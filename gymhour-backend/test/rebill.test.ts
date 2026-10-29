import crypto from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BILLING_CATALOG } from '../src/services/billingCatalog.service.js';
import { fetchRebillPayment, fetchRebillSubscription, findOrCreateRebillPlan, rebillSubscriptionMatchesOrder, validRebillSignature } from '../src/services/rebill.service.js';

describe('Rebill configuration and webhook signature', () => {
  afterEach(() => {
    delete process.env.REBILL_SECRET_KEY;
    vi.unstubAllGlobals();
  });

  it('verifies exact raw bytes and rejects a tampered body', () => {
    const body = Buffer.from('{"data":{"payment":{"id":"pay_123"}}}');
    const secret = 'whsec_test';
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(validRebillSignature(body, signature, secret)).toBe(true);
    expect(validRebillSignature(Buffer.from('{}'), signature, secret)).toBe(false);
    expect(validRebillSignature(body, 'not-hex', secret)).toBe(false);
  });

  it('checks the authoritative payment using the private API key', async () => {
    process.env.REBILL_SECRET_KEY = 'sk_test';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      id: 'test_pay_123', status: 'approved', amount: 50000, currency: 'ARS',
      subscriptionId: 'test_sub_123', planId: 'test_pln_123', createdAt: '2026-10-27T10:00:00Z',
      customer: { email: 'admin@example.com' },
    }) });
    vi.stubGlobal('fetch', fetchMock);
    const payment = await fetchRebillPayment('test_pay_123');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.rebill.com/v3/payments/test_pay_123');
    expect(fetchMock.mock.calls[0][1].headers).toEqual({ 'x-api-key': 'sk_test' });
    expect(payment).toMatchObject({ status: 'approved', amount: 50000, customerEmail: 'admin@example.com' });
  });

  it('reads the order reference from a one-time Rebill payment', async () => {
    process.env.REBILL_SECRET_KEY = 'sk_test';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      id: 'test_pay_transfer', status: 'approved', amount: 50000, currency: 'ARS',
      createdAt: '2026-10-27T10:00:00Z', customer: { email: 'admin@example.com' },
      metadata: { gymhourOrderId: 'order_123' },
    }) }));
    const payment = await fetchRebillPayment('test_pay_transfer');
    expect(payment).toMatchObject({ orderId: 'order_123', subscriptionId: null });
  });

  it('checks the recurring amount, cadence and plan name', async () => {
    process.env.REBILL_SECRET_KEY = 'sk_test';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        id: 'test_sub_123', status: 'active', amount: 135000, currency: 'ARS',
        frequency: { period: 'month', count: 3 }, metadata: { gymhourOrderId: 'order_123' },
        plan: { id: 'test_pln_123' },
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        id: 'test_pln_123', status: 'active',
        name: [{ language: 'es', text: 'Gymhour 1–100 Trimestral' }],
        frequency: { period: 'month', count: 3 }, repetitions: null,
        prices: [{ amount: 135000, currency: 'ARS', isDefault: true }],
      }) });
    vi.stubGlobal('fetch', fetchMock);
    const subscription = await fetchRebillSubscription('test_sub_123');
    expect(subscription.orderId).toBe('order_123');
    expect(rebillSubscriptionMatchesOrder(subscription, { planCode: 'UP_TO_100_QUARTERLY', amountArs: 135000, months: 3 })).toBe(true);
    expect(rebillSubscriptionMatchesOrder(subscription, { planCode: 'UP_TO_100_QUARTERLY', amountArs: 135000, months: 1 })).toBe(false);
    expect(rebillSubscriptionMatchesOrder(subscription, { planCode: 'UP_TO_100_QUARTERLY', amountArs: 50000, months: 3 })).toBe(false);
    expect(rebillSubscriptionMatchesOrder(subscription, { planCode: 'UP_TO_300_QUARTERLY', amountArs: 135000, months: 3 })).toBe(false);
  });

  it('fetches stored plan terms if the subscription only contains a plan ID', async () => {
    process.env.REBILL_SECRET_KEY = 'sk_test';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'test_sub_123', planId: 'test_pln_123', status: 'active',
        amount: 50000, currency: 'ARS', frequency: { period: 'month', count: 1 },
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'test_pln_123',
        name: [{ language: 'es', text: 'Gymhour 1–100 Mensual' }],
        frequency: { period: 'month', count: 1 }, prices: [{ amount: 50000, currency: 'ARS', isDefault: true }],
        metadata: { gymhourOrderId: 'order_123' },
      }) });
    vi.stubGlobal('fetch', fetchMock);
    const subscription = await fetchRebillSubscription('test_sub_123');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.rebill.com/v3/plans/test_pln_123');
    expect(subscription.orderId).toBe('order_123');
    expect(rebillSubscriptionMatchesOrder(subscription, { planCode: 'UP_TO_100_MONTHLY', amountArs: 50000, months: 1 })).toBe(true);
  });

  it('rejects subscriptions without verifiable recurring terms', async () => {
    process.env.REBILL_SECRET_KEY = 'sk_test';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      id: 'test_sub_123', status: 'active', amount: 50000, currency: 'ARS',
    }) }));
    const subscription = await fetchRebillSubscription('test_sub_123');
    expect(rebillSubscriptionMatchesOrder(subscription, { planCode: 'UP_TO_100_MONTHLY', amountArs: 50000, months: 1 })).toBe(false);
  });

  it('rejects a subscription changed to a different recurring amount', async () => {
    process.env.REBILL_SECRET_KEY = 'sk_test';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'test_sub_123', planId: 'test_pln_123',
        amount: 1, currency: 'ARS', frequency: { period: 'month', count: 1 },
      }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'test_pln_123',
        name: [{ language: 'es', text: 'Gymhour 1–100 Mensual' }],
        frequency: { period: 'month', count: 1 }, prices: [{ amount: 50000, currency: 'ARS', isDefault: true }],
      }) });
    vi.stubGlobal('fetch', fetchMock);
    const subscription = await fetchRebillSubscription('test_sub_123');
    expect(rebillSubscriptionMatchesOrder(subscription, { planCode: 'UP_TO_100_MONTHLY', amountArs: 50000, months: 1 })).toBe(false);
  });

  it('reuses a matching sandbox plan without creating another', async () => {
    process.env.REBILL_SECRET_KEY = 'sk_test';
    const plan = BILLING_CATALOG.find(item => item.code === 'UP_TO_100_QUARTERLY')!;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ records: [{
      id: 'test_pln_existing', status: 'active', name: [{ language: 'es', text: 'Gymhour 1–100 Trimestral' }],
      frequency: { period: 'month', count: 3 }, prices: [{ amount: 135000, currency: 'ARS', isDefault: true }],
    }] }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await findOrCreateRebillPlan(plan)).toBe('test_pln_existing');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('creates a missing recurring plan automatically', async () => {
    process.env.REBILL_SECRET_KEY = 'sk_test';
    const plan = BILLING_CATALOG.find(item => item.code === 'UP_TO_100_ANNUAL')!;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ records: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        id: 'test_pln_new', status: 'active', name: [{ language: 'es', text: 'Gymhour 1–100 Anual' }],
        frequency: { period: 'year', count: 1 }, prices: [{ amount: 480000, currency: 'ARS', isDefault: true }],
      }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await findOrCreateRebillPlan(plan)).toBe('test_pln_new');
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.rebill.com/v3/plans');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      frequency: { period: 'year', count: 1 }, prices: [{ amount: 480000, currency: 'ARS' }],
    });
  });
});
