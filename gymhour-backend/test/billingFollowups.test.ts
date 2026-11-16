import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const client: any = {
    tenant: { create: vi.fn(), findMany: vi.fn(), findUniqueOrThrow: vi.fn(), findUnique: vi.fn() },
    tenantPlanChange: { findFirst: vi.fn() },
    tenantSettings: { findUnique: vi.fn() },
    user: { findFirst: vi.fn(), create: vi.fn() },
  };
  client.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(client));
  return client;
});
const rebill = vi.hoisted(() => ({
  changeRebillSubscriptionPlan: vi.fn(), fetchRebillPayment: vi.fn(), fetchRebillSubscription: vi.fn(),
  findOrCreateRebillPlan: vi.fn(), findRebillPaymentIdByMetadata: vi.fn(), rebillSubscriptionMatchesOrder: vi.fn(),
  createRebillCardUpdateLink: vi.fn(),
}));
const subscription = vi.hoisted(() => ({ cancelTenantSubscriptions: vi.fn(), liveSubscriptionOrders: vi.fn() }));
const notify = vi.hoisted(() => ({ notifySubscriptionCancelled: vi.fn() }));
const access = vi.hoisted(() => ({ tenantPlanAccess: vi.fn() }));

vi.mock('../src/models/Prisma.js', () => ({ systemPrisma: db, default: db }));
vi.mock('../src/services/rebill.service.js', () => rebill);
vi.mock('../src/services/tenantSubscription.service.js', () => subscription);
vi.mock('../src/services/billingNotifications.service.js', () => notify);
vi.mock('../src/services/planAccess.service.js', () => access);
vi.mock('../src/services/tenantBilling.service.js', () => ({ tenantBillingTier: vi.fn().mockResolvedValue({ activeStudents: 230 }) }));
vi.mock('../src/services/password.service.js', () => ({ hashPassword: vi.fn().mockResolvedValue('hash'), comparePassword: vi.fn() }));
vi.mock('../src/services/email.service.js', () => ({
  sendResetPasswordEmail: vi.fn(), sendVerificationEmail: vi.fn(), sendWelcomeEmail: vi.fn(),
}));
vi.mock('../src/services/cloudinary.service.js', () => ({ getTenantLogoUrl: vi.fn() }));

import { confirmPlanChange } from '../src/controllers/billingChange.Controller.js';
import { cancelSubscription } from '../src/controllers/billingSubscription.Controller.js';
import { me, registerTenant } from '../src/controllers/auth.Controller.js';

const response = () => {
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  return res;
};

beforeEach(() => { vi.clearAllMocks(); });

describe('ajuste a Pro pagado por transferencia', () => {
  const change = { id: 'change_1', tenantId: 7, status: 'PENDING', amountArs: 25000 };
  const confirm = async () => {
    const res = response();
    await confirmPlanChange({ params: { id: 'change_1' }, body: {}, user: { tenantId: 7, email: 'Admin@Example.com' } } as any, res);
    return res;
  };

  it('sin ID de pago lo busca por el cambio y espera mientras no llega', async () => {
    db.tenantPlanChange.findFirst.mockResolvedValue(change);
    rebill.findRebillPaymentIdByMetadata.mockResolvedValue(null);
    const res = await confirm();
    expect(rebill.findRebillPaymentIdByMetadata).toHaveBeenCalledWith('gymhourPlanChangeId', 'change_1', 'admin@example.com');
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('si Rebill no responde, avisa sin aplicar nada', async () => {
    db.tenantPlanChange.findFirst.mockResolvedValue(change);
    rebill.findRebillPaymentIdByMetadata.mockRejectedValue(new Error('REBILL_LOOKUP_500'));
    expect((await confirm()).status).toHaveBeenCalledWith(503);
  });
});

describe('cancelación desde Mi suscripción', () => {
  it('guarda quién canceló y avisa por mail', async () => {
    const paidUntil = new Date('2026-12-03T23:56:07.104Z');
    subscription.liveSubscriptionOrders.mockResolvedValue([{ id: 'order_1' }]);
    subscription.cancelTenantSubscriptions.mockResolvedValue(1);
    db.tenant.findUniqueOrThrow.mockResolvedValue({ paidUntil });
    const res = response();
    await cancelSubscription({ body: { reason: 'Cierro el gimnasio' }, user: { tenantId: 7, email: 'admin@example.com' } } as any, res);
    expect(subscription.cancelTenantSubscriptions).toHaveBeenCalledWith(7, 'Cierro el gimnasio', 'admin@example.com');
    expect(notify.notifySubscriptionCancelled).toHaveBeenCalledWith(7, paidUntil);
    expect(res.json).toHaveBeenCalledWith({ status: 'CANCELLED', accessUntil: paidUntil });
  });

  it('si Rebill falla no manda el mail', async () => {
    subscription.liveSubscriptionOrders.mockResolvedValue([{ id: 'order_1' }]);
    subscription.cancelTenantSubscriptions.mockRejectedValue(new Error('REBILL_LOOKUP_500'));
    const res = response();
    await cancelSubscription({ body: { reason: 'Cierro el gimnasio' }, user: { tenantId: 7, email: 'admin@example.com' } } as any, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(notify.notifySubscriptionCancelled).not.toHaveBeenCalled();
  });
});

describe('prueba gratuita única por email', () => {
  const register = async () => {
    const res = response();
    db.tenant.findMany.mockResolvedValue([]);
    db.tenant.create.mockImplementation(async ({ data }: any) => ({ id: 9, name: data.name, slug: data.slug, trialEndsAt: data.trialEndsAt }));
    db.user.create.mockResolvedValue({ ID_Usuario: 1, email: 'admin@example.com', role: 'ADMIN', tenantId: 9, authVersion: 0 });
    await registerTenant({ body: { email: 'Admin@Example.com', password: 'secreta123' } } as any, res);
    return res;
  };

  it('un email nuevo recibe 14 días de prueba', async () => {
    db.user.findFirst.mockResolvedValue(null);
    const res = await register();
    const { trialEndsAt } = db.tenant.create.mock.calls[0][0].data;
    expect(trialEndsAt.getTime() - Date.now()).toBeGreaterThan(13 * 24 * 60 * 60 * 1000);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ trialAvailable: true }));
  });

  it('si el email ya administra otro gimnasio, el nuevo empieza sin prueba', async () => {
    db.user.findFirst.mockResolvedValue({ ID_Usuario: 3 });
    const res = await register();
    expect(db.user.findFirst).toHaveBeenCalledWith({ where: { email: 'admin@example.com', role: 'ADMIN' }, select: { ID_Usuario: true } });
    const { trialEndsAt } = db.tenant.create.mock.calls[0][0].data;
    expect(trialEndsAt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ trialAvailable: false }));
  });
});

describe('sesión durante la prueba', () => {
  const session = async (role: string, state: string) => {
    access.tenantPlanAccess.mockResolvedValue({ state });
    db.tenantSettings.findUnique.mockResolvedValue(null);
    db.tenant.findUniqueOrThrow.mockResolvedValue({ id: 7 });
    const res = response();
    await me({ user: { role }, tenant: { id: 7 } } as any, res);
    return res.json.mock.calls[0][0].tenant.billing;
  };

  it('el admin en prueba recibe la cantidad de socios activos', async () => {
    expect(await session('ADMIN', 'TRIAL')).toMatchObject({ state: 'TRIAL', activeStudents: 230 });
  });

  it('no la recibe fuera de la prueba ni con otro rol', async () => {
    expect((await session('ADMIN', 'PAID')).activeStudents).toBeUndefined();
    expect((await session('STUDENT', 'TRIAL')).activeStudents).toBeUndefined();
  });
});
