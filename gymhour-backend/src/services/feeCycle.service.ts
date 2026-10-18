import { Prisma } from '@prisma/client';
import prisma from '../models/Prisma.js';
import { buildCuotaPlanSnapshot, generateFixedTurnosForCuota } from './accessRules.service.js';
import { runSerializableTransaction } from './transaction.service.js';
import {
  feeDateString, feeDayEnd, feeMonth, feeNextDay, feePeriod, feeToday,
  nextUnbilledAnniversary, parseFeeDate,
} from './feeDates.service.js';

const DEFAULT_TIMEZONE = 'America/Argentina/Cordoba';

export class FeeCycleError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function localFeeToday(): Promise<Date> {
  const settings = await prisma.tenantSettings.findFirst({ select: { timezone: true } });
  return feeToday(settings?.timezone || DEFAULT_TIMEZONE);
}

function proposedStart(user: any, today: Date): Date {
  if (!user.plan) throw new FeeCycleError(409, 'El alumno necesita un plan para crear una cuota.');
  if (user.cobroAutomaticoActivo && user.proximoInicioCuota) return user.proximoInicioCuota;
  if (!user.fechaInicioCobro) throw new FeeCycleError(409, 'Definí la fecha de inicio de cobro del alumno.');
  return nextUnbilledAnniversary(user.fechaInicioCobro, user.plan.duracion,
    user.diaAnclaCobro || user.fechaInicioCobro.getUTCDate(), today);
}

export async function getNextFeePreview(userId: number, requestedStart?: string) {
  const user = await prisma.user.findFirst({
    where: { ID_Usuario: userId, role: 'STUDENT' },
    select: {
      ID_Usuario: true, estado: true, fechaInicioCobro: true, proximoInicioCuota: true,
      diaAnclaCobro: true, cobroAutomaticoActivo: true,
      plan: { select: { ID_Plan: true, nombre: true, precio: true, duracion: true } },
    },
  });
  if (!user) throw new FeeCycleError(404, 'No encontramos ese alumno.');
  if (!user.estado) throw new FeeCycleError(409, 'Reactivá al alumno antes de crear una cuota.');
  if (!user.plan) throw new FeeCycleError(409, 'El alumno necesita un plan para crear una cuota.');
  const today = await localFeeToday();
  const selectedStart = requestedStart ? parseFeeDate(requestedStart) : null;
  if (requestedStart && !selectedStart) throw new FeeCycleError(400, 'Elegí una fecha de inicio de cobro válida.');
  if (selectedStart) {
    const existingFees = await prisma.cuota.count({ where: { ID_Usuario: userId } });
    if (user.cobroAutomaticoActivo || existingFees > 0) throw new FeeCycleError(409, 'El inicio de cobro solo puede definirse al crear la primera cuota.');
  }
  const anchorDay = selectedStart?.getUTCDate() || user.diaAnclaCobro || today.getUTCDate();
  const start = selectedStart
    ? nextUnbilledAnniversary(selectedStart, user.plan!.duracion, anchorDay, today)
    : proposedStart(user, today);
  const period = feePeriod(start, user.plan!.duracion, anchorDay);
  return {
    fechaInicio: feeDateString(start), fechaFinSugerida: feeDateString(period.end),
    vence: feeDateString(start), importeSugerido: user.plan!.precio,
    plan: user.plan, cobroAutomaticoActivo: user.cobroAutomaticoActivo,
  };
}

type ManualFeeInput = {
  fechaInicioCobro?: string;
  fechaFin: string;
  importe: number;
  pagada: boolean;
  formaPago?: string | null;
  fechaPago?: string | null;
};

export async function createCycleFee(userId: number, input: ManualFeeInput) {
  const today = await localFeeToday();
  const selectedStart = input.fechaInicioCobro ? parseFeeDate(input.fechaInicioCobro) : null;
  if (input.fechaInicioCobro && !selectedStart) throw new FeeCycleError(400, 'Elegí una fecha de inicio de cobro válida.');
  const endDay = parseFeeDate(input.fechaFin);
  const importe = Number(input.importe);
  const paymentDay = input.pagada ? parseFeeDate(input.fechaPago) : null;
  if (!endDay || !Number.isFinite(importe) || importe < 0 || typeof input.pagada !== 'boolean') {
    throw new FeeCycleError(400, 'Indicá una fecha de fin, un importe válido y el estado de la cuota.');
  }
  if (input.pagada && (!paymentDay || !String(input.formaPago || '').trim() || paymentDay > today)) {
    throw new FeeCycleError(400, 'Indicá un medio y una fecha de pago válida, no posterior a hoy.');
  }

  const created = await runSerializableTransaction(async tx => {
    const user = await tx.user.findFirst({ where: { ID_Usuario: userId, role: 'STUDENT' }, include: { plan: true } });
    if (!user) throw new FeeCycleError(404, 'No encontramos ese alumno.');
    if (!user.estado) throw new FeeCycleError(409, 'Reactivá al alumno antes de crear una cuota.');
    if (!user.plan) throw new FeeCycleError(409, 'El alumno necesita un plan para crear una cuota.');
    if (selectedStart) {
      const existingFees = await tx.cuota.count({ where: { ID_Usuario: userId } });
      if (user.cobroAutomaticoActivo || existingFees > 0) throw new FeeCycleError(409, 'El inicio de cobro solo puede definirse al crear la primera cuota.');
    }
    const anchorDay = selectedStart?.getUTCDate() || user.diaAnclaCobro || today.getUTCDate();
    const start = selectedStart
      ? nextUnbilledAnniversary(selectedStart, user.plan.duracion, anchorDay, today)
      : proposedStart(user, today);
    if (endDay < start || endDay.getTime() - start.getTime() > 731 * 86_400_000) {
      throw new FeeCycleError(400, 'La fecha de fin debe ser posterior al inicio y estar dentro de dos años.');
    }
    const end = feeDayEnd(endDay);
    const existing = await tx.cuota.findFirst({ where: {
      ID_Usuario: userId,
      OR: [{ fechaInicio: { lte: end }, fechaFin: { gte: start } },
        { mes: feeMonth(start), OR: [{ fechaInicio: null }, { fechaFin: null }] }],
    } });
    if (existing) throw new FeeCycleError(409, 'Ya existe una cuota para ese período. Registrá el pago sobre la cuota existente.');
    const suggested = feePeriod(start, user.plan.duracion, anchorDay);
    const nextStart = feeNextDay(endDay);
    const free = Number(user.plan.precio) === 0;
    if (free && importe !== 0) throw new FeeCycleError(400, 'Las cuotas de un plan gratuito deben tener importe cero.');
    const cuota = await tx.cuota.create({ data: {
      ID_Usuario: userId, ID_Plan: user.ID_Plan, mes: feeMonth(start),
      fechaInicio: start, fechaFin: end, vence: feeDayEnd(start), importe,
      pagada: free || input.pagada, vencida: !free && !input.pagada && start < today,
      fechaPago: free ? today : paymentDay,
      formaPago: free ? 'Plan gratuito' : input.pagada ? String(input.formaPago).trim() : null,
      origen: 'MANUAL', ...buildCuotaPlanSnapshot(user.plan),
    } });
    await tx.user.update({ where: { ID_Usuario: userId }, data: {
      cobroAutomaticoActivo: true, proximoInicioCuota: nextStart,
      ...(selectedStart ? { fechaInicioCobro: selectedStart } : {}),
      diaAnclaCobro: end.getTime() === suggested.end.getTime()
        ? anchorDay : nextStart.getUTCDate(),
    } });
    return cuota;
  });
  const fixed = await generateFixedTurnosForCuota(created);
  return { cuota: created, turnosGenerados: fixed.created, turnosNoGenerados: fixed.errores };
}

export async function generateDueFees(): Promise<{ created: number; skipped: number; errors: number }> {
  const today = await localFeeToday();
  const horizon = new Date(today.getTime() + 3 * 86_400_000);
  const users = await prisma.user.findMany({
    where: { role: 'STUDENT', estado: true, cobroAutomaticoActivo: true,
      proximoInicioCuota: { lte: horizon }, plan: { isNot: null } },
    select: { ID_Usuario: true },
  });
  const result = { created: 0, skipped: 0, errors: 0 };
  for (const user of users) {
    try {
      for (let periodCount = 0; periodCount < 1200; periodCount += 1) {
        const step = await runSerializableTransaction(async tx => {
          const current = await tx.user.findFirst({
            where: { ID_Usuario: user.ID_Usuario, role: 'STUDENT', estado: true, cobroAutomaticoActivo: true },
            include: { plan: true },
          });
          if (!current?.plan || !current.proximoInicioCuota || current.proximoInicioCuota > horizon) return null;
          const start = current.proximoInicioCuota;
          const period = feePeriod(start, current.plan.duracion, current.diaAnclaCobro || start.getUTCDate());
          const existing = await tx.cuota.findFirst({ where: { ID_Usuario: user.ID_Usuario,
            OR: [{ fechaInicio: { lte: period.end }, fechaFin: { gte: start } },
              { mes: feeMonth(start), OR: [{ fechaInicio: null }, { fechaFin: null }] }],
          } });
          if (existing) {
            if (!existing.fechaInicio || !existing.fechaFin || existing.fechaInicio.getTime() !== start.getTime()) {
              throw new FeeCycleError(409, `Cuota solapada para el alumno ${user.ID_Usuario} en ${feeDateString(start)}.`);
            }
            await tx.user.update({ where: { ID_Usuario: user.ID_Usuario }, data: {
              proximoInicioCuota: feeNextDay(new Date(Date.UTC(existing.fechaFin.getUTCFullYear(), existing.fechaFin.getUTCMonth(), existing.fechaFin.getUTCDate()))),
            } });
            return { skipped: true };
          }
          const free = Number(current.plan.precio) === 0;
          const cuota = await tx.cuota.create({ data: {
            ID_Usuario: user.ID_Usuario, ID_Plan: current.ID_Plan, mes: feeMonth(start),
            fechaInicio: start, fechaFin: period.end, vence: period.due,
            importe: Number(current.plan.precio), pagada: free,
            vencida: !free && start < today,
            fechaPago: free ? today : null, formaPago: free ? 'Plan gratuito' : null,
            origen: 'AUTOMATICA', ...buildCuotaPlanSnapshot(current.plan),
          } });
          await tx.user.update({ where: { ID_Usuario: user.ID_Usuario }, data: { proximoInicioCuota: period.nextStart } });
          return { cuota };
        }, { maxWait: 10000, timeout: 30000 });
        if (!step) break;
        if (step.skipped) { result.skipped += 1; continue; }
        result.created += 1;
        const fixed = await generateFixedTurnosForCuota(step.cuota);
        if (fixed.errores.length) console.warn('[fee-cycle] turnos fijos omitidos', user.ID_Usuario, fixed.errores.length);
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') result.skipped += 1;
      else { result.errors += 1; console.error('[fee-cycle] alumno', user.ID_Usuario, error); }
    }
  }
  return result;
}
