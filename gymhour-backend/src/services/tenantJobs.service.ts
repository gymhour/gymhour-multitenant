import prisma, { systemPrisma } from '../models/Prisma.js';
import { runWithTenantContext } from './tenantContext.service.js';
import { runNightlyTasks } from './nightly.service.js';
import { runReminderTasks } from './reminders.service.js';

type TenantJob = () => Promise<unknown>;

async function dispatchToActiveTenants(job: TenantJob): Promise<Record<string, unknown>> {
  const tenants = await systemPrisma.tenant.findMany({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } });
  const result: Record<string, unknown> = {};

  // Secuencial a propósito: evita multiplicar conexiones y ráfagas SMTP en Railway/serverless.
  for (const tenant of tenants) {
    const context = {
      tenantId: tenant.id,
      user: null,
      tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status },
      db: prisma,
      source: 'JOB' as const,
    };
    try {
      result[tenant.slug] = { ok: true, result: await runWithTenantContext(context, job) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[tenant-job:${tenant.slug}]`, error);
      result[tenant.slug] = { ok: false, error: message };
    }
  }
  return result;
}

export const runAllTenantNightlyTasks = (): Promise<Record<string, unknown>> => dispatchToActiveTenants(runNightlyTasks);
export const runAllTenantReminderTasks = (): Promise<Record<string, unknown>> => dispatchToActiveTenants(runReminderTasks);

export async function runAllTenantDailyTasks(): Promise<Record<string, unknown>> {
  return dispatchToActiveTenants(async () => ({
    nightly: await runNightlyTasks(),
    reminders: await runReminderTasks(),
  }));
}
