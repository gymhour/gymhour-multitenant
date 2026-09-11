import type { PlatformRole, TenantRole, TenantStatus } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: number;
        tenantId: number;
        email: string;
        role: TenantRole;
        authVersion: number;
      };
      tenant?: { id: number; name: string; slug: string; status: TenantStatus };
      platformUser?: { id: number; email: string; role: PlatformRole; authVersion: number };
    }
  }
}
