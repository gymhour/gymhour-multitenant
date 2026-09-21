import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import argon2 from 'argon2';
import { verify as verifyTotpToken } from 'otplib';
import { systemPrisma } from '../models/Prisma.js';

const SESSION_COOKIE = 'gh_platform_session';
const CHALLENGE_COOKIE = 'gh_platform_challenge';
const SESSION_IDLE_MS = 15 * 60 * 1000;
const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
const CHALLENGE_MS = 5 * 60 * 1000;

const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');
const randomToken = (): string => crypto.randomBytes(32).toString('base64url');

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/platform',
  maxAge,
});

const readCookie = (req: Request, name: string): string | null => {
  const raw = String(req.headers.cookie ?? '');
  for (const part of raw.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return null;
};

const encryptionKey = (): Buffer => {
  const raw = process.env.PLATFORM_MFA_ENCRYPTION_KEY ?? '';
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('PLATFORM_MFA_ENCRYPTION_KEY debe contener exactamente 32 bytes.');
  return key;
};

export const encryptMfaSecret = (secret: string): string => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString('base64url')).join('.');
};

export const decryptMfaSecret = (payload: string): string => {
  const [ivRaw, tagRaw, encryptedRaw] = payload.split('.');
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error('MFA_SECRET_INVALID');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivRaw, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, 'base64url')), decipher.final()]).toString('utf8');
};

export const validatePlatformPassword = (password: string): boolean => (
  password.length >= 16 && password.length <= 128
);

export const hashPlatformPassword = (password: string): Promise<string> => {
  if (!validatePlatformPassword(password)) throw new Error('PLATFORM_PASSWORD_POLICY');
  return argon2.hash(password, { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
};

export const verifyPlatformPassword = async (hash: string, password: string): Promise<boolean> => {
  try { return await argon2.verify(hash, password); } catch { return false; }
};

export const generateRecoveryCodes = (): string[] => Array.from({ length: 10 }, () => {
  const value = crypto.randomBytes(8).toString('hex').toUpperCase();
  return `${value.slice(0, 4)}-${value.slice(4, 8)}-${value.slice(8, 12)}-${value.slice(12)}`;
});

export const recoveryCodeHash = (code: string): string => sha256(code.trim().toUpperCase());

export const requestIdentity = (req: Request) => ({
  ipAddress: String(req.ip || req.socket.remoteAddress || '').slice(0, 64) || null,
  userAgent: String(req.headers['user-agent'] ?? '').slice(0, 500) || null,
});

export const auditPlatform = async (req: Request, data: {
  action: string;
  outcome: 'SUCCESS' | 'FAILURE';
  targetTenantId?: number | null;
  targetTenantSlug?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> => {
  const identity = requestIdentity(req);
  await systemPrisma.platformAuditLog.create({ data: {
    platformUserId: req.platformUser?.id ?? null,
    platformUserEmail: req.platformUser?.email ?? null,
    action: data.action,
    outcome: data.outcome,
    targetTenantId: data.targetTenantId ?? null,
    targetTenantSlug: data.targetTenantSlug ?? null,
    reason: data.reason?.slice(0, 500) ?? null,
    ...identity,
    metadata: data.metadata as any,
  } });
};

export const createLoginChallenge = async (res: Response, platformUserId: number): Promise<void> => {
  const token = randomToken();
  await systemPrisma.platformAuthChallenge.deleteMany({ where: { platformUserId } });
  await systemPrisma.platformAuthChallenge.create({ data: {
    platformUserId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + CHALLENGE_MS),
  } });
  res.cookie(CHALLENGE_COOKIE, token, cookieOptions(CHALLENGE_MS));
};

export const consumeLoginChallenge = async (req: Request): Promise<{
  challenge: { id: number; attempts: number };
  user: Awaited<ReturnType<typeof systemPrisma.platformUser.findUniqueOrThrow>>;
} | null> => {
  const token = readCookie(req, CHALLENGE_COOKIE);
  if (!token) return null;
  const challenge = await systemPrisma.platformAuthChallenge.findUnique({
    where: { tokenHash: sha256(token) }, include: { user: true },
  });
  if (!challenge || challenge.expiresAt <= new Date() || challenge.attempts >= 5 || !challenge.user.active) return null;
  return { challenge: { id: challenge.id, attempts: challenge.attempts }, user: challenge.user };
};

export const verifyAndConsumeMfa = async (user: {
  id: number; mfaSecretEncrypted: string | null; mfaLastUsedStep: bigint | null;
}, token: string): Promise<boolean> => {
  const normalized = token.trim().toUpperCase();
  if (/^\d{6}$/.test(normalized) && user.mfaSecretEncrypted) {
    const result = await verifyTotpToken({
      secret: decryptMfaSecret(user.mfaSecretEncrypted), token: normalized,
      epochTolerance: 30,
      ...(user.mfaLastUsedStep !== null ? { afterTimeStep: Number(user.mfaLastUsedStep) } : {}),
    });
    if (!result.valid) return false;
    const timeStep = 'timeStep' in result ? result.timeStep : Math.floor(Date.now() / 30000);
    const updated = await systemPrisma.platformUser.updateMany({
      where: { id: user.id, OR: [{ mfaLastUsedStep: null }, { mfaLastUsedStep: { lt: BigInt(timeStep) } }] },
      data: { mfaLastUsedStep: BigInt(timeStep) },
    });
    return updated.count === 1;
  }

  const recovery = await systemPrisma.platformRecoveryCode.findUnique({ where: { codeHash: recoveryCodeHash(normalized) } });
  if (!recovery || recovery.platformUserId !== user.id || recovery.usedAt) return false;
  const used = await systemPrisma.platformRecoveryCode.updateMany({
    where: { id: recovery.id, usedAt: null }, data: { usedAt: new Date() },
  });
  return used.count === 1;
};

export const createPlatformSession = async (req: Request, res: Response, user: { id: number; authVersion: number }) => {
  const token = randomToken();
  const csrfToken = randomToken();
  const identity = requestIdentity(req);
  await systemPrisma.platformSession.create({ data: {
    platformUserId: user.id,
    authVersion: user.authVersion,
    tokenHash: sha256(token),
    csrfHash: sha256(csrfToken),
    expiresAt: new Date(Date.now() + SESSION_ABSOLUTE_MS),
    ...identity,
  } });
  res.clearCookie(CHALLENGE_COOKIE, { path: '/platform' });
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_ABSOLUTE_MS));
  return csrfToken;
};

export async function authenticatePlatformSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = readCookie(req, SESSION_COOKIE);
  if (!token) { res.status(401).json({ message: 'No autorizado.' }); return; }
  const session = await systemPrisma.platformSession.findUnique({
    where: { tokenHash: sha256(token) }, include: { user: true },
  });
  const now = Date.now();
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now
    || session.lastSeenAt.getTime() + SESSION_IDLE_MS <= now || !session.user.active
    || session.user.role !== 'SUPER_ADMIN' || session.authVersion !== session.user.authVersion) {
    res.clearCookie(SESSION_COOKIE, { path: '/platform' });
    res.status(401).json({ message: 'La sesión venció. Iniciá sesión nuevamente.' });
    return;
  }
  req.platformUser = session.user;
  req.platformSession = { id: session.id, csrfHash: session.csrfHash };
  if (session.lastSeenAt.getTime() + 5 * 60 * 1000 < now) {
    void systemPrisma.platformSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  next();
}

export function requirePlatformCsrf(req: Request, res: Response, next: NextFunction): void {
  const token = String(req.headers['x-csrf-token'] ?? '');
  const expected = req.platformSession?.csrfHash ?? '';
  if (!token || !expected || !crypto.timingSafeEqual(Buffer.from(sha256(token)), Buffer.from(expected))) {
    res.status(403).json({ message: 'La validación de seguridad venció. Actualizá la página.' });
    return;
  }
  next();
}

export const platformCsrfToken = async (req: Request): Promise<string> => {
  if (!req.platformSession) throw new Error('PLATFORM_SESSION_REQUIRED');
  const token = randomToken();
  await systemPrisma.platformSession.update({ where: { id: req.platformSession.id }, data: { csrfHash: sha256(token) } });
  req.platformSession.csrfHash = sha256(token);
  return token;
};

export const destroyPlatformSession = async (req: Request, res: Response): Promise<void> => {
  if (req.platformSession) {
    await systemPrisma.platformSession.updateMany({ where: { id: req.platformSession.id }, data: { revokedAt: new Date() } });
  }
  res.clearCookie(SESSION_COOKIE, { path: '/platform' });
};

export const cleanupExpiredPlatformAuth = async (): Promise<{ sessions: number; challenges: number }> => {
  const now = new Date();
  const revokedBefore = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const [sessions, challenges] = await systemPrisma.$transaction([
    systemPrisma.platformSession.deleteMany({ where: {
      OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: revokedBefore } }],
    } }),
    systemPrisma.platformAuthChallenge.deleteMany({ where: { expiresAt: { lt: now } } }),
  ]);
  return { sessions: sessions.count, challenges: challenges.count };
};
