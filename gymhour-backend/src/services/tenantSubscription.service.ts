import { systemPrisma } from '../models/Prisma.js';
import { cardGraceUntil } from './billing.service.js';
import { fetchRebillSubscription, updateRebillSubscription } from './rebill.service.js';

const TERMINAL_STATUSES = ['cancelled', 'finished'];

export const isTerminalSubscriptionStatus = (status: string | null | undefined): boolean => (
  TERMINAL_STATUSES.includes(status || 'active')
);

export async function liveSubscriptionOrders(tenantId: number) {
  const orders = await systemPrisma.tenantBillingOrder.findMany({
    where: { tenantId, method: 'CARD', status: 'PAID', rebillSubscriptionId: { not: null } },
    orderBy: { paidAt: 'desc' },
  });
  return orders.filter(order => !isTerminalSubscriptionStatus(order.rebillSubscriptionStatus));
}

// Corta el débito en Rebill. El acceso ya pago sigue hasta paidUntil, sin tolerancia posterior.
export async function cancelTenantSubscriptions(tenantId: number, reason: string, cancelledBy: string): Promise<number> {
  const orders = await liveSubscriptionOrders(tenantId);
  for (const order of orders) {
    const subscriptionId = order.rebillSubscriptionId!;
    const current = await fetchRebillSubscription(subscriptionId);
    if (!isTerminalSubscriptionStatus(current.status)) {
      await updateRebillSubscription(subscriptionId, { status: 'cancelled' });
    }
    await systemPrisma.tenantBillingOrder.update({ where: { id: order.id }, data: {
      rebillSubscriptionStatus: 'cancelled', cancelledAt: new Date(),
      cancelReason: reason.slice(0, 255), cancelledBy: cancelledBy.slice(0, 191), pausedBySuspensionAt: null,
    } });
  }
  if (orders.length) {
    await systemPrisma.tenant.update({ where: { id: tenantId }, data: { billingGraceUntil: null } });
  }
  return orders.length;
}

export async function pauseTenantSubscriptions(tenantId: number): Promise<void> {
  for (const order of await liveSubscriptionOrders(tenantId)) {
    const subscriptionId = order.rebillSubscriptionId!;
    const current = await fetchRebillSubscription(subscriptionId);
    if (!['active', 'retrying'].includes(current.status)) continue;
    await updateRebillSubscription(subscriptionId, { status: 'paused' });
    await systemPrisma.tenantBillingOrder.update({ where: { id: order.id }, data: {
      rebillSubscriptionStatus: 'paused', pausedBySuspensionAt: new Date(),
    } });
  }
}

// Retoma solo lo que pausó la suspensión: una suscripción ya pausada por falta de pago sigue así.
export async function resumeTenantSubscriptions(tenantId: number): Promise<void> {
  const tenant = await systemPrisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const now = new Date();
  const nextCharge = tenant.paidUntil && tenant.paidUntil > now ? tenant.paidUntil : now;
  const orders = await liveSubscriptionOrders(tenantId);
  const paused = orders.filter(order => order.pausedBySuspensionAt);
  for (const order of paused) {
    await updateRebillSubscription(order.rebillSubscriptionId!, {
      status: 'active', nextChargeDate: nextCharge.toISOString(),
    });
    await systemPrisma.tenantBillingOrder.update({ where: { id: order.id }, data: {
      rebillSubscriptionStatus: 'active', pausedBySuspensionAt: null,
    } });
  }
  if (paused.length) {
    await systemPrisma.tenant.update({ where: { id: tenantId }, data: { billingGraceUntil: cardGraceUntil(nextCharge) } });
  }
}

// Al cambiar la tarjeta, Rebill espera a la próxima fecha de cobro. Si el acceso ya venció,
// se adelanta el cobro para hoy. Desde retrying hay que pasar por paused, según su documentación.
export async function collectAfterCardUpdate(order: { tenantId: number; rebillSubscriptionId: string | null }): Promise<void> {
  const tenant = await systemPrisma.tenant.findUnique({ where: { id: order.tenantId } });
  const now = new Date();
  if (!tenant || tenant.status !== 'ACTIVE' || !order.rebillSubscriptionId
    || (tenant.paidUntil && tenant.paidUntil > now)) return;
  const current = await fetchRebillSubscription(order.rebillSubscriptionId);
  if (isTerminalSubscriptionStatus(current.status)) return;
  const nextChargeDate = now.toISOString();
  if (current.status === 'active') {
    await updateRebillSubscription(order.rebillSubscriptionId, { nextChargeDate });
    return;
  }
  if (current.status === 'retrying') {
    await updateRebillSubscription(order.rebillSubscriptionId, { status: 'paused' });
  }
  await updateRebillSubscription(order.rebillSubscriptionId, { status: 'active', nextChargeDate });
}
