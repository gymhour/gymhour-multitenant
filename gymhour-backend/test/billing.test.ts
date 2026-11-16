import { describe, expect, it } from 'vitest';
import { cardGraceUntil, getBillingAccess } from '../src/services/billing.service.js';

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

  it('mantiene el acceso durante la tolerancia y lo corta al terminar', () => {
    const base = { trialEndsAt: before, paidUntil: before, billingExempt: false };
    expect(getBillingAccess({ ...base, billingGraceUntil: after }, now)).toMatchObject({ state: 'PAID', inGrace: true, graceUntil: after });
    expect(getBillingAccess({ ...base, billingGraceUntil: now }, now)).toMatchObject({ state: 'EXPIRED', inGrace: false });
    expect(getBillingAccess({ ...base, billingGraceUntil: null }, now)).toMatchObject({ state: 'EXPIRED', inGrace: false });
  });

  it('no marca tolerancia con el período al día, en prueba o exento', () => {
    const grace = { billingGraceUntil: after };
    expect(getBillingAccess({ trialEndsAt: before, paidUntil: after, billingExempt: false, ...grace }, now).inGrace).toBe(false);
    expect(getBillingAccess({ trialEndsAt: after, paidUntil: before, billingExempt: false, ...grace }, now)).toMatchObject({ state: 'TRIAL', inGrace: false });
    expect(getBillingAccess({ trialEndsAt: before, paidUntil: before, billingExempt: true, ...grace }, now)).toMatchObject({ state: 'EXEMPT', inGrace: false });
  });

  it('calcula la tolerancia de tarjeta en 48 horas', () => {
    expect(cardGraceUntil(now).getTime() - now.getTime()).toBe(48 * 60 * 60 * 1000);
  });

  it('conserva el acceso de gimnasios anteriores y falla cerrado sin fecha', () => {
    expect(getBillingAccess({ trialEndsAt: before, paidUntil: null, billingExempt: true }, now).state).toBe('EXEMPT');
    expect(getBillingAccess({ trialEndsAt: null, paidUntil: null, billingExempt: false }, now).state).toBe('EXPIRED');
  });
});
