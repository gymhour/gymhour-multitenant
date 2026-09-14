import type { TenantRole } from '@prisma/client';
import prisma from '../models/Prisma.js';
import { getChurnRiskReport } from './churnRisk.service.js';
import { getAiInsights } from './aiInsights.service.js';

const nullableString = { type: ['string', 'null'] };
const VARCHAR_LIMIT = 191;

const fitString = (value: unknown, maxLength = VARCHAR_LIMIT): string =>
  Array.from(String(value ?? '').trim()).slice(0, maxLength).join('');

/**
 * Keeps AI-generated labels inside the legacy MySQL VARCHAR columns.
 * Free-form descriptions are stored as TEXT and intentionally remain intact.
 */
export const fitAiRoutineDraftToStorage = (source: any) => {
  const draft = structuredClone(source || {});
  draft.nombre = fitString(draft.nombre);
  draft.claseRutina = fitString(draft.claseRutina);
  draft.grupoMuscularRutina = fitString(draft.grupoMuscularRutina);

  const fitDays = (days: any) => {
    if (!days || typeof days !== 'object') return;
    for (const day of Object.values(days) as any[]) {
      day.nombre = fitString(day?.nombre);
      for (const block of day?.bloques || []) {
        for (const field of ['setsReps', 'nombreEj', 'weight', 'tiempoTrabajoDescansoTabata', 'tipoEscalera']) {
          if (block[field] != null) block[field] = fitString(block[field]);
        }
        for (const item of block?.bloqueEjercicios || []) {
          if (item.reps != null) item.reps = fitString(item.reps);
          if (item.setRepWeight != null) item.setRepWeight = fitString(item.setRepWeight);
          if (item.nuevoEjercicio?.nombre != null) item.nuevoEjercicio.nombre = fitString(item.nuevoEjercicio.nombre);
          if (item.nuevoEjercicio?.mediaUrl != null) item.nuevoEjercicio.mediaUrl = fitString(item.nuevoEjercicio.mediaUrl);
        }
      }
    }
  };

  fitDays(draft.dias);
  if (draft.semanas && typeof draft.semanas === 'object') {
    for (const week of Object.values(draft.semanas) as any[]) {
      week.nombre = fitString(week?.nombre);
      fitDays(week?.dias);
    }
  }
  return draft;
};
const currentMonth = () => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
};

export const buildStudentSearchFilter = (value: unknown) => {
  const terms = String(value || '').trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!terms.length) return {};
  return {
    AND: terms.map(term => ({
      OR: [
        { nombre: { contains: term } },
        { apellido: { contains: term } },
        { dni: { contains: term } },
      ],
    })),
  };
};

type FeeSummary = { mes: string; pagada: boolean; vencida: boolean; vence: Date; fechaPago?: Date | null };

export const summarizeFeeStatus = (fees: FeeSummary[], now = new Date()) => {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const current = fees.find(fee => fee.mes === month);
  const overdueCount = fees.filter(fee => !fee.pagada && (fee.vencida || fee.vence < now)).length;
  if (!current) return { mes: month, estado: overdueCount ? 'SIN_CUOTA_DEL_MES_CON_DEUDA' : 'SIN_CUOTA_DEL_MES', cuotasVencidas: overdueCount };
  const estado = current.pagada ? 'PAGADA' : (current.vencida || current.vence < now) ? 'VENCIDA' : 'PENDIENTE';
  return { mes: current.mes, estado, vence: current.vence, fechaPago: current.fechaPago ?? null, cuotasVencidas: overdueCount };
};

const routineDraftTool = {
  type: 'function', name: 'build_routine_draft', strict: true,
  description: 'Construye un borrador editable de rutina. Usar únicamente después de identificar un alumno y conocer objetivo, días disponibles y restricciones relevantes.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: {
      studentId: { type: 'integer' },
      name: { type: 'string', maxLength: 191 },
      description: { type: 'string' },
      goal: { type: 'string' },
      days: {
        type: 'array', minItems: 1, maxItems: 7,
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            name: { type: 'string', maxLength: 191 }, description: { type: 'string' },
            blocks: {
              type: 'array', minItems: 1, maxItems: 8,
              items: {
                type: 'object', additionalProperties: false,
                properties: {
                  type: { type: 'string', enum: ['SETS_REPS', 'ROUNDS', 'EMOM', 'AMRAP', 'LADDER', 'TABATA'] },
                  rounds: { type: ['integer', 'null'] }, durationMinutes: { type: ['integer', 'null'] },
                  restSeconds: { type: ['integer', 'null'] }, notes: nullableString,
                  exercises: {
                    type: 'array', minItems: 1, maxItems: 12,
                    items: {
                      type: 'object', additionalProperties: false,
                      properties: {
                        name: { type: 'string', maxLength: 191 },
                        reps: { type: 'string', maxLength: 191 },
                        weight: { type: ['string', 'null'], maxLength: 191 },
                      },
                      required: ['name', 'reps', 'weight'],
                    },
                  },
                },
                required: ['type', 'rounds', 'durationMinutes', 'restSeconds', 'notes', 'exercises'],
              },
            },
          },
          required: ['name', 'description', 'blocks'],
        },
      },
    },
    required: ['studentId', 'name', 'description', 'goal', 'days'],
  },
};

const commonTools: any[] = [
  {
    type: 'function', name: 'get_operational_summary', strict: true,
    description: 'Obtiene alertas operativas actuales del gimnasio.',
    parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    type: 'function', name: 'search_students', strict: true,
    description: 'Busca socios por nombre completo (en cualquier orden), nombre parcial, apellido o DNI. Con query vacío lista socios. Devuelve estado del socio y de su cuota del mes.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { query: { type: 'string' }, overdueOnly: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 20 } },
      required: ['query', 'overdueOnly', 'limit'],
    },
  },
  {
    type: 'function', name: 'get_student_context', strict: true,
    description: 'Obtiene contexto de un socio identificado, incluido el estado detallado de sus cuotas recientes, para seguimiento o personalización de rutina. Excluye ficha médica y contacto.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { studentId: { type: 'integer' }, includeHealthSummary: { type: 'boolean' } },
      required: ['studentId', 'includeHealthSummary'],
    },
  },
  {
    type: 'function', name: 'get_churn_risk', strict: true,
    description: 'Lista alumnos con riesgo de baja según su asistencia reciente.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        riskLevel: { type: 'string', enum: ['ALTO', 'MEDIO', 'BAJO', 'MEDIO_ALTO'] },
        search: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 20 },
      },
      required: ['riskLevel', 'search', 'limit'],
    },
  },
  {
    type: 'function', name: 'get_attendance_summary', strict: true,
    description: 'Obtiene resumen de asistencias dentro de un rango ISO YYYY-MM-DD.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { dateFrom: { type: 'string' }, dateTo: { type: 'string' } },
      required: ['dateFrom', 'dateTo'],
    },
  },
  {
    type: 'function', name: 'search_exercises', strict: true,
    description: 'Busca ejercicios existentes en la biblioteca del gimnasio.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 30 } },
      required: ['query', 'limit'],
    },
  },
  routineDraftTool,
];

const financeTool = {
  type: 'function', name: 'get_financial_summary', strict: true,
  description: 'Obtiene ingresos por cuotas pagadas, pendientes, vencidas, gastos y resultado para un mes YYYY-MM. Solo Admin.',
  parameters: {
    type: 'object', additionalProperties: false,
    properties: { month: { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}$' } },
    required: ['month'],
  },
};

export const getToolsForRole = (role: TenantRole): any[] =>
  role === 'ADMIN' ? [...commonTools, financeTool] : role === 'TRAINER' ? commonTools : [];

const parseDate = (value: unknown, fallback: Date): Date => {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? fallback : date;
};

export async function executeAiTool(name: string, args: any, role: TenantRole): Promise<any> {
  switch (name) {
    case 'get_operational_summary':
      return { generatedAt: new Date().toISOString(), insights: await getAiInsights(role) };
    case 'search_students': {
      const query = String(args.query || '').trim();
      const overdueFilter = args.overdueOnly
        ? { Cuotas: { some: { pagada: false, OR: [{ vencida: true }, { vence: { lt: new Date() } }] } } }
        : {};
      const users = await prisma.user.findMany({
        where: {
          role: 'STUDENT', ...overdueFilter,
          ...buildStudentSearchFilter(query),
        },
        take: Math.min(20, Math.max(1, Number(args.limit) || 10)),
        select: {
          ID_Usuario: true, nombre: true, apellido: true, dni: true, estado: true,
          plan: { select: { nombre: true } },
          Cuotas: { orderBy: { vence: 'desc' }, take: 24, select: { mes: true, pagada: true, vencida: true, vence: true, fechaPago: true } },
          Asistencias: { where: { permitido: true }, orderBy: { fechaIngreso: 'desc' }, take: 1, select: { fechaIngreso: true } },
        },
      });
      return users.map(user => ({
        id: user.ID_Usuario, nombre: [user.nombre, user.apellido].filter(Boolean).join(' '), dni: user.dni,
        estadoSocio: user.estado ? 'ACTIVO' : 'INACTIVO', plan: user.plan?.nombre ?? null,
        estadoCuota: summarizeFeeStatus(user.Cuotas),
        ultimaAsistencia: user.Asistencias[0]?.fechaIngreso ?? null,
      }));
    }
    case 'get_student_context': {
      const student = await prisma.user.findFirst({
        where: { ID_Usuario: Number(args.studentId), role: 'STUDENT' },
        select: {
          ID_Usuario: true, nombre: true, apellido: true, estado: true,
          observacionesSalud: Boolean(args.includeHealthSummary),
          plan: { select: { nombre: true, sesionesTotales: true } },
          Cuotas: { orderBy: { vence: 'desc' }, take: 12, select: { mes: true, vence: true, vencida: true, pagada: true, fechaPago: true } },
          Asistencias: { where: { permitido: true }, orderBy: { fechaIngreso: 'desc' }, take: 10, select: { fechaIngreso: true } },
          asignacionesRutina: { orderBy: { createdAt: 'desc' }, take: 3, select: { rutina: { select: { ID_Rutina: true, nombre: true, updatedAt: true } } } },
        },
      });
      if (!student) return { error: 'Alumno no encontrado.' };
      return {
        id: student.ID_Usuario, nombre: [student.nombre, student.apellido].filter(Boolean).join(' '),
        estado: student.estado, plan: student.plan, restriccionesSalud: student.observacionesSalud || null,
        estadoCuota: summarizeFeeStatus(student.Cuotas), cuotasRecientes: student.Cuotas.map(cuota => ({
          ...cuota,
          estado: cuota.pagada ? 'PAGADA' : (cuota.vencida || cuota.vence < new Date()) ? 'VENCIDA' : 'PENDIENTE',
        })),
        asistenciasRecientes: student.Asistencias,
        rutinasRecientes: student.asignacionesRutina.map(item => item.rutina),
      };
    }
    case 'get_churn_risk': {
      const report = await getChurnRiskReport({
        page: 1, take: Math.min(20, Math.max(1, Number(args.limit) || 10)),
        riskLevel: args.riskLevel, search: String(args.search || ''),
      });
      return { summary: report.summary, data: report.data };
    }
    case 'get_attendance_summary': {
      const end = parseDate(args.dateTo, new Date());
      end.setUTCHours(23, 59, 59, 999);
      const start = parseDate(args.dateFrom, new Date(end.getTime() - 30 * 86400000));
      const [total, unique] = await Promise.all([
        prisma.asistencia.count({ where: { permitido: true, fechaIngreso: { gte: start, lte: end } } }),
        prisma.asistencia.findMany({ where: { permitido: true, fechaIngreso: { gte: start, lte: end } }, distinct: ['ID_Usuario'], select: { ID_Usuario: true } }),
      ]);
      return { dateFrom: start.toISOString(), dateTo: end.toISOString(), totalAsistencias: total, alumnosUnicos: unique.length };
    }
    case 'search_exercises': {
      const query = String(args.query || '').trim();
      const terms = query.split(/[,;|\n]+|\s+(?:o|y)\s+/i).map(term => term.trim()).filter(Boolean).slice(0, 12);
      return prisma.ejercicio.findMany({
        where: terms.length ? { OR: terms.flatMap(term => [
          { nombre: { contains: term } },
          { musculos: { contains: term } },
          { equipamiento: { contains: term } },
        ]) } : {},
        take: Math.min(30, Math.max(1, Number(args.limit) || 15)),
        select: { ID_Ejercicio: true, nombre: true, descripcion: true, musculos: true, equipamiento: true },
        orderBy: { nombre: 'asc' },
      });
    }
    case 'get_financial_summary': {
      if (role !== 'ADMIN') return { error: 'Esta información está disponible únicamente para administradores.' };
      const month = typeof args.month === 'string' && /^\d{4}-\d{2}$/.test(args.month) ? args.month : currentMonth();
      const [paid, pending, overdue, expenses] = await Promise.all([
        prisma.cuota.aggregate({ where: { mes: month, pagada: true }, _sum: { importe: true }, _count: true }),
        prisma.cuota.aggregate({ where: { mes: month, pagada: false }, _sum: { importe: true }, _count: true }),
        prisma.cuota.aggregate({ where: { pagada: false, OR: [{ vencida: true }, { vence: { lt: new Date() } }] }, _sum: { importe: true }, _count: true }),
        prisma.gasto.aggregate({ where: { mes: month }, _sum: { monto: true }, _count: true }),
      ]);
      const income = Number(paid._sum.importe || 0);
      const expense = Number(expenses._sum.monto || 0);
      return {
        month, ingresos: income, cuotasPagadas: paid._count,
        pendiente: Number(pending._sum.importe || 0), cuotasPendientes: pending._count,
        deudaVencidaAcumulada: Number(overdue._sum.importe || 0), cuotasVencidas: overdue._count,
        gastos: expense, cantidadGastos: expenses._count, resultadoNeto: income - expense,
      };
    }
    case 'build_routine_draft': {
      const student = await prisma.user.findFirst({ where: { ID_Usuario: Number(args.studentId), role: 'STUDENT', estado: true }, select: { ID_Usuario: true, nombre: true, apellido: true } });
      if (!student) return { error: 'No se puede crear el borrador: alumno inexistente o inactivo.' };
      const requestedNames = Array.from(new Set((args.days || []).flatMap((day: any) => (day.blocks || []).flatMap((block: any) => (block.exercises || []).map((exercise: any) => String(exercise.name).trim()).filter(Boolean))))) as string[];
      const catalog = requestedNames.length ? await prisma.ejercicio.findMany({
        where: { OR: requestedNames.map(name => ({ nombre: { equals: name } })) },
        select: { ID_Ejercicio: true, nombre: true },
      }) : [];
      const byName = new Map(catalog.map(item => [item.nombre.trim().toLowerCase(), item]));
      const newExercises: string[] = [];
      const dias: Record<string, any> = {};
      (args.days || []).forEach((day: any, dayIndex: number) => {
        dias[`dia${dayIndex + 1}`] = {
          nombre: String(day.name || `Día ${dayIndex + 1}`), descripcion: String(day.description || ''),
          bloques: (day.blocks || []).map((block: any) => ({
            type: block.type,
            cantRondas: block.rounds ?? null,
            durationMin: block.durationMinutes ?? null,
            descansoRonda: block.restSeconds ?? null,
            descTabata: block.notes ?? null,
            bloqueEjercicios: (block.exercises || []).map((exercise: any, index: number) => {
              const found = byName.get(String(exercise.name).trim().toLowerCase());
              if (!found) newExercises.push(String(exercise.name).trim());
              return {
                ejercicioId: found?.ID_Ejercicio ?? null,
                nombre: String(exercise.name).trim(),
                nuevoEjercicio: found ? null : { nombre: String(exercise.name).trim(), descripcion: '', mediaUrl: null },
                reps: String(exercise.reps || ''), setRepWeight: exercise.weight ?? null, orden: index + 1,
              };
            }),
          })),
        };
      });
      return {
        draft: {
          version: 1, ID_Usuario: student.ID_Usuario, usuariosAsignados: [student.ID_Usuario], gruposAsignados: [],
          nombre: String(args.name), desc: `${String(args.description)}\n\nObjetivo: ${String(args.goal)}`.trim(),
          claseRutina: '', grupoMuscularRutina: '', dias,
        },
        summary: {
          student: { id: student.ID_Usuario, name: [student.nombre, student.apellido].filter(Boolean).join(' ') },
          goal: String(args.goal), days: (args.days || []).length,
          newExercises: Array.from(new Set(newExercises)),
        },
      };
    }
    default:
      return { error: `Herramienta no disponible: ${name}` };
  }
}
