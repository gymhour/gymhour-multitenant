import { describe, expect, it } from 'vitest';
import { effectivePlanCode, hasPaidFeature } from '../src/services/planAccess.service.js';
import { tierCodeFromPlanCode } from '../src/services/billingCatalog.service.js';

describe('plan features', () => {
  it('allows all features during the free trial, even if a plan was purchased early', () => {
    const future = new Date('2026-11-10T00:00:00Z');
    const now = new Date('2026-10-29T00:00:00Z');
    expect(hasPaidFeature('TRIAL', null, 'AI', future, now)).toBe(true);
    expect(hasPaidFeature('PAID', 'ESSENTIAL', 'CHECK_IN', future, now)).toBe(true);
  });

  it('restricts Esencial and enables Pro', () => {
    expect(hasPaidFeature('PAID', 'ESSENTIAL', 'AI')).toBe(false);
    expect(hasPaidFeature('PAID', 'ESSENTIAL', 'ATTENDANCE')).toBe(false);
    expect(hasPaidFeature('PAID', 'PRO', 'CHURN')).toBe(true);
    expect(hasPaidFeature('PAID', 'PRO', 'CHECK_IN')).toBe(true);
    expect(tierCodeFromPlanCode('ESSENTIAL_MONTHLY')).toBe('ESSENTIAL');
    expect(tierCodeFromPlanCode('PRO_MONTHLY')).toBe('PRO');
  });

  it('preserves legacy subscriptions and exempts', () => {
    expect(tierCodeFromPlanCode('UP_TO_100_ANNUAL')).toBe('LEGACY');
    expect(hasPaidFeature('PAID', 'LEGACY', 'AI')).toBe(true);
    expect(hasPaidFeature('EXEMPT', null, 'AI')).toBe(true);
    expect(hasPaidFeature('EXPIRED', 'PRO', 'AI')).toBe(false);
  });

  it('conserva Pro hasta el vencimiento aunque Rebill cobre Esencial en la renovación', () => {
    const scheduled = { fromPlanCode: 'PRO_MONTHLY', toPlanCode: 'ESSENTIAL_MONTHLY',
      periodEnd: new Date('2026-11-01T00:00:00Z') };
    expect(effectivePlanCode('ESSENTIAL_MONTHLY', scheduled, new Date('2026-10-31T23:59:59Z'))).toBe('PRO_MONTHLY');
    expect(effectivePlanCode('ESSENTIAL_MONTHLY', scheduled, scheduled.periodEnd)).toBe('ESSENTIAL_MONTHLY');
  });
});
