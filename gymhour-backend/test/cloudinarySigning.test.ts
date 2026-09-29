import { describe, expect, it } from 'vitest';
import { getImageUrl, getTenantLogoUrl } from '../src/services/cloudinary.service.js';

describe('entrega privada de MediaAsset', () => {
  it('firma URLs tenant-owned sin requerir delivery auth tokens', () => {
    const url = new URL(getImageUrl('tenants/42/users/avatar'));
    expect(url.pathname).toContain('/authenticated/');
    expect(url.pathname).toContain('/s--');
    expect(url.searchParams.has('__cld_token__')).toBe(false);
  });

  it('mantiene legibles los assets legacy hasta terminar copy-verify', () => {
    const url = new URL(getImageUrl('users/legacy-avatar'));
    expect(url.pathname).toContain('/upload/');
    expect(url.pathname).not.toContain('/s--');
    expect(url.searchParams.has('__cld_token__')).toBe(false);
  });

  it('permite mostrar el logo con una URL firmada', () => {
    const url = new URL(getTenantLogoUrl('tenants/42/branding/logo-42'));
    expect(url.pathname).toContain('/authenticated/');
    expect(url.pathname).toContain('/s--');
    expect(url.searchParams.has('__cld_token__')).toBe(false);
  });
});
