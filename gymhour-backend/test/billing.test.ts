import { describe, expect, it } from 'vitest';
import { getBillingAccess } from '../src/services/billing.service.js';

describe('acceso por suscripción', () => {
  const now = new Date('2026-10-17T12:00:00.000Z');
  const before = new Date(now.getTime() - 1);
  const after = new Date(now.getTime() + 1);

  it('vence exactamente a los 14 días y permite períodos pagos posteriores', () => {
    const base = { trialEndsAt: after, paidUntil: null, billingExempt: false };
    expect(getBillingAccess(base, now).state).toBe('TRIAL');
    expect(getBillingAccess({ ...base, trialEndsAt: now }, now).state).toBe('EXPIRED');
    expect(getBillingAccess({ ...base, trialEndsAt: before, paidUntil: after }, now).state).toBe('PAID');
    expect(getBillingAccess({ ...base, trialEndsAt: before, paidUntil: now }, now).state).toBe('EXPIRED');
  });

  it('conserva el acceso de gimnasios anteriores y falla cerrado sin fecha', () => {
    expect(getBillingAccess({ trialEndsAt: before, paidUntil: null, billingExempt: true }, now).state).toBe('EXEMPT');
    expect(getBillingAccess({ trialEndsAt: null, paidUntil: null, billingExempt: false }, now).state).toBe('EXPIRED');
  });
});
