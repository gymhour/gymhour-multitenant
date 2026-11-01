import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  tenantPlanChange: { findFirst: vi.fn(), updateMany: vi.fn() },
  tenantBillingOrder: { findFirst: vi.fn(), update: vi.fn() },
  tenant: { findUnique: vi.fn(), update: vi.fn() },
}));
const rebill = vi.hoisted(() => ({
  fetchRebillSubscription: vi.fn(), findOrCreateRebillPlan: vi.fn(),
  changeRebillSubscriptionPlan: vi.fn(), rebillSubscriptionMatchesOrder: vi.fn(),
  fetchRebillPayment: vi.fn(),
}));
vi.mock('../src/models/Prisma.js', () => ({ systemPrisma: db }));
vi.mock('../src/services/rebill.service.js', () => rebill);
vi.mock('../src/services/tenantBilling.service.js', () => ({ tenantBillingTier: vi.fn().mockResolvedValue({ activeStudents: 42 }) }));

import { cancelScheduledDowngrade, scheduleDowngrade } from '../src/controllers/billingChange.Controller.js';

describe('baja programada', () => {
  const end = new Date('2099-11-01T00:00:00Z');
  beforeEach(() => {
    vi.clearAllMocks();
    db.tenantPlanChange.findFirst.mockResolvedValue({ id: 'change_1', tenantId: 7, orderId: 'order_1',
      fromPlanCode: 'PRO_MONTHLY', toPlanCode: 'ESSENTIAL_MONTHLY', amountArs: 0,
      periodEnd: end, status: 'PENDING' });
    db.tenant.findUnique.mockResolvedValue({ id: 7, paidUntil: end });
    db.tenantPlanChange.updateMany.mockResolvedValue({ count: 1 });
  });

  it('programa la próxima cuota por transferencia sin modificar el plan pagado', async () => {
    db.tenantBillingOrder.findFirst.mockResolvedValue({ id: 'order_1', planCode: 'PRO_MONTHLY', method: 'TRANSFER' });
    expect(await scheduleDowngrade('change_1', 7)).toEqual({ status: 'SCHEDULED', effectiveAt: end });
    expect(db.tenantPlanChange.updateMany).toHaveBeenCalledWith({ where: { id: 'change_1', status: 'PENDING' },
      data: { status: 'APPLIED', appliedAt: expect.any(Date) } });
    expect(db.tenantBillingOrder.update).not.toHaveBeenCalled();
    expect(db.tenant.update).not.toHaveBeenCalled();
    expect(rebill.changeRebillSubscriptionPlan).not.toHaveBeenCalled();
  });

  it('prepara la próxima cuota de tarjeta en Rebill y conserva Pro hasta el vencimiento', async () => {
    db.tenantBillingOrder.findFirst.mockResolvedValue({ id: 'order_1', planCode: 'PRO_MONTHLY', method: 'CARD',
      rebillSubscriptionId: 'test_sub_1', amountArs: 99999, months: 1 });
    rebill.fetchRebillSubscription.mockResolvedValueOnce({ status: 'active', phase: 'PRO_MONTHLY' })
      .mockResolvedValueOnce({ status: 'active', phase: 'ESSENTIAL_MONTHLY' });
    rebill.rebillSubscriptionMatchesOrder.mockImplementation((subscription, order) => subscription.phase === order.planCode);
    rebill.findOrCreateRebillPlan.mockResolvedValue('test_pln_essential');
    expect(await scheduleDowngrade('change_1', 7)).toEqual({ status: 'SCHEDULED', effectiveAt: end });
    expect(rebill.changeRebillSubscriptionPlan).toHaveBeenCalledWith('test_sub_1', 'test_pln_essential');
    expect(db.tenantBillingOrder.update).not.toHaveBeenCalled();
    expect(db.tenant.update).not.toHaveBeenCalled();
  });

  it('cancela la baja y restaura la próxima cuota Pro en Rebill', async () => {
    db.tenantPlanChange.findFirst.mockResolvedValue({ id: 'change_1', tenantId: 7, orderId: 'order_1',
      fromPlanCode: 'PRO_MONTHLY', toPlanCode: 'ESSENTIAL_MONTHLY', amountArs: 0, periodEnd: end, status: 'APPLIED' });
    db.tenantBillingOrder.findFirst.mockResolvedValue({ id: 'order_1', planCode: 'PRO_MONTHLY', method: 'CARD',
      rebillSubscriptionId: 'test_sub_1', amountArs: 99999, months: 1 });
    rebill.fetchRebillSubscription.mockReset().mockResolvedValueOnce({ status: 'active', phase: 'ESSENTIAL_MONTHLY' })
      .mockResolvedValueOnce({ status: 'active', phase: 'PRO_MONTHLY' });
    rebill.rebillSubscriptionMatchesOrder.mockImplementation((subscription, order) => subscription.phase === order.planCode);
    rebill.findOrCreateRebillPlan.mockResolvedValue('test_pln_pro');
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await cancelScheduledDowngrade({ user: { tenantId: 7 } } as any, res as any);
    expect(rebill.changeRebillSubscriptionPlan).toHaveBeenCalledWith('test_sub_1', 'test_pln_pro');
    expect(db.tenantPlanChange.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: { rebillRefundId: 'CANCELLED_DOWNGRADE' },
    }));
    expect(res.json).toHaveBeenCalledWith({ status: 'CANCELLED' });
    expect(db.tenantBillingOrder.update).not.toHaveBeenCalled();
  });

  it('mantiene pendiente la cancelación si Rebill no confirma el cambio', async () => {
    db.tenantPlanChange.findFirst.mockResolvedValue({ id: 'change_1', tenantId: 7, orderId: 'order_1',
      fromPlanCode: 'PRO_MONTHLY', toPlanCode: 'ESSENTIAL_MONTHLY', amountArs: 0, periodEnd: end, status: 'APPLIED' });
    db.tenantBillingOrder.findFirst.mockResolvedValue({ id: 'order_1', planCode: 'PRO_MONTHLY', method: 'CARD',
      rebillSubscriptionId: 'test_sub_1', amountArs: 99999, months: 1 });
    rebill.fetchRebillSubscription.mockReset().mockRejectedValue(new Error('unavailable'));
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await cancelScheduledDowngrade({ user: { tenantId: 7 } } as any, res as any);
    expect(res.status).toHaveBeenCalledWith(202);
    expect(db.tenantPlanChange.updateMany).toHaveBeenCalledTimes(1);
  });

  it('cancela la baja por transferencia sin llamar a Rebill', async () => {
    db.tenantPlanChange.findFirst.mockResolvedValue({ id: 'change_1', tenantId: 7, orderId: 'order_1',
      fromPlanCode: 'PRO_MONTHLY', toPlanCode: 'ESSENTIAL_MONTHLY', amountArs: 0, periodEnd: end, status: 'APPLIED' });
    db.tenantBillingOrder.findFirst.mockResolvedValue({ id: 'order_1', planCode: 'PRO_MONTHLY', method: 'TRANSFER' });
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await cancelScheduledDowngrade({ user: { tenantId: 7 } } as any, res as any);
    expect(res.json).toHaveBeenCalledWith({ status: 'CANCELLED' });
    expect(rebill.changeRebillSubscriptionPlan).not.toHaveBeenCalled();
  });
});
