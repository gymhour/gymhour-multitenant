import type { Tenant } from '@prisma/client';

type BillingTenant = Pick<Tenant, 'trialEndsAt' | 'paidUntil' | 'billingExempt'>;

export function getBillingAccess(tenant: BillingTenant, now = new Date()) {
  const state = tenant.billingExempt ? 'EXEMPT'
    : tenant.paidUntil && tenant.paidUntil > now ? 'PAID'
      : tenant.trialEndsAt && tenant.trialEndsAt > now ? 'TRIAL' : 'EXPIRED';
  return {
    state,
    trialEndsAt: tenant.trialEndsAt,
    paidUntil: tenant.paidUntil,
    serverNow: now,
  };
}

export function requireBillingAccess(tenant: BillingTenant, now = new Date()) {
  return getBillingAccess(tenant, now).state !== 'EXPIRED';
}
