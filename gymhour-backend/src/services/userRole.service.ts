import type { TenantRole } from '@prisma/client';

export const isForbiddenSelfRoleChange = (
  requesterId: number,
  requesterRole: TenantRole,
  targetUserId: number,
  requestedRole: TenantRole,
): boolean => requesterId === targetUserId && requesterRole !== requestedRole;
