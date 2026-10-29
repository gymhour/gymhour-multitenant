import { describe, expect, it } from 'vitest';
import { BILLING_CATALOG, billingOfferForActiveStudentCount, billingTierForActiveStudentCount, paidUntilFromPurchase } from '../src/services/billingCatalog.service.js';

describe('Gymhour billing catalog', () => {
  it('calculates the twelve full-period ARS prices', () => {
    expect(Object.fromEntries(BILLING_CATALOG.map(plan => [plan.code, plan.amountArs]))).toEqual({
      UP_TO_100_MONTHLY: 50_000,
      UP_TO_100_QUARTERLY: 135_000,
      UP_TO_100_SEMIANNUAL: 255_000,
      UP_TO_100_ANNUAL: 480_000,
      UP_TO_300_MONTHLY: 100_000,
      UP_TO_300_QUARTERLY: 270_000,
      UP_TO_300_SEMIANNUAL: 510_000,
      UP_TO_300_ANNUAL: 960_000,
      UP_TO_1000_MONTHLY: 150_000,
      UP_TO_1000_QUARTERLY: 405_000,
      UP_TO_1000_SEMIANNUAL: 765_000,
      UP_TO_1000_ANNUAL: 1_440_000,
    });
  });

  it('selects tiers at the inclusive user boundaries', () => {
    expect(billingTierForActiveStudentCount(100)?.code).toBe('UP_TO_100');
    expect(billingTierForActiveStudentCount(101)?.code).toBe('UP_TO_300');
    expect(billingTierForActiveStudentCount(300)?.code).toBe('UP_TO_300');
    expect(billingTierForActiveStudentCount(301)?.code).toBe('UP_TO_1000');
    expect(billingTierForActiveStudentCount(1000)?.code).toBe('UP_TO_1000');
    expect(billingTierForActiveStudentCount(1001)).toBeNull();
    expect(billingOfferForActiveStudentCount(1001)).toEqual({ kind: 'ENTERPRISE' });
    expect(billingOfferForActiveStudentCount(1000).kind).toBe('SELF_SERVICE');
  });

  it('starts a paid period at approval and clamps month-end dates', () => {
    expect(paidUntilFromPurchase(new Date('2026-01-31T15:30:00.000Z'), 1).toISOString())
      .toBe('2026-02-28T15:30:00.000Z');
    expect(paidUntilFromPurchase(new Date('2026-10-20T15:30:00.000Z'), 3).toISOString())
      .toBe('2027-01-20T15:30:00.000Z');
  });
});
