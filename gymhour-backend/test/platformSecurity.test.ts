import { beforeAll, describe, expect, it } from 'vitest';
import {
  decryptMfaSecret, encryptMfaSecret, generateRecoveryCodes,
  hashPlatformPassword, recoveryCodeHash, validatePlatformPassword, verifyPlatformPassword,
} from '../src/services/platformSecurity.service.js';

describe('seguridad de plataforma', () => {
  beforeAll(() => {
    process.env.PLATFORM_MFA_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
  });

  it('cifra el secreto MFA con nonce aleatorio y lo recupera', () => {
    const first = encryptMfaSecret('SECRET-TOTP');
    const second = encryptMfaSecret('SECRET-TOTP');
    expect(first).not.toBe(second);
    expect(decryptMfaSecret(first)).toBe('SECRET-TOTP');
    expect(() => decryptMfaSecret(`${first.slice(0, -2)}AA`)).toThrow();
  });

  it('aplica la política y verifica hashes Argon2id', async () => {
    expect(validatePlatformPassword('corta')).toBe(false);
    const password = 'Una-clave-larga-y-unica-2026!';
    const hash = await hashPlatformPassword(password);
    expect(hash).toContain('argon2id');
    await expect(verifyPlatformPassword(hash, password)).resolves.toBe(true);
    await expect(verifyPlatformPassword(hash, 'incorrecta')).resolves.toBe(false);
  });

  it('genera códigos de recuperación únicos y hashes normalizados', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(recoveryCodeHash(codes[0].toLowerCase())).toBe(recoveryCodeHash(codes[0]));
  });
});
