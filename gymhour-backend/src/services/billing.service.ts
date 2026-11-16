import type { Tenant } from '@prisma/client';

type BillingTenant = Pick<Tenant, 'trialEndsAt' | 'paidUntil' | 'billingExempt'> & {
  billingGraceUntil?: Date | null;
};

const CARD_GRACE_MS = 48 * 60 * 60 * 1000;

// Con tarjeta, el acceso sigue 48 horas después del vencimiento: absorbe la demora de la
// renovación y da tiempo a resolver un cobro rechazado.
export const cardGraceUntil = (paidUntil: Date): Date => new Date(paidUntil.getTime() + CARD_GRACE_MS);

export function getBillingAccess(tenant: BillingTenant, now = new Date()) {
  const paid = Boolean(tenant.paidUntil && tenant.paidUntil > now);
  const trial = Boolean(tenant.trialEndsAt && tenant.trialEndsAt > now);
  const inGrace = !tenant.billingExempt && !paid && !trial
    && Boolean(tenant.billingGraceUntil && tenant.billingGraceUntil > now);
  const state = tenant.billingExempt ? 'EXEMPT'
    : paid || inGrace ? 'PAID'
      : trial ? 'TRIAL' : 'EXPIRED';
  return {
    state,
    inGrace,
    trialEndsAt: tenant.trialEndsAt,
    paidUntil: tenant.paidUntil,
    graceUntil: inGrace ? tenant.billingGraceUntil : null,
    serverNow: now,
  };
}

export function requireBillingAccess(tenant: BillingTenant, now = new Date()) {
  return getBillingAccess(tenant, now).state !== 'EXPIRED';
}
