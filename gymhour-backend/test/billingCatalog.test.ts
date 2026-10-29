import { describe, expect, it } from 'vitest';
import { BILLING_CATALOG, billingOfferForActiveStudentCount, billingTierForActiveStudentCount, paidUntilFromPurchase } from '../src/services/billingCatalog.service.js';

describe('Gymhour billing catalog', () => {
  it('publishes the two monthly plans', () => {
    expect(Object.fromEntries(BILLING_CATALOG.map(plan => [plan.code, plan.amountArs]))).toEqual({
      ESSENTIAL_MONTHLY: 49_999,
      PRO_MONTHLY: 99_999,
    });
  });

  it('selects tiers at the inclusive user boundaries', () => {
    expect(billingTierForActiveStudentCount(100)?.code).toBe('ESSENTIAL');
    expect(billingTierForActiveStudentCount(101)?.code).toBe('PRO');
    expect(billingTierForActiveStudentCount(200)?.code).toBe('PRO');
    expect(billingTierForActiveStudentCount(201)).toBeNull();
    expect(billingOfferForActiveStudentCount(201)).toEqual({ kind: 'ENTERPRISE' });
    expect(billingOfferForActiveStudentCount(200).kind).toBe('SELF_SERVICE');
  });

  it('starts a paid period at approval and clamps month-end dates', () => {
    expect(paidUntilFromPurchase(new Date('2026-01-31T15:30:00.000Z'), 1).toISOString())
      .toBe('2026-02-28T15:30:00.000Z');
    expect(paidUntilFromPurchase(new Date('2026-10-20T15:30:00.000Z'), 3).toISOString())
      .toBe('2027-01-20T15:30:00.000Z');
  });
});
