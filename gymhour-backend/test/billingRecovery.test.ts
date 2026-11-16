import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const client: any = {
    tenant: { findUniqueOrThrow: vi.fn(), findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    tenantBillingOrder: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    tenantPlanChange: { findFirst: vi.fn() },
    rebillWebhookEvent: { findUnique: vi.fn(), create: vi.fn() },
    rebillProcessedPayment: { findUnique: vi.fn(), create: vi.fn() },
    rebillUnlinkedPayment: { upsert: vi.fn(), updateMany: vi.fn() },
    user: { findFirst: vi.fn() },
  };
  client.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(client));
  return client;
});
const rebill = vi.hoisted(() => ({
  fetchRebillPayment: vi.fn(), fetchRebillSubscription: vi.fn(), findOrCreateRebillPlan: vi.fn(), findRebillPaymentIdByMetadata: vi.fn(),
  rebillSubscriptionMatchesOrder: vi.fn(), validRebillSignature: vi.fn(),
}));
const subscription = vi.hoisted(() => ({
  cancelTenantSubscriptions: vi.fn(), collectAfterCardUpdate: vi.fn(), liveSubscriptionOrders: vi.fn(),
}));
const access = vi.hoisted(() => ({ tenantPlanAccess: vi.fn() }));
const notify = vi.hoisted(() => ({
  notifyPurchaseConfirmed: vi.fn(), notifyRenewal: vi.fn(), notifyPaymentFailed: vi.fn(), notifySubscriptionPaused: vi.fn(),
}));

vi.mock('../src/models/Prisma.js', () => ({ systemPrisma: db }));
vi.mock('../src/services/rebill.service.js', () => rebill);
vi.mock('../src/services/tenantSubscription.service.js', () => subscription);
vi.mock('../src/services/planAccess.service.js', () => access);
vi.mock('../src/services/billingNotifications.service.js', () => notify);
vi.mock('../src/services/tenantBilling.service.js', () => ({ tenantBillingTier: vi.fn().mockResolvedValue({ activeStudents: 42 }) }));
vi.mock('../src/controllers/billingChange.Controller.js', () => ({ confirmPaidPlanChangePayment: vi.fn() }));

import { confirmTransfer, createOrder, rebillWebhook } from '../src/controllers/billing.Controller.js';

const response = () => {
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis(), end: vi.fn().mockReturnThis(), setHeader: vi.fn() };
  return res;
};
const orderRequest = (body = {}) => ({
  user: { tenantId: 7, email: 'admin@example.com' },
  body: { planCode: 'ESSENTIAL_MONTHLY', method: 'TRANSFER', ...body },
}) as any;

beforeAll(() => {
  process.env.REBILL_PUBLIC_KEY = 'pk_test';
  process.env.REBILL_SECRET_KEY = 'sk_test';
});
afterAll(() => {
  delete process.env.REBILL_PUBLIC_KEY;
  delete process.env.REBILL_SECRET_KEY;
});

beforeEach(() => {
  vi.clearAllMocks();
  access.tenantPlanAccess.mockResolvedValue({ state: 'EXPIRED', inGrace: false, scheduledPlanCode: null });
  subscription.liveSubscriptionOrders.mockResolvedValue([]);
  subscription.cancelTenantSubscriptions.mockResolvedValue(1);
  db.tenant.findUniqueOrThrow.mockResolvedValue({ id: 7, billingCreditArs: 0, paidUntil: null });
  db.tenantBillingOrder.findFirst.mockResolvedValue(null);
  db.tenantBillingOrder.create.mockResolvedValue({ id: 'order_new' });
  db.rebillWebhookEvent.findUnique.mockResolvedValue(null);
  rebill.validRebillSignature.mockReturnValue(true);
});

describe('compra con una suscripción de tarjeta sin resolver', () => {
  it('pide decidir antes de cobrar', async () => {
    subscription.liveSubscriptionOrders.mockResolvedValue([{ id: 'order_old' }]);
    const res = response();
    await createOrder(orderRequest(), res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'SUBSCRIPTION_RECOVERY_REQUIRED' }));
    expect(subscription.cancelTenantSubscriptions).not.toHaveBeenCalled();
    expect(db.tenantBillingOrder.create).not.toHaveBeenCalled();
  });

  it('con confirmación cancela la anterior y recién ahí crea la orden', async () => {
    subscription.liveSubscriptionOrders.mockResolvedValue([{ id: 'order_old' }]);
    const res = response();
    await createOrder(orderRequest({ replaceSubscription: true }), res);
    expect(subscription.cancelTenantSubscriptions).toHaveBeenCalledWith(7, 'Reemplazada por una nueva compra', 'admin@example.com');
    expect(subscription.cancelTenantSubscriptions.mock.invocationCallOrder[0])
      .toBeLessThan(db.tenantBillingOrder.create.mock.invocationCallOrder[0]);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('si Rebill no cancela la anterior, no crea la orden', async () => {
    subscription.liveSubscriptionOrders.mockResolvedValue([{ id: 'order_old' }]);
    subscription.cancelTenantSubscriptions.mockRejectedValue(new Error('REBILL_LOOKUP_500'));
    const res = response();
    await createOrder(orderRequest({ replaceSubscription: true }), res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(db.tenantBillingOrder.create).not.toHaveBeenCalled();
  });

  it('permite comprar durante la tolerancia, pero no con el período al día', async () => {
    access.tenantPlanAccess.mockResolvedValue({ state: 'PAID', inGrace: true, scheduledPlanCode: null });
    const inGrace = response();
    await createOrder(orderRequest(), inGrace);
    expect(inGrace.status).toHaveBeenCalledWith(201);

    access.tenantPlanAccess.mockResolvedValue({ state: 'PAID', inGrace: false, scheduledPlanCode: null });
    const paid = response();
    await createOrder(orderRequest(), paid);
    expect(paid.status).toHaveBeenCalledWith(409);
  });
});

describe('transferencia sin ID de pago en el navegador', () => {
  const transferOrder = {
    id: 'order_t', tenantId: 7, method: 'TRANSFER', status: 'PENDING', planCode: 'ESSENTIAL_MONTHLY', amountArs: 49999, months: 1,
    creditUsedArs: 0, rebillPaymentId: null, createdAt: new Date('2026-11-04T00:19:00.000Z'),
  };
  const confirm = async () => {
    const res = response();
    await confirmTransfer({ params: { id: 'order_t' }, body: {}, user: { tenantId: 7, email: 'Admin@Example.com' } } as any, res);
    return res;
  };

  beforeEach(() => { db.tenantBillingOrder.findFirst.mockResolvedValue(transferOrder); });

  it('responde pendiente mientras Rebill no tiene el pago', async () => {
    rebill.findRebillPaymentIdByMetadata.mockResolvedValue(null);
    const res = await confirm();
    expect(rebill.findRebillPaymentIdByMetadata).toHaveBeenCalledWith('gymhourOrderId', 'order_t', 'admin@example.com');
    expect(res.status).toHaveBeenCalledWith(202);
    expect(rebill.fetchRebillPayment).not.toHaveBeenCalled();
  });

  it('encuentra el pago por la orden, lo valida y lo acredita', async () => {
    rebill.findRebillPaymentIdByMetadata.mockResolvedValue('test_pay_t');
    rebill.fetchRebillPayment.mockResolvedValue({
      id: 'test_pay_t', status: 'approved', amount: 49999, currency: 'ARS', orderId: 'order_t',
      subscriptionId: null, customerEmail: 'admin@example.com', createdAt: new Date('2026-11-04T00:19:30.000Z'),
    });
    db.tenantBillingOrder.updateMany.mockResolvedValue({ count: 1 });
    db.tenant.updateMany.mockResolvedValue({ count: 1 });
    const res = await confirm();
    expect(rebill.fetchRebillPayment).toHaveBeenCalledWith('test_pay_t');
    expect(db.tenantBillingOrder.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'PAID', rebillPaymentId: 'test_pay_t' }),
    }));
    expect(res.json).toHaveBeenCalledWith({ paidUntil: new Date('2026-12-04T00:19:30.000Z') });
    expect(notify.notifyPurchaseConfirmed).toHaveBeenCalledWith(7, 'ESSENTIAL_MONTHLY', new Date('2026-12-04T00:19:30.000Z'));
  });

  it('rechaza un pago encontrado que pertenece a otra orden', async () => {
    rebill.findRebillPaymentIdByMetadata.mockResolvedValue('test_pay_t');
    rebill.fetchRebillPayment.mockResolvedValue({
      id: 'test_pay_t', status: 'approved', amount: 49999, currency: 'ARS', orderId: 'order_otra',
      subscriptionId: null, customerEmail: 'admin@example.com', createdAt: new Date('2026-11-04T00:19:30.000Z'),
    });
    const res = await confirm();
    expect(res.status).toHaveBeenCalledWith(409);
    expect(db.tenantBillingOrder.updateMany).not.toHaveBeenCalled();
  });

  it('si Rebill no responde, avisa sin marcar nada', async () => {
    rebill.findRebillPaymentIdByMetadata.mockRejectedValue(new Error('REBILL_LOOKUP_500'));
    const res = await confirm();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(db.tenantBillingOrder.updateMany).not.toHaveBeenCalled();
  });
});

describe('webhook de Rebill', () => {
  const webhook = (event: string, data: unknown) => ({
    rawBody: Buffer.from('{}'), headers: { 'x-rebill-signature': 'firma' },
    body: { webhook: { event, logId: 'we_log_1' }, data },
  }) as any;

  it('quita la tolerancia si la suscripción queda pausada', async () => {
    db.tenantBillingOrder.findUnique.mockResolvedValue({ id: 'order_1', tenantId: 7 });
    const res = response();
    await rebillWebhook(webhook('subscription.updated', { id: 'test_sub_1', status: 'paused' }), res);
    expect(db.tenantBillingOrder.updateMany).toHaveBeenCalledWith({ where: { rebillSubscriptionId: 'test_sub_1' }, data: { rebillSubscriptionStatus: 'paused' } });
    expect(db.tenant.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { billingGraceUntil: null } });
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('mantiene la tolerancia mientras Rebill reintenta', async () => {
    db.tenantBillingOrder.findUnique.mockResolvedValue({ id: 'order_1', tenantId: 7 });
    await rebillWebhook(webhook('subscription.updated', { id: 'test_sub_1', status: 'retrying' }), response());
    expect(db.tenant.update).not.toHaveBeenCalled();
  });

  it('al cambiar la tarjeta intenta cobrar y no toca el estado guardado', async () => {
    const order = { id: 'order_1', tenantId: 7, rebillSubscriptionId: 'test_sub_1' };
    db.tenantBillingOrder.findUnique.mockResolvedValue(order);
    const res = response();
    await rebillWebhook(webhook('subscription.updated', { id: 'test_sub_1', status: 'retrying', cardUpdated: true }), res);
    expect(subscription.collectAfterCardUpdate).toHaveBeenCalledWith(order);
    expect(db.tenantBillingOrder.updateMany).not.toHaveBeenCalled();
    expect(db.rebillWebhookEvent.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('si falla el cobro tras cambiar la tarjeta, no marca el evento para que Rebill reintente', async () => {
    db.tenantBillingOrder.findUnique.mockResolvedValue({ id: 'order_1', tenantId: 7, rebillSubscriptionId: 'test_sub_1' });
    subscription.collectAfterCardUpdate.mockRejectedValueOnce(new Error('REBILL_LOOKUP_500'));
    await expect(rebillWebhook(webhook('subscription.updated', { id: 'test_sub_1', cardUpdated: true }), response())).rejects.toThrow();
    expect(db.rebillWebhookEvent.create).not.toHaveBeenCalled();
  });

  const renewalOrder = {
    id: 'order_1', tenantId: 7, status: 'PAID', planCode: 'ESSENTIAL_MONTHLY', amountArs: 49999, months: 1, rebillPaymentId: 'pay_first',
  };
  const renewal = { payment: { id: 'test_pay_2' }, subscriptionId: 'test_sub_1' };

  it('un cobro rechazado responde 204 y no extiende el acceso', async () => {
    db.tenantBillingOrder.findUnique.mockResolvedValue(renewalOrder);
    db.tenantPlanChange.findFirst.mockResolvedValue(null);
    rebill.fetchRebillPayment.mockResolvedValue({ id: 'test_pay_2', status: 'rejected', amount: 49999, currency: 'ARS', createdAt: new Date() });
    rebill.fetchRebillSubscription.mockResolvedValue({ id: 'test_sub_1' });
    const res = response();
    await rebillWebhook(webhook('payment.created', renewal), res);
    expect(res.status).toHaveBeenCalledWith(204);
    expect(db.tenant.update).not.toHaveBeenCalled();
    expect(db.rebillWebhookEvent.create).toHaveBeenCalled();
  });

  it('una renovación aprobada extiende el acceso y renueva la tolerancia', async () => {
    const createdAt = new Date('2026-11-10T15:00:00.000Z');
    db.tenantBillingOrder.findUnique.mockResolvedValue(renewalOrder);
    db.tenantPlanChange.findFirst.mockResolvedValue(null);
    db.rebillProcessedPayment.findUnique.mockResolvedValue(null);
    db.tenant.findUniqueOrThrow.mockResolvedValue({ id: 7, paidUntil: new Date('2026-11-10T12:00:00.000Z') });
    rebill.fetchRebillPayment.mockResolvedValue({ id: 'test_pay_2', status: 'approved', amount: 49999, currency: 'ARS', subscriptionId: 'test_sub_1', createdAt });
    rebill.fetchRebillSubscription.mockResolvedValue({ id: 'test_sub_1' });
    rebill.rebillSubscriptionMatchesOrder.mockReturnValue(true);
    const res = response();
    await rebillWebhook(webhook('payment.created', renewal), res);
    expect(db.tenant.update).toHaveBeenCalledWith({ where: { id: 7 }, data: {
      paidUntil: new Date('2026-12-10T15:00:00.000Z'), billingGraceUntil: new Date('2026-12-12T15:00:00.000Z'),
    } });
    expect(res.status).toHaveBeenCalledWith(204);
    expect(notify.notifyRenewal).toHaveBeenCalledWith(7, new Date('2026-12-10T15:00:00.000Z'));
  });

  it('avisa el cobro rechazado una sola vez por período', async () => {
    const paidUntil = new Date('2026-11-10T12:00:00.000Z');
    db.tenantPlanChange.findFirst.mockResolvedValue(null);
    db.tenant.findUnique.mockResolvedValue({ billingGraceUntil: new Date('2026-11-12T12:00:00.000Z') });
    rebill.fetchRebillPayment.mockResolvedValue({ id: 'test_pay_2', status: 'rejected', amount: 49999, currency: 'ARS', createdAt: new Date() });
    rebill.fetchRebillSubscription.mockResolvedValue({ id: 'test_sub_1' });

    db.tenantBillingOrder.findUnique.mockResolvedValue({ ...renewalOrder, paidUntil, failureNotifiedUntil: null });
    await rebillWebhook(webhook('payment.created', renewal), response());
    expect(db.tenantBillingOrder.update).toHaveBeenCalledWith({ where: { id: 'order_1' }, data: { failureNotifiedUntil: paidUntil } });
    expect(notify.notifyPaymentFailed).toHaveBeenCalledWith(7, new Date('2026-11-12T12:00:00.000Z'));

    vi.clearAllMocks();
    db.rebillWebhookEvent.findUnique.mockResolvedValue(null);
    rebill.validRebillSignature.mockReturnValue(true);
    db.tenantBillingOrder.findUnique.mockResolvedValue({ ...renewalOrder, paidUntil, failureNotifiedUntil: paidUntil });
    await rebillWebhook(webhook('payment.created', renewal), response());
    expect(db.tenantBillingOrder.update).not.toHaveBeenCalled();
    expect(notify.notifyPaymentFailed).not.toHaveBeenCalled();
    expect(db.rebillWebhookEvent.create).toHaveBeenCalled();
  });

  it('avisa la pausa por falta de pago, pero no la que pidió Gymhour al suspender', async () => {
    db.tenant.findUnique.mockResolvedValue({ status: 'ACTIVE' });
    db.tenantBillingOrder.findUnique.mockResolvedValue({ id: 'order_1', tenantId: 7, rebillSubscriptionStatus: 'retrying', pausedBySuspensionAt: null });
    await rebillWebhook(webhook('subscription.updated', { id: 'test_sub_1', status: 'paused' }), response());
    expect(notify.notifySubscriptionPaused).toHaveBeenCalledWith(7);

    notify.notifySubscriptionPaused.mockClear();
    db.tenantBillingOrder.findUnique.mockResolvedValue({ id: 'order_1', tenantId: 7, rebillSubscriptionStatus: 'paused', pausedBySuspensionAt: new Date() });
    await rebillWebhook(webhook('subscription.updated', { id: 'test_sub_1', status: 'paused' }), response());
    expect(notify.notifySubscriptionPaused).not.toHaveBeenCalled();
  });

  it('guarda el primer pago de una suscripción sin orden para vincularlo a mano', async () => {
    db.tenantBillingOrder.findUnique.mockResolvedValue(null);
    const paidAt = new Date('2026-11-10T15:00:00.000Z');
    rebill.fetchRebillPayment.mockResolvedValue({
      id: 'test_pay_1', status: 'approved', amount: 49999, currency: 'ARS', subscriptionId: 'test_sub_9',
      customerEmail: 'admin@example.com', createdAt: paidAt,
    });
    const res = response();
    await rebillWebhook(webhook('payment.created', { payment: { id: 'test_pay_1' }, subscriptionId: 'test_sub_9' }), res);
    expect(db.rebillUnlinkedPayment.upsert).toHaveBeenCalledWith({ where: { paymentId: 'test_pay_1' }, update: {}, create: {
      paymentId: 'test_pay_1', subscriptionId: 'test_sub_9', customerEmail: 'admin@example.com',
      amountArs: 49999, currency: 'ARS', paidAt,
    } });
    expect(db.rebillWebhookEvent.create).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });

  it('no guarda pagos rechazados ni registra el evento si Rebill no responde', async () => {
    db.tenantBillingOrder.findUnique.mockResolvedValue(null);
    rebill.fetchRebillPayment.mockResolvedValue({ id: 'test_pay_1', status: 'rejected', amount: 49999, currency: 'ARS', createdAt: new Date() });
    await rebillWebhook(webhook('payment.created', { payment: { id: 'test_pay_1' }, subscriptionId: 'test_sub_9' }), response());
    expect(db.rebillUnlinkedPayment.upsert).not.toHaveBeenCalled();

    db.rebillWebhookEvent.create.mockClear();
    rebill.fetchRebillPayment.mockRejectedValue(new Error('REBILL_LOOKUP_500'));
    await expect(rebillWebhook(webhook('payment.created', { payment: { id: 'test_pay_1' }, subscriptionId: 'test_sub_9' }), response())).rejects.toThrow();
    expect(db.rebillWebhookEvent.create).not.toHaveBeenCalled();
  });
});
