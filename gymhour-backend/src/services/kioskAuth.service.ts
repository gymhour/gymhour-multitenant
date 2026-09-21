import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import prisma, { systemPrisma } from '../models/Prisma.js';
import { runWithTenantContext } from './tenantContext.service.js';

export const hashKioskToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');
export const generateKioskToken = (): string => crypto.randomBytes(32).toString('base64url');

const normalizeSlug = (value: unknown): string => String(value ?? '')
  .trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

export async function authenticatePublicTenant(req: Request, res: Response, next: NextFunction): Promise<void> {
  const slug = normalizeSlug(req.params.slug);
  const tenant = slug ? await systemPrisma.tenant.findFirst({
    where: { slug, status: 'ACTIVE', settings: { is: { onboardingCompleted: true } } },
  }) : null;
  if (!tenant) { res.status(404).json({ error: 'Gimnasio no encontrado.' }); return; }
  req.tenant = { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status };
  runWithTenantContext({ tenantId: tenant.id, user: null, tenant: req.tenant, db: prisma, source: 'KIOSK' }, next);
}

export async function authenticateKiosk(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = String(req.headers['x-kiosk-token'] ?? '');
  if (!token) { res.status(401).json({ error: 'Credencial de kiosco requerida.' }); return; }

  const credential = await systemPrisma.tenantKioskCredential.findUnique({
    where: { tokenHash: hashKioskToken(token) },
    include: { tenant: true },
  });
  if (!credential || !credential.active || credential.tenant.status !== 'ACTIVE') {
    res.status(401).json({ error: 'Credencial de kiosco inválida.' });
    return;
  }

  const tenant = credential.tenant;
  void systemPrisma.tenantKioskCredential.update({
    where: { id: credential.id }, data: { lastUsedAt: new Date() },
  }).catch(error => console.error('No se pudo actualizar lastUsedAt del kiosco:', error));
  if (!tenant.lastActivityAt || tenant.lastActivityAt.getTime() < Date.now() - 15 * 60 * 1000) {
    void systemPrisma.tenant.update({ where: { id: tenant.id }, data: { lastActivityAt: new Date() } }).catch(() => undefined);
  }
  req.tenant = { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status };
  runWithTenantContext({ tenantId: tenant.id, user: null, tenant: req.tenant, db: prisma, source: 'KIOSK' }, next);
}
