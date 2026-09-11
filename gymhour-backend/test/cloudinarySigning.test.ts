import { afterEach, describe, expect, it } from 'vitest';
import { getImageUrl, getTenantLogoUrl } from '../src/services/cloudinary.service.js';

const previousKey = process.env.CLOUDINARY_AUTH_TOKEN_KEY;

afterEach(() => {
  if (previousKey === undefined) delete process.env.CLOUDINARY_AUTH_TOKEN_KEY;
  else process.env.CLOUDINARY_AUTH_TOKEN_KEY = previousKey;
});

describe('entrega privada de MediaAsset', () => {
  it('firma URLs tenant-owned con vencimiento de 15 minutos', () => {
    process.env.CLOUDINARY_AUTH_TOKEN_KEY = '0123456789abcdef'.repeat(4);
    const now = Math.floor(Date.now() / 1000);
    const url = new URL(getImageUrl('tenants/42/users/avatar'));
    expect(url.pathname).toContain('/authenticated/');
    const token = url.searchParams.get('__cld_token__') || '';
    const expires = Number(token.match(/exp=(\d+)/)?.[1]);
    expect(expires).toBeGreaterThanOrEqual(now + 895);
    expect(expires).toBeLessThanOrEqual(now + 905);
  });

  it('falla cerrado si falta la signing key', () => {
    delete process.env.CLOUDINARY_AUTH_TOKEN_KEY;
    expect(() => getImageUrl('tenants/42/users/avatar')).toThrow('CLOUDINARY_AUTH_TOKEN_KEY_REQUIRED');
  });

  it('mantiene legibles los assets legacy hasta terminar copy-verify', () => {
    delete process.env.CLOUDINARY_AUTH_TOKEN_KEY;
    const url = new URL(getImageUrl('users/legacy-avatar'));
    expect(url.pathname).toContain('/upload/');
    expect(url.searchParams.has('__cld_token__')).toBe(false);
  });

  it('permite mostrar el logo firmado aun sin auth-token key', () => {
    delete process.env.CLOUDINARY_AUTH_TOKEN_KEY;
    const url = new URL(getTenantLogoUrl('tenants/42/branding/logo-42'));
    expect(url.pathname).toContain('/authenticated/');
    expect(url.pathname).toContain('/s--');
    expect(url.searchParams.has('__cld_token__')).toBe(false);
  });
});
