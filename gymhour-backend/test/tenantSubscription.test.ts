import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  tenantBillingOrder: { findMany: vi.fn(), update: vi.fn() },
  tenant: { update: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn() },
}));
const rebill = vi.hoisted(() => ({ fetchRebillSubscription: vi.fn(), updateRebillSubscription: vi.fn() }));

vi.mock('../src/models/Prisma.js', () => ({ systemPrisma: db }));
vi.mock('../src/services/rebill.service.js', () => rebill);

import {
  cancelTenantSubscriptions, collectAfterCardUpdate, liveSubscriptionOrders,
  pauseTenantSubscriptions, resumeTenantSubscriptions,
} from '../src/services/tenantSubscription.service.js';

const order = (overrides = {}) => ({
  id: 'order_1', tenantId: 7, rebillSubscriptionId: 'test_sub_1', rebillSubscriptionStatus: 'active',
  pausedBySuspensionAt: null, ...overrides,
});
const future = new Date(Date.now() + 86_400_000);

beforeEach(() => {
  vi.clearAllMocks();
  db.tenantBillingOrder.findMany.mockResolvedValue([order()]);
  rebill.fetchRebillSubscription.mockResolvedValue({ status: 'active' });
  rebill.updateRebillSubscription.mockResolvedValue(undefined);
});

describe('suscripciones vivas', () => {
  it('ignora las canceladas y terminadas, y toma como activa la que no informó estado', async () => {
    db.tenantBillingOrder.findMany.mockResolvedValue([
      order({ id: 'a', rebillSubscriptionStatus: 'cancelled' }),
      order({ id: 'b', rebillSubscriptionStatus: 'finished' }),
      order({ id: 'c', rebillSubscriptionStatus: 'retrying' }),
      order({ id: 'd', rebillSubscriptionStatus: null }),
    ]);
    expect((await liveSubscriptionOrders(7)).map(item => item.id)).toEqual(['c', 'd']);
  });
});

describe('cancelación', () => {
  it('cancela en Rebill, guarda el motivo y quita la tolerancia', async () => {
    expect(await cancelTenantSubscriptions(7, 'Cierro el gimnasio', 'admin@example.com')).toBe(1);
    expect(rebill.updateRebillSubscription).toHaveBeenCalledWith('test_sub_1', { status: 'cancelled' });
    expect(db.tenantBillingOrder.update).toHaveBeenCalledWith({ where: { id: 'order_1' }, data: expect.objectContaining({
      rebillSubscriptionStatus: 'cancelled', cancelReason: 'Cierro el gimnasio', cancelledBy: 'admin@example.com', cancelledAt: expect.any(Date),
    }) });
    expect(db.tenant.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { billingGraceUntil: null } });
  });

  it('no vuelve a cancelar si Rebill ya la tiene cancelada, pero la registra', async () => {
    rebill.fetchRebillSubscription.mockResolvedValue({ status: 'cancelled' });
    await cancelTenantSubscriptions(7, 'Motivo', 'admin@example.com');
    expect(rebill.updateRebillSubscription).not.toHaveBeenCalled();
    expect(db.tenantBillingOrder.update).toHaveBeenCalled();
  });

  it('no registra nada si Rebill falla', async () => {
    rebill.updateRebillSubscription.mockRejectedValue(new Error('REBILL_LOOKUP_500'));
    await expect(cancelTenantSubscriptions(7, 'Motivo', 'admin@example.com')).rejects.toThrow();
    expect(db.tenantBillingOrder.update).not.toHaveBeenCalled();
    expect(db.tenant.update).not.toHaveBeenCalled();
  });

  it('sin suscripciones no hace nada', async () => {
    db.tenantBillingOrder.findMany.mockResolvedValue([]);
    expect(await cancelTenantSubscriptions(7, 'Motivo', 'admin@example.com')).toBe(0);
    expect(db.tenant.update).not.toHaveBeenCalled();
  });
});

describe('suspensión', () => {
  it('pausa una suscripción activa y la marca', async () => {
    await pauseTenantSubscriptions(7);
    expect(rebill.updateRebillSubscription).toHaveBeenCalledWith('test_sub_1', { status: 'paused' });
    expect(db.tenantBillingOrder.update).toHaveBeenCalledWith({ where: { id: 'order_1' }, data: {
      rebillSubscriptionStatus: 'paused', pausedBySuspensionAt: expect.any(Date),
    } });
  });

  it('no marca una suscripción que ya estaba pausada por falta de pago', async () => {
    rebill.fetchRebillSubscription.mockResolvedValue({ status: 'paused' });
    await pauseTenantSubscriptions(7);
    expect(rebill.updateRebillSubscription).not.toHaveBeenCalled();
    expect(db.tenantBillingOrder.update).not.toHaveBeenCalled();
  });

  it('al reactivar retoma solo la marcada, con cobro al vencer el período pago', async () => {
    db.tenant.findUniqueOrThrow.mockResolvedValue({ id: 7, paidUntil: future });
    db.tenantBillingOrder.findMany.mockResolvedValue([
      order({ rebillSubscriptionStatus: 'paused', pausedBySuspensionAt: new Date() }),
      order({ id: 'order_2', rebillSubscriptionId: 'test_sub_2', rebillSubscriptionStatus: 'paused' }),
    ]);
    await resumeTenantSubscriptions(7);
    expect(rebill.updateRebillSubscription).toHaveBeenCalledTimes(1);
    expect(rebill.updateRebillSubscription).toHaveBeenCalledWith('test_sub_1', { status: 'active', nextChargeDate: future.toISOString() });
    expect(db.tenant.update).toHaveBeenCalledWith({ where: { id: 7 }, data: {
      billingGraceUntil: new Date(future.getTime() + 48 * 60 * 60 * 1000),
    } });
  });

  it('si el período pago ya pasó, retoma con cobro inmediato', async () => {
    db.tenant.findUniqueOrThrow.mockResolvedValue({ id: 7, paidUntil: new Date(Date.now() - 86_400_000) });
    db.tenantBillingOrder.findMany.mockResolvedValue([order({ rebillSubscriptionStatus: 'paused', pausedBySuspensionAt: new Date() })]);
    await resumeTenantSubscriptions(7);
    const { nextChargeDate } = rebill.updateRebillSubscription.mock.calls[0][1];
    expect(Math.abs(new Date(nextChargeDate).getTime() - Date.now())).toBeLessThan(5_000);
  });
});

describe('cobro al cambiar la tarjeta', () => {
  const expired = { id: 7, status: 'ACTIVE', paidUntil: new Date(Date.now() - 1000) };

  it('desde retrying pasa por paused y reactiva con cobro para hoy', async () => {
    db.tenant.findUnique.mockResolvedValue(expired);
    rebill.fetchRebillSubscription.mockResolvedValue({ status: 'retrying' });
    await collectAfterCardUpdate(order());
    expect(rebill.updateRebillSubscription.mock.calls.map(call => call[1].status)).toEqual(['paused', 'active']);
    expect(rebill.updateRebillSubscription.mock.calls[1][1].nextChargeDate).toEqual(expect.any(String));
  });

  it('desde paused reactiva directo', async () => {
    db.tenant.findUnique.mockResolvedValue(expired);
    rebill.fetchRebillSubscription.mockResolvedValue({ status: 'paused' });
    await collectAfterCardUpdate(order());
    expect(rebill.updateRebillSubscription).toHaveBeenCalledTimes(1);
    expect(rebill.updateRebillSubscription.mock.calls[0][1].status).toBe('active');
  });

  it('si sigue activa solo adelanta la fecha de cobro', async () => {
    db.tenant.findUnique.mockResolvedValue(expired);
    await collectAfterCardUpdate(order());
    expect(rebill.updateRebillSubscription.mock.calls[0][1]).toEqual({ nextChargeDate: expect.any(String) });
  });

  it('no cobra si el acceso sigue pago, el gimnasio está suspendido o la suscripción terminó', async () => {
    db.tenant.findUnique.mockResolvedValue({ ...expired, paidUntil: future });
    await collectAfterCardUpdate(order());
    db.tenant.findUnique.mockResolvedValue({ ...expired, status: 'SUSPENDED' });
    await collectAfterCardUpdate(order());
    db.tenant.findUnique.mockResolvedValue(expired);
    rebill.fetchRebillSubscription.mockResolvedValue({ status: 'cancelled' });
    await collectAfterCardUpdate(order());
    expect(rebill.updateRebillSubscription).not.toHaveBeenCalled();
  });
});
