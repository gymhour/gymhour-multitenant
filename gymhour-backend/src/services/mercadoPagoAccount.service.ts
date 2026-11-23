import crypto from 'node:crypto';
import type { MercadoPagoAccount } from '@prisma/client';
import { systemPrisma } from '../models/Prisma.js';
import { notifyTenantAdmins } from './billingNotifications.service.js';
import { sendMercadoPagoReconnectEmail } from './email.service.js';
import {
  MercadoPagoError, buildAuthorizationUrl, exchangeAuthorizationCode, getCurrentUser,
  isMercadoPagoConfigured, isTestMode, refreshAccessToken,
} from './mercadoPago.service.js';
import { tenantPlanAccess } from './planAccess.service.js';
import { openSecret, parseEncryptionKey, sealSecret } from './secretBox.service.js';

// Conexión de cada gimnasio con su cuenta de Mercado Pago (OAuth). Ver MERCADOPAGO.md.
//
// - El `state` es aleatorio, de un solo uso, vence a los 10 minutos y queda atado al gimnasio y al
//   admin que empezó la conexión. Impide que alguien conecte SU cuenta a un gimnasio ajeno.
// - PKCE (S256): el verificador nunca sale del servidor, así que un `code` filtrado no sirve.
// - Los tokens se guardan cifrados con MP_TOKEN_ENCRYPTION_KEY y nunca salen del backend.

const STATE_TTL_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
export const TOKEN_REFRESH_WINDOW_MS = 30 * DAY_MS;

const tokenKey = () => parseEncryptionKey(process.env.MP_TOKEN_ENCRYPTION_KEY, 'MP_TOKEN_ENCRYPTION_KEY');
const sha256 = (value: string) => crypto.createHash('sha256').update(value).digest('hex');
export const lockKeyFor = (tenantId: number, userId: number) => `${tenantId}:${userId}`;

export class MercadoPagoConnectionError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export async function startConnection(tenantId: number, userId: number): Promise<string> {
  if (!isMercadoPagoConfigured()) throw new MercadoPagoError(503, 'MP_NOT_CONFIGURED');
  const state = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const now = new Date();
  // Un intento nuevo invalida los anteriores del mismo admin, y de paso se limpian los vencidos.
  await systemPrisma.mercadoPagoOAuthState.deleteMany({ where: { OR: [
    { expiresAt: { lt: now } }, { tenantId, userId, usedAt: null },
  ] } });
  await systemPrisma.mercadoPagoOAuthState.create({ data: {
    stateHash: sha256(state), tenantId, userId,
    codeVerifierEnc: sealSecret(verifier, tokenKey()),
    expiresAt: new Date(now.getTime() + STATE_TTL_MS),
  } });
  return buildAuthorizationUrl(state, challenge);
}

// Pagos en curso o débitos activos: mientras existan, no se puede desconectar ni cambiar de cuenta.
export async function activeOnlineOperations(tenantId: number) {
  const [attempts, debits] = await Promise.all([
    systemPrisma.cuotaPago.count({ where: { tenantId, lockKey: { not: null } } }),
    systemPrisma.debitoAutomatico.count({ where: { tenantId, activeKey: { not: null } } }),
  ]);
  return { attempts, debits };
}

export async function completeConnection(state: string, code: string): Promise<{ tenantId: number }> {
  const row = await systemPrisma.mercadoPagoOAuthState.findUnique({ where: { stateHash: sha256(state) } });
  if (!row || row.usedAt || row.expiresAt < new Date()) throw new MercadoPagoConnectionError('STATE_INVALID');
  // Un solo uso, también si llegan dos vueltas al mismo tiempo.
  const consumed = await systemPrisma.mercadoPagoOAuthState.updateMany({
    where: { id: row.id, usedAt: null }, data: { usedAt: new Date() },
  });
  if (!consumed.count) throw new MercadoPagoConnectionError('STATE_INVALID');

  const [admin, tenant] = await Promise.all([
    systemPrisma.user.findFirst({ where: { ID_Usuario: row.userId, tenantId: row.tenantId, role: 'ADMIN', estado: true } }),
    systemPrisma.tenant.findUnique({ where: { id: row.tenantId } }),
  ]);
  if (!admin || !tenant || tenant.status !== 'ACTIVE') throw new MercadoPagoConnectionError('STATE_INVALID');
  if (!(await tenantPlanAccess(row.tenantId)).features.MEMBER_PAYMENTS) throw new MercadoPagoConnectionError('PLAN_UPGRADE_REQUIRED');

  const tokens = await exchangeAuthorizationCode(code, openSecret(row.codeVerifierEnc, tokenKey()));
  // No se mezclan cuentas de prueba con cobros reales, ni al revés.
  if (tokens.liveMode === isTestMode()) throw new MercadoPagoConnectionError('MODE_MISMATCH');

  const existing = await systemPrisma.mercadoPagoAccount.findUnique({ where: { tenantId: row.tenantId } });
  if (existing && existing.mpUserId !== tokens.userId) {
    const active = await activeOnlineOperations(row.tenantId);
    if (active.attempts || active.debits) throw new MercadoPagoConnectionError('ACCOUNT_CHANGE_BLOCKED');
  }
  const profile = await getCurrentUser(tokens.accessToken).catch(() => null);
  const key = tokenKey();
  const data = {
    mpUserId: tokens.userId,
    nickname: profile?.nickname ?? profile?.email ?? null,
    accessTokenEnc: sealSecret(tokens.accessToken, key),
    refreshTokenEnc: tokens.refreshToken ? sealSecret(tokens.refreshToken, key) : null,
    tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
    lastRefreshAt: new Date(),
    liveMode: tokens.liveMode,
    status: 'CONNECTED',
    lastError: null,
    connectedAt: new Date(),
    connectedByUserId: row.userId,
    reconnectNotifiedAt: null,
  };
  await systemPrisma.mercadoPagoAccount.upsert({
    where: { tenantId: row.tenantId }, create: { tenantId: row.tenantId, ...data }, update: data,
  });
  return { tenantId: row.tenantId };
}

// Deja la conexión en ERROR y avisa a los admins una sola vez, hasta que reconecten.
export async function markAccountError(tenantId: number, message: string): Promise<void> {
  const account = await systemPrisma.mercadoPagoAccount.findUnique({ where: { tenantId } });
  if (!account || account.status === 'DISCONNECTED') return;
  const notify = !account.reconnectNotifiedAt;
  await systemPrisma.mercadoPagoAccount.update({ where: { tenantId }, data: {
    status: 'ERROR', lastError: message.slice(0, 255), ...(notify ? { reconnectNotifiedAt: new Date() } : {}),
  } });
  if (notify) notifyTenantAdmins(tenantId, email => sendMercadoPagoReconnectEmail(email, { reason: message }));
}

export async function refreshAccount(account: MercadoPagoAccount): Promise<MercadoPagoAccount> {
  if (!account.refreshTokenEnc) {
    await markAccountError(account.tenantId, 'La conexión con Mercado Pago venció. Volvé a conectarla.');
    throw new MercadoPagoError(409, 'MP_RECONNECT_REQUIRED');
  }
  try {
    const key = tokenKey();
    const tokens = await refreshAccessToken(openSecret(account.refreshTokenEnc, key));
    return await systemPrisma.mercadoPagoAccount.update({ where: { tenantId: account.tenantId }, data: {
      accessTokenEnc: sealSecret(tokens.accessToken, key),
      // Mercado Pago entrega un refresh token nuevo en cada renovación.
      refreshTokenEnc: tokens.refreshToken ? sealSecret(tokens.refreshToken, key) : account.refreshTokenEnc,
      tokenExpiresAt: new Date(Date.now() + tokens.expiresIn * 1000),
      lastRefreshAt: new Date(),
      status: 'CONNECTED',
      lastError: null,
    } });
  } catch (error) {
    if (error instanceof MercadoPagoError && ['MP_INVALID_GRANT', 'MP_UNAUTHORIZED', 'MP_BAD_REQUEST'].includes(error.code)) {
      await markAccountError(account.tenantId, 'Mercado Pago rechazó la renovación del acceso. Volvé a conectar la cuenta.');
      throw new MercadoPagoError(409, 'MP_RECONNECT_REQUIRED');
    }
    throw error;
  }
}

// Token vigente del gimnasio. Si venció, intenta renovarlo; si no se puede, pide reconectar.
export async function tokenFor(tenantId: number): Promise<{ account: MercadoPagoAccount; accessToken: string }> {
  let account = await systemPrisma.mercadoPagoAccount.findUnique({ where: { tenantId } });
  if (!account || account.status === 'DISCONNECTED') throw new MercadoPagoError(409, 'MP_NOT_CONNECTED');
  if (account.status === 'ERROR') throw new MercadoPagoError(409, 'MP_RECONNECT_REQUIRED');
  if (account.tokenExpiresAt && account.tokenExpiresAt.getTime() < Date.now() + 60_000) account = await refreshAccount(account);
  return { account, accessToken: openSecret(account.accessTokenEnc, tokenKey()) };
}

// Ejecuta una operación con el token del gimnasio. Si Mercado Pago lo rechaza, la conexión queda
// en ERROR y se avisa al admin.
export async function withTenantToken<T>(
  tenantId: number,
  operation: (input: { account: MercadoPagoAccount; accessToken: string }) => Promise<T>,
): Promise<T> {
  const input = await tokenFor(tenantId);
  try {
    return await operation(input);
  } catch (error) {
    if (error instanceof MercadoPagoError && error.code === 'MP_UNAUTHORIZED') {
      await markAccountError(tenantId, 'Mercado Pago rechazó el acceso de Gymhour. Volvé a conectar la cuenta.');
      throw new MercadoPagoError(409, 'MP_RECONNECT_REQUIRED');
    }
    throw error;
  }
}

export async function connectionStatus(tenantId: number) {
  const [account, active] = await Promise.all([
    systemPrisma.mercadoPagoAccount.findUnique({ where: { tenantId } }),
    activeOnlineOperations(tenantId),
  ]);
  return {
    configured: isMercadoPagoConfigured(),
    testMode: isTestMode(),
    connected: Boolean(account && account.status !== 'DISCONNECTED'),
    status: account?.status ?? 'DISCONNECTED',
    nickname: account?.nickname ?? null,
    liveMode: account?.liveMode ?? null,
    connectedAt: account?.connectedAt ?? null,
    tokenExpiresAt: account?.tokenExpiresAt ?? null,
    lastError: account?.status === 'ERROR' ? account.lastError : null,
    activeAttempts: active.attempts,
    activeDebits: active.debits,
  };
}

export async function disconnectAccount(tenantId: number): Promise<void> {
  // Se borran los tokens: Gymhour deja de poder operar la cuenta. La revocación definitiva la hace
  // el gimnasio desde su cuenta de Mercado Pago.
  await systemPrisma.mercadoPagoAccount.deleteMany({ where: { tenantId } });
  await systemPrisma.mercadoPagoOAuthState.deleteMany({ where: { tenantId } });
}

// --- Cola de avisos que llegaron sin un token utilizable ---

export async function queueNotification(tenantId: number, topic: string, resourceId: string): Promise<void> {
  await systemPrisma.mercadoPagoPendingNotification.upsert({
    where: { topic_resourceId: { topic, resourceId } },
    create: { tenantId, topic, resourceId },
    update: { processedAt: null },
  });
}
