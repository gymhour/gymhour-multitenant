import type { Request, Response } from 'express';
import prisma, { systemPrisma } from '../models/Prisma.js';
import { generateKioskToken, hashKioskToken } from '../services/kioskAuth.service.js';
import { respondUnexpected } from '../services/apiError.service.js';
import { deleteImage, getTenantLogoUrl, uploadImageBuffer } from '../services/cloudinary.service.js';

const normalizeSlug = (value: unknown): string => String(value ?? '')
  .trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

const availableSlug = async (name: string, tenantId: number): Promise<string> => {
  const base = normalizeSlug(name) || 'gimnasio';
  const matches = await systemPrisma.tenant.findMany({
    where: { slug: { startsWith: base }, id: { not: tenantId } },
    select: { slug: true },
  });
  const taken = new Set(matches.map(item => item.slug));
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix <= 9999; suffix += 1) {
    const candidate = `${base.slice(0, 50 - String(suffix).length - 1)}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base.slice(0, 41)}-${Date.now().toString(36)}`;
};

export const listKiosks = async (_req: Request, res: Response): Promise<void> => {
  const kiosks = await prisma.tenantKioskCredential.findMany({
    select: { id: true, label: true, active: true, lastUsedAt: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json({ kiosks });
};

export const createKiosk = async (req: Request, res: Response): Promise<void> => {
  try {
    const token = generateKioskToken();
    const kiosk = await prisma.tenantKioskCredential.create({
      data: { label: String(req.body?.label ?? '').trim() || 'Kiosco principal', tokenHash: hashKioskToken(token) },
      select: { id: true, label: true, active: true, createdAt: true },
    });
    res.status(201).json({ kiosk, activationToken: token });
  } catch (error) { respondUnexpected(res, error, 'crear la credencial de kiosco'); }
};

export const revokeKiosk = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ message: 'Credencial inválida.' }); return; }
  const result = await prisma.tenantKioskCredential.updateMany({ where: { id }, data: { active: false } });
  if (!result.count) { res.status(404).json({ message: 'Credencial no encontrada.' }); return; }
  res.status(204).send();
};

export const rotateKiosk = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ message: 'Credencial inválida.' }); return; }
  const current = await prisma.tenantKioskCredential.findUnique({ where: { id } });
  if (!current) { res.status(404).json({ message: 'Credencial no encontrada.' }); return; }
  const token = generateKioskToken();
  try {
    const [, kiosk] = await prisma.$transaction([
      prisma.tenantKioskCredential.update({ where: { id }, data: { active: false } }),
      prisma.tenantKioskCredential.create({
        data: { label: `${current.label} (rotada)`, tokenHash: hashKioskToken(token) },
        select: { id: true, label: true, active: true, createdAt: true },
      }),
    ]);
    res.status(201).json({ kiosk, activationToken: token });
  } catch (error) { respondUnexpected(res, error, 'rotar la credencial de kiosco'); }
};

export const updateSettings = async (req: Request, res: Response): Promise<void> => {
  const allowed = ['timezone', 'currency', 'paymentAccountHolder', 'paymentAlias', 'paymentCbu', 'paymentTaxId', 'paymentWhatsapp'] as const;
  const data: Record<string, string | null> = {};
  for (const field of allowed) {
    if (req.body?.[field] !== undefined) data[field] = String(req.body[field]).trim() || null;
  }
  if (!Object.keys(data).length) { res.status(400).json({ message: 'No hay cambios para guardar.' }); return; }
  if (data.timezone === null || data.currency === null) {
    res.status(400).json({ message: 'Zona horaria y moneda no pueden quedar vacías.' });
    return;
  }
  if (data.currency) data.currency = data.currency.toUpperCase().slice(0, 3);
  try {
    const settings = await prisma.tenantSettings.update({ where: { tenantId: req.tenant!.id }, data });
    res.json({ settings });
  } catch (error) { respondUnexpected(res, error, 'actualizar la configuración'); }
};

export const completeOnboarding = async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenant!.id;
  const name = String(req.body?.name ?? '').trim();
  const primaryColor = String(req.body?.primaryColor ?? '').trim().toUpperCase();
  const contactPhone = String(req.body?.contactPhone ?? '').trim();
  const contactEmail = String(req.body?.contactEmail ?? '').trim().toLowerCase() || null;
  const location = String(req.body?.location ?? '').trim() || null;

  if (name.length < 3 || !/^#[0-9A-F]{6}$/.test(primaryColor) || contactPhone.length < 6) {
    res.status(400).json({ message: 'Completá el nombre, un color válido y un número de contacto.' });
    return;
  }
  if (contactEmail && !/^\S+@\S+\.\S+$/.test(contactEmail)) {
    res.status(400).json({ message: 'El email de contacto no es válido.' });
    return;
  }
  if (!req.file?.buffer) {
    res.status(400).json({ message: 'Subí el logo de tu gimnasio.' });
    return;
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(req.file.mimetype)) {
    res.status(400).json({ message: 'El logo debe ser PNG, JPG o WebP.' });
    return;
  }

  let uploadedPublicId: string | null = null;
  try {
    const current = await systemPrisma.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
    const uploaded = await uploadImageBuffer(req.file.buffer, `logo-${tenantId}`, 'branding', tenantId);
    uploadedPublicId = uploaded.public_id;
    const slug = await availableSlug(name, tenantId);
    const [, settings] = await systemPrisma.$transaction([
      systemPrisma.tenant.update({ where: { id: tenantId }, data: { name, slug } }),
      systemPrisma.tenantSettings.update({
        where: { tenantId },
        data: { primaryColor, contactPhone, contactEmail, location, logoPublicId: uploadedPublicId, onboardingCompleted: true },
      }),
    ]);
    if (current.logoPublicId && current.logoPublicId !== uploadedPublicId) {
      try { await deleteImage(current.logoPublicId, tenantId); } catch (error) {
        console.error('No se pudo eliminar el logo anterior:', error);
      }
    }
    const logoUrl = getTenantLogoUrl(uploadedPublicId);
    res.json({
      tenant: { id: tenantId, name, slug },
      settings: { ...settings, logoUrl },
    });
  } catch (error) {
    if (uploadedPublicId) {
      try { await deleteImage(uploadedPublicId, tenantId); } catch { /* El registro se limpia en un mantenimiento posterior. */ }
    }
    respondUnexpected(res, error, 'completar la configuración inicial');
  }
};

export const updateProfile = async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenant!.id;
  const name = String(req.body?.name ?? '').trim();
  const primaryColor = String(req.body?.primaryColor ?? '').trim().toUpperCase();
  const contactPhone = String(req.body?.contactPhone ?? '').trim();
  const contactEmail = String(req.body?.contactEmail ?? '').trim().toLowerCase() || null;
  const location = String(req.body?.location ?? '').trim() || null;

  if (name.length < 3 || !/^#[0-9A-F]{6}$/.test(primaryColor) || contactPhone.length < 6) {
    res.status(400).json({ message: 'Completá el nombre, un color válido y un número de contacto.' }); return;
  }
  if (contactEmail && !/^\S+@\S+\.\S+$/.test(contactEmail)) {
    res.status(400).json({ message: 'El email de contacto no es válido.' }); return;
  }
  if (req.file && !['image/png', 'image/jpeg', 'image/webp'].includes(req.file.mimetype)) {
    res.status(400).json({ message: 'El logo debe ser PNG, JPG o WebP.' }); return;
  }

  let uploadedPublicId: string | null = null;
  try {
    const current = await systemPrisma.tenantSettings.findUniqueOrThrow({ where: { tenantId } });
    if (req.file?.buffer) {
      const uploaded = await uploadImageBuffer(
        req.file.buffer,
        `logo-${tenantId}-${Date.now().toString(36)}`,
        'branding',
        tenantId,
      );
      uploadedPublicId = uploaded.public_id;
    }
    const [, settings] = await systemPrisma.$transaction([
      systemPrisma.tenant.update({ where: { id: tenantId }, data: { name } }),
      systemPrisma.tenantSettings.update({
        where: { tenantId },
        data: { primaryColor, contactPhone, contactEmail, location, ...(uploadedPublicId ? { logoPublicId: uploadedPublicId } : {}) },
      }),
    ]);
    if (uploadedPublicId && current.logoPublicId && current.logoPublicId !== uploadedPublicId) {
      try { await deleteImage(current.logoPublicId, tenantId); } catch (error) {
        console.error('No se pudo eliminar el logo reemplazado:', error);
      }
    }
    res.json({
      tenant: { ...req.tenant, name },
      settings: { ...settings, logoUrl: settings.logoPublicId ? getTenantLogoUrl(settings.logoPublicId) : null },
    });
  } catch (error) {
    if (uploadedPublicId) {
      try { await deleteImage(uploadedPublicId, tenantId); } catch { /* Se audita posteriormente. */ }
    }
    respondUnexpected(res, error, 'actualizar el perfil del gimnasio');
  }
};

export const tenantMethods = { listKiosks, createKiosk, revokeKiosk, rotateKiosk, updateSettings, completeOnboarding, updateProfile };
