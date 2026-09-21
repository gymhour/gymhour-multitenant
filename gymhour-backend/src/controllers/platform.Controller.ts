import type { Request, Response } from 'express';
import { systemPrisma } from '../models/Prisma.js';
import {
  auditPlatform, consumeLoginChallenge, createLoginChallenge, createPlatformSession,
  destroyPlatformSession, platformCsrfToken, requestIdentity, verifyAndConsumeMfa,
  verifyPlatformPassword,
} from '../services/platformSecurity.service.js';
import {
  collectTenantAssets, processTenantDeletionJob, purgeTenantDatabase,
} from '../services/tenantDeletion.service.js';

const normalizeEmail = (value: unknown) => String(value ?? '').trim().toLowerCase();
const cleanReason = (value: unknown) => String(value ?? '').trim().slice(0, 500);
const invalidLogin = (res: Response) => res.status(401).json({ message: 'Credenciales incorrectas.' });
const DUMMY_PASSWORD_HASH = '$argon2id$v=19$m=65536,p=1,t=3$E4lWpd9WdNoECOZyudq1EQ$vlmpxekhQ8gvEmfjTXOjJIg94DZJ/r8gVekOPOWtrAM';

export async function login(req: Request, res: Response): Promise<void> {
  const email = normalizeEmail(req.body?.email);
  const password = String(req.body?.password ?? '');
  const user = email ? await systemPrisma.platformUser.findUnique({ where: { email } }) : null;
  const passwordMatches = await verifyPlatformPassword(user?.password ?? DUMMY_PASSWORD_HASH, password);
  const valid = Boolean(user && user.active && user.mfaEnabledAt && user.mfaSecretEncrypted
    && (!user.lockedUntil || user.lockedUntil <= new Date())
    && passwordMatches);
  if (!valid || !user) {
    if (user) {
      const failures = user.failedLoginCount + 1;
      await systemPrisma.platformUser.update({ where: { id: user.id }, data: {
        failedLoginCount: failures,
        ...(failures >= 5 ? { lockedUntil: new Date(Date.now() + 15 * 60 * 1000), failedLoginCount: 0 } : {}),
      } });
    }
    await systemPrisma.platformAuditLog.create({ data: {
      platformUserId: user?.id ?? null, platformUserEmail: user?.email ?? (email || null),
      action: 'LOGIN_PASSWORD', outcome: 'FAILURE', ...requestIdentity(req),
    } });
    invalidLogin(res); return;
  }
  await systemPrisma.platformUser.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } });
  await createLoginChallenge(res, user.id);
  req.platformUser = user;
  await auditPlatform(req, { action: 'LOGIN_PASSWORD', outcome: 'SUCCESS' });
  res.json({ requiresMfa: true });
}

export async function verifyMfa(req: Request, res: Response): Promise<void> {
  const pending = await consumeLoginChallenge(req);
  if (!pending) { invalidLogin(res); return; }
  req.platformUser = pending.user;
  const valid = await verifyAndConsumeMfa(pending.user, String(req.body?.code ?? ''));
  if (!valid) {
    await systemPrisma.platformAuthChallenge.update({ where: { id: pending.challenge.id }, data: { attempts: { increment: 1 } } });
    await auditPlatform(req, { action: 'LOGIN_MFA', outcome: 'FAILURE' });
    invalidLogin(res); return;
  }
  await systemPrisma.platformAuthChallenge.delete({ where: { id: pending.challenge.id } });
  await systemPrisma.platformUser.update({ where: { id: pending.user.id }, data: { lastLoginAt: new Date() } });
  const csrfToken = await createPlatformSession(req, res, pending.user);
  await auditPlatform(req, { action: 'LOGIN_MFA', outcome: 'SUCCESS' });
  res.json({ user: { id: pending.user.id, email: pending.user.email, role: pending.user.role }, csrfToken });
}

export async function me(req: Request, res: Response): Promise<void> {
  const csrfToken = await platformCsrfToken(req);
  const recoveryCodesRemaining = await systemPrisma.platformRecoveryCode.count({
    where: { platformUserId: req.platformUser!.id, usedAt: null },
  });
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    user: { id: req.platformUser!.id, email: req.platformUser!.email, role: req.platformUser!.role },
    csrfToken, recoveryCodesRemaining,
  });
}

export async function logout(req: Request, res: Response): Promise<void> {
  await auditPlatform(req, { action: 'LOGOUT', outcome: 'SUCCESS' });
  await destroyPlatformSession(req, res);
  res.status(204).end();
}

const monthKey = (date: Date) => `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

export async function dashboard(_req: Request, res: Response): Promise<void> {
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const since12 = new Date();
  since12.setUTCMonth(since12.getUTCMonth() - 11, 1);
  since12.setUTCHours(0, 0, 0, 0);
  const [tenantTotal, activeTenants, suspendedTenants, newTenants, tenantDates] = await Promise.all([
    systemPrisma.tenant.count(),
    systemPrisma.tenant.count({ where: { status: 'ACTIVE' } }),
    systemPrisma.tenant.count({ where: { status: 'SUSPENDED' } }),
    systemPrisma.tenant.count({ where: { createdAt: { gte: since30 } } }),
    systemPrisma.tenant.findMany({ where: { createdAt: { gte: since12 } }, select: { createdAt: true } }),
  ]);
  const months: Record<string, { month: string; tenantsCreated: number }> = {};
  for (let offset = 0; offset < 12; offset += 1) {
    const date = new Date(Date.UTC(since12.getUTCFullYear(), since12.getUTCMonth() + offset, 1));
    const key = monthKey(date); months[key] = { month: key, tenantsCreated: 0 };
  }
  tenantDates.forEach(item => { const key = monthKey(item.createdAt); if (months[key]) months[key].tenantsCreated += 1; });
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    summary: {
      tenants: { total: tenantTotal, active: activeTenants, suspended: suspendedTenants, createdLast30Days: newTenants },
    },
    trends: Object.values(months),
  });
}

const pagination = (req: Request) => {
  const page = Math.max(1, Number.parseInt(String(req.query.page ?? '1'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(String(req.query.pageSize ?? '25'), 10) || 25));
  return { page, pageSize, skip: (page - 1) * pageSize };
};

export async function listTenants(req: Request, res: Response): Promise<void> {
  const { page, pageSize, skip } = pagination(req);
  const search = String(req.query.search ?? '').trim().slice(0, 100);
  const status = req.query.status === 'ACTIVE' || req.query.status === 'SUSPENDED' ? req.query.status : undefined;
  const sort = ['name', 'createdAt', 'lastActivityAt'].includes(String(req.query.sort)) ? String(req.query.sort) : 'createdAt';
  const direction = req.query.direction === 'asc' || req.query.direction === 'desc'
    ? req.query.direction : sort === 'name' ? 'asc' : 'desc';
  const where: any = {
    ...(status ? { status } : {}),
    ...(search ? { OR: [
      { name: { contains: search } }, { slug: { contains: search } },
      { settings: { is: { contactEmail: { contains: search } } } },
      { users: { some: { role: 'ADMIN', email: { contains: search } } } },
    ] } : {}),
  };
  const [total, tenants] = await Promise.all([
    systemPrisma.tenant.count({ where }),
    systemPrisma.tenant.findMany({
      where, skip, take: pageSize, orderBy: { [sort]: direction },
      include: {
        settings: { select: { contactEmail: true, contactPhone: true, location: true, onboardingCompleted: true } },
        users: { where: { role: 'ADMIN' }, select: { ID_Usuario: true, nombre: true, apellido: true, email: true, estado: true } },
      },
    }),
  ]);
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    items: tenants,
    pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) },
  });
}

export async function tenantDetail(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ message: 'Tenant inválido.' }); return; }
  const tenant = await systemPrisma.tenant.findUnique({
    where: { id },
    include: {
      settings: { select: {
        contactEmail: true, contactPhone: true, location: true, timezone: true, currency: true,
        onboardingCompleted: true, aiEnabled: true, aiMonthlyTokenLimit: true,
      } },
      users: { where: { role: 'ADMIN' }, select: {
        ID_Usuario: true, nombre: true, apellido: true, email: true, estado: true, fechaRegistro: true,
      } },
    },
  });
  if (!tenant) { res.status(404).json({ message: 'Tenant no encontrado.' }); return; }
  res.setHeader('Cache-Control', 'no-store');
  res.json(tenant);
}

export async function changeTenantStatus(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const status = req.body?.status;
  const reason = cleanReason(req.body?.reason);
  if (!Number.isInteger(id) || !['ACTIVE', 'SUSPENDED'].includes(status) || reason.length < 5) {
    res.status(400).json({ message: 'Indicá un estado y un motivo de al menos 5 caracteres.' }); return;
  }
  if (!await verifyAndConsumeMfa(req.platformUser!, String(req.body?.mfaCode ?? ''))) {
    await auditPlatform(req, { action: `TENANT_${status}`, outcome: 'FAILURE', targetTenantId: id, reason });
    res.status(401).json({ message: 'El código MFA no es válido o ya fue utilizado.' }); return;
  }
  const current = await systemPrisma.tenant.findUnique({ where: { id } });
  if (!current) { res.status(404).json({ message: 'Tenant no encontrado.' }); return; }
  if (current.status === status) { res.status(409).json({ message: `El tenant ya está ${status === 'ACTIVE' ? 'activo' : 'suspendido'}.` }); return; }
  await systemPrisma.$transaction(async tx => {
    await tx.tenant.update({ where: { id }, data: status === 'SUSPENDED'
      ? { status, suspendedAt: new Date(), suspensionReason: reason }
      : { status, suspendedAt: null, suspensionReason: null } });
    if (status === 'SUSPENDED') {
      await tx.user.updateMany({ where: { tenantId: id }, data: { authVersion: { increment: 1 } } });
    }
    await tx.platformAuditLog.create({ data: {
      platformUserId: req.platformUser!.id, platformUserEmail: req.platformUser!.email,
      action: status === 'SUSPENDED' ? 'TENANT_SUSPEND' : 'TENANT_REACTIVATE', outcome: 'SUCCESS',
      targetTenantId: id, targetTenantSlug: current.slug, reason, ...requestIdentity(req),
    } });
  });
  res.json({ id, status, reason });
}

export async function purgeTenant(req: Request, res: Response): Promise<void> {
  const id = Number(req.params.id);
  const slug = String(req.body?.slug ?? '').trim();
  const password = String(req.body?.password ?? '');
  const reason = cleanReason(req.body?.reason) || 'Eliminación definitiva desde plataforma';
  if (!Number.isInteger(id) || !slug || !password) { res.status(400).json({ message: 'Completá todos los datos de confirmación.' }); return; }
  const tenant = await systemPrisma.tenant.findUnique({ where: { id }, select: { id: true, slug: true, name: true } });
  if (!tenant) { res.status(404).json({ message: 'Tenant no encontrado.' }); return; }
  const passwordValid = await verifyPlatformPassword(req.platformUser!.password, password);
  const mfaValid = passwordValid && await verifyAndConsumeMfa(req.platformUser!, String(req.body?.mfaCode ?? ''));
  if (tenant.slug !== slug || !passwordValid || !mfaValid) {
    await auditPlatform(req, { action: 'TENANT_DELETE', outcome: 'FAILURE', targetTenantId: id, targetTenantSlug: tenant.slug, reason });
    res.status(401).json({ message: 'La confirmación, contraseña o MFA no son válidos.' }); return;
  }
  const assets = await collectTenantAssets(id);
  const identity = requestIdentity(req);
  const jobId = await purgeTenantDatabase({ tenant, actor: req.platformUser!, assets, reason, ...identity });
  const cleanup = await processTenantDeletionJob(jobId);
  res.status(cleanup === 'COMPLETED' ? 200 : 202).json({
    deleted: true, deletionJobId: jobId, mediaCleanupStatus: cleanup,
  });
}

export async function auditList(req: Request, res: Response): Promise<void> {
  const { page, pageSize, skip } = pagination(req);
  const tenantId = Number(req.query.tenantId);
  const action = String(req.query.action ?? '').trim();
  const outcome = String(req.query.outcome ?? '').trim();
  const where = {
    ...(Number.isInteger(tenantId) && tenantId > 0 ? { targetTenantId: tenantId } : {}),
    ...(action ? { action } : {}), ...(outcome ? { outcome } : {}),
  };
  const [total, items] = await Promise.all([
    systemPrisma.platformAuditLog.count({ where }),
    systemPrisma.platformAuditLog.findMany({ where, skip, take: pageSize, orderBy: { createdAt: 'desc' } }),
  ]);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ items: items.map(item => ({ ...item, id: item.id.toString() })), pagination: { page, pageSize, total, pages: Math.ceil(total / pageSize) } });
}

export const platformMethods = {
  login, verifyMfa, me, logout, dashboard, listTenants, tenantDetail, changeTenantStatus, purgeTenant, auditList,
};
