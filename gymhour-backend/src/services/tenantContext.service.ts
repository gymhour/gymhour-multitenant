import { AsyncLocalStorage } from "node:async_hooks";
import type { TenantRole, TenantStatus } from "@prisma/client";
import type { TenantPrismaClient } from "../models/Prisma.js";

export interface AuthenticatedUser {
  id: number;
  tenantId: number;
  email: string;
  role: TenantRole;
  authVersion: number;
}

export interface AuthenticatedTenant {
  id: number;
  name: string;
  slug: string;
  status: TenantStatus;
}

export interface TenantContext {
  tenantId: number;
  user: AuthenticatedUser | null;
  tenant: AuthenticatedTenant;
  db: TenantPrismaClient;
  source: "JWT" | "KIOSK" | "JOB" | "TEST";
}

const tenantStorage = new AsyncLocalStorage<TenantContext>();

export const getTenantContext = (): TenantContext => {
  const context = tenantStorage.getStore();
  if (!context) {
    throw new Error("TENANT_CONTEXT_REQUIRED");
  }
  return context;
};

export const getTenantContextOrNull = (): TenantContext | null => tenantStorage.getStore() ?? null;

export const runWithTenantContext = <T>(context: TenantContext, callback: () => T): T => (
  tenantStorage.run(context, callback)
);
