import crypto from 'node:crypto';

// Cliente de la API de Mercado Pago para el cobro de cuotas a socios.
//
// Es el ÚNICO módulo que habla con Mercado Pago, y solo puede llamar a las operaciones de
// MERCADOPAGO_ROUTES. Mercado Pago no ofrece un permiso de "solo cobrar": el token de cada
// gimnasio tiene read y write sobre su cuenta. Por eso el límite lo pone este módulo: no hay
// devoluciones, cancelaciones de pagos ni lecturas del resto de la cuenta. Un test verifica que
// no se use ninguna otra ruta. Ver MERCADOPAGO.md, "Permisos usados".

const REQUEST_TIMEOUT_MS = 10_000;

export const MERCADOPAGO_ROUTES = {
  oauthToken: { method: 'POST', path: () => '/oauth/token' },
  currentUser: { method: 'GET', path: () => '/users/me' },
  createPreference: { method: 'POST', path: () => '/checkout/preferences' },
  getPayment: { method: 'GET', path: (id: string) => `/v1/payments/${id}` },
  searchPayments: {
    method: 'GET',
    path: (reference: string) => `/v1/payments/search?external_reference=${encodeURIComponent(reference)}&sort=date_created&criteria=desc`,
  },
  createPreapproval: { method: 'POST', path: () => '/preapproval' },
  getPreapproval: { method: 'GET', path: (id: string) => `/preapproval/${id}` },
  updatePreapproval: { method: 'PUT', path: (id: string) => `/preapproval/${id}` },
  getAuthorizedPayment: { method: 'GET', path: (id: string) => `/authorized_payments/${id}` },
} as const;

type RouteName = keyof typeof MERCADOPAGO_ROUTES;

export class MercadoPagoError extends Error {
  constructor(public readonly status: number, public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'MercadoPagoError';
  }
}

// --- Configuración ---

const env = (name: string) => (process.env[name] ?? '').trim();
export const apiPublicUrl = () => env('API_PUBLIC_URL').replace(/\/$/, '');
export const frontendUrl = () => env('FRONTEND_URL').replace(/\/$/, '');
export const isTestMode = () => env('MP_TEST_MODE') === 'true';
const apiBase = () => (env('MP_API_BASE_URL') || 'https://api.mercadopago.com').replace(/\/$/, '');
const authBase = () => (env('MP_AUTH_BASE_URL') || 'https://auth.mercadopago.com').replace(/\/$/, '');
export const oauthRedirectUri = () => `${apiPublicUrl()}/pagos/mercadopago/oauth/callback`;

export function isMercadoPagoConfigured(): boolean {
  return Boolean(env('MP_CLIENT_ID') && env('MP_CLIENT_SECRET') && env('MP_TOKEN_ENCRYPTION_KEY') && apiPublicUrl());
}

// --- Validación de identificadores (nunca se arma una URL con datos sin validar) ---

const PAYMENT_ID = /^\d{1,20}$/;
const PREAPPROVAL_ID = /^[\w-]{6,64}$/;
const REFERENCE = /^[\w-]{8,64}$/;
const assertId = (value: string, pattern: RegExp) => {
  if (!pattern.test(value)) throw new MercadoPagoError(400, 'MP_INVALID_ID');
  return value;
};

// --- Pedido genérico, limitado a las rutas permitidas ---

async function mpRequest(route: RouteName, options: { token?: string; param?: string; body?: unknown } = {}): Promise<any> {
  const definition = MERCADOPAGO_ROUTES[route];
  const path = (definition.path as (param: string) => string)(options.param ?? '');
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method: definition.method,
      headers: {
        accept: 'application/json',
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
        ...(options.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new MercadoPagoError(503, 'MP_UNAVAILABLE');
  }
  const text = await response.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (response.ok) return data;
  // Nunca se incluyen tokens ni el cuerpo completo en el error.
  const detail = typeof data?.message === 'string' ? data.message.slice(0, 200) : undefined;
  if (response.status === 401 || response.status === 403) throw new MercadoPagoError(response.status, 'MP_UNAUTHORIZED', detail);
  if (response.status === 404) throw new MercadoPagoError(404, 'MP_NOT_FOUND', detail);
  if (response.status >= 500) throw new MercadoPagoError(503, 'MP_UNAVAILABLE', detail);
  throw new MercadoPagoError(400, data?.error === 'invalid_grant' ? 'MP_INVALID_GRANT' : 'MP_BAD_REQUEST', detail);
}

// --- OAuth ---

export type MercadoPagoTokens = {
  accessToken: string;
  refreshToken: string | null;
  userId: string;
  expiresIn: number;
  liveMode: boolean;
  scope: string;
};

export function buildAuthorizationUrl(state: string, codeChallenge: string): string {
  const url = new URL(`${authBase()}/authorization`);
  url.searchParams.set('client_id', env('MP_CLIENT_ID'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('platform_id', 'mp');
  url.searchParams.set('state', state);
  url.searchParams.set('redirect_uri', oauthRedirectUri());
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

const parseTokens = (data: any): MercadoPagoTokens => {
  if (typeof data?.access_token !== 'string' || !data.access_token || data.user_id === undefined) {
    throw new MercadoPagoError(502, 'MP_BAD_TOKEN_RESPONSE');
  }
  return {
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' && data.refresh_token ? data.refresh_token : null,
    userId: String(data.user_id),
    expiresIn: Number(data.expires_in) > 0 ? Number(data.expires_in) : 15_552_000,
    liveMode: data.live_mode === true,
    scope: String(data.scope ?? ''),
  };
};

export async function exchangeAuthorizationCode(code: string, codeVerifier: string): Promise<MercadoPagoTokens> {
  if (!/^[\w.~-]{1,512}$/.test(code)) throw new MercadoPagoError(400, 'MP_INVALID_ID');
  return parseTokens(await mpRequest('oauthToken', { body: {
    client_id: env('MP_CLIENT_ID'),
    client_secret: env('MP_CLIENT_SECRET'),
    grant_type: 'authorization_code',
    code,
    redirect_uri: oauthRedirectUri(),
    code_verifier: codeVerifier,
    ...(isTestMode() ? { test_token: true } : {}),
  } }));
}

export async function refreshAccessToken(refreshToken: string): Promise<MercadoPagoTokens> {
  return parseTokens(await mpRequest('oauthToken', { body: {
    client_id: env('MP_CLIENT_ID'),
    client_secret: env('MP_CLIENT_SECRET'),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  } }));
}

export async function getCurrentUser(token: string): Promise<{ id: string; nickname: string | null; email: string | null }> {
  const data = await mpRequest('currentUser', { token });
  return {
    id: String(data?.id ?? ''),
    nickname: typeof data?.nickname === 'string' ? data.nickname.slice(0, 191) : null,
    email: typeof data?.email === 'string' ? data.email.slice(0, 191) : null,
  };
}

// --- Checkout Pro ---

export async function createPreference(token: string, body: Record<string, unknown>): Promise<{ id: string; initPoint: string }> {
  const data = await mpRequest('createPreference', { token, body });
  const initPoint = isTestMode() ? (data?.sandbox_init_point || data?.init_point) : data?.init_point;
  if (typeof data?.id !== 'string' || typeof initPoint !== 'string' || !initPoint.startsWith('https://')) {
    throw new MercadoPagoError(502, 'MP_BAD_PREFERENCE');
  }
  return { id: data.id, initPoint };
}

// --- Pagos ---

export type MercadoPagoPayment = {
  id: string;
  status: string;
  statusDetail: string | null;
  amount: number;
  refundedAmount: number;
  currency: string;
  externalReference: string | null;
  collectorId: string | null;
  merchantOrderId: string | null;
  paymentMethod: string | null;
  netAmount: number | null;
  payerEmail: string | null;
  dateApproved: Date | null;
  dateCreated: Date | null;
};

const PAYMENT_TYPES: Record<string, string> = {
  credit_card: 'crédito', debit_card: 'débito', prepaid_card: 'prepaga',
};

// "Visa débito", "Dinero en cuenta", etc. Es lo que ve el admin en la cuota.
export function paymentMethodLabel(methodId: unknown, typeId: unknown): string | null {
  const method = String(methodId ?? '').trim();
  const type = String(typeId ?? '').trim();
  if (type === 'account_money' || method === 'account_money') return 'Dinero en cuenta';
  if (!method) return null;
  const brand = method.charAt(0).toUpperCase() + method.slice(1).replace(/_/g, ' ');
  return `${brand}${PAYMENT_TYPES[type] ? ` ${PAYMENT_TYPES[type]}` : ''}`.slice(0, 80);
}

const toDate = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export function normalizePayment(data: any): MercadoPagoPayment {
  if (data?.id === undefined || data?.id === null) throw new MercadoPagoError(502, 'MP_BAD_PAYMENT');
  return {
    id: String(data.id),
    status: String(data.status ?? ''),
    statusDetail: typeof data.status_detail === 'string' ? data.status_detail.slice(0, 80) : null,
    amount: Number(data.transaction_amount ?? 0),
    refundedAmount: Number(data.transaction_amount_refunded ?? 0),
    currency: String(data.currency_id ?? ''),
    externalReference: typeof data.external_reference === 'string' && data.external_reference ? data.external_reference : null,
    collectorId: data.collector_id !== undefined && data.collector_id !== null ? String(data.collector_id) : null,
    merchantOrderId: data.order?.id !== undefined && data.order?.id !== null ? String(data.order.id) : null,
    paymentMethod: paymentMethodLabel(data.payment_method_id, data.payment_type_id),
    netAmount: data.transaction_details?.net_received_amount !== undefined
      ? Number(data.transaction_details.net_received_amount) : null,
    payerEmail: typeof data.payer?.email === 'string' ? data.payer.email.slice(0, 191) : null,
    dateApproved: toDate(data.date_approved),
    dateCreated: toDate(data.date_created),
  };
}

export async function getPayment(token: string, paymentId: string): Promise<MercadoPagoPayment> {
  return normalizePayment(await mpRequest('getPayment', { token, param: assertId(paymentId, PAYMENT_ID) }));
}

// Solo se busca por referencias que creó Gymhour.
export async function searchPaymentsByReference(token: string, reference: string): Promise<MercadoPagoPayment[]> {
  const data = await mpRequest('searchPayments', { token, param: assertId(reference, REFERENCE) });
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.map(normalizePayment);
}

// --- Suscripciones (débito automático) ---

export type MercadoPagoPreapproval = {
  id: string;
  status: string;
  externalReference: string | null;
  collectorId: string | null;
  amount: number;
  currency: string;
  frequency: number;
  frequencyType: string;
  nextPaymentDate: Date | null;
  initPoint: string | null;
};

export function normalizePreapproval(data: any): MercadoPagoPreapproval {
  if (typeof data?.id !== 'string' || !data.id) throw new MercadoPagoError(502, 'MP_BAD_PREAPPROVAL');
  return {
    id: data.id,
    status: String(data.status ?? ''),
    externalReference: typeof data.external_reference === 'string' && data.external_reference ? data.external_reference : null,
    collectorId: data.collector_id !== undefined && data.collector_id !== null ? String(data.collector_id) : null,
    amount: Number(data.auto_recurring?.transaction_amount ?? 0),
    currency: String(data.auto_recurring?.currency_id ?? ''),
    frequency: Number(data.auto_recurring?.frequency ?? 0),
    frequencyType: String(data.auto_recurring?.frequency_type ?? ''),
    nextPaymentDate: toDate(data.next_payment_date),
    initPoint: typeof data.init_point === 'string' && data.init_point.startsWith('https://') ? data.init_point : null,
  };
}

export async function createPreapproval(token: string, body: Record<string, unknown>): Promise<MercadoPagoPreapproval> {
  return normalizePreapproval(await mpRequest('createPreapproval', { token, body }));
}

export async function getPreapproval(token: string, preapprovalId: string): Promise<MercadoPagoPreapproval> {
  return normalizePreapproval(await mpRequest('getPreapproval', { token, param: assertId(preapprovalId, PREAPPROVAL_ID) }));
}

// PUT /preapproval solo se usa para estos dos cambios.
export async function cancelPreapproval(token: string, preapprovalId: string): Promise<MercadoPagoPreapproval> {
  return normalizePreapproval(await mpRequest('updatePreapproval', {
    token, param: assertId(preapprovalId, PREAPPROVAL_ID), body: { status: 'cancelled' },
  }));
}

export async function updatePreapprovalAmount(token: string, preapprovalId: string, amount: number): Promise<MercadoPagoPreapproval> {
  if (!(amount > 0)) throw new MercadoPagoError(400, 'MP_INVALID_AMOUNT');
  return normalizePreapproval(await mpRequest('updatePreapproval', {
    token, param: assertId(preapprovalId, PREAPPROVAL_ID),
    body: { auto_recurring: { transaction_amount: amount, currency_id: 'ARS' } },
  }));
}

export type MercadoPagoAuthorizedPayment = {
  id: string;
  preapprovalId: string | null;
  status: string;
  amount: number;
  debitDate: Date | null;
  paymentId: string | null;
  paymentStatus: string | null;
};

export async function getAuthorizedPayment(token: string, authorizedPaymentId: string): Promise<MercadoPagoAuthorizedPayment> {
  const data = await mpRequest('getAuthorizedPayment', { token, param: assertId(authorizedPaymentId, PAYMENT_ID) });
  if (data?.id === undefined || data?.id === null) throw new MercadoPagoError(502, 'MP_BAD_AUTHORIZED_PAYMENT');
  return {
    id: String(data.id),
    preapprovalId: typeof data.preapproval_id === 'string' ? data.preapproval_id : null,
    status: String(data.status ?? ''),
    amount: Number(data.transaction_amount ?? 0),
    debitDate: toDate(data.debit_date),
    paymentId: data.payment?.id !== undefined && data.payment?.id !== null ? String(data.payment.id) : null,
    paymentStatus: typeof data.payment?.status === 'string' ? data.payment.status : null,
  };
}

// --- Firma de los avisos (webhooks) ---

// Mercado Pago firma cada aviso con el secreto de la aplicación: header x-signature "ts=...,v1=..."
// sobre el texto "id:<data.id>;request-id:<x-request-id>;ts:<ts>;". El data.id es el de la URL;
// si no viene, como en los avisos con formato IPN, esa parte se omite. Igual, Gymhour nunca confía
// en el cuerpo: siempre vuelve a consultar el recurso en la API con el token del gimnasio.
const SIGNATURE_TOLERANCE_MS = 24 * 60 * 60 * 1000;

export function verifyWebhookSignature(input: {
  signature: unknown; requestId: unknown; dataId: string | null; secret: string; now?: number;
}): 'valid' | 'invalid' | 'missing' {
  if (typeof input.signature !== 'string' || !input.signature || !input.secret) return 'missing';
  const parts = Object.fromEntries(input.signature.split(',').map(part => {
    const [key, ...value] = part.trim().split('=');
    return [key, value.join('=')];
  }));
  const ts = parts.ts;
  const v1 = parts.v1;
  if (!ts || !v1 || !/^[a-f0-9]{64}$/i.test(v1)) return 'invalid';
  const tsMs = Number(ts) > 1e12 ? Number(ts) : Number(ts) * 1000;
  if (!Number.isFinite(tsMs) || Math.abs((input.now ?? Date.now()) - tsMs) > SIGNATURE_TOLERANCE_MS) return 'invalid';
  const dataId = input.dataId && /^[a-z0-9]+$/i.test(input.dataId) ? input.dataId.toLowerCase() : input.dataId;
  const manifest = [
    dataId ? `id:${dataId};` : '',
    typeof input.requestId === 'string' && input.requestId ? `request-id:${input.requestId};` : '',
    `ts:${ts};`,
  ].join('');
  const expected = crypto.createHmac('sha256', input.secret).update(manifest).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(v1.toLowerCase(), 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? 'valid' : 'invalid';
}
