import { systemPrisma } from '../models/Prisma.js';
import { billingTierForActiveStudentCount } from './billingCatalog.service.js';

export async function tenantBillingTier(tenantId: number) {
  const activeStudents = await systemPrisma.user.count({
    where: { tenantId, role: 'STUDENT', estado: true },
  });
  return { activeStudents, tier: billingTierForActiveStudentCount(activeStudents) };
}
