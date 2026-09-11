import 'dotenv/config';
import { createHash } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { systemPrisma } from '../models/Prisma.js';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_SECRET_KEY,
  secure: true,
});

const slug = (process.argv.find(arg => arg.startsWith('--tenant=')) ?? '').split('=')[1];
const apply = process.argv.includes('--apply');
if (!slug) throw new Error('Uso: node dist/scripts/migrateMediaAssets.js --tenant=<slug> [--apply]');

const stableId = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 20);

async function copyAsset(tenantId: number, oldValue: string, folder: string, resourceType: 'image' | 'raw' = 'image') {
  const newPublicId = `tenants/${tenantId}/${folder}/legacy_${stableId(oldValue)}`;
  if (!apply) return newPublicId;
  const sourceUrl = /^https?:\/\//i.test(oldValue)
    ? oldValue
    : cloudinary.url(oldValue, { secure: true, type: 'upload', resource_type: resourceType });
  const uploaded = await cloudinary.uploader.upload(sourceUrl, {
    public_id: newPublicId,
    type: 'authenticated',
    overwrite: false,
    resource_type: resourceType,
  });
  const verified = await cloudinary.api.resource(uploaded.public_id, {
    type: 'authenticated', resource_type: uploaded.resource_type,
  });
  if (!verified?.public_id || Number(verified.bytes ?? 0) !== Number(uploaded.bytes ?? 0)) {
    throw new Error(`Falló la verificación copy-verify de ${oldValue}`);
  }
  return uploaded;
}

async function main() {
  const tenant = await systemPrisma.tenant.findUniqueOrThrow({ where: { slug } });
  const users = await systemPrisma.user.findMany({
    where: { tenantId: tenant.id, OR: [{ imagenUsuario: { not: null } }, { fichaMedicaUrl: { not: null } }] },
    select: { ID_Usuario: true, imagenUsuario: true, fichaMedicaUrl: true },
  });
  const classes = await systemPrisma.clase.findMany({
    where: { tenantId: tenant.id, imagenClase: { not: null } },
    select: { ID_Clase: true, imagenClase: true },
  });
  const exercises = await systemPrisma.ejercicio.findMany({
    where: { tenantId: tenant.id, mediaUrl: { not: null } },
    select: { ID_Ejercicio: true, mediaUrl: true },
  });

  console.log(`[media] tenant=${slug}; users/medical=${users.length}; classes=${classes.length}; exercises=${exercises.length}; apply=${apply}`);
  for (const user of users) {
    if (user.imagenUsuario && !user.imagenUsuario.startsWith('tenants/')) {
      const copied: any = await copyAsset(tenant.id, user.imagenUsuario, 'users');
      if (apply) await systemPrisma.$transaction([
        systemPrisma.mediaAsset.create({ data: {
          tenantId: tenant.id, kind: 'USER_AVATAR', cloudinaryPublicId: copied.public_id,
          resourceType: copied.resource_type, format: copied.format, bytes: copied.bytes,
        } }),
        systemPrisma.user.update({ where: { ID_Usuario: user.ID_Usuario }, data: { imagenUsuario: copied.public_id } }),
      ]);
    }
    if (user.fichaMedicaUrl && !user.fichaMedicaUrl.startsWith('tenants/')) {
      const copied: any = await copyAsset(tenant.id, user.fichaMedicaUrl, 'medical-records', 'raw');
      if (apply) await systemPrisma.$transaction([
        systemPrisma.mediaAsset.create({ data: {
          tenantId: tenant.id, kind: 'MEDICAL_RECORD', cloudinaryPublicId: copied.public_id,
          resourceType: copied.resource_type, format: copied.format, bytes: copied.bytes,
        } }),
        systemPrisma.user.update({ where: { ID_Usuario: user.ID_Usuario }, data: { fichaMedicaUrl: copied.public_id } }),
      ]);
    }
  }
  for (const gymClass of classes) {
    if (gymClass.imagenClase!.startsWith('tenants/')) continue;
    const copied: any = await copyAsset(tenant.id, gymClass.imagenClase!, 'classes');
    if (apply) await systemPrisma.$transaction([
      systemPrisma.mediaAsset.create({ data: {
        tenantId: tenant.id, kind: 'CLASS_IMAGE', cloudinaryPublicId: copied.public_id,
        resourceType: copied.resource_type, format: copied.format, bytes: copied.bytes,
      } }),
      systemPrisma.clase.update({ where: { ID_Clase: gymClass.ID_Clase }, data: { imagenClase: copied.public_id } }),
    ]);
  }
  for (const exercise of exercises) {
    if (exercise.mediaUrl!.startsWith('tenants/')) continue;
    const copied: any = await copyAsset(tenant.id, exercise.mediaUrl!, 'exercises');
    if (apply) await systemPrisma.$transaction([
      systemPrisma.mediaAsset.create({ data: {
        tenantId: tenant.id, kind: 'EXERCISE_MEDIA', cloudinaryPublicId: copied.public_id,
        resourceType: copied.resource_type, format: copied.format, bytes: copied.bytes,
      } }),
      systemPrisma.ejercicio.update({ where: { ID_Ejercicio: exercise.ID_Ejercicio }, data: { mediaUrl: copied.public_id } }),
    ]);
  }
  console.log('[media] copy-verify finalizado. Los originales no fueron eliminados.');
}

main()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => systemPrisma.$disconnect());
