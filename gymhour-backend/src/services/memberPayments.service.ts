import crypto from 'node:crypto';
import type { CuotaPago, MercadoPagoAccount } from '@prisma/client';
import { systemPrisma } from '../models/Prisma.js';
import { feeToday } from './feeDates.service.js';
import { calculateLateFee } from './lateFee.service.js';
import {
  MercadoPagoError, apiPublicUrl, createPreference, frontendUrl, isTestMode, searchPaymentsByReference,
  type MercadoPagoPayment,
} from './mercadoPago.service.js';
import { lockKeyFor, withTenantToken } from './mercadoPagoAccount.service.js';
import { tenantPlanAccess } from './planAccess.service.js';

// Pago de cuotas con Mercado Pago (botón de pago) y registro de cada pago en la cuota.
// Ver MERCADOPAGO.md: "Confirmación de pagos" y "Prevención de pagos duplicados".

export const CHECKOUT_TTL_MS = 10 * 60 * 1000;
export const ACTIVE_ATTEMPT_STATUSES = ['INICIADO', 'PENDIENTE'];
export const ALERT_STATUSES = ['DEVUELTO', 'CONTRACARGO', 'DUPLICADO', 'REVISAR'];
export const DEBIT_COVERING_STATUSES = ['PENDIENTE', 'ACTIVO', 'CON_RECHAZO', 'PAUSADO'];
export const MP_CHECKOUT_LABEL = 'Mercado Pago';
export const MP_DEBIT_LABEL = 'Mercado Pago (débito automático)';
const DEFAULT_TIMEZONE = 'America/Argentina/Cordoba';
const STALE_CHECK_MS = 2 * 60 * 1000;

export class MemberPaymentError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) { super(message); }
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export const isUniqueError = (error: unknown) => (error as { code?: string } | null)?.code === 'P2002';
const hhmm = (date: Date | null) => date
  ? date.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
  : '';
const feeDay = (date: Date | null) => date ? date.toLocaleDateString('es-AR', { timeZone: 'UTC' }) : '';

export async function tenantTimezone(tenantId: number): Promise<string> {
  const settings = await systemPrisma.tenantSettings.findUnique({ where: { tenantId }, select: { timezone: true } });
  return settings?.timezone || DEFAULT_TIMEZONE;
}

// Datos del pago que se guardan en el intento. Los datos de tarjeta nunca llegan a Gymhour.
export const paymentFields = (payment: MercadoPagoPayment) => ({
  mpPaymentId: payment.id,
  mpMerchantOrderId: payment.merchantOrderId,
  mpStatus: payment.status.slice(0, 40),
  mpStatusDetail: payment.statusDetail,
  paymentMethod: payment.paymentMethod,
  netAmount: payment.netAmount,
  payerEmail: payment.payerEmail,
  approvedAt: payment.dateApproved,
  checkedAt: new Date(),
});
const statusFields = (payment: MercadoPagoPayment) => ({
  mpStatus: payment.status.slice(0, 40), mpStatusDetail: payment.statusDetail, checkedAt: new Date(),
});
const byCreation = (a: MercadoPagoPayment, b: MercadoPagoPayment) =>
  (a.dateCreated?.getTime() ?? 0) - (b.dateCreated?.getTime() ?? 0);

export const publicAttempt = (attempt: CuotaPago) => ({
  ref: attempt.externalReference,
  cuotaId: attempt.ID_Cuota,
  status: attempt.status,
  origen: attempt.origen,
  expiresAt: attempt.expiresAt,
  amount: attempt.amount,
  recargo: attempt.recargo,
  mpPaymentId: attempt.mpPaymentId,
  mpStatusDetail: attempt.mpStatusDetail,
  paymentMethod: attempt.paymentMethod,
  approvedAt: attempt.approvedAt,
});

// Débito automático que cubre esa cuota: las cuotas desde su primer período se cobran solo por débito.
export async function coveringDebit(tenantId: number, userId: number, cuota: { fechaInicio: Date | null; vence: Date }) {
  const debit = await systemPrisma.debitoAutomatico.findFirst({
    where: { tenantId, ID_Usuario: userId, activeKey: { not: null }, status: { in: DEBIT_COVERING_STATUSES } },
  });
  if (!debit) return null;
  const start = cuota.fechaInicio ?? cuota.vence;
  return start.getTime() >= debit.startDate.getTime() ? debit : null;
}

// --- Botón de pago ---

export async function startCheckout(input: { tenantId: number; userId: number; cuotaId: number }) {
  const { tenantId, userId, cuotaId } = input;
  const cuota = await systemPrisma.cuota.findFirst({
    where: { tenantId, ID_Cuota: cuotaId, ID_Usuario: userId },
    select: { ID_Cuota: true, importe: true, vence: true, pagada: true, fechaInicio: true, fechaFin: true, mes: true },
  });
  if (!cuota) throw new MemberPaymentError(404, 'CUOTA_NO_ENCONTRADA', 'No encontramos esa cuota.');
  if (cuota.pagada) throw new MemberPaymentError(409, 'CUOTA_PAGADA', 'Esta cuota ya está pagada.');
  if (await coveringDebit(tenantId, userId, cuota)) {
    throw new MemberPaymentError(409, 'CUOTA_CON_DEBITO',
      'Esta cuota se cobra con tu débito automático. Para pagarla de otra forma, primero dá de baja el débito.');
  }

  return withTenantToken(tenantId, async ({ account, accessToken }) => {
    const lockKey = lockKeyFor(tenantId, userId);
    let active = await systemPrisma.cuotaPago.findUnique({ where: { lockKey } });
    if (active?.status === 'INICIADO' && active.expiresAt && active.expiresAt <= new Date()) {
      active = await settleExpiredAttempt(active, account, accessToken);
    }
    if (active?.lockKey) {
      if (active.ID_Cuota === cuotaId && active.status === 'INICIADO' && active.initPoint) {
        return { ...publicAttempt(active), initPoint: active.initPoint, resumed: true };
      }
      throw new MemberPaymentError(409, 'PAGO_EN_CURSO', active.status === 'PENDIENTE'
        ? 'Tenés un pago en revisión en Mercado Pago. Esperá a que se resuelva antes de iniciar otro.'
        : `Tenés un pago en curso. Terminalo o esperá a que venza a las ${hhmm(active.expiresAt)}.`,
      { cuotaId: active.ID_Cuota, expiresAt: active.expiresAt, status: active.status });
    }

    const [settings, tenant] = await Promise.all([
      systemPrisma.tenantSettings.findUnique({ where: { tenantId } }),
      systemPrisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } }),
    ]);
    const lateFee = calculateLateFee(cuota, settings, feeToday(settings?.timezone || DEFAULT_TIMEZONE));
    const amount = round2(cuota.importe + lateFee.monto);
    if (!(amount > 0)) throw new MemberPaymentError(409, 'CUOTA_SIN_IMPORTE', 'Esta cuota no tiene un importe para pagar.');

    const now = new Date();
    const expiresAt = new Date(now.getTime() + CHECKOUT_TTL_MS);
    const externalReference = crypto.randomUUID();
    let attempt: CuotaPago;
    try {
      attempt = await systemPrisma.cuotaPago.create({ data: {
        tenantId, ID_Cuota: cuotaId, ID_Usuario: userId, origen: 'CHECKOUT', status: 'INICIADO',
        externalReference, expiresAt, lockKey, amount, recargo: lateFee.monto,
      } });
    } catch (error) {
      if (isUniqueError(error)) throw new MemberPaymentError(409, 'PAGO_EN_CURSO', 'Tenés un pago en curso. Terminalo antes de iniciar otro.');
      throw error;
    }

    const back = `${frontendUrl()}/alumno/cuotas?pago=${externalReference}`;
    const notificationUrl = `${apiPublicUrl()}/pagos/webhooks/mercadopago?ref=${externalReference}`;
    const period = cuota.fechaInicio && cuota.fechaFin ? `del ${feeDay(cuota.fechaInicio)} al ${feeDay(cuota.fechaFin)}` : cuota.mes;
    try {
      const preference = await createPreference(accessToken, {
        items: [{
          id: `cuota-${cuotaId}`, title: `${tenant.name} · Cuota ${period}`.slice(0, 250),
          quantity: 1, unit_price: amount, currency_id: 'ARS',
        }],
        external_reference: externalReference,
        metadata: { gymhour_tenant_id: tenantId, gymhour_cuota_id: cuotaId, gymhour_user_id: userId },
        // Sin efectivo (tarda días) y en un solo pago.
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }], installments: 1 },
        expires: true,
        expiration_date_from: now.toISOString(),
        expiration_date_to: expiresAt.toISOString(),
        back_urls: { success: back, pending: back, failure: back },
        // Mercado Pago solo acepta volver solo y avisar a direcciones públicas con https.
        ...(back.startsWith('https://') ? { auto_return: 'approved' } : {}),
        ...(notificationUrl.startsWith('https://') ? { notification_url: notificationUrl } : {}),
      });
      attempt = await systemPrisma.cuotaPago.update({ where: { id: attempt.id }, data: {
        preferenceId: preference.id, initPoint: preference.initPoint,
      } });
    } catch (error) {
      await systemPrisma.cuotaPago.update({ where: { id: attempt.id }, data: {
        status: 'EXPIRADO', lockKey: null, mpStatusDetail: 'preference_error',
      } });
      throw error;
    }
    return { ...publicAttempt(attempt), initPoint: attempt.initPoint, resumed: false, lateFee };
  });
}

// --- Aplicación de un pago (webhook, vuelta del socio, verificación y cron) ---

// Registra un pago aprobado en la cuota. Es idempotente: `mpPaymentId` es único y la cuota solo se
// marca si sigue impaga. Si ya estaba pagada, el pago queda como DUPLICADO para que lo revise el admin.
export async function markApproved(attempt: CuotaPago, payment: MercadoPagoPayment, formaPago: string) {
  const timezone = await tenantTimezone(attempt.tenantId);
  const paidOn = feeToday(timezone, payment.dateApproved ?? new Date());
  try {
    return await systemPrisma.$transaction(async tx => {
      const changed = await tx.cuota.updateMany({
        where: { tenantId: attempt.tenantId, ID_Cuota: attempt.ID_Cuota, pagada: false },
        data: {
          pagada: true, vencida: false, fechaPago: paidOn, formaPago,
          recargo: attempt.recargo, referenciaPago: payment.id,
        },
      });
      await tx.cuotaPago.update({ where: { id: attempt.id }, data: {
        ...paymentFields(payment),
        status: changed.count ? 'APROBADO' : 'DUPLICADO',
        lockKey: null,
        reviewNote: changed.count ? attempt.reviewNote : 'La cuota ya estaba pagada cuando se aprobó este pago. Validalo y devolvelo desde Mercado Pago si corresponde.',
        reviewedAt: null,
      } });
      return changed.count ? 'APLICADO' : 'DUPLICADO';
    });
  } catch (error) {
    if (isUniqueError(error)) return 'YA_REGISTRADO';
    throw error;
  }
}

// Segundo pago aprobado para la misma cuota (por ejemplo, el mismo checkout en dos pestañas).
export async function recordDuplicate(attempt: CuotaPago, payment: MercadoPagoPayment, note: string) {
  try {
    await systemPrisma.cuotaPago.create({ data: {
      tenantId: attempt.tenantId, ID_Cuota: attempt.ID_Cuota, ID_Usuario: attempt.ID_Usuario,
      origen: attempt.origen, debitoId: attempt.debitoId, status: 'DUPLICADO',
      externalReference: `${attempt.externalReference}-d${payment.id}`.slice(0, 64),
      amount: payment.amount, recargo: 0, ...paymentFields(payment), reviewNote: note,
    } });
  } catch (error) {
    if (!isUniqueError(error)) throw error;
  }
  return 'DUPLICADO';
}

const paymentMatches = (attempt: CuotaPago, account: MercadoPagoAccount, payment: MercadoPagoPayment) =>
  payment.collectorId === account.mpUserId && payment.currency === 'ARS' && Math.abs(payment.amount - attempt.amount) <= 0.01;

async function markForReview(attempt: CuotaPago, payment: MercadoPagoPayment, note: string) {
  const taken = await systemPrisma.cuotaPago.findUnique({ where: { mpPaymentId: payment.id } });
  await systemPrisma.cuotaPago.update({ where: { id: attempt.id }, data: {
    ...(taken && taken.id !== attempt.id ? statusFields(payment) : paymentFields(payment)),
    status: 'REVISAR', lockKey: null, reviewNote: note, reviewedAt: null,
  } });
  return 'REVISAR';
}

// Devolución o contracargo hechos desde Mercado Pago: la cuota vuelve a impaga y se avisa al admin.
async function revertForRefund(row: CuotaPago, payment: MercadoPagoPayment) {
  const finalStatus = payment.status === 'charged_back' ? 'CONTRACARGO' : 'DEVUELTO';
  if (row.status === 'DUPLICADO') {
    // El admin devolvió el pago de más, como se le indicó: queda resuelto.
    await systemPrisma.cuotaPago.update({ where: { id: row.id }, data: {
      ...statusFields(payment), lockKey: null, reviewNote: 'Devuelto desde Mercado Pago.', reviewedAt: row.reviewedAt ?? new Date(),
    } });
    return 'SIN_CAMBIOS';
  }
  if (row.status === finalStatus) return 'SIN_CAMBIOS';
  await systemPrisma.$transaction(async tx => {
    if (['APROBADO', 'REVISAR'].includes(row.status)) {
      const cuota = await tx.cuota.findFirst({ where: { tenantId: row.tenantId, ID_Cuota: row.ID_Cuota }, select: { vence: true } });
      await tx.cuota.updateMany({
        where: { tenantId: row.tenantId, ID_Cuota: row.ID_Cuota, pagada: true, referenciaPago: payment.id },
        data: {
          pagada: false, fechaPago: null, formaPago: null, recargo: 0, referenciaPago: null,
          vencida: cuota ? cuota.vence.getTime() < Date.now() : false,
        },
      });
    }
    await tx.cuotaPago.update({ where: { id: row.id }, data: {
      ...statusFields(payment), status: finalStatus, lockKey: null, reviewedAt: null,
      reviewNote: finalStatus === 'CONTRACARGO'
        ? 'El socio desconoció el cargo con su tarjeta (contracargo). La cuota volvió a impaga.'
        : 'El pago se devolvió desde Mercado Pago. La cuota volvió a impaga.',
    } });
  });
  return finalStatus;
}

// Cambios de estado de un pago que Gymhour ya tiene registrado (cualquier origen).
async function applyKnownPaymentUpdate(row: CuotaPago, account: MercadoPagoAccount, payment: MercadoPagoPayment) {
  if (payment.status === 'refunded' || payment.status === 'charged_back') return revertForRefund(row, payment);
  if (payment.status === 'approved') {
    if (payment.refundedAmount > 0) {
      if (row.status === 'APROBADO') {
        await systemPrisma.cuotaPago.update({ where: { id: row.id }, data: {
          ...statusFields(payment), status: 'REVISAR', reviewedAt: null,
          reviewNote: `Devolución parcial de $${payment.refundedAmount} desde Mercado Pago. La cuota sigue pagada: revisala.`,
        } });
        return 'REVISAR';
      }
      return 'SIN_CAMBIOS';
    }
    if (row.status === 'APROBADO' || row.status === 'DUPLICADO') {
      await systemPrisma.cuotaPago.update({ where: { id: row.id }, data: statusFields(payment) });
      return 'SIN_CAMBIOS';
    }
    if (!paymentMatches(row, account, payment)) return markForReview(row, payment, 'El pago no coincide con la cuota (monto, moneda o cuenta). No se aplicó.');
    return markApproved(row, payment, row.origen === 'DEBITO' ? MP_DEBIT_LABEL : MP_CHECKOUT_LABEL);
  }
  if (payment.status === 'rejected' || payment.status === 'cancelled') {
    await systemPrisma.cuotaPago.update({ where: { id: row.id }, data: {
      ...statusFields(payment),
      ...(row.status === 'PENDIENTE' ? { status: 'RECHAZADO', lockKey: null } : {}),
    } });
    return 'RECHAZADO';
  }
  await systemPrisma.cuotaPago.update({ where: { id: row.id }, data: statusFields(payment) });
  return 'SIN_CAMBIOS';
}

async function applyCheckoutPayment(attempt: CuotaPago, account: MercadoPagoAccount, payment: MercadoPagoPayment) {
  switch (payment.status) {
    case 'approved':
      if (!paymentMatches(attempt, account, payment)) {
        return markForReview(attempt, payment, 'El pago no coincide con la cuota (monto, moneda o cuenta). No se aplicó.');
      }
      if (attempt.status === 'APROBADO' && attempt.mpPaymentId && attempt.mpPaymentId !== payment.id) {
        return recordDuplicate(attempt, payment, 'Segundo pago aprobado para la misma cuota. Validalo y devolvelo desde Mercado Pago si corresponde.');
      }
      return markApproved(attempt, payment, MP_CHECKOUT_LABEL);
    case 'pending':
    case 'in_process':
    case 'authorized':
      if (!ACTIVE_ATTEMPT_STATUSES.includes(attempt.status)) return 'SIN_CAMBIOS';
      try {
        await systemPrisma.cuotaPago.update({ where: { id: attempt.id }, data: { ...paymentFields(payment), status: 'PENDIENTE' } });
      } catch (error) {
        if (!isUniqueError(error)) throw error;
      }
      return 'PENDIENTE';
    case 'rejected':
    case 'cancelled':
      // El socio puede reintentar con otra tarjeta mientras el checkout no venza.
      await systemPrisma.cuotaPago.update({ where: { id: attempt.id }, data: {
        ...statusFields(payment),
        ...(attempt.status === 'PENDIENTE' ? { status: 'RECHAZADO', lockKey: null } : {}),
      } });
      return 'RECHAZADO';
    case 'refunded':
    case 'charged_back':
      await systemPrisma.cuotaPago.update({ where: { id: attempt.id }, data: {
        ...statusFields(payment),
        ...(ACTIVE_ATTEMPT_STATUSES.includes(attempt.status) ? { status: payment.status === 'charged_back' ? 'CONTRACARGO' : 'DEVUELTO', lockKey: null } : {}),
      } });
      return 'SIN_CAMBIOS';
    default:
      return 'SIN_CAMBIOS';
  }
}

// Punto de entrada para cualquier pago de Mercado Pago consultado con el token del gimnasio.
// Devuelve IGNORADO si el pago no es de un checkout de Gymhour en ese gimnasio.
export async function applyPaymentUpdate(tenantId: number, account: MercadoPagoAccount, payment: MercadoPagoPayment): Promise<string> {
  const known = await systemPrisma.cuotaPago.findUnique({ where: { mpPaymentId: payment.id } });
  if (known) return known.tenantId === tenantId ? applyKnownPaymentUpdate(known, account, payment) : 'IGNORADO';
  if (!payment.externalReference) return 'IGNORADO';
  const attempt = await systemPrisma.cuotaPago.findUnique({ where: { externalReference: payment.externalReference } });
  if (!attempt || attempt.tenantId !== tenantId || attempt.origen !== 'CHECKOUT') return 'IGNORADO';
  return applyCheckoutPayment(attempt, account, payment);
}

// Checkout vencido: antes de liberar el bloqueo se consulta a Mercado Pago si hubo algún pago.
export async function settleExpiredAttempt(attempt: CuotaPago, account: MercadoPagoAccount, accessToken: string) {
  const payments = (await searchPaymentsByReference(accessToken, attempt.externalReference)).sort(byCreation);
  for (const payment of payments) await applyPaymentUpdate(attempt.tenantId, account, payment);
  const fresh = await systemPrisma.cuotaPago.findUnique({ where: { id: attempt.id } });
  if (fresh?.status === 'INICIADO' && fresh.expiresAt && fresh.expiresAt <= new Date()) {
    return systemPrisma.cuotaPago.update({ where: { id: fresh.id }, data: {
      status: payments.some(payment => payment.status === 'rejected') ? 'RECHAZADO' : 'EXPIRADO',
      lockKey: null, checkedAt: new Date(),
    } });
  }
  return fresh;
}

// Vuelta del socio desde Mercado Pago o botón "Verificar". El socio solo puede verificar lo suyo.
export async function verifyAttempt(tenantId: number, reference: string, userId?: number) {
  const attempt = await systemPrisma.cuotaPago.findUnique({ where: { externalReference: reference } });
  if (!attempt || attempt.tenantId !== tenantId || (userId !== undefined && attempt.ID_Usuario !== userId)) {
    throw new MemberPaymentError(404, 'INTENTO_NO_ENCONTRADO', 'No encontramos ese pago.');
  }
  if (!ACTIVE_ATTEMPT_STATUSES.includes(attempt.status)) return publicAttempt(attempt);
  return withTenantToken(tenantId, async ({ account, accessToken }) => {
    const payments = (await searchPaymentsByReference(accessToken, reference)).sort(byCreation);
    for (const payment of payments) await applyPaymentUpdate(tenantId, account, payment);
    let fresh = await systemPrisma.cuotaPago.findUniqueOrThrow({ where: { id: attempt.id } });
    if (fresh.status === 'INICIADO' && fresh.expiresAt && fresh.expiresAt <= new Date()) {
      fresh = (await settleExpiredAttempt(fresh, account, accessToken)) ?? fresh;
    } else if (ACTIVE_ATTEMPT_STATUSES.includes(fresh.status)) {
      fresh = await systemPrisma.cuotaPago.update({ where: { id: fresh.id }, data: { checkedAt: new Date() } });
    }
    return publicAttempt(fresh);
  });
}

// Estado para la pantalla del socio. Si hay un intento sin resolver, lo verifica como mucho cada
// dos minutos (por si el aviso de Mercado Pago no llegó).
export async function memberPaymentState(tenantId: number, userId: number) {
  const [access, account] = await Promise.all([
    tenantPlanAccess(tenantId),
    systemPrisma.mercadoPagoAccount.findUnique({ where: { tenantId } }),
  ]);
  const disponible = Boolean(access.features.MEMBER_PAYMENTS && account?.status === 'CONNECTED' && account.liveMode !== isTestMode());
  let active = await systemPrisma.cuotaPago.findUnique({ where: { lockKey: lockKeyFor(tenantId, userId) } });
  const stale = active && (!active.checkedAt || active.checkedAt.getTime() < Date.now() - STALE_CHECK_MS);
  const needsCheck = active && (active.status === 'PENDIENTE' || (active.expiresAt && active.expiresAt <= new Date()));
  if (active && account?.status === 'CONNECTED' && stale && needsCheck) {
    try {
      await verifyAttempt(tenantId, active.externalReference, userId);
      active = await systemPrisma.cuotaPago.findUnique({ where: { lockKey: lockKeyFor(tenantId, userId) } });
    } catch (error) {
      console.error('[mercadopago] no se pudo verificar el pago en curso', (error as Error).message);
    }
  }
  return {
    disponible,
    intentoActivo: active ? { ...publicAttempt(active), initPoint: active.status === 'INICIADO' ? active.initPoint : null } : null,
  };
}

// --- Bloqueos sobre las acciones manuales del admin ---

export async function onlinePaymentLock(tenantId: number, cuotaId: number): Promise<{ code: string; message: string } | null> {
  let attempt = await systemPrisma.cuotaPago.findFirst({ where: { tenantId, ID_Cuota: cuotaId, lockKey: { not: null } } });
  let unverified = false;
  if (attempt?.status === 'INICIADO' && attempt.expiresAt && attempt.expiresAt <= new Date()) {
    const current = attempt;
    try {
      const settled = await withTenantToken(tenantId, ({ account, accessToken }) => settleExpiredAttempt(current, account, accessToken));
      if (!settled?.lockKey) attempt = null;
    } catch (error) {
      // Si no se puede consultar a Mercado Pago, el bloqueo sigue: es preferible a un cobro doble.
      unverified = true;
      console.error('[mercadopago] no se pudo cerrar el pago vencido', (error as Error).message);
    }
  }
  if (attempt) {
    let message = `El socio está pagando esta cuota con Mercado Pago (vence a las ${hhmm(attempt.expiresAt)}). Esperá a que termine.`;
    if (attempt.status === 'PENDIENTE') {
      message = 'El socio tiene un pago con Mercado Pago en revisión para esta cuota. Esperá a que se resuelva.';
    } else if (unverified) {
      message = 'No pudimos confirmar con Mercado Pago si el socio pagó esta cuota. Si la conexión necesita reconectarse, hacelo en Configuración; si no, probá en unos minutos.';
    }
    return { code: 'PAGO_EN_CURSO', message };
  }
  const cuota = await systemPrisma.cuota.findFirst({
    where: { tenantId, ID_Cuota: cuotaId }, select: { ID_Usuario: true, fechaInicio: true, vence: true, pagada: true },
  });
  if (cuota && !cuota.pagada && await coveringDebit(tenantId, cuota.ID_Usuario, cuota)) {
    return { code: 'CUOTA_CON_DEBITO', message: 'Este socio tiene débito automático: cancelalo para registrar el pago de otra forma.' };
  }
  return null;
}

// --- Datos para las pantallas de cuotas (sin tokens ni links de pago) ---

export async function attachOnlinePayments<T extends { ID_Cuota: number; ID_Usuario: number; pagada: boolean; fechaInicio?: Date | null; vence: Date }>(
  tenantId: number, cuotas: T[],
) {
  if (!cuotas.length) return cuotas.map(cuota => ({ ...cuota, pagoEnLinea: null, cubiertaPorDebito: false }));
  const ids = cuotas.map(cuota => cuota.ID_Cuota);
  const userIds = Array.from(new Set(cuotas.map(cuota => cuota.ID_Usuario)));
  const [rows, debits] = await Promise.all([
    systemPrisma.cuotaPago.findMany({
      where: { tenantId, ID_Cuota: { in: ids }, status: { in: ['INICIADO', 'PENDIENTE', 'APROBADO', ...ALERT_STATUSES] } },
      orderBy: { createdAt: 'desc' },
    }),
    systemPrisma.debitoAutomatico.findMany({
      where: { tenantId, ID_Usuario: { in: userIds }, activeKey: { not: null }, status: { in: DEBIT_COVERING_STATUSES } },
    }),
  ]);
  return cuotas.map(cuota => {
    const row = rows.find(item => item.ID_Cuota === cuota.ID_Cuota && (item.lockKey || item.status !== 'INICIADO'));
    const debit = debits.find(item => item.ID_Usuario === cuota.ID_Usuario);
    const start = cuota.fechaInicio ?? cuota.vence;
    return {
      ...cuota,
      pagoEnLinea: row ? {
        status: row.status, origen: row.origen, expiresAt: row.expiresAt, mpPaymentId: row.mpPaymentId,
        paymentMethod: row.paymentMethod, netAmount: row.netAmount, approvedAt: row.approvedAt,
        alerta: (ALERT_STATUSES.includes(row.status) || Boolean(row.reviewNote)) && !row.reviewedAt,
        reviewNote: row.reviewNote,
      } : null,
      cubiertaPorDebito: Boolean(!cuota.pagada && debit && start.getTime() >= debit.startDate.getTime()),
    };
  });
}

// --- Avisos para el admin ---

export async function listAlerts(tenantId: number) {
  const rows = await systemPrisma.cuotaPago.findMany({
    where: { tenantId, reviewedAt: null, OR: [{ status: { in: ALERT_STATUSES } }, { reviewNote: { not: null }, status: 'APROBADO' }] },
    orderBy: { updatedAt: 'desc' }, take: 100,
  });
  if (!rows.length) return [];
  const [users, cuotas] = await Promise.all([
    systemPrisma.user.findMany({ where: { tenantId, ID_Usuario: { in: rows.map(row => row.ID_Usuario) } }, select: { ID_Usuario: true, nombre: true, apellido: true } }),
    systemPrisma.cuota.findMany({ where: { tenantId, ID_Cuota: { in: rows.map(row => row.ID_Cuota) } }, select: { ID_Cuota: true, fechaInicio: true, fechaFin: true, mes: true, importe: true, pagada: true } }),
  ]);
  return rows.map(row => ({
    id: row.id, status: row.status, origen: row.origen, reviewNote: row.reviewNote,
    mpPaymentId: row.mpPaymentId, amount: row.amount, paymentMethod: row.paymentMethod,
    approvedAt: row.approvedAt, updatedAt: row.updatedAt,
    socio: users.find(user => user.ID_Usuario === row.ID_Usuario) ?? null,
    cuota: cuotas.find(cuota => cuota.ID_Cuota === row.ID_Cuota) ?? null,
  }));
}

export async function markAlertReviewed(tenantId: number, id: string, userId: number) {
  const changed = await systemPrisma.cuotaPago.updateMany({
    where: { id, tenantId, reviewedAt: null }, data: { reviewedAt: new Date(), reviewedByUserId: userId },
  });
  if (!changed.count) throw new MemberPaymentError(404, 'AVISO_NO_ENCONTRADO', 'No encontramos ese aviso.');
}

export { MercadoPagoError };
