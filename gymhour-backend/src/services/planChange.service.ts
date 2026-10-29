import { BILLING_CATALOG } from './billingCatalog.service.js';

export function proratedPlanDifference(fromCode: string, toCode: string, periodStart: Date, periodEnd: Date, now = new Date()) {
  const from = BILLING_CATALOG.find(plan => plan.code === fromCode);
  const to = BILLING_CATALOG.find(plan => plan.code === toCode);
  const start = periodStart.getTime();
  const end = periodEnd.getTime();
  const today = now.getTime();
  if (!from || !to || from.code === to.code || !Number.isFinite(start) || !Number.isFinite(end)
    || !Number.isFinite(today) || end <= start || today < start || today >= end) {
    throw new Error('INVALID_PLAN_CHANGE_PERIOD');
  }
  const remaining = (end - today) / (end - start);
  const difference = to.amountArs - from.amountArs;
  return Math.sign(difference) * Math.round(Math.abs(difference) * remaining);
}

export function planChangeCharge(fromCode: string, toCode: string, periodStart: Date, periodEnd: Date, now = new Date()) {
  const difference = proratedPlanDifference(fromCode, toCode, periodStart, periodEnd, now);
  const from = BILLING_CATALOG.find(plan => plan.code === fromCode)!;
  const to = BILLING_CATALOG.find(plan => plan.code === toCode)!;
  return to.amountArs > from.amountArs ? Math.max(1, difference) : 0;
}
