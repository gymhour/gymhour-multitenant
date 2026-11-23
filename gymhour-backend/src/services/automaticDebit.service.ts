import crypto from 'node:crypto';
import type { DebitoAutomatico, MercadoPagoAccount } from '@prisma/client';
import prisma, { systemPrisma } from '../models/Prisma.js';
import { generateDueFeesForUser } from './feeCycle.service.js';
import { feeDateString, feeToday, nextFeeStart, parseFeeDuration } from './feeDates.service.js';
import {
  MercadoPagoError, cancelPreapproval, createPreapproval, frontendUrl, getAuthorizedPayment, getPayment,
  getPreapproval, searchPaymentsByReference, updatePreapprovalAmount, type MercadoPagoPayment,
} from './mercadoPago.service.js';
import { lockKeyFor, withTenantToken } from './mercadoPagoAccount.service.js';
import {
  DEBIT_COVERING_STATUSES, MP_DEBIT_LABEL, MemberPaymentError, applyPaymentUpdate, isUniqueError, markApproved,
  paymentFields, tenantTimezone,
} from './memberPayments.service.js';
import { tenantPlanAccess } from './planAccess.service.js';
import { runWithTenantContext } from './tenantContext.service.js';

// Débito automático de cuotas con suscripciones de Mercado Pago, creadas con el token del gimnasio.
// Ver MERCADOPAGO.md, "Débito automático".

const DAY_MS = 86_400_000;
const PENDING_DEBIT_TTL_MS = 48 * 60 * 60 * 1000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const activeKeyFor = (tenantId: number, userId: number) => `${tenantId}:${userId}`;

export const publicDebit = (debit: DebitoAutomatico) => ({
  id: debit.id,
  status: debit.status,
  payerEmail: debit.payerEmail,
  amount: debit.amount,
  frequency: debit.frequency,
  frequencyType: debit.frequencyType,
  startDate: debit.startDate,
  nextChargeDate: debit.nextChargeDate,
  lastChargeStatus: debit.lastChargeStatus,
  lastChargeAt: debit.lastChargeAt,
  cancelledAt: debit.cancelledAt,
  cancelReason: debit.cancelReason,
  createdAt: debit.createdAt,
});

// Mercado Pago cobra cada n meses o cada n días. Los planes por semanas se cobran en días.
export function debitFrequency(duration: unknown): { frequency: number; frequencyType: 'months' | 'days' } | null {
  const parsed = parseFeeDuration(duration);
  if (!parsed) return null;
  return parsed.unit === 'MONTHS'
    ? { frequency: parsed.count, frequencyType: 'months' }
    : { frequency: parsed.count * 7, frequencyType: 'days' };
}

// Primer cobro: el primer período futuro que no esté pagado. Así el débito nunca se superpone con una
// cuota ya pagada ni con la del período actual, que se paga aparte.
export async function firstDebitDate(
  tenantId: number,
  user: { ID_Usuario: number; proximoInicioCuota: Date | null; diaAnclaCobro: number | null; plan: { duracion: string } },
  today: Date,
): Promise<Date> {
  const latest = await systemPrisma.cuota.findFirst({
    where: { tenantId, ID_Usuario: user.ID_Usuario },
    orderBy: [{ fechaInicio: 'desc' }, { ID_Cuota: 'desc' }],
    select: { fechaInicio: true, pagada: true },
  });
  if (latest?.fechaInicio && !latest.pagada && latest.fechaInicio > today) return latest.fechaInicio;
  let start = user.proximoInicioCuota ?? today;
  const anchor = user.diaAnclaCobro || start.getUTCDate();
  for (let i = 0; i < 1200 && start <= today; i += 1) start = nextFeeStart(start, user.plan.duracion, anchor);
  return start;
}

// Las fechas de cuotas son días locales; Mercado Pago espera una fecha y hora futura.
const mpStartDate = (start: Date) => `${feeDateString(start)}T12:00:00.000-03:00`;

const mapPreapprovalStatus = (status: string, current: DebitoAutomatico): string => {
  if (status === 'authorized') return current.status === 'CON_RECHAZO' ? 'CON_RECHAZO' : 'ACTIVO';
  if (status === 'paused') return 'PAUSADO';
  if (status === 'cancelled' || status === 'finished') return 'CANCELADO';
  return 'PENDIENTE';
};

// --- Adhesión ---

export async function adhereDebit(input: { tenantId: number; userId: number; payerEmail: string }) {
  const { tenantId, userId } = input;
  const payerEmail = String(input.payerEmail ?? '').trim().toLowerCase();
  if (!EMAIL.test(payerEmail) || payerEmail.length > 191) {
    throw new MemberPaymentError(400, 'EMAIL_INVALIDO', 'Ingresá el email de tu cuenta de Mercado Pago.');
  }
  if (!(await tenantPlanAccess(tenantId)).features.MEMBER_PAYMENTS) {
    throw new MemberPaymentError(403, 'PLAN_UPGRADE_REQUIRED', 'El gimnasio no tiene habilitados los cobros con Mercado Pago.');
  }
  const user = await systemPrisma.user.findFirst({
    where: { tenantId, ID_Usuario: userId, role: 'STUDENT', estado: true }, include: { plan: true },
  });
  if (!user?.plan) throw new MemberPaymentError(409, 'SIN_PLAN', 'Necesitás tener un plan asignado para adherirte al débito automático.');
  if (!user.cobroAutomaticoActivo || !user.proximoInicioCuota) {
    throw new MemberPaymentError(409, 'CICLO_INACTIVO', 'Tu gimnasio todavía no activó tu ciclo de cuotas. Consultalo con el gimnasio.');
  }
  if (!(Number(user.plan.precio) > 0)) throw new MemberPaymentError(409, 'PLAN_GRATUITO', 'Tu plan no tiene costo: no hace falta el débito automático.');
  const frequency = debitFrequency(user.plan.duracion);
  if (!frequency) throw new MemberPaymentError(409, 'DURACION_NO_SOPORTADA', 'La duración de tu plan no admite débito automático.');
  if (await systemPrisma.cuotaPago.findUnique({ where: { lockKey: lockKeyFor(tenantId, userId) } })) {
    throw new MemberPaymentError(409, 'PAGO_EN_CURSO', 'Tenés un pago en curso. Terminalo antes de adherirte al débito automático.');
  }
  const existing = await systemPrisma.debitoAutomatico.findUnique({ where: { activeKey: activeKeyFor(tenantId, userId) } });
  if (existing) {
    if (existing.status === 'PENDIENTE' && existing.initPoint) return { ...publicDebit(existing), initPoint: existing.initPoint, resumed: true };
    throw new MemberPaymentError(409, 'DEBITO_ACTIVO', 'Ya tenés un débito automático.');
  }

  return withTenantToken(tenantId, async ({ accessToken }) => {
    const [tenant, timezone] = await Promise.all([
      systemPrisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } }),
      tenantTimezone(tenantId),
    ]);
    const startDate = await firstDebitDate(tenantId, { ...user, plan: user.plan! }, feeToday(timezone));
    const externalReference = crypto.randomUUID();
    let debit: DebitoAutomatico;
    try {
      debit = await systemPrisma.debitoAutomatico.create({ data: {
        tenantId, ID_Usuario: userId, ID_Plan: user.ID_Plan, externalReference,
        activeKey: activeKeyFor(tenantId, userId), status: 'PENDIENTE', payerEmail,
        amount: Number(user.plan!.precio), ...frequency, startDate,
      } });
    } catch (error) {
      if (isUniqueError(error)) throw new MemberPaymentError(409, 'DEBITO_ACTIVO', 'Ya tenés un débito automático.');
      throw error;
    }
    try {
      const preapproval = await createPreapproval(accessToken, {
        reason: `${tenant.name} · ${user.plan!.nombre}`.slice(0, 250),
        external_reference: externalReference,
        payer_email: payerEmail,
        auto_recurring: {
          frequency: frequency.frequency, frequency_type: frequency.frequencyType,
          start_date: mpStartDate(startDate), transaction_amount: Number(user.plan!.precio), currency_id: 'ARS',
        },
        back_url: `${frontendUrl()}/alumno/cuotas?debito=${externalReference}`,
        status: 'pending',
      });
      if (!preapproval.initPoint) throw new MercadoPagoError(502, 'MP_BAD_PREAPPROVAL');
      debit = await systemPrisma.debitoAutomatico.update({ where: { id: debit.id }, data: {
        preapprovalId: preapproval.id, initPoint: preapproval.initPoint, nextChargeDate: preapproval.nextPaymentDate,
      } });
    } catch (error) {
      await systemPrisma.debitoAutomatico.delete({ where: { id: debit.id } });
      if (error instanceof MercadoPagoError && error.code === 'MP_BAD_REQUEST') {
        throw new MemberPaymentError(400, 'DEBITO_RECHAZADO',
          'Mercado Pago no aceptó el débito. Revisá que el email sea el de tu cuenta de Mercado Pago.');
      }
      throw error;
    }
    return { ...publicDebit(debit), initPoint: debit.initPoint, resumed: false };
  });
}

// --- Sincronización con Mercado Pago ---

export async function syncDebit(debit: DebitoAutomatico, account: MercadoPagoAccount, accessToken: string) {
  if (!debit.preapprovalId) return debit;
  const preapproval = await getPreapproval(accessToken, debit.preapprovalId);
  if (preapproval.externalReference !== debit.externalReference
    || (preapproval.collectorId && preapproval.collectorId !== account.mpUserId)) {
    console.error('[mercadopago] la suscripción no coincide con el débito', debit.id);
    return debit;
  }
  const status = mapPreapprovalStatus(preapproval.status, debit);
  const cancelled = status === 'CANCELADO' && debit.status !== 'CANCELADO';
  return systemPrisma.debitoAutomatico.update({ where: { id: debit.id }, data: {
    status,
    nextChargeDate: preapproval.nextPaymentDate,
    initPoint: preapproval.initPoint ?? debit.initPoint,
    ...(cancelled ? {
      activeKey: null, cancelledAt: new Date(), cancelledBy: 'Mercado Pago',
      cancelReason: 'Se dio de baja desde Mercado Pago.',
    } : {}),
  } });
}

// --- Cada cobro ---

async function findDebitCuota(debit: DebitoAutomatico, chargeDay: Date) {
  return systemPrisma.cuota.findFirst({
    where: {
      tenantId: debit.tenantId, ID_Usuario: debit.ID_Usuario, pagada: false,
      fechaInicio: { gte: debit.startDate, lte: new Date(chargeDay.getTime() + 3 * DAY_MS) },
    },
    orderBy: { fechaInicio: 'asc' },
  });
}

async function generateMissingFee(debit: DebitoAutomatico) {
  const tenant = await systemPrisma.tenant.findUniqueOrThrow({ where: { id: debit.tenantId } });
  await runWithTenantContext({
    tenantId: tenant.id, user: null, db: prisma, source: 'JOB',
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug, status: tenant.status },
  }, () => generateDueFeesForUser(debit.ID_Usuario));
}

export async function applyDebitPayment(
  debit: DebitoAutomatico, account: MercadoPagoAccount, payment: MercadoPagoPayment, debitDate: Date | null,
): Promise<string> {
  if (await systemPrisma.cuotaPago.findUnique({ where: { mpPaymentId: payment.id } })) {
    return applyPaymentUpdate(debit.tenantId, account, payment);
  }
  if (payment.collectorId !== account.mpUserId || payment.currency !== 'ARS') {
    console.error('[mercadopago] cobro del débito de otra cuenta o moneda', debit.id, payment.id);
    return 'IGNORADO';
  }
  if (payment.status === 'rejected' || payment.status === 'cancelled') {
    await systemPrisma.debitoAutomatico.update({ where: { id: debit.id }, data: {
      ...(debit.status === 'ACTIVO' ? { status: 'CON_RECHAZO' } : {}),
      lastChargeStatus: 'rejected', lastChargeAt: new Date(),
    } });
    return 'RECHAZADO';
  }
  if (payment.status !== 'approved') {
    await systemPrisma.debitoAutomatico.update({ where: { id: debit.id }, data: { lastChargeStatus: payment.status.slice(0, 40) } });
    return 'SIN_CAMBIOS';
  }

  const timezone = await tenantTimezone(debit.tenantId);
  const chargeDay = feeToday(timezone, debitDate ?? payment.dateApproved ?? new Date());
  let cuota = await findDebitCuota(debit, chargeDay);
  if (!cuota) {
    await generateMissingFee(debit);
    cuota = await findDebitCuota(debit, chargeDay);
  }
  const externalReference = `deb-${payment.id}`;
  const chargeData = {
    tenantId: debit.tenantId, ID_Usuario: debit.ID_Usuario, origen: 'DEBITO', debitoId: debit.id,
    externalReference, amount: payment.amount, recargo: 0,
  };
  let result: string;
  if (cuota) {
    let row = await systemPrisma.cuotaPago.findUnique({ where: { externalReference } });
    if (!row) {
      const mismatch = Math.abs(payment.amount - cuota.importe) > 0.01
        ? `Mercado Pago cobró $${payment.amount} y la cuota es de $${cuota.importe}. Se registró como pagada: revisá el importe.`
        : null;
      try {
        row = await systemPrisma.cuotaPago.create({ data: { ...chargeData, ID_Cuota: cuota.ID_Cuota, status: 'PENDIENTE', reviewNote: mismatch } });
      } catch (error) {
        if (!isUniqueError(error)) throw error;
        row = await systemPrisma.cuotaPago.findUniqueOrThrow({ where: { externalReference } });
      }
    }
    result = await markApproved(row, payment, MP_DEBIT_LABEL);
  } else {
    // No hay una cuota impaga para ese período. Si ya estaba pagada, es un cobro de más; si no existe,
    // el admin tiene que revisar el ciclo del socio. En los dos casos el cobro queda registrado y avisado.
    const window = { gte: debit.startDate, lte: new Date(chargeDay.getTime() + 3 * DAY_MS) };
    const paid = await systemPrisma.cuota.findFirst({
      where: { tenantId: debit.tenantId, ID_Usuario: debit.ID_Usuario, pagada: true, fechaInicio: window },
      orderBy: { fechaInicio: 'asc' },
    });
    const target = paid ?? await systemPrisma.cuota.findFirst({
      where: { tenantId: debit.tenantId, ID_Usuario: debit.ID_Usuario },
      orderBy: [{ fechaInicio: 'desc' }, { ID_Cuota: 'desc' }],
    });
    if (!target) {
      console.error('[mercadopago] cobro del débito sin cuotas del socio', debit.id, payment.id);
      return 'IGNORADO';
    }
    try {
      await systemPrisma.cuotaPago.create({ data: {
        ...chargeData, ID_Cuota: target.ID_Cuota, status: paid ? 'DUPLICADO' : 'REVISAR', ...paymentFields(payment),
        reviewNote: paid
          ? 'Mercado Pago cobró el débito de un período que ya estaba pagado. Validalo y devolvelo desde Mercado Pago si corresponde.'
          : 'Mercado Pago cobró el débito, pero no encontramos la cuota de ese período. Revisá el ciclo de cuotas del socio.',
      } });
    } catch (error) {
      if (!isUniqueError(error)) throw error;
    }
    result = paid ? 'DUPLICADO' : 'REVISAR';
  }
  await systemPrisma.debitoAutomatico.update({ where: { id: debit.id }, data: {
    ...(debit.status === 'CON_RECHAZO' ? { status: 'ACTIVO' } : {}),
    lastChargeStatus: 'approved', lastChargeAt: new Date(),
  } });
  return result;
}

// Aviso de un cobro de la suscripción (authorized_payment).
export async function applyAuthorizedPayment(
  tenantId: number, account: MercadoPagoAccount, accessToken: string, authorizedPaymentId: string,
): Promise<string> {
  const authorized = await getAuthorizedPayment(accessToken, authorizedPaymentId);
  if (!authorized.preapprovalId) return 'IGNORADO';
  const debit = await systemPrisma.debitoAutomatico.findUnique({ where: { preapprovalId: authorized.preapprovalId } });
  if (!debit || debit.tenantId !== tenantId) return 'IGNORADO';
  if (!authorized.paymentId) {
    if (authorized.status === 'recycling') {
      await systemPrisma.debitoAutomatico.update({ where: { id: debit.id }, data: {
        ...(debit.status === 'ACTIVO' ? { status: 'CON_RECHAZO' } : {}), lastChargeStatus: 'rejected', lastChargeAt: new Date(),
      } });
      return 'RECHAZADO';
    }
    return 'SIN_CAMBIOS';
  }
  const payment = await getPayment(accessToken, authorized.paymentId);
  return applyDebitPayment(debit, account, payment, authorized.debitDate);
}

// Pago de un débito avisado como "payment": se identifica por la referencia de la suscripción.
export async function applyDebitPaymentByReference(tenantId: number, account: MercadoPagoAccount, payment: MercadoPagoPayment) {
  if (!payment.externalReference) return 'IGNORADO';
  const debit = await systemPrisma.debitoAutomatico.findUnique({ where: { externalReference: payment.externalReference } });
  if (!debit || debit.tenantId !== tenantId) return 'IGNORADO';
  return applyDebitPayment(debit, account, payment, null);
}

// --- Conciliación de cobros ---

const RECONCILED_STATUSES = ['approved', 'refunded', 'charged_back'];
const byCreation = (a: MercadoPagoPayment, b: MercadoPagoPayment) =>
  (a.dateCreated?.getTime() ?? 0) - (b.dateCreated?.getTime() ?? 0);

// Red de seguridad por si se pierde el aviso de un cobro: Mercado Pago cobró, la plata está en la
// cuenta del gimnasio, pero Gymhour nunca se enteró y la cuota sigue impaga. Se buscan los pagos por
// la referencia del débito (una operación de la lista cerrada) y se registran los que falten. Es
// idempotente: un cobro ya registrado no se vuelve a aplicar, y sí se reflejan sus devoluciones.
export async function reconcileDebitCharges(
  debit: DebitoAutomatico, account: MercadoPagoAccount, accessToken: string,
): Promise<number> {
  const payments = (await searchPaymentsByReference(accessToken, debit.externalReference))
    .filter(payment => RECONCILED_STATUSES.includes(payment.status))
    .sort(byCreation);
  let registered = 0;
  for (const payment of payments) {
    if (await systemPrisma.cuotaPago.findUnique({ where: { mpPaymentId: payment.id } })) {
      await applyPaymentUpdate(debit.tenantId, account, payment);
      continue;
    }
    if (payment.status !== 'approved') continue;
    const current = await systemPrisma.debitoAutomatico.findUniqueOrThrow({ where: { id: debit.id } });
    const result = await applyDebitPayment(current, account, payment, null);
    if (['APLICADO', 'DUPLICADO', 'REVISAR'].includes(result)) registered += 1;
  }
  return registered;
}

// Verificación de un débito a pedido (socio o admin): actualiza su estado y registra los cobros que falten.
export async function verifyDebit(debit: DebitoAutomatico) {
  return withTenantToken(debit.tenantId, async ({ account, accessToken }) => {
    const synced = await syncDebit(debit, account, accessToken);
    const registered = await reconcileDebitCharges(synced, account, accessToken);
    const fresh = await systemPrisma.debitoAutomatico.findUniqueOrThrow({ where: { id: debit.id } });
    return { ...publicDebit(fresh), cobrosRegistrados: registered };
  });
}

// Tarea diaria: concilia todos los débitos que pueden tener cobros. Los que vencieron o tuvieron un
// rechazo también se sincronizan, para actualizar la fecha del próximo cobro y el estado.
export async function reconcileActiveDebits(tenantId: number): Promise<number> {
  const debits = await systemPrisma.debitoAutomatico.findMany({ where: {
    tenantId, activeKey: { not: null }, preapprovalId: { not: null }, status: { in: ['ACTIVO', 'CON_RECHAZO'] },
  } });
  if (!debits.length) return 0;
  const now = Date.now();
  return withTenantToken(tenantId, async ({ account, accessToken }) => {
    let registered = 0;
    for (const debit of debits) {
      try {
        const due = debit.status === 'CON_RECHAZO' || !debit.nextChargeDate || debit.nextChargeDate.getTime() <= now;
        const current = due ? await syncDebit(debit, account, accessToken) : debit;
        registered += await reconcileDebitCharges(current, account, accessToken);
      } catch (error) {
        // Un token inválido corta todo el gimnasio; cualquier otro error corta solo ese débito.
        if (error instanceof MercadoPagoError && error.code === 'MP_UNAUTHORIZED') throw error;
        console.error('[mercadopago] no se pudo conciliar el débito', debit.id, (error as Error).message);
      }
    }
    return registered;
  });
}

// --- Baja y cambios ---

export async function cancelDebit(debit: DebitoAutomatico, input: { by: string; reason: string }) {
  if (debit.status === 'CANCELADO') return debit;
  if (debit.preapprovalId) {
    const preapprovalId = debit.preapprovalId;
    await withTenantToken(debit.tenantId, async ({ accessToken }) => {
      let status: string;
      try {
        status = (await cancelPreapproval(accessToken, preapprovalId)).status;
      } catch (error) {
        if (error instanceof MercadoPagoError && error.code === 'MP_NOT_FOUND') return;
        if (!(error instanceof MercadoPagoError && error.code === 'MP_BAD_REQUEST')) throw error;
        // Si ya estaba cancelada, Mercado Pago no deja modificarla: se confirma consultándola.
        status = (await getPreapproval(accessToken, preapprovalId)).status;
      }
      // Recién con la suscripción cancelada en Mercado Pago se habilita pagar de otra forma.
      if (!['cancelled', 'finished'].includes(status)) {
        throw new MemberPaymentError(502, 'DEBITO_NO_CANCELADO', 'Mercado Pago no confirmó la baja del débito. Probá de nuevo en unos minutos.');
      }
    });
  }
  return systemPrisma.debitoAutomatico.update({ where: { id: debit.id }, data: {
    status: 'CANCELADO', activeKey: null, cancelledAt: new Date(),
    cancelledBy: input.by.slice(0, 191), cancelReason: input.reason.slice(0, 255),
  } });
}

export async function cancelDebitForUser(tenantId: number, userId: number, input: { by: string; reason: string }) {
  const debit = await systemPrisma.debitoAutomatico.findUnique({ where: { activeKey: activeKeyFor(tenantId, userId) } });
  return debit ? cancelDebit(debit, input) : null;
}

// Desconexión o eliminación del gimnasio. Si alguna baja falla, se informa y no se sigue.
export async function cancelAllDebits(tenantId: number, input: { by: string; reason: string }) {
  const debits = await systemPrisma.debitoAutomatico.findMany({ where: { tenantId, activeKey: { not: null } } });
  for (const debit of debits) await cancelDebit(debit, input);
  return debits.length;
}

// El admin cambió el precio o la duración de un plan: se actualiza el monto de los débitos activos
// de ese plan, o se cancelan si cambió la frecuencia o el plan pasó a no tener costo.
export async function syncDebitsWithPlan(tenantId: number, plan: { ID_Plan: number; precio: number; duracion: string }) {
  const debits = await systemPrisma.debitoAutomatico.findMany({ where: { tenantId, ID_Plan: plan.ID_Plan, activeKey: { not: null } } });
  if (!debits.length) return { updated: 0, cancelled: 0, failed: 0 };
  const frequency = debitFrequency(plan.duracion);
  const result = { updated: 0, cancelled: 0, failed: 0 };
  for (const debit of debits) {
    try {
      if (!(plan.precio > 0) || !frequency
        || frequency.frequency !== debit.frequency || frequency.frequencyType !== debit.frequencyType) {
        await cancelDebit(debit, { by: 'Gymhour', reason: 'Cambió el plan: volvé a adherirte al débito automático.' });
        result.cancelled += 1;
      } else if (plan.precio !== debit.amount && debit.preapprovalId) {
        const preapprovalId = debit.preapprovalId;
        await withTenantToken(tenantId, ({ accessToken }) => updatePreapprovalAmount(accessToken, preapprovalId, plan.precio));
        await systemPrisma.debitoAutomatico.update({ where: { id: debit.id }, data: { amount: plan.precio } });
        result.updated += 1;
      }
    } catch (error) {
      result.failed += 1;
      console.error('[mercadopago] no se pudo ajustar el débito al plan', debit.id, (error as Error).message);
    }
  }
  return result;
}

export async function onUserPlanChange(
  tenantId: number, userId: number, plan: { ID_Plan: number; precio: number; duracion: string } | null,
) {
  const debit = await systemPrisma.debitoAutomatico.findUnique({ where: { activeKey: activeKeyFor(tenantId, userId) } });
  if (!debit || debit.ID_Plan === plan?.ID_Plan) return null;
  const frequency = plan ? debitFrequency(plan.duracion) : null;
  if (!plan || !(plan.precio > 0) || !frequency
    || frequency.frequency !== debit.frequency || frequency.frequencyType !== debit.frequencyType) {
    return cancelDebit(debit, { by: 'Gymhour', reason: 'Cambió el plan: volvé a adherirte al débito automático.' });
  }
  if (debit.preapprovalId && plan.precio !== debit.amount) {
    const preapprovalId = debit.preapprovalId;
    await withTenantToken(tenantId, ({ accessToken }) => updatePreapprovalAmount(accessToken, preapprovalId, plan.precio));
  }
  return systemPrisma.debitoAutomatico.update({ where: { id: debit.id }, data: { ID_Plan: plan.ID_Plan, amount: plan.precio } });
}

// --- Pantallas ---

export async function debitStateForUser(tenantId: number, userId: number) {
  const debit = await systemPrisma.debitoAutomatico.findFirst({
    where: { tenantId, ID_Usuario: userId }, orderBy: { createdAt: 'desc' },
  });
  if (!debit) return null;
  return {
    ...publicDebit(debit),
    // Para autorizar (pendiente) o para cambiar la tarjeta (activo o con rechazo).
    initPoint: DEBIT_COVERING_STATUSES.includes(debit.status) ? debit.initPoint : null,
  };
}

// El socio verifica su débito: estado de la autorización y cobros que todavía no figuren en Gymhour.
export async function verifyMyDebit(tenantId: number, userId: number) {
  const debit = await systemPrisma.debitoAutomatico.findUnique({ where: { activeKey: activeKeyFor(tenantId, userId) } });
  if (!debit) return debitStateForUser(tenantId, userId);
  const { cobrosRegistrados } = await verifyDebit(debit);
  return { ...(await debitStateForUser(tenantId, userId)), cobrosRegistrados };
}

export async function listDebits(tenantId: number) {
  const debits = await systemPrisma.debitoAutomatico.findMany({
    where: { tenantId, activeKey: { not: null } }, orderBy: { createdAt: 'desc' },
  });
  return debits.map(debit => ({ ...publicDebit(debit), ID_Usuario: debit.ID_Usuario }));
}

// Débitos que quedaron sin autorizar: se consultan y, si siguen pendientes, se dan de baja.
export async function expireStaleDebits(tenantId: number) {
  const stale = await systemPrisma.debitoAutomatico.findMany({ where: {
    tenantId, status: 'PENDIENTE', activeKey: { not: null }, createdAt: { lt: new Date(Date.now() - PENDING_DEBIT_TTL_MS) },
  } });
  let cancelled = 0;
  for (const debit of stale) {
    const synced = await withTenantToken(tenantId, ({ account, accessToken }) => syncDebit(debit, account, accessToken));
    if (synced.status === 'PENDIENTE') {
      await cancelDebit(synced, { by: 'Gymhour', reason: 'No se autorizó en Mercado Pago dentro de las 48 horas.' });
      cancelled += 1;
    }
  }
  return cancelled;
}
