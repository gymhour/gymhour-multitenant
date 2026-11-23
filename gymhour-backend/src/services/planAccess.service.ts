import type { NextFunction, Request, Response } from 'express';
import { systemPrisma } from '../models/Prisma.js';
import { getBillingAccess } from './billing.service.js';
import { tierCodeFromPlanCode } from './billingCatalog.service.js';
import { liveSubscriptionOrders } from './tenantSubscription.service.js';

// MEMBER_PAYMENTS: cobro de cuotas a socios con Mercado Pago (botón de pago y débito automático).
export type PaidFeature = 'CHECK_IN' | 'ATTENDANCE' | 'CHURN' | 'AI' | 'MEMBER_PAYMENTS';
export const PAID_FEATURES: PaidFeature[] = ['CHECK_IN', 'ATTENDANCE', 'CHURN', 'AI', 'MEMBER_PAYMENTS'];

export function hasPaidFeature(state: string, tierCode: string | null, feature: PaidFeature, trialEndsAt?: Date | null, now = new Date()) {
  if (state === 'EXEMPT' || (trialEndsAt && trialEndsAt > now)) return true;
  if (state !== 'PAID') return false;
  return tierCode === 'PRO' || tierCode === 'LEGACY';
}

export function effectivePlanCode(planCode: string | null, scheduled: {
  fromPlanCode: string; toPlanCode: string; periodEnd: Date;
} | null, now = new Date()) {
  return scheduled && planCode === scheduled.toPlanCode && now < scheduled.periodEnd
    ? scheduled.fromPlanCode : planCode;
}

export async function tenantPlanAccess(tenantId: number) {
  const [tenant, order, [liveOrder]] = await Promise.all([
    systemPrisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    systemPrisma.tenantBillingOrder.findFirst({ where: { tenantId, status: 'PAID' }, orderBy: { paidAt: 'desc' }, select: { id: true, planCode: true, method: true } }),
    liveSubscriptionOrders(tenantId),
  ]);
  const billing = getBillingAccess(tenant);
  const scheduled = order && await systemPrisma.tenantPlanChange.findFirst({ where: {
    tenantId, orderId: order.id, amountArs: 0,
    OR: [{ status: 'APPLIED' }, { status: 'FAILED', rebillRefundId: 'CANCELLING_DOWNGRADE' }],
    fromPlanCode: 'PRO_MONTHLY', toPlanCode: 'ESSENTIAL_MONTHLY',
  }, orderBy: { createdAt: 'desc' } });
  const planCode = effectivePlanCode(order?.planCode ?? null, scheduled, billing.serverNow);
  const tierCode = tierCodeFromPlanCode(planCode) ?? (billing.state === 'PAID' ? 'LEGACY' : null);
  return { ...billing, tierCode, planCode, paymentMethod: order?.method ?? null,
    liveSubscriptionStatus: liveOrder ? liveOrder.rebillSubscriptionStatus || 'active' : null,
    scheduledPlanCode: scheduled && (order?.planCode === scheduled.fromPlanCode || billing.serverNow < scheduled.periodEnd)
      ? scheduled.toPlanCode : null,
    scheduledEffectiveAt: scheduled?.periodEnd ?? null,
    features: Object.fromEntries(PAID_FEATURES
      .map(feature => [feature, hasPaidFeature(billing.state, tierCode, feature, tenant.trialEndsAt)])) as Record<PaidFeature, boolean> };
}

export const requirePaidFeature = (feature: PaidFeature) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const access = await tenantPlanAccess(req.user?.tenantId ?? req.tenant!.id);
    if (access.features[feature]) { next(); return; }
    res.status(403).json({ code: 'PLAN_UPGRADE_REQUIRED', feature, requiredPlan: 'PRO',
      message: 'Esta función está disponible en el plan Pro.' });
  } catch (error) { next(error); }
};
