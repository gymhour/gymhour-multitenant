import crypto from 'node:crypto';
import { ALL_BILLING_PLANS } from './billingCatalog.service.js';

type BillingPlan = (typeof ALL_BILLING_PLANS)[number];

const tierNames: Record<string, string> = {
  ESSENTIAL: 'Esencial', PRO: 'Pro',
  UP_TO_100: '1–100', UP_TO_300: '101–300', UP_TO_1000: '301–1000',
};

export function rebillPlanName(plan: { tierCode: string; periodLabel: string }): string {
  return `Gymhour ${tierNames[plan.tierCode]} ${plan.periodLabel}`;
}

export type RebillPayment = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  customerEmail: string | null;
  subscriptionId: string | null;
  planId: string | null;
  orderId: string | null;
  changeId: string | null;
  createdAt: Date;
};

async function rebillRequest(path: string, method = 'GET', payload?: unknown): Promise<Record<string, any>> {
  const base = process.env.REBILL_API_BASE_URL || 'https://api.rebill.com';
  const key = process.env.REBILL_SECRET_KEY;
  if (!key) throw new Error('REBILL_NOT_CONFIGURED');
  const response = await fetch(`${base.replace(/\/$/, '')}/v3/${path}`, {
    method, headers: { 'x-api-key': key, ...(payload ? { 'content-type': 'application/json' } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}), signal: AbortSignal.timeout(7000),
  });
  if (!response.ok) throw new Error(`REBILL_LOOKUP_${response.status}`);
  return await response.json() as Record<string, any>;
}

const rebillGet = (path: string) => rebillRequest(path);

export async function changeRebillSubscriptionPlan(subscriptionId: string, planId: string): Promise<void> {
  if (!/^(test_)?sub_[\w-]+$/.test(subscriptionId) || !/^(test_)?pln_[\w-]+$/.test(planId)) {
    throw new Error('INVALID_REBILL_IDENTIFIER');
  }
  await rebillRequest(`subscriptions/${encodeURIComponent(subscriptionId)}/plan`, 'PATCH', { planId });
}

function planMatches(plan: any, expected: BillingPlan): boolean {
  const terms = subscriptionTerms(plan, plan);
  return plan?.status === 'active' && plan?.name?.some?.((name: any) => name.text === rebillPlanName(expected))
    && Boolean(terms && terms.amount === expected.amountArs && terms.currency === 'ARS'
      && ((terms.period === 'month' && terms.count === expected.months)
        || (expected.months === 12 && terms.period === 'year' && terms.count === 1))
      && terms.repetitions === null && !plan.trialPeriodDays);
}

const provisioning = new Map<string, Promise<string>>();

export async function findOrCreateRebillPlan(plan: BillingPlan): Promise<string> {
  const existing = provisioning.get(plan.code);
  if (existing) return existing;
  const lookup = (async () => {
    const name = rebillPlanName(plan);
    const search = await rebillRequest('plans/search', 'POST', {
      search: name, pagination: { limit: 30, offset: 0, order: 'DESC' },
    });
    const found = search.records?.find?.((item: any) => planMatches(item, plan));
    if (found?.id) return String(found.id);
    const created = await rebillRequest('plans', 'POST', {
      name: [{ language: 'es', text: name }],
      frequency: plan.months === 12 ? { period: 'year', count: 1 } : { period: 'month', count: plan.months },
      prices: [{ amount: plan.amountArs, currency: 'ARS', isDefault: true }],
      metadata: { gymhourPlanCode: plan.code },
    });
    const result = created.data?.plan ?? created.data ?? created.plan ?? created;
    if (!/^(test_)?pln_[\w-]+$/.test(String(result.id ?? '')) || !planMatches(result, plan)) {
      throw new Error('REBILL_PLAN_CREATION_INVALID');
    }
    return String(result.id);
  })();
  provisioning.set(plan.code, lookup);
  try { return await lookup; } finally { provisioning.delete(plan.code); }
}

export async function fetchRebillPayment(id: string): Promise<RebillPayment> {
  if (!/^(test_)?pay_[\w-]+$/.test(id)) throw new Error('INVALID_PAYMENT_ID');
  const body = await rebillGet(`payments/${encodeURIComponent(id)}`);
  const payment = body.data?.payment ?? body.data ?? body.payment ?? body;
  return {
    id: String(payment.id ?? ''), status: String(payment.status ?? ''),
    amount: Number(payment.amount), currency: String(payment.currency ?? ''),
    customerEmail: payment.customer?.email ? String(payment.customer.email).toLowerCase() : null,
    subscriptionId: payment.subscriptionId ?? payment.subscription?.id ?? body.subscriptionId ?? null,
    planId: payment.planId ?? payment.plan?.id ?? body.planId ?? null,
    orderId: payment.metadata?.gymhourOrderId ?? body.metadata?.gymhourOrderId ?? null,
    changeId: payment.metadata?.gymhourPlanChangeId ?? body.metadata?.gymhourPlanChangeId ?? null,
    createdAt: new Date(payment.createdAt),
  };
}

export async function fetchRebillSubscription(id: string) {
  if (!/^(test_)?sub_[\w-]+$/.test(id)) throw new Error('INVALID_SUBSCRIPTION_ID');
  const body = await rebillGet(`subscriptions/${encodeURIComponent(id)}`);
  const subscription = body.data?.subscription ?? body.data ?? body.subscription ?? body;
  const plan = typeof subscription.plan === 'object' && subscription.plan !== null ? subscription.plan : null;
  const planId = subscription.planId ?? (typeof subscription.plan === 'string' ? subscription.plan : plan?.id) ?? null;
  // The stored plan is authoritative for the recurring amount and cadence.
  const orderId = subscription.metadata?.gymhourOrderId ?? plan?.metadata?.gymhourOrderId;
  const planBody = typeof planId === 'string' && /^(test_)?pln_[\w-]+$/.test(planId)
    ? await rebillGet(`plans/${encodeURIComponent(planId)}`) : null;
  const storedPlan = planBody?.data?.plan ?? planBody?.data ?? planBody?.plan ?? planBody;
  return {
    id: String(subscription.id ?? ''),
    planId,
    customerId: subscription.customerId ?? subscription.customer?.id ?? null,
    status: String(subscription.status ?? ''),
    orderId: orderId ?? storedPlan?.metadata?.gymhourOrderId ?? null,
    planName: storedPlan?.name?.find?.((name: any) => name.language === 'es')?.text
      ?? storedPlan?.name?.[0]?.text ?? plan?.name?.[0]?.text ?? null,
    terms: subscriptionTerms(subscription, null),
    planTerms: subscriptionTerms(storedPlan, storedPlan),
  };
}

type SubscriptionTerms = { amount: number; currency: string; period: string; count: number; repetitions: number | null };

function subscriptionTerms(subscription: any, plan: any): SubscriptionTerms | null {
  if (!subscription || typeof subscription !== 'object') return null;
  const frequency = plan?.frequency ?? subscription.frequency;
  const price = subscription.price ?? plan?.price
    ?? subscription.prices?.find?.((item: any) => item.isDefault) ?? subscription.prices?.[0]
    ?? plan?.prices?.find?.((item: any) => item.isDefault) ?? plan?.prices?.[0];
  const amount = Number(price?.amount ?? subscription.amount ?? plan?.amount);
  const currency = price?.currency ?? subscription.currency ?? plan?.currency;
  const count = Number(frequency?.count ?? frequency?.quantity);
  const repetitions = plan?.repetitions ?? subscription.repetitions ?? null;
  if (!Number.isFinite(amount) || typeof currency !== 'string'
    || typeof frequency?.period !== 'string' || !Number.isInteger(count)) return null;
  return { amount, currency, period: frequency.period, count, repetitions };
}

export function rebillSubscriptionMatchesOrder(
  subscription: { terms: SubscriptionTerms | null; planTerms: SubscriptionTerms | null; planName: string | null },
  order: { amountArs: number; months: number; planCode: string },
): boolean {
  const expected = ALL_BILLING_PLANS.find(plan => plan.code === order.planCode);
  if (!expected) return false;
  const matches = (terms: SubscriptionTerms | null) => Boolean(terms
    && terms.amount === order.amountArs && terms.currency === 'ARS'
    && ((terms.period === 'month' && terms.count === order.months)
      || (order.months === 12 && terms.period === 'year' && terms.count === 1)));
  return matches(subscription.terms) && matches(subscription.planTerms)
    && subscription.planTerms?.repetitions === null && subscription.planName === rebillPlanName(expected);
}

export function validRebillSignature(raw: Buffer | undefined, signature: unknown, secret = process.env.REBILL_SIGNING_SECRET): boolean {
  if (!raw || !secret || typeof signature !== 'string' || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const actual = Buffer.from(signature, 'hex');
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  return crypto.timingSafeEqual(actual, expected);
}
