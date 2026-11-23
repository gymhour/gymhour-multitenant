import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  tenant: { findUnique: vi.fn(), update: vi.fn() },
  platformUser: { findUnique: vi.fn() },
}));
vi.mock('../src/models/Prisma.js', () => ({ systemPrisma: db, default: db }));
vi.mock('../src/services/tenantContext.service.js', () => ({ runWithTenantContext: (_context: unknown, next: () => void) => next() }));
vi.mock('../src/services/billing.service.js', () => ({ getBillingAccess: () => ({ state: 'ACTIVE' }) }));

import { authenticatePlatformToken, authenticateToken } from '../src/services/auth.service.js';

const secret = process.env.JWT_SECRET as string;
const tenantToken = jwt.sign({ sub: '5', tenantId: 7, role: 'ADMIN', authVersion: 1, scope: 'tenant' }, secret);
const response = () => {
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return res;
};
const request = (token: string) => ({ headers: { authorization: `Bearer ${token}` }, baseUrl: '/cuotas', method: 'GET', path: '/' }) as any;
// Error de Prisma cuando el pool no tiene conexiones libres.
const poolTimeout = () => Object.assign(new Error('Timed out fetching a new connection from the connection pool.'), { code: 'P2024' });

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('sesión de los gimnasios', () => {
  it('con un token inválido responde 401', async () => {
    const res = response();
    const next = vi.fn();
    await authenticateToken(request('no-es-un-token'), res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('si el usuario ya no coincide con el token responde 401', async () => {
    db.user.findFirst.mockResolvedValue(null);
    const res = response();
    await authenticateToken(request(tenantToken), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('si falla la base responde 503, así el frontend no cierra la sesión', async () => {
    db.user.findFirst.mockRejectedValue(poolTimeout());
    const res = response();
    const next = vi.fn();
    await authenticateToken(request(tenantToken), res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(next).not.toHaveBeenCalled();
  });

  it('con un token válido sigue', async () => {
    db.user.findFirst.mockResolvedValue({
      ID_Usuario: 5, tenantId: 7, email: 'admin@gym.test', role: 'ADMIN', authVersion: 1, estado: true, setupGuideDismissedAt: null,
    });
    db.tenant.findUnique.mockResolvedValue({ id: 7, name: 'Gym', slug: 'gym', status: 'ACTIVE', lastActivityAt: new Date() });
    const next = vi.fn();
    await authenticateToken(request(tenantToken), response(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe('sesión del backoffice', () => {
  it('si falla la base responde 503', async () => {
    const token = jwt.sign({ sub: '1', role: 'SUPER_ADMIN', authVersion: 1, scope: 'platform' }, secret);
    db.platformUser.findUnique.mockRejectedValue(poolTimeout());
    const res = response();
    await authenticatePlatformToken(request(token), res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
