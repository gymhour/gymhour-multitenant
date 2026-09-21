import type { NextFunction, Request, Response } from 'express';
import type { PlatformUser, TenantRole, User } from '@prisma/client';
import jwt from 'jsonwebtoken';
import prisma, { systemPrisma } from '../models/Prisma.js';
import { runWithTenantContext } from './tenantContext.service.js';

const JWT_SECRET = process.env.JWT_SECRET ?? '';
if (!JWT_SECRET) throw new Error('FATAL: la variable de entorno JWT_SECRET no está definida.');

type TenantTokenPayload = {
  sub: string;
  tenantId: number;
  role: TenantRole;
  authVersion: number;
  scope: 'tenant';
};

type PlatformTokenPayload = {
  sub: string;
  role: 'SUPER_ADMIN';
  authVersion: number;
  scope: 'platform';
};

export type TenantSelectionCandidate = {
  userId: number;
  tenantId: number;
  authVersion: number;
};

type TenantSelectionTokenPayload = {
  memberships: TenantSelectionCandidate[];
  scope: 'tenant-selection';
};

export const generateToken = (user: Pick<User, 'ID_Usuario' | 'tenantId' | 'role' | 'authVersion'>): string => (
  jwt.sign({
    sub: String(user.ID_Usuario), tenantId: user.tenantId, role: user.role,
    authVersion: user.authVersion, scope: 'tenant',
  } satisfies TenantTokenPayload, JWT_SECRET, { expiresIn: '1h' })
);

export const generatePlatformToken = (user: PlatformUser): string => (
  jwt.sign({
    sub: String(user.id), role: user.role, authVersion: user.authVersion, scope: 'platform',
  } satisfies PlatformTokenPayload, JWT_SECRET, { expiresIn: '1h' })
);

export const generateTenantSelectionToken = (memberships: TenantSelectionCandidate[]): string => (
  jwt.sign({ memberships, scope: 'tenant-selection' } satisfies TenantSelectionTokenPayload, JWT_SECRET, { expiresIn: '5m' })
);

export const verifyTenantSelectionToken = (token: string): TenantSelectionCandidate[] => {
  const payload = jwt.verify(token, JWT_SECRET) as TenantSelectionTokenPayload;
  if (payload.scope !== 'tenant-selection' || !Array.isArray(payload.memberships) || payload.memberships.length < 2) {
    throw new Error('INVALID_TENANT_SELECTION_TOKEN');
  }
  const valid = payload.memberships.every(candidate => Number.isInteger(candidate.userId)
    && Number.isInteger(candidate.tenantId) && Number.isInteger(candidate.authVersion));
  if (!valid) throw new Error('INVALID_TENANT_SELECTION_TOKEN');
  return payload.memberships;
};

const bearerToken = (req: Request): string | null => {
  const [scheme, token] = String(req.headers.authorization ?? '').split(' ');
  return scheme === 'Bearer' && token ? token : null;
};

export async function authenticateToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as TenantTokenPayload;
    if (payload.scope !== 'tenant' || !Number.isInteger(payload.tenantId)) throw new Error('INVALID_TOKEN_SCOPE');
    const userId = Number(payload.sub);
    const user = await systemPrisma.user.findFirst({
      where: { ID_Usuario: userId, tenantId: payload.tenantId },
      select: { ID_Usuario: true, tenantId: true, email: true, role: true, authVersion: true, estado: true, setupGuideDismissedAt: true },
    });
    if (!user || user.estado !== true || user.authVersion !== payload.authVersion || user.role !== payload.role) {
      throw new Error('STALE_OR_INVALID_TOKEN');
    }

    const tenant = await systemPrisma.tenant.findUnique({ where: { id: user.tenantId } });
    if (!tenant || tenant.status !== 'ACTIVE') {
      res.status(403).json({ error: 'El gimnasio no está habilitado.' });
      return;
    }

    req.user = {
      id: user.ID_Usuario, tenantId: user.tenantId, email: user.email,
      role: user.role, authVersion: user.authVersion, setupGuideDismissedAt: user.setupGuideDismissedAt,
    };
    req.tenant = { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status };
    if (!tenant.lastActivityAt || tenant.lastActivityAt.getTime() < Date.now() - 15 * 60 * 1000) {
      void systemPrisma.tenant.update({ where: { id: tenant.id }, data: { lastActivityAt: new Date() } }).catch(() => undefined);
    }
    runWithTenantContext({ tenantId: tenant.id, user: req.user, tenant: req.tenant, db: prisma, source: 'JWT' }, next);
  } catch (error) {
    console.error('Error en la autenticación:', error);
    res.status(401).json({ error: 'No autorizado' });
  }
}

export const requireRoles = (...roles: TenantRole[]) => (
  (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || !roles.includes(req.user.role)) {
      res.status(403).json({ error: `Acceso denegado: se requiere uno de los roles [${roles.join(', ')}]` });
      return;
    }
    next();
  }
);

export const isAdminOrEntrenador = requireRoles('ADMIN', 'TRAINER');
export const isAdmin = requireRoles('ADMIN');

export function isSelfOrStaff(req: Request, res: Response, next: NextFunction): void {
  return isSelfOrStaffParam('id')(req, res, next);
}

export const isSelfOrStaffParam = (paramName: string) => (
  (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }
  const targetId = Number.parseInt(req.params[paramName], 10);
  const staff = req.user.role === 'ADMIN' || req.user.role === 'TRAINER';
  if (!staff && req.user.id !== targetId) {
    res.status(404).json({ error: 'Recurso no encontrado' });
    return;
  }
  next();
});

export async function authenticatePlatformToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = bearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET) as PlatformTokenPayload;
    if (payload.scope !== 'platform' || payload.role !== 'SUPER_ADMIN') throw new Error('INVALID_TOKEN_SCOPE');
    const platformUser = await systemPrisma.platformUser.findUnique({ where: { id: Number(payload.sub) } });
    if (!platformUser || !platformUser.active || platformUser.role !== 'SUPER_ADMIN'
      || platformUser.authVersion !== payload.authVersion) throw new Error('STALE_OR_INVALID_TOKEN');
    req.platformUser = platformUser;
    next();
  } catch {
    res.status(401).json({ error: 'No autorizado' });
  }
}

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.platformUser || req.platformUser.role !== 'SUPER_ADMIN') {
    res.status(403).json({ error: 'Acceso denegado' });
    return;
  }
  next();
}

export const authServices = {
  generateToken, generatePlatformToken, generateTenantSelectionToken, verifyTenantSelectionToken,
  authenticateToken, authenticatePlatformToken, isAdmin, requireRoles,
  isAdminOrEntrenador, isSelfOrStaff, isSelfOrStaffParam, requireSuperAdmin,
};
