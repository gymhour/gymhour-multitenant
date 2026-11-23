import crypto from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as mp from '../src/services/mercadoPago.service.js';

// La única forma de hablar con Mercado Pago es este módulo, y solo con estas rutas.
const ALLOWED = [
  /^POST https:\/\/api\.mercadopago\.com\/oauth\/token$/,
  /^GET https:\/\/api\.mercadopago\.com\/users\/me$/,
  /^POST https:\/\/api\.mercadopago\.com\/checkout\/preferences$/,
  /^GET https:\/\/api\.mercadopago\.com\/v1\/payments\/\d+$/,
  /^GET https:\/\/api\.mercadopago\.com\/v1\/payments\/search\?external_reference=[\w-]+&sort=date_created&criteria=desc$/,
  /^POST https:\/\/api\.mercadopago\.com\/preapproval$/,
  /^GET https:\/\/api\.mercadopago\.com\/preapproval\/[\w-]+$/,
  /^PUT https:\/\/api\.mercadopago\.com\/preapproval\/[\w-]+$/,
  /^GET https:\/\/api\.mercadopago\.com\/authorized_payments\/\d+$/,
];

const fetchMock = vi.fn();
const reply = (body: unknown, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
  process.env.MP_CLIENT_ID = 'client-id';
  process.env.MP_CLIENT_SECRET = 'client-secret';
  process.env.API_PUBLIC_URL = 'https://api.gymhour.test';
  process.env.MP_TEST_MODE = 'false';
  delete process.env.MP_API_BASE_URL;
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('lista cerrada de operaciones', () => {
  it('solo expone las rutas permitidas', () => {
    expect(Object.keys(mp.MERCADOPAGO_ROUTES).sort()).toEqual([
      'createPreapproval', 'createPreference', 'currentUser', 'getAuthorizedPayment', 'getPayment',
      'getPreapproval', 'oauthToken', 'searchPayments', 'updatePreapproval',
    ]);
  });

  it('cada función llama solo a rutas de la lista, con el token del gimnasio', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/oauth/token')) return reply({ access_token: 'APP_USR-x', refresh_token: 'TG-y', user_id: 99, expires_in: 100, live_mode: true });
      if (url.includes('/users/me')) return reply({ id: 99, nickname: 'GYM' });
      if (url.includes('/checkout/preferences')) return reply({ id: 'pref_1', init_point: 'https://www.mercadopago.com.ar/checkout' });
      if (url.includes('/payments/search')) return reply({ results: [{ id: 1, status: 'approved' }] });
      if (url.includes('/v1/payments/')) return reply({ id: 1, status: 'approved' });
      if (url.includes('/authorized_payments/')) return reply({ id: 5, preapproval_id: 'pre_123456', payment: { id: 1, status: 'approved' } });
      return reply({ id: 'pre_123456', status: 'authorized', init_point: 'https://www.mercadopago.com.ar/subscriptions' });
    });
    await mp.exchangeAuthorizationCode('TG-code', 'verifier');
    await mp.refreshAccessToken('TG-refresh');
    await mp.getCurrentUser('TOKEN');
    await mp.createPreference('TOKEN', { items: [] });
    await mp.getPayment('TOKEN', '123');
    await mp.searchPaymentsByReference('TOKEN', '7b7c2e3a-1111-2222-3333-444455556666');
    await mp.createPreapproval('TOKEN', { reason: 'x' });
    await mp.getPreapproval('TOKEN', 'pre_123456');
    await mp.cancelPreapproval('TOKEN', 'pre_123456');
    await mp.updatePreapprovalAmount('TOKEN', 'pre_123456', 30000);
    await mp.getAuthorizedPayment('TOKEN', '5');
    for (const [url, init] of fetchMock.mock.calls) {
      expect(ALLOWED.some(pattern => pattern.test(`${init.method} ${url}`))).toBe(true);
      if (!String(url).includes('/oauth/token')) expect(init.headers.authorization).toBe('Bearer TOKEN');
    }
    // PUT /preapproval solo cancela o cambia el monto.
    const puts = fetchMock.mock.calls.filter(([, init]) => init.method === 'PUT').map(([, init]) => JSON.parse(init.body));
    expect(puts).toEqual([{ status: 'cancelled' }, { auto_recurring: { transaction_amount: 30000, currency_id: 'ARS' } }]);
  });

  it('rechaza identificadores que no son de Mercado Pago, sin llamar a la API', async () => {
    await expect(mp.getPayment('TOKEN', '../users/me')).rejects.toMatchObject({ code: 'MP_INVALID_ID' });
    await expect(mp.getPreapproval('TOKEN', 'a/b')).rejects.toMatchObject({ code: 'MP_INVALID_ID' });
    await expect(mp.searchPaymentsByReference('TOKEN', 'x&y=1')).rejects.toMatchObject({ code: 'MP_INVALID_ID' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('ningún otro archivo del backend llama a la API de Mercado Pago', async () => {
    const root = new URL('../src/', import.meta.url);
    const files = async (dir: string): Promise<string[]> => (await Promise.all((await readdir(dir, { withFileTypes: true }))
      .map(entry => entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]))).flat();
    const offenders: string[] = [];
    let scanned = 0;
    for (const file of await files(decodeURIComponent(root.pathname).replace(/^\/([A-Za-z]:)/, '$1'))) {
      if (!file.endsWith('.ts') || file.endsWith('mercadoPago.service.ts')) continue;
      scanned += 1;
      if (/api\.mercadopago\.com|auth\.mercadopago\.com/.test(await readFile(file, 'utf8'))) offenders.push(file);
    }
    expect(scanned).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});

describe('errores', () => {
  it('un 401 se informa como MP_UNAUTHORIZED, sin incluir el token', async () => {
    fetchMock.mockResolvedValue(reply({ message: 'invalid access token' }, 401));
    const error = await mp.getPayment('SECRET_TOKEN', '1').catch(e => e);
    expect(error).toMatchObject({ code: 'MP_UNAUTHORIZED' });
    expect(String(error.message)).not.toContain('SECRET_TOKEN');
  });

  it('una renovación rechazada se informa como MP_INVALID_GRANT', async () => {
    fetchMock.mockResolvedValue(reply({ error: 'invalid_grant' }, 400));
    await expect(mp.refreshAccessToken('TG-old')).rejects.toMatchObject({ code: 'MP_INVALID_GRANT' });
  });

  it('si Mercado Pago no responde, es MP_UNAVAILABLE', async () => {
    fetchMock.mockRejectedValue(new Error('timeout'));
    await expect(mp.getPayment('TOKEN', '1')).rejects.toMatchObject({ code: 'MP_UNAVAILABLE' });
  });
});

describe('OAuth', () => {
  it('la URL de autorización lleva state, PKCE S256 y la URL de vuelta fija', () => {
    const url = new URL(mp.buildAuthorizationUrl('state-123', 'challenge-abc'));
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('state')).toBe('state-123');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-abc');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('redirect_uri')).toBe('https://api.gymhour.test/pagos/mercadopago/oauth/callback');
  });

  it('el canje del code envía el verificador PKCE y pide token de prueba solo en modo prueba', async () => {
    fetchMock.mockResolvedValue(reply({ access_token: 'TEST-x', user_id: 1, live_mode: false }));
    process.env.MP_TEST_MODE = 'true';
    await mp.exchangeAuthorizationCode('TG-code', 'verifier-xyz');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ grant_type: 'authorization_code', code: 'TG-code', code_verifier: 'verifier-xyz', test_token: true });
  });
});

describe('pagos', () => {
  it('normaliza el pago con el número de operación, el medio y el neto', () => {
    expect(mp.normalizePayment({
      id: 123456789, status: 'approved', status_detail: 'accredited', transaction_amount: 26500, currency_id: 'ARS',
      external_reference: 'ref-1', collector_id: 99, order: { id: 555 }, payment_method_id: 'visa',
      payment_type_id: 'debit_card', transaction_details: { net_received_amount: 25000.5 }, payer: { email: 'socio@x.com' },
      date_approved: '2026-11-19T10:00:00.000-03:00',
    })).toMatchObject({
      id: '123456789', status: 'approved', amount: 26500, collectorId: '99', merchantOrderId: '555',
      paymentMethod: 'Visa débito', netAmount: 25000.5, externalReference: 'ref-1',
    });
    expect(mp.paymentMethodLabel('account_money', 'account_money')).toBe('Dinero en cuenta');
  });
});

describe('firma de los avisos', () => {
  const secret = 'webhook-secret';
  const sign = (manifest: string) => crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  const now = Date.UTC(2026, 10, 19, 13, 0, 0);
  const ts = String(Math.floor(now / 1000));

  it('acepta una firma válida y rechaza una alterada', () => {
    const v1 = sign(`id:123;request-id:req-1;ts:${ts};`);
    expect(mp.verifyWebhookSignature({ signature: `ts=${ts},v1=${v1}`, requestId: 'req-1', dataId: '123', secret, now })).toBe('valid');
    expect(mp.verifyWebhookSignature({ signature: `ts=${ts},v1=${v1}`, requestId: 'req-1', dataId: '124', secret, now })).toBe('invalid');
  });

  it('pasa a minúsculas los IDs alfanuméricos, como indica Mercado Pago', () => {
    const v1 = sign(`id:abc123;request-id:req-1;ts:${ts};`);
    expect(mp.verifyWebhookSignature({ signature: `ts=${ts},v1=${v1}`, requestId: 'req-1', dataId: 'ABC123', secret, now })).toBe('valid');
  });

  it('rechaza firmas muy viejas y distingue los avisos sin firma', () => {
    const old = String(Math.floor(now / 1000) - 3 * 24 * 3600);
    const v1 = sign(`id:123;request-id:req-1;ts:${old};`);
    expect(mp.verifyWebhookSignature({ signature: `ts=${old},v1=${v1}`, requestId: 'req-1', dataId: '123', secret, now })).toBe('invalid');
    expect(mp.verifyWebhookSignature({ signature: undefined, requestId: 'req-1', dataId: '123', secret, now })).toBe('missing');
  });
});
