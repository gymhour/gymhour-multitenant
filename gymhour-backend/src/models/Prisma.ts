import { PrismaClient } from '@prisma/client';
import { getTenantContextOrNull } from '../services/tenantContext.service.js';

/**
 * En serverless (Vercel) cada instancia de lambda abre su propio pool de conexiones.
 * Prisma por defecto usa `num_cpus * 2 + 1` conexiones, y el hosting MySQL limita
 * las aperturas acumuladas por hora (max_connections_per_hour = 500).
 * Forzamos connection_limit=1 para que cada instancia consuma una sola conexión.
 */
function buildDatabaseUrl(): string | undefined {
    const raw = process.env.DATABASE_URL;
    if (!raw) return undefined;

    try {
        const url = new URL(raw);
        if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '1');
        if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '20');
        if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '15');
        return url.toString();
    } catch {
        return raw;
    }
}

function createPrismaClient() {
    const datasourceUrl = buildDatabaseUrl();
    return new PrismaClient({
        ...(datasourceUrl ? { datasourceUrl } : {}),
        //log: ['query', 'info', 'warn', 'error'], // Registra todas las consultas y errores
    });
}

// Reutilizamos la misma instancia entre invocaciones "calientes" de la lambda
// y entre recargas en desarrollo, en lugar de abrir un pool nuevo cada vez.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const systemPrisma = globalForPrisma.prisma ?? createPrismaClient();
globalForPrisma.prisma = systemPrisma;

export const TENANT_MODELS = new Set([
    'User', 'Plan', 'Cuota', 'Gasto', 'ContactoAlumno', 'MovimientoSocio',
    'Turno', 'TurnoFijo', 'HorarioClase', 'Clase', 'ClaseEntrenador', 'Rutina',
    'GrupoUsuario', 'GrupoUsuarioMiembro', 'RutinaAsignacionUsuario',
    'RutinaAsignacionGrupo', 'RutinaDia', 'Semana', 'Bloque', 'Ejercicio',
    'BloqueEjercicio', 'EjercicioMedicion', 'HistoricoEjercicio', 'Asistencia',
    'MediaAsset', 'TenantKioskCredential', 'TenantSettings', 'AiConversation',
    'AiMessage'
]);

const WHERE_OPERATIONS = new Set([
    'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany',
    'count', 'aggregate', 'groupBy', 'update', 'updateMany', 'delete', 'deleteMany',
    'upsert'
]);

const assertTenantValue = (value: unknown, tenantId: number): void => {
    if (value !== undefined && value !== tenantId) {
        throw new Error('CROSS_TENANT_WRITE_REJECTED');
    }
};

export const tenantizeNestedWrites = (value: unknown, tenantId: number): unknown => {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => tenantizeNestedWrites(item, tenantId));

    const object = value as Record<string, any>;
    for (const [key, nested] of Object.entries(object)) {
        if (key === 'create') {
            object[key] = tenantizeNestedCreateData(nested, tenantId);
        } else if (key === 'createMany' && nested && typeof nested === 'object') {
            const createMany = nested as Record<string, any>;
            createMany.data = tenantizeNestedCreateData(createMany.data, tenantId);
        } else if (key === 'connectOrCreate' && nested && typeof nested === 'object') {
            const entries = Array.isArray(nested) ? nested : [nested];
            for (const entry of entries) {
                if (entry?.create) entry.create = tenantizeNestedCreateData(entry.create, tenantId);
            }
        } else if (key === 'upsert' && nested && typeof nested === 'object') {
            const entries = Array.isArray(nested) ? nested : [nested];
            for (const entry of entries) {
                if (entry?.create) entry.create = tenantizeNestedCreateData(entry.create, tenantId);
                if (entry?.update) entry.update = tenantizeNestedWrites(entry.update, tenantId);
            }
        } else if (nested && typeof nested === 'object') {
            object[key] = tenantizeNestedWrites(nested, tenantId);
        }
    }
    return object;
};

function tenantizeNestedCreateData(value: unknown, tenantId: number): unknown {
    if (Array.isArray(value)) return value.map(item => tenantizeNestedCreateData(item, tenantId));
    if (!value || typeof value !== 'object') return value;

    const data = value as Record<string, any>;
    assertTenantValue(data.tenantId, tenantId);
    delete data.tenantId;

    const connectedTenantId = data.tenant?.connect?.id;
    assertTenantValue(connectedTenantId, tenantId);
    delete data.tenant;

    return tenantizeNestedWrites(data, tenantId);
}

function tenantizeCreateData(value: unknown, tenantId: number): unknown {
    if (Array.isArray(value)) return value.map(item => tenantizeCreateData(item, tenantId));
    if (!value || typeof value !== 'object') return value;
    const data = value as Record<string, any>;
    assertTenantValue(data.tenantId, tenantId);
    data.tenantId = tenantId;
    return tenantizeNestedWrites(data, tenantId);
}

export const scopeTenantArgs = (
    model: string,
    operation: string,
    args: Record<string, any>,
    tenantId: number,
): Record<string, any> => {
    if (!TENANT_MODELS.has(model)) return args;

    if (WHERE_OPERATIONS.has(operation)) {
        const where = args.where ?? {};
        assertTenantValue(where.tenantId, tenantId);
        args.where = { ...where, tenantId };
    }

    if (operation === 'create' || operation === 'createMany') {
        args.data = tenantizeCreateData(args.data, tenantId);
    } else if (operation === 'update' || operation === 'updateMany') {
        if (args.data) {
            assertTenantValue(args.data.tenantId, tenantId);
            delete args.data.tenantId;
            args.data = tenantizeNestedWrites(args.data, tenantId);
        }
    } else if (operation === 'upsert') {
        args.create = tenantizeCreateData(args.create, tenantId);
        if (args.update) {
            assertTenantValue(args.update.tenantId, tenantId);
            delete args.update.tenantId;
            args.update = tenantizeNestedWrites(args.update, tenantId);
        }
    }
    return args;
};

const tenantPrisma = systemPrisma.$extends({
    name: 'tenant-isolation',
    query: {
        $allModels: {
            async $allOperations({ model, operation, args, query }) {
                if (!TENANT_MODELS.has(model)) return query(args);

                const context = getTenantContextOrNull();
                if (!context) throw new Error(`TENANT_CONTEXT_REQUIRED:${model}.${operation}`);
                return query(scopeTenantArgs(model, operation, args as Record<string, any>, context.tenantId) as any);
            },
        },
    },
});

export type TenantPrismaClient = typeof tenantPrisma;
export default tenantPrisma;
