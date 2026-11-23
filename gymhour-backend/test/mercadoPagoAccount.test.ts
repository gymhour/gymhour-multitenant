import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakePrisma, sharedFakePrisma as db } from './helpers/fakePrisma.js';

vi.mock('../src/models/Prisma.js', async () => {
  const { sharedFakePrisma } = await import('./helpers/fakePrisma.js');
  return { systemPrisma: sharedFakePrisma, default: sharedFakePrisma };
});
const mp = vi.hoisted(() => ({ exchangeAuthorizationCode: vi.fn(), refreshAccessToken: vi.fn(), getCurrentUser: vi.fn() }));
vi.mock('../src/services/mercadoPago.service.js', async importOriginal => ({ ...(await importOriginal<any>()), ...mp }));
const access = vi.hoisted(() => ({ tenantPlanAccess: vi.fn() }));
vi.mock('../src/services/planAccess.service.js', () => access);
const notify = vi.hoisted(() => ({ notifyTenantAdmins: vi.fn() }));
vi.mock('../src/services/billingNotifications.service.js', () => notify);
vi.mock('../src/services/email.service.js', () => ({ sendMercadoPagoReconnectEmail: vi.fn() }));

import { MercadoPagoError } from '../src/services/mercadoPago.service.js';
import {
  completeConnection, connectionStatus, startConnection, tokenFor, withTenantToken,
} from '../src/services/mercadoPagoAccount.service.js';
import { openSecret, parseEncryptionKey } from '../src/services/secretBox.service.js';

const KEY_HEX = 'a'.repeat(64);
const key = () => parseEncryptionKey(KEY_HEX, 'MP_TOKEN_ENCRYPTION_KEY');
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');

const begin = async () => {
  const url = new URL(await startConnection(7, 1));
  return { url, state: url.searchParams.get('state')! };
};

beforeEach(async () => {
  vi.clearAllMocks();
  resetFakePrisma();
  Object.assign(process.env, {
    MP_CLIENT_ID: 'client', MP_CLIENT_SECRET: 'secret', MP_TOKEN_ENCRYPTION_KEY: KEY_HEX,
    API_PUBLIC_URL: 'https://api.gymhour.test', MP_TEST_MODE: 'false',
  });
  access.tenantPlanAccess.mockResolvedValue({ features: { MEMBER_PAYMENTS: true } });
  mp.exchangeAuthorizationCode.mockResolvedValue({
    accessToken: 'APP_USR-access', refreshToken: 'TG-refresh', userId: '99', expiresIn: 15_552_000, liveMode: true, scope: 'read write offline_access',
  });
  mp.getCurrentUser.mockResolvedValue({ id: '99', nickname: 'GIMNASIO', email: null });
  await db.tenant.create({ data: { id: 7, name: 'Gym', slug: 'gym', status: 'ACTIVE' } });
  await db.user.create({ data: { ID_Usuario: 1, tenantId: 7, role: 'ADMIN', estado: true, email: 'admin@gym.test' } });
});

describe('inicio de la conexión', () => {
  it('guarda el state solo como hash y el verificador PKCE cifrado, y la URL lleva el challenge S256', async () => {
    const { url, state } = await begin();
    const [row] = db.mercadoPagoOAuthState.rows;
    expect(row.stateHash).toBe(sha256(state));
    expect(JSON.stringify(row)).not.toContain(state);
    const verifier = openSecret(row.codeVerifierEnc, key());
    expect(url.searchParams.get('code_challenge')).toBe(crypto.createHash('sha256').update(verifier).digest('base64url'));
    expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(10 * 60 * 1000);
  });

  it('sin la configuración de Mercado Pago no arranca', async () => {
    delete process.env.MP_CLIENT_SECRET;
    await expect(startConnection(7, 1)).rejects.toMatchObject({ code: 'MP_NOT_CONFIGURED' });
  });
});

describe('vuelta de Mercado Pago (callback)', () => {
  it('guarda los tokens cifrados y canjea el code con el verificador', async () => {
    const { state } = await begin();
    const verifier = openSecret(db.mercadoPagoOAuthState.rows[0].codeVerifierEnc, key());
    await expect(completeConnection(state, 'TG-code')).resolves.toEqual({ tenantId: 7 });
    expect(mp.exchangeAuthorizationCode).toHaveBeenCalledWith('TG-code', verifier);
    const [account] = db.mercadoPagoAccount.rows;
    expect(account).toMatchObject({ tenantId: 7, mpUserId: '99', status: 'CONNECTED', nickname: 'GIMNASIO', liveMode: true });
    expect(account.accessTokenEnc).not.toContain('APP_USR-access');
    expect(openSecret(account.accessTokenEnc, key())).toBe('APP_USR-access');
    expect(openSecret(account.refreshTokenEnc, key())).toBe('TG-refresh');
  });

  it('el state se usa una sola vez y vence', async () => {
    const { state } = await begin();
    await completeConnection(state, 'TG-code');
    await expect(completeConnection(state, 'TG-code')).rejects.toMatchObject({ code: 'STATE_INVALID' });
    const second = await begin();
    db.mercadoPagoOAuthState.rows.find((row: any) => row.stateHash === sha256(second.state)).expiresAt = new Date(Date.now() - 1);
    await expect(completeConnection(second.state, 'TG-code')).rejects.toMatchObject({ code: 'STATE_INVALID' });
    await expect(completeConnection('inventado', 'TG-code')).rejects.toMatchObject({ code: 'STATE_INVALID' });
  });

  it('si el admin ya no es admin, o el gimnasio perdió el plan, no conecta', async () => {
    const { state } = await begin();
    db.user.rows[0].role = 'STUDENT';
    await expect(completeConnection(state, 'TG-code')).rejects.toMatchObject({ code: 'STATE_INVALID' });
    db.user.rows[0].role = 'ADMIN';
    access.tenantPlanAccess.mockResolvedValue({ features: { MEMBER_PAYMENTS: false } });
    const second = await begin();
    await expect(completeConnection(second.state, 'TG-code')).rejects.toMatchObject({ code: 'PLAN_UPGRADE_REQUIRED' });
    expect(db.mercadoPagoAccount.rows).toHaveLength(0);
  });

  it('no mezcla cuentas de prueba con cobros reales', async () => {
    mp.exchangeAuthorizationCode.mockResolvedValue({ accessToken: 'TEST-x', refreshToken: null, userId: '99', expiresIn: 100, liveMode: false, scope: '' });
    const { state } = await begin();
    await expect(completeConnection(state, 'TG-code')).rejects.toMatchObject({ code: 'MODE_MISMATCH' });
  });

  it('no deja cambiar a otra cuenta de Mercado Pago con pagos en curso o débitos activos', async () => {
    await completeConnection((await begin()).state, 'TG-code');
    await db.debitoAutomatico.create({ data: { tenantId: 7, ID_Usuario: 5, activeKey: '7:5', status: 'ACTIVO', externalReference: 'ref-deb-1' } });
    mp.exchangeAuthorizationCode.mockResolvedValue({ accessToken: 'APP_USR-otra', refreshToken: 'TG-2', userId: '555', expiresIn: 100, liveMode: true, scope: '' });
    await expect(completeConnection((await begin()).state, 'TG-code')).rejects.toMatchObject({ code: 'ACCOUNT_CHANGE_BLOCKED' });
    // Reconectar la misma cuenta sí se puede.
    mp.exchangeAuthorizationCode.mockResolvedValue({ accessToken: 'APP_USR-nuevo', refreshToken: 'TG-3', userId: '99', expiresIn: 100, liveMode: true, scope: '' });
    await expect(completeConnection((await begin()).state, 'TG-code')).resolves.toEqual({ tenantId: 7 });
  });
});

describe('token y renovación', () => {
  beforeEach(async () => { await completeConnection((await begin()).state, 'TG-code'); });

  it('si el token vence, lo renueva y guarda el refresh token nuevo', async () => {
    db.mercadoPagoAccount.rows[0].tokenExpiresAt = new Date(Date.now() - 1000);
    mp.refreshAccessToken.mockResolvedValue({ accessToken: 'APP_USR-renovado', refreshToken: 'TG-nuevo', userId: '99', expiresIn: 100, liveMode: true, scope: '' });
    const { accessToken } = await tokenFor(7);
    expect(mp.refreshAccessToken).toHaveBeenCalledWith('TG-refresh');
    expect(accessToken).toBe('APP_USR-renovado');
    expect(openSecret(db.mercadoPagoAccount.rows[0].refreshTokenEnc, key())).toBe('TG-nuevo');
  });

  it('si Mercado Pago rechaza la renovación, pide reconectar y avisa al admin una sola vez', async () => {
    db.mercadoPagoAccount.rows[0].tokenExpiresAt = new Date(Date.now() - 1000);
    mp.refreshAccessToken.mockRejectedValue(new MercadoPagoError(400, 'MP_INVALID_GRANT'));
    await expect(tokenFor(7)).rejects.toMatchObject({ code: 'MP_RECONNECT_REQUIRED' });
    expect(db.mercadoPagoAccount.rows[0].status).toBe('ERROR');
    await expect(tokenFor(7)).rejects.toMatchObject({ code: 'MP_RECONNECT_REQUIRED' });
    expect(notify.notifyTenantAdmins).toHaveBeenCalledTimes(1);
    expect(await connectionStatus(7)).toMatchObject({ connected: true, status: 'ERROR', lastError: expect.any(String) });
  });

  it('si Mercado Pago responde 401 durante una operación, la conexión queda en ERROR', async () => {
    await expect(withTenantToken(7, async () => { throw new MercadoPagoError(401, 'MP_UNAUTHORIZED'); }))
      .rejects.toMatchObject({ code: 'MP_RECONNECT_REQUIRED' });
    expect(db.mercadoPagoAccount.rows[0].status).toBe('ERROR');
  });

  it('sin conexión, no hay token', async () => {
    await expect(tokenFor(8)).rejects.toMatchObject({ code: 'MP_NOT_CONNECTED' });
  });
});
