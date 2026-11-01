/** Prices for Gymhour's tenant subscription, in whole Argentine pesos. */
export const BILLING_TIERS = [
  { code: 'ESSENTIAL', label: 'Esencial', minUsers: 0, maxUsers: 100, monthlyArs: 49_999 },
  { code: 'PRO', label: 'Pro', minUsers: 0, maxUsers: 200, monthlyArs: 99_999 },
] as const;

export function billingTierForActiveStudentCount(activeStudentCount: number) {
  if (!Number.isInteger(activeStudentCount) || activeStudentCount < 0) return null;
  return BILLING_TIERS.find(tier => activeStudentCount <= tier.maxUsers) ?? null;
}

export function billingOfferForActiveStudentCount(activeStudentCount: number) {
  if (!Number.isInteger(activeStudentCount) || activeStudentCount < 0) {
    throw new Error('INVALID_ACTIVE_STUDENT_COUNT');
  }
  if (activeStudentCount > 200) return { kind: 'ENTERPRISE' as const };
  return { kind: 'SELF_SERVICE' as const, tier: billingTierForActiveStudentCount(activeStudentCount)! };
}

export const BILLING_PERIODS = [
  { code: 'MONTHLY', label: 'Mensual', months: 1, discountPercent: 0 },
] as const;

export const BILLING_CATALOG = BILLING_TIERS.flatMap(tier => BILLING_PERIODS.map(period => ({
  code: `${tier.code}_${period.code}`,
  tierCode: tier.code,
  tierLabel: tier.label,
  minUsers: tier.minUsers,
  maxUsers: tier.maxUsers,
  periodCode: period.code,
  periodLabel: period.label,
  months: period.months,
  discountPercent: period.discountPercent,
  amountArs: tier.monthlyArs * period.months * (100 - period.discountPercent) / 100,
})));

// Existing Rebill subscriptions keep their original terms for renewal verification.
export const LEGACY_BILLING_CATALOG = [
  { code: 'UP_TO_100', label: 'Hasta 100 alumnos activos', maxUsers: 100, monthlyArs: 50_000 },
  { code: 'UP_TO_300', label: 'De 101 a 300 alumnos activos', maxUsers: 300, monthlyArs: 100_000 },
  { code: 'UP_TO_1000', label: 'De 301 a 1000 alumnos activos', maxUsers: 1000, monthlyArs: 150_000 },
].flatMap(tier => [
  { code: 'MONTHLY', label: 'Mensual', months: 1, discountPercent: 0 },
  { code: 'QUARTERLY', label: 'Trimestral', months: 3, discountPercent: 10 },
  { code: 'SEMIANNUAL', label: 'Semestral', months: 6, discountPercent: 15 },
  { code: 'ANNUAL', label: 'Anual', months: 12, discountPercent: 20 },
].map(period => ({
  code: `${tier.code}_${period.code}`, tierCode: tier.code, tierLabel: tier.label,
  minUsers: 0, maxUsers: tier.maxUsers, periodCode: period.code,
  periodLabel: period.label, months: period.months,
  discountPercent: period.discountPercent,
  amountArs: tier.monthlyArs * period.months * (100 - period.discountPercent) / 100,
})));

export const ALL_BILLING_PLANS = [...BILLING_CATALOG, ...LEGACY_BILLING_CATALOG];

export function tierCodeFromPlanCode(planCode: string | null | undefined) {
  if (!planCode) return null;
  if (planCode.startsWith('ESSENTIAL_')) return 'ESSENTIAL';
  if (planCode.startsWith('PRO_')) return 'PRO';
  if (planCode.startsWith('UP_TO_')) return 'LEGACY';
  return null;
}

/** First paid period starts when Rebill approves the purchase, even during trial. */
export function paidUntilFromPurchase(approvedAt: Date, months: number): Date {
  if (!Number.isInteger(months) || months < 1 || !Number.isFinite(approvedAt.getTime())) {
    throw new Error('INVALID_BILLING_PERIOD');
  }
  const year = approvedAt.getUTCFullYear();
  const month = approvedAt.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const result = new Date(approvedAt);
  result.setUTCDate(1);
  result.setUTCFullYear(year, month, Math.min(approvedAt.getUTCDate(), lastDay));
  return result;
}
