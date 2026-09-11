import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import prisma, { systemPrisma } from '../models/Prisma.js';
import { runWithTenantContext } from './tenantContext.service.js';

export const hashKioskToken = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');
export const generateKioskToken = (): string => crypto.randomBytes(32).toString('base64url');

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
  req.tenant = { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status };
  void systemPrisma.tenantKioskCredential.update({
    where: { id: credential.id }, data: { lastUsedAt: new Date() },
  }).catch(error => console.error('No se pudo actualizar lastUsedAt del kiosco:', error));
  runWithTenantContext({ tenantId: tenant.id, user: null, tenant: req.tenant, db: prisma, source: 'KIOSK' }, next);
}
