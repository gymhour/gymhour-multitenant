import { PrismaClient } from '@prisma/client';

const TENANT_MODELS = new Set([
  'User', 'Plan', 'Cuota', 'Gasto', 'ContactoAlumno', 'MovimientoSocio', 'Turno',
  'TurnoFijo', 'HorarioClase', 'Clase', 'ClaseEntrenador', 'Rutina', 'GrupoUsuario',
  'GrupoUsuarioMiembro', 'RutinaAsignacionUsuario', 'RutinaAsignacionGrupo', 'RutinaDia',
  'Semana', 'Bloque', 'Ejercicio', 'BloqueEjercicio', 'EjercicioMedicion',
  'HistoricoEjercicio', 'Asistencia', 'MediaAsset', 'TenantKioskCredential', 'TenantSettings',
]);
const WHERE_OPERATIONS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
  'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany', 'upsert',
]);

const withTenantInData = (data, tenantId) => {
  if (Array.isArray(data)) return data.map(item => withTenantInData(item, tenantId));
  if (!data || typeof data !== 'object') return data;
  if (data.tenantId !== undefined && data.tenantId !== tenantId) throw new Error('CROSS_TENANT_WRITE_REJECTED');
  return { ...data, tenantId };
};

export async function createScriptTenantPrisma() {
  const slug = (process.argv.find(arg => arg.startsWith('--tenant=')) ?? '').split('=')[1];
  if (!slug) throw new Error('Falta --tenant=<slug>. Los scripts manuales nunca operan globalmente.');

  const system = new PrismaClient();
  const tenant = await system.tenant.findUnique({ where: { slug } });
  if (!tenant) {
    await system.$disconnect();
    throw new Error(`No existe el tenant con slug "${slug}".`);
  }
  console.error(`[script] tenant=${tenant.slug} id=${tenant.id}`);

  return system.$extends({
    name: `manual-script-${tenant.slug}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) return query(args);
          if (WHERE_OPERATIONS.has(operation)) {
            if (args.where?.tenantId !== undefined && args.where.tenantId !== tenant.id) {
              throw new Error('CROSS_TENANT_WRITE_REJECTED');
            }
            args.where = { ...(args.where ?? {}), tenantId: tenant.id };
          }
          if (operation === 'create' || operation === 'createMany') args.data = withTenantInData(args.data, tenant.id);
          if (operation === 'upsert') args.create = withTenantInData(args.create, tenant.id);
          if ((operation === 'update' || operation === 'updateMany') && args.data?.tenantId !== undefined) {
            if (args.data.tenantId !== tenant.id) throw new Error('CROSS_TENANT_WRITE_REJECTED');
            delete args.data.tenantId;
          }
          if (operation === 'upsert' && args.update?.tenantId !== undefined) {
            if (args.update.tenantId !== tenant.id) throw new Error('CROSS_TENANT_WRITE_REJECTED');
            delete args.update.tenantId;
          }
          return query(args);
        },
      },
    },
  });
}
