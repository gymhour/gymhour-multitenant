import type { Prisma, PrismaClient } from '@prisma/client';
import { systemPrisma } from '../models/Prisma.js';
import { deleteExternalAsset } from './cloudinary.service.js';

export type AssetManifestEntry = { publicId: string; resourceType: string };

const addAsset = (map: Map<string, AssetManifestEntry>, value: string | null | undefined, resourceType = 'image'): boolean => {
  if (!value) return false;
  if (/^https?:\/\//i.test(value)) return true;
  map.set(value, { publicId: value, resourceType });
  return true;
};

export async function collectTenantAssets(tenantId: number): Promise<AssetManifestEntry[]> {
  const [registered, settings, users, classes, exercises] = await Promise.all([
    systemPrisma.mediaAsset.findMany({ where: { tenantId }, select: { cloudinaryPublicId: true, resourceType: true } }),
    systemPrisma.tenantSettings.findUnique({ where: { tenantId }, select: { logoPublicId: true } }),
    systemPrisma.user.findMany({ where: { tenantId }, select: { imagenUsuario: true, fichaMedicaUrl: true } }),
    systemPrisma.clase.findMany({ where: { tenantId }, select: { imagenClase: true } }),
    systemPrisma.ejercicio.findMany({ where: { tenantId }, select: { mediaUrl: true } }),
  ]);
  const manifest = new Map<string, AssetManifestEntry>();
  let hasAssets = false;
  registered.forEach(asset => { hasAssets = addAsset(manifest, asset.cloudinaryPublicId, asset.resourceType) || hasAssets; });
  hasAssets = addAsset(manifest, settings?.logoPublicId) || hasAssets;
  users.forEach(user => {
    hasAssets = addAsset(manifest, user.imagenUsuario) || hasAssets;
    hasAssets = addAsset(manifest, user.fichaMedicaUrl, 'raw') || hasAssets;
  });
  classes.forEach(item => { hasAssets = addAsset(manifest, item.imagenClase) || hasAssets; });
  exercises.forEach(item => { hasAssets = addAsset(manifest, item.mediaUrl) || hasAssets; });
  if (hasAssets) manifest.set('__tenant_prefix__', { publicId: `tenants/${tenantId}/`, resourceType: 'tenant-prefix' });
  return [...manifest.values()];
}

type TransactionClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

async function deleteTenantRows(tx: TransactionClient, tenantId: number): Promise<void> {
  const where = { tenantId };
  await tx.aiMessage.deleteMany({ where });
  await tx.aiConversation.deleteMany({ where });
  await tx.asistencia.deleteMany({ where });
  await tx.turno.deleteMany({ where });
  await tx.turnoFijo.deleteMany({ where });
  await tx.claseEntrenador.deleteMany({ where });
  await tx.horarioClase.deleteMany({ where });
  await tx.clase.deleteMany({ where });
  await tx.historicoEjercicio.deleteMany({ where });
  await tx.ejercicioMedicion.deleteMany({ where });
  await tx.bloqueEjercicio.deleteMany({ where });
  await tx.bloque.deleteMany({ where });
  await tx.rutinaDia.deleteMany({ where });
  await tx.semana.deleteMany({ where });
  await tx.rutinaAsignacionUsuario.deleteMany({ where });
  await tx.rutinaAsignacionGrupo.deleteMany({ where });
  await tx.grupoUsuarioMiembro.deleteMany({ where });
  await tx.grupoUsuario.deleteMany({ where });
  await tx.rutina.deleteMany({ where });
  await tx.ejercicio.deleteMany({ where });
  await tx.contactoAlumno.deleteMany({ where });
  await tx.movimientoSocio.deleteMany({ where });
  await tx.cuota.deleteMany({ where });
  await tx.gasto.deleteMany({ where });
  await tx.user.deleteMany({ where });
  await tx.plan.deleteMany({ where });
  await tx.mediaAsset.deleteMany({ where });
  await tx.tenantKioskCredential.deleteMany({ where });
  await tx.tenantSettings.deleteMany({ where });
  await tx.tenant.delete({ where: { id: tenantId } });
}

export async function purgeTenantDatabase(input: {
  tenant: { id: number; slug: string; name: string };
  actor: { id: number; email: string };
  assets: AssetManifestEntry[];
  reason: string;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<number> {
  return systemPrisma.$transaction(async tx => {
    const current = await tx.tenant.findUnique({ where: { id: input.tenant.id }, select: { slug: true } });
    if (!current || current.slug !== input.tenant.slug) throw new Error('TENANT_CHANGED_OR_MISSING');
    await deleteTenantRows(tx as TransactionClient, input.tenant.id);
    const job = await tx.tenantDeletionJob.create({ data: {
      tenantIdSnapshot: input.tenant.id,
      tenantSlugSnapshot: input.tenant.slug,
      tenantNameSnapshot: input.tenant.name,
      initiatedByUserId: input.actor.id,
      initiatedByEmail: input.actor.email,
      assetManifest: input.assets as unknown as Prisma.InputJsonValue,
      status: input.assets.length ? 'PENDING' : 'COMPLETED',
      databaseDeletedAt: new Date(),
      ...(input.assets.length ? {} : { mediaDeletedAt: new Date() }),
    } });
    await tx.platformAuditLog.create({ data: {
      platformUserId: input.actor.id,
      platformUserEmail: input.actor.email,
      action: 'TENANT_DELETE', outcome: 'SUCCESS',
      targetTenantId: input.tenant.id,
      targetTenantSlug: input.tenant.slug,
      reason: input.reason,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: { deletionJobId: job.id, assetCount: input.assets.length },
    } });
    return job.id;
  }, { isolationLevel: 'Serializable', timeout: 120000 });
}

export async function processTenantDeletionJob(jobId: number): Promise<'COMPLETED' | 'FAILED'> {
  const job = await systemPrisma.tenantDeletionJob.findUniqueOrThrow({ where: { id: jobId } });
  if (job.status === 'COMPLETED') return 'COMPLETED';
  const assets = job.assetManifest as unknown as AssetManifestEntry[];
  try {
    for (const asset of assets) await deleteExternalAsset(asset.publicId, asset.resourceType);
    await systemPrisma.tenantDeletionJob.update({ where: { id: job.id }, data: {
      status: 'COMPLETED', mediaDeletedAt: new Date(), lastError: null, attempts: { increment: 1 },
    } });
    return 'COMPLETED';
  } catch (error) {
    await systemPrisma.tenantDeletionJob.update({ where: { id: job.id }, data: {
      status: 'FAILED', attempts: { increment: 1 }, lastError: String(error).slice(0, 4000),
    } });
    return 'FAILED';
  }
}

export async function retryPendingTenantDeletions(limit = 10): Promise<{ completed: number; failed: number }> {
  const jobs = await systemPrisma.tenantDeletionJob.findMany({
    where: { status: { in: ['PENDING', 'FAILED'] }, attempts: { lt: 10 } }, orderBy: { createdAt: 'asc' }, take: limit,
  });
  let completed = 0;
  let failed = 0;
  for (const job of jobs) {
    if (await processTenantDeletionJob(job.id) === 'COMPLETED') completed += 1; else failed += 1;
  }
  return { completed, failed };
}
