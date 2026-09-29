import { describe, expect, it } from 'vitest';
import { isForbiddenSelfRoleChange } from '../src/services/userRole.service.js';

describe('política de cambio de rol', () => {
  it.each(['TRAINER', 'STUDENT'] as const)(
    'impide que un administrador cambie su propio rol a %s',
    requestedRole => {
      expect(isForbiddenSelfRoleChange(7, 'ADMIN', 7, requestedRole)).toBe(true);
    },
  );

  it('permite conservar el rol durante la autoedición', () => {
    expect(isForbiddenSelfRoleChange(7, 'ADMIN', 7, 'ADMIN')).toBe(false);
  });

  it('permite administrar el rol de otro usuario', () => {
    expect(isForbiddenSelfRoleChange(7, 'ADMIN', 12, 'TRAINER')).toBe(false);
  });
});
