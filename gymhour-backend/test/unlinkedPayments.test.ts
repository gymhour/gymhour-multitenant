import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const client: any = {
    rebillUnlinkedPayment: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    tenantBillingOrder: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    tenant: { update: vi.fn(), updateMany: vi.fn() },
    rebillProcessedPayment: { create: vi.fn() },
    user: { findMany: vi.fn() },
  };
  client.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(client));
  return client;
});
const rebill = vi.hoisted(() => ({
  fetchRebillPayment: vi.fn(), fetchRebillSubscription: vi.fn(), rebillSubscriptionMatchesOrder: vi.fn(),
}));
const security = vi.hoisted(() => ({
  auditPlatform: vi.fn(), verifyAndConsumeMfa: vi.fn(), consumeLoginChallenge: vi.fn(), createLoginChallenge: vi.fn(),
  createPlatformSession: vi.fn(), destroyPlatformSession: vi.fn(), platformCsrfToken: vi.fn(), requestIdentity: vi.fn(() => ({})),
  verifyPlatformPassword: vi.fn(),
}));
const notify = vi.hoisted(() => ({ notifyPurchaseConfirmed: vi.fn(), notifySubscriptionCancelled: vi.fn() }));

vi.mock('../src/models/Prisma.js', () => ({ systemPrisma: db }));
vi.mock('../src/services/rebill.service.js', () => rebill);
vi.mock('../src/services/platformSecurity.service.js', () => security);
vi.mock('../src/services/billingNotifications.service.js', () => notify);
vi.mock('../src/services/tenantDeletion.service.js', () => ({
  collectTenantAssets: vi.fn(), processTenantDeletionJob: vi.fn(), purgeTenantDatabase: vi.fn(),
}));
vi.mock('../src/services/tenantSubscription.service.js', () => ({
  cancelTenantSubscriptions: vi.fn(), liveSubscriptionOrders: vi.fn(), pauseTenantSubscriptions: vi.fn(), resumeTenantSubscriptions: vi.fn(),
}));

import { platformMethods } from '../src/controllers/platform.Controller.js';

const response = () => {
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  return res;
};
const paidAt = new Date('2026-11-10T15:00:00.000Z');
const record = {
  id: 'unl_1', paymentId: 'test_pay_1', subscriptionId: 'test_sub_1', customerEmail: 'admin@example.com',
  amountArs: 49999, currency: 'ARS', paidAt, linkedAt: null,
};
const order = {
  id: 'order_1', tenantId: 7, method: 'CARD', status: 'PENDING', planCode: 'ESSENTIAL_MONTHLY', amountArs: 49999,
  months: 1, creditUsedArs: 0, createdAt: new Date('2026-11-10T14:58:00.000Z'), tenant: { slug: 'gym' },
};
const payment = (id: string, createdAt: Date) => ({
  id, status: 'approved', amount: 49999, currency: 'ARS', subscriptionId: 'test_sub_1', orderId: null, planId: null,
  customerEmail: 'otro@example.com', createdAt,
});
const link = async (body = {}) => {
  const res = response();
  await platformMethods.linkUnlinkedPayment({
    params: { id: 'unl_1' }, body: { orderId: 'order_1', reason: 'Pagó y cerró la pestaña', mfaCode: '123456', ...body },
    platformUser: { id: 1, email: 'ops@gymhour.app' },
  } as any, res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  security.verifyAndConsumeMfa.mockResolvedValue(true);
  db.rebillUnlinkedPayment.findUnique.mockResolvedValue(record);
  db.rebillUnlinkedPayment.findMany.mockResolvedValue([record]);
  db.tenantBillingOrder.findUnique.mockResolvedValue(order);
  db.tenantBillingOrder.updateMany.mockResolvedValue({ count: 1 });
  db.tenant.updateMany.mockResolvedValue({ count: 1 });
  rebill.fetchRebillSubscription.mockResolvedValue({ id: 'test_sub_1', status: 'active', planId: null, orderId: null });
  rebill.fetchRebillPayment.mockResolvedValue(payment('test_pay_1', paidAt));
  rebill.rebillSubscriptionMatchesOrder.mockReturnValue(true);
});

describe('pagos con tarjeta sin vincular', () => {
  it('sugiere la orden pendiente del gimnasio donde ese email es admin', async () => {
    db.rebillUnlinkedPayment.findMany.mockResolvedValue([record, { ...record, id: 'unl_2', paymentId: 'test_pay_2' }]);
    db.user.findMany.mockResolvedValue([{ email: 'admin@example.com', tenantId: 7 }]);
    db.tenantBillingOrder.findMany.mockResolvedValue([
      { ...order, tenant: { id: 7, name: 'Gym', slug: 'gym' } },
      { ...order, id: 'order_otro_importe', amountArs: 99999, tenant: { id: 7, name: 'Gym', slug: 'gym' } },
    ]);
    const res = response();
    await platformMethods.listUnlinkedPayments({} as any, res);
    const [item] = res.json.mock.calls[0][0].items;
    expect(res.json.mock.calls[0][0].items).toHaveLength(1);
    expect(item).toMatchObject({ paymentId: 'test_pay_1', payments: 2 });
    expect(item.suggestions.map((suggestion: any) => suggestion.orderId)).toEqual(['order_1']);
  });

  it('vincula el pago aunque el email no coincida y deja la auditoría', async () => {
    const res = await link();
    expect(db.tenantBillingOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order_1', status: 'PENDING' },
      data: expect.objectContaining({ status: 'PAID', rebillPaymentId: 'test_pay_1', rebillSubscriptionId: 'test_sub_1' }),
    }));
    expect(db.rebillUnlinkedPayment.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ linkedOrderId: 'order_1', linkedBy: 'Backoffice · ops@gymhour.app' }),
    }));
    expect(security.auditPlatform).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'TENANT_PAYMENT_LINK', outcome: 'SUCCESS' }));
    expect(notify.notifyPurchaseConfirmed).toHaveBeenCalledWith(7, 'ESSENTIAL_MONTHLY', new Date('2026-12-10T15:00:00.000Z'));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ paidUntil: new Date('2026-12-10T15:00:00.000Z'), renewalsCredited: 0 }));
  });

  it('acredita también las renovaciones que quedaron sin vincular', async () => {
    const renewalAt = new Date('2026-12-10T15:00:00.000Z');
    db.rebillUnlinkedPayment.findMany.mockResolvedValue([record, { ...record, id: 'unl_2', paymentId: 'test_pay_2', paidAt: renewalAt }]);
    rebill.fetchRebillPayment.mockImplementation(async (id: string) => payment(id, id === 'test_pay_1' ? paidAt : renewalAt));
    const res = await link();
    expect(db.tenant.update).toHaveBeenCalledWith({ where: { id: 7 }, data: {
      paidUntil: new Date('2027-01-10T15:00:00.000Z'), billingGraceUntil: new Date('2027-01-12T15:00:00.000Z'),
    } });
    expect(db.rebillProcessedPayment.create).toHaveBeenCalledWith({ data: { paymentId: 'test_pay_2' } });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ renewalsCredited: 1, renewalsSkipped: 0 }));
  });

  it('rechaza una orden con otro importe o anterior al pago', async () => {
    db.tenantBillingOrder.findUnique.mockResolvedValue({ ...order, amountArs: 99999 });
    expect((await link()).status).toHaveBeenCalledWith(409);
    db.tenantBillingOrder.findUnique.mockResolvedValue({ ...order, createdAt: new Date('2026-11-11T00:00:00.000Z') });
    expect((await link()).status).toHaveBeenCalledWith(409);
    expect(db.tenantBillingOrder.updateMany).not.toHaveBeenCalled();
    expect(security.auditPlatform).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ outcome: 'FAILURE' }));
  });

  it('no vincula sin MFA, con una orden ya pagada o si Rebill no responde', async () => {
    security.verifyAndConsumeMfa.mockResolvedValue(false);
    expect((await link()).status).toHaveBeenCalledWith(401);
    security.verifyAndConsumeMfa.mockResolvedValue(true);
    db.tenantBillingOrder.findUnique.mockResolvedValue({ ...order, status: 'PAID' });
    expect((await link()).status).toHaveBeenCalledWith(409);
    db.tenantBillingOrder.findUnique.mockResolvedValue(order);
    rebill.fetchRebillSubscription.mockRejectedValue(new Error('REBILL_LOOKUP_500'));
    expect((await link()).status).toHaveBeenCalledWith(502);
    expect(db.tenantBillingOrder.updateMany).not.toHaveBeenCalled();
  });
});
