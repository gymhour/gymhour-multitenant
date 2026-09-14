import type { TenantRole } from '@prisma/client';
import prisma from '../models/Prisma.js';
import { getChurnRiskReport } from './churnRisk.service.js';
import { MONTHLY_USER_PROMPT_LIMIT } from './aiLimits.js';

const monthKey = (date = new Date()): string =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;

const isoDate = (date: Date): string => date.toISOString();

export type AiInsight = {
  id: string;
  title: string;
  value: string;
  detail: string;
  severity: 'info' | 'warning' | 'critical' | 'positive';
  href: string;
  prompt: string;
};

export async function getAiInsights(role: TenantRole): Promise<AiInsight[]> {
  const now = new Date();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86400000);
  const currentMonth = monthKey(now);

  const [risk, overdueFees, inactiveStudents, withoutRoutine] = await Promise.all([
    getChurnRiskReport({ page: 1, take: 1 }),
    prisma.cuota.findMany({
      where: { pagada: false, OR: [{ vencida: true }, { vence: { lt: now } }] },
      select: { ID_Usuario: true, importe: true },
    }),
    prisma.user.count({
      where: {
        role: 'STUDENT', estado: true,
        Asistencias: { none: { permitido: true, fechaIngreso: { gte: fourteenDaysAgo } } },
      },
    }),
    prisma.user.count({
      where: {
        role: 'STUDENT', estado: true,
        asignacionesRutina: { none: {} },
        rutinasAsignadas: { none: {} },
      },
    }),
  ]);

  const overdueStudents = new Set(overdueFees.map(fee => fee.ID_Usuario)).size;
  const overdueAmount = overdueFees.reduce((sum, fee) => sum + Number(fee.importe || 0), 0);
  const common: AiInsight[] = [
    {
      id: 'churn-risk', title: 'Riesgo de baja',
      value: `${risk.summary.highRisk} alto · ${risk.summary.mediumRisk} medio`,
      detail: 'Estimación basada en cambios de asistencia y uso reciente.',
      severity: risk.summary.highRisk > 0 ? 'critical' : risk.summary.mediumRisk > 0 ? 'warning' : 'positive',
      href: role === 'ADMIN' ? '/admin/predictor-bajas' : '/entrenador/usuarios',
      prompt: '¿Qué alumnos necesitan seguimiento por riesgo de baja y por qué?',
    },
    {
      id: 'low-attendance', title: 'Sin asistencia reciente', value: String(inactiveStudents),
      detail: 'Alumnos activos sin ingresos registrados en los últimos 14 días.',
      severity: inactiveStudents > 0 ? 'warning' : 'positive',
      href: role === 'ADMIN' ? '/admin/asistencias' : '/entrenador/usuarios',
      prompt: 'Mostrame los alumnos que no asistieron en los últimos 14 días.',
    },
    {
      id: 'without-routine', title: 'Sin rutina asignada', value: String(withoutRoutine),
      detail: 'Alumnos activos que todavía no tienen una rutina individual.',
      severity: withoutRoutine > 0 ? 'warning' : 'positive',
      href: role === 'ADMIN' ? '/admin/asignar-rutinas' : '/entrenador/asignar-rutinas',
      prompt: '¿Qué alumnos no tienen rutina y a cuál conviene priorizar?',
    },
  ];

  if (role === 'TRAINER') {
    return [
      ...common,
      {
        id: 'overdue-students', title: 'Alumnos con cuotas vencidas', value: String(overdueStudents),
        detail: 'Se muestra el estado por alumno, sin importes financieros globales.',
        severity: overdueStudents > 0 ? 'warning' : 'positive', href: '/entrenador/usuarios',
        prompt: '¿Qué alumnos tienen cuotas vencidas?',
      },
    ];
  }

  const [paid, pending, expenses] = await Promise.all([
    prisma.cuota.aggregate({ where: { mes: currentMonth, pagada: true }, _sum: { importe: true } }),
    prisma.cuota.aggregate({ where: { mes: currentMonth, pagada: false }, _sum: { importe: true } }),
    prisma.gasto.aggregate({ where: { mes: currentMonth }, _sum: { monto: true } }),
  ]);
  const income = Number(paid._sum.importe || 0);
  const pendingAmount = Number(pending._sum.importe || 0);
  const expenseAmount = Number(expenses._sum.monto || 0);
  const collectionRate = income + pendingAmount > 0 ? Math.round(income / (income + pendingAmount) * 100) : 0;
  const net = income - expenseAmount;

  return [
    {
      id: 'overdue-fees', title: 'Deuda vencida', value: `$${overdueAmount.toLocaleString('es-AR')}`,
      detail: `${overdueFees.length} cuotas de ${overdueStudents} alumnos.`,
      severity: overdueFees.length > 0 ? 'critical' : 'positive', href: '/admin/cuotas?estado=vencida',
      prompt: 'Analizá las cuotas vencidas y decime qué debería priorizar.',
    },
    common[0],
    {
      id: 'collection-rate', title: 'Tasa de cobranza', value: `${collectionRate}%`,
      detail: `Correspondiente a ${currentMonth}.`,
      severity: collectionRate < 70 ? 'warning' : 'positive', href: `/admin/cuotas?mes=${currentMonth}`,
      prompt: 'Explicame la cobranza de este mes y comparala con los meses anteriores.',
    },
    {
      id: 'net-income', title: 'Resultado neto', value: `$${net.toLocaleString('es-AR')}`,
      detail: `Ingresos menos gastos de ${currentMonth}.`,
      severity: net < 0 ? 'critical' : 'positive', href: '/admin/inicio',
      prompt: '¿Cómo está el resultado financiero del gimnasio este mes?',
    },
  ];
}

export async function getAiHome(role: TenantRole, userId: number) {
  const start = new Date();
  start.setUTCDate(1); start.setUTCHours(0, 0, 0, 0);
  const usedPrompts = await prisma.aiMessage.count({
    where: { userId, role: 'USER', createdAt: { gte: start } },
  });
  const insights = role === 'STUDENT' ? [] : await getAiInsights(role);
  const fixed = role === 'ADMIN'
    ? [
      '🏋️ Creá una rutina para un socio según sus objetivos y nivel.',
      '📊 ¿Cuál es el estado actual del gimnasio?',
      '🚀 ¿Qué promociones puedo lanzar para conseguir más socios y hacer crecer el gimnasio?',
    ]
    : role === 'TRAINER'
      ? ['¿Qué alumnos necesitan seguimiento?', '¿Quiénes no tienen rutina?', 'Creá una rutina para un alumno']
      : ['Ayudame a organizar mi semana de entrenamiento', '¿Cómo puedo sostener el hábito de entrenar?', 'Explicame cómo usar Gymhour'];
  const configured = Boolean(process.env.OPENAI_API_KEY);
  const limitReached = usedPrompts >= MONTHLY_USER_PROMPT_LIMIT;
  return {
    enabled: configured && !limitReached,
    configured,
    disabledReason: !configured ? 'NOT_CONFIGURED' : limitReached ? 'MONTHLY_LIMIT' : null,
    usage: {
      usedPrompts,
      limitPrompts: MONTHLY_USER_PROMPT_LIMIT,
      remainingPrompts: Math.max(0, MONTHLY_USER_PROMPT_LIMIT - usedPrompts),
      resetAt: isoDate(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))),
    },
    insights,
    suggestions: [...fixed, ...insights.slice(0, 3).map(item => item.prompt)].slice(0, 6),
    userId,
  };
}
