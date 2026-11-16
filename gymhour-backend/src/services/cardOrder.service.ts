import type { Prisma } from '@prisma/client';
import { cardGraceUntil } from './billing.service.js';
import { paidUntilFromPurchase } from './billingCatalog.service.js';
import { fetchRebillSubscription, rebillSubscriptionMatchesOrder, type RebillPayment } from './rebill.service.js';

type CardOrder = {
  id: string; tenantId: number; planCode: string; amountArs: number; months: number;
  creditUsedArs: number; createdAt: Date;
};
type RebillSubscription = Awaited<ReturnType<typeof fetchRebillSubscription>>;

// Lo que Rebill tiene que confirmar para habilitar una compra con tarjeta. El email se valida aparte.
export function cardPaymentMatchesOrder(order: CardOrder, payment: RebillPayment, subscription: RebillSubscription): boolean {
  return payment.status === 'approved' && payment.amount === order.amountArs && payment.currency === 'ARS'
    && (!payment.subscriptionId || payment.subscriptionId === subscription.id)
    && rebillSubscriptionMatchesOrder(subscription, order)
    && (!subscription.orderId || subscription.orderId === order.id)
    && (!payment.orderId || payment.orderId === order.id)
    && Number.isFinite(payment.createdAt.getTime()) && payment.createdAt >= order.createdAt
    && (!payment.planId || !subscription.planId || payment.planId === subscription.planId);
}

// Marca la orden como pagada y extiende el acceso. Devuelve false si otra confirmación ya la procesó.
export async function activateCardOrder(
  tx: Prisma.TransactionClient, order: CardOrder, payment: RebillPayment, subscription: RebillSubscription,
): Promise<{ activated: boolean; paidUntil: Date }> {
  const paidUntil = paidUntilFromPurchase(payment.createdAt, order.months);
  const changed = await tx.tenantBillingOrder.updateMany({ where: { id: order.id, status: 'PENDING' }, data: {
    status: 'PAID', rebillPaymentId: payment.id, rebillSubscriptionId: subscription.id,
    rebillSubscriptionStatus: subscription.status,
    rebillLatestPaymentId: payment.id, currentPeriodStart: payment.createdAt,
    paidAt: payment.createdAt, paidUntil,
  } });
  if (!changed.count) return { activated: false, paidUntil };
  await tx.rebillProcessedPayment.create({ data: { paymentId: payment.id } });
  // Si el webhook llegó antes que la confirmación, el pago ya figuraba como sin vincular.
  await tx.rebillUnlinkedPayment.updateMany({ where: { paymentId: payment.id, linkedAt: null },
    data: { linkedAt: new Date(), linkedOrderId: order.id, linkedBy: 'Confirmado al pagar' } });
  const tenant = await tx.tenant.updateMany({ where: { id: order.tenantId, billingCreditArs: { gte: order.creditUsedArs } },
    data: { paidUntil, billingGraceUntil: cardGraceUntil(paidUntil), billingExempt: false, billingCreditArs: { decrement: order.creditUsedArs } } });
  if (!tenant.count) throw new Error('BILLING_CREDIT_CHANGED');
  return { activated: true, paidUntil };
}
