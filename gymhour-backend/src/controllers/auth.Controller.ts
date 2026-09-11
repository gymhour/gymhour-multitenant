import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { systemPrisma } from '../models/Prisma.js';
import { respondUnexpected } from '../services/apiError.service.js';
import { authServices } from '../services/auth.service.js';
import { sendResetPasswordEmail, sendWelcomeEmail } from '../services/email.service.js';
import { comparePassword, hashPassword } from '../services/password.service.js';

const TIMEZONE = process.env.TIMEZONE || 'America/Argentina/Cordoba';
const normalizeEmail = (value: unknown): string => String(value ?? '').trim().toLowerCase();
const normalizeSlug = (value: unknown): string => String(value ?? '')
  .trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);
const hashOpaqueToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');

const availableTenantSlug = async (gymName: string): Promise<string> => {
  const base = normalizeSlug(gymName) || 'gimnasio';
  const existing = await systemPrisma.tenant.findMany({
    where: { slug: { startsWith: base } },
    select: { slug: true },
  });
  const taken = new Set(existing.map(tenant => tenant.slug));
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix <= 9999; suffix += 1) {
    const candidate = `${base.slice(0, 50 - String(suffix).length - 1)}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 41)}-${crypto.randomBytes(4).toString('hex')}`;
};

const birthdayToday = (fechaCumple: Date | null): boolean => {
  if (!fechaCumple) return false;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: TIMEZONE, month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const month = Number(parts.find(part => part.type === 'month')?.value);
  const day = Number(parts.find(part => part.type === 'day')?.value);
  return fechaCumple.getUTCMonth() + 1 === month && fechaCumple.getUTCDate() === day;
};

export const registerTenant = async (req: Request, res: Response): Promise<void> => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');

  if (!email || !/^\S+@\S+\.\S+$/.test(email) || password.length < 8) {
    res.status(400).json({ message: 'Ingresá un email válido y una contraseña de al menos 8 caracteres.' });
    return;
  }

  try {
    const passwordHash = await hashPassword(password);
    const kioskToken = crypto.randomBytes(32).toString('base64url');
    let result;
    for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
      const slug = await availableTenantSlug(`nuevo-gimnasio-${crypto.randomBytes(4).toString('hex')}`);
      try {
        result = await systemPrisma.$transaction(async tx => {
          const tenant = await tx.tenant.create({
            data: {
              name: 'Mi gimnasio',
              slug,
              settings: { create: { timezone: TIMEZONE, currency: 'ARS', onboardingCompleted: false } },
              kiosks: { create: { tokenHash: hashOpaqueToken(kioskToken) } },
            },
          });
          const user = await tx.user.create({
            data: {
              tenantId: tenant.id, email, password: passwordHash,
              role: 'ADMIN', estado: true,
            },
          });
          return { tenant, user };
        });
      } catch (error: any) {
        if (error?.code !== 'P2002' || attempt === 2) throw error;
      }
    }
    if (!result) throw new Error('TENANT_CREATION_FAILED');

    if (process.env.NODE_ENV !== 'test') {
      try { await sendWelcomeEmail(result.user.email, result.user.nombre ?? ''); } catch (error) {
        console.error('No se pudo enviar el email de bienvenida:', error);
      }
    }

    res.status(201).json({
      token: authServices.generateToken(result.user),
      user: { id: result.user.ID_Usuario, email: result.user.email, role: result.user.role },
      tenant: { id: result.tenant.id, name: result.tenant.name, slug: result.tenant.slug, onboardingCompleted: false },
      kioskActivationToken: kioskToken,
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      res.status(409).json({ message: 'No pudimos generar un identificador disponible. Intentá nuevamente.' });
      return;
    }
    respondUnexpected(res, error, 'crear el gimnasio');
  }
};

export const login = async (req: Request, res: Response): Promise<void> => {
  const slug = normalizeSlug(req.params.slug);
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const invalid = () => res.status(401).json({ message: 'Gimnasio, email o contraseña incorrectos.' });

  if (!slug || !email || !password) { invalid(); return; }
  try {
    const tenant = await systemPrisma.tenant.findUnique({ where: { slug } });
    if (!tenant || tenant.status !== 'ACTIVE') { invalid(); return; }
    const user = await systemPrisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
    });
    if (!user || user.estado !== true || !(await comparePassword(password, user.password))) {
      invalid(); return;
    }
    res.status(200).json({ token: authServices.generateToken(user), isBirthday: birthdayToday(user.fechaCumple) });
  } catch (error) {
    respondUnexpected(res, error, 'iniciar sesión');
  }
};

export const loginWithoutTenant = async (req: Request, res: Response): Promise<void> => {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const invalid = () => res.status(401).json({ message: 'Email o contraseña incorrectos.' });

  if (!email || !password) { invalid(); return; }
  try {
    const candidates = await systemPrisma.user.findMany({
      where: { email, estado: true, tenant: { status: 'ACTIVE' } },
      include: { tenant: true },
      orderBy: { tenantId: 'asc' },
    });
    const passwordMatches = await Promise.all(candidates.map(user => comparePassword(password, user.password)));
    const matches = candidates.filter((_user, index) => passwordMatches[index]);
    if (!matches.length) { invalid(); return; }

    if (matches.length === 1) {
      const [user] = matches;
      res.status(200).json({
        requiresTenantSelection: false,
        token: authServices.generateToken(user),
        isBirthday: birthdayToday(user.fechaCumple),
      });
      return;
    }

    const memberships = matches.map(user => ({
      userId: user.ID_Usuario,
      tenantId: user.tenantId,
      authVersion: user.authVersion,
    }));
    res.status(200).json({
      requiresTenantSelection: true,
      selectionToken: authServices.generateTenantSelectionToken(memberships),
      tenants: matches.map(user => ({
        id: user.tenant.id,
        name: user.tenant.name,
        slug: user.tenant.slug,
        role: user.role,
      })),
    });
  } catch (error) {
    respondUnexpected(res, error, 'iniciar sesión');
  }
};

export const selectLoginTenant = async (req: Request, res: Response): Promise<void> => {
  const selectionToken = String(req.body?.selectionToken ?? '');
  const tenantId = Number(req.body?.tenantId);
  const invalid = () => res.status(401).json({ message: 'La selección venció. Iniciá sesión nuevamente.' });

  if (!selectionToken || !Number.isInteger(tenantId)) { invalid(); return; }
  try {
    const memberships = authServices.verifyTenantSelectionToken(selectionToken);
    const selected = memberships.find(candidate => candidate.tenantId === tenantId);
    if (!selected) { invalid(); return; }
    const user = await systemPrisma.user.findFirst({
      where: {
        ID_Usuario: selected.userId,
        tenantId: selected.tenantId,
        authVersion: selected.authVersion,
        estado: true,
        tenant: { status: 'ACTIVE' },
      },
      include: { tenant: true },
    });
    if (!user) { invalid(); return; }
    res.status(200).json({
      requiresTenantSelection: false,
      token: authServices.generateToken(user),
      isBirthday: birthdayToday(user.fechaCumple),
    });
  } catch {
    invalid();
  }
};

export const me = async (req: Request, res: Response): Promise<void> => {
  if (!req.user || !req.tenant) { res.status(401).json({ error: 'No autorizado' }); return; }
  const settings = await systemPrisma.tenantSettings.findUnique({ where: { tenantId: req.tenant.id } });
  let enrichedSettings: any = settings;
  if (settings?.logoPublicId) {
    const { getTenantLogoUrl } = await import('../services/cloudinary.service.js');
    enrichedSettings = { ...settings, logoUrl: getTenantLogoUrl(settings.logoPublicId) };
  }
  res.json({ user: req.user, tenant: { ...req.tenant, settings: enrichedSettings } });
};

export const forgotPassword = async (req: Request, res: Response): Promise<void> => {
  const slug = normalizeSlug(req.params.slug);
  const email = normalizeEmail(req.body?.email);
  const response = { message: 'Si esos datos existen, recibirás instrucciones.' };
  if (!slug || !email) { res.json(response); return; }
  try {
    const tenant = await systemPrisma.tenant.findUnique({ where: { slug } });
    const user = tenant ? await systemPrisma.user.findUnique({
      where: { tenantId_email: { tenantId: tenant.id, email } },
    }) : null;
    if (!user) { res.json(response); return; }
    const token = crypto.randomBytes(32).toString('hex');
    await systemPrisma.user.update({
      where: { ID_Usuario: user.ID_Usuario },
      data: { resetToken: token, resetTokenExpiry: new Date(Date.now() + 15 * 60 * 1000) },
    });
    if (process.env.NODE_ENV !== 'test') {
      try {
        await sendResetPasswordEmail(user.email, `${process.env.FRONTEND_URL}/g/${slug}/reset-password?token=${token}`);
      } catch (error) { console.error('Error enviando email de reset:', error); }
    }
    res.json(response);
  } catch (error) { respondUnexpected(res, error, 'recuperar la contraseña'); }
};

export const resetPassword = async (req: Request, res: Response): Promise<void> => {
  const token = String(req.body?.token ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
  if (!token || newPassword.length < 8) {
    res.status(400).json({ message: 'El enlace no es válido o la contraseña es demasiado corta.' });
    return;
  }
  const user = await systemPrisma.user.findFirst({
    where: { resetToken: token, resetTokenExpiry: { gt: new Date() } },
  });
  if (!user) { res.status(400).json({ message: 'El enlace venció o no es válido.' }); return; }
  await systemPrisma.user.update({
    where: { ID_Usuario: user.ID_Usuario },
    data: { password: await hashPassword(newPassword), resetToken: null, resetTokenExpiry: null, authVersion: { increment: 1 } },
  });
  res.json({ message: 'Contraseña reseteada con éxito.' });
};

export const changePassword = async (req: Request, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ message: 'No autorizado' }); return; }
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');
  if (!currentPassword || newPassword.length < 8) {
    res.status(400).json({ message: 'Completá la contraseña actual y una nueva de al menos 8 caracteres.' });
    return;
  }
  const user = await systemPrisma.user.findFirst({ where: { ID_Usuario: req.user.id, tenantId: req.user.tenantId } });
  if (!user || !(await comparePassword(currentPassword, user.password))) {
    res.status(401).json({ message: 'La contraseña actual es incorrecta.' }); return;
  }
  await systemPrisma.user.update({
    where: { ID_Usuario: user.ID_Usuario },
    data: { password: await hashPassword(newPassword), authVersion: { increment: 1 } },
  });
  res.json({ message: 'Contraseña cambiada exitosamente.' });
};

export const authMethods = {
  registerTenant, login, loginWithoutTenant, selectLoginTenant, me, forgotPassword, resetPassword, changePassword,
};
