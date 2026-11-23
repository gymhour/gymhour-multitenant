import { systemPrisma } from '../models/Prisma.js';
import {
  applyAuthorizedPayment, applyDebitPaymentByReference, syncDebit,
} from './automaticDebit.service.js';
import { MercadoPagoError, getPayment } from './mercadoPago.service.js';
import { queueNotification, withTenantToken } from './mercadoPagoAccount.service.js';
import { applyPaymentUpdate } from './memberPayments.service.js';

// Avisos de Mercado Pago (webhooks). Nunca se confía en el cuerpo del aviso: solo se usa el ID del
// recurso, que se vuelve a consultar en la API con el token del gimnasio, y se aplica únicamente si
// es un checkout o un débito creado por Gymhour en ese gimnasio. Ver MERCADOPAGO.md.

export type NotificationTopic = 'payment' | 'preapproval' | 'authorized_payment';

export function normalizeTopic(value: unknown): NotificationTopic | null {
  const topic = String(value ?? '').trim().toLowerCase();
  if (topic === 'payment') return 'payment';
  if (topic === 'preapproval' || topic === 'subscription_preapproval') return 'preapproval';
  if (topic === 'authorized_payment' || topic === 'subscription_authorized_payment') return 'authorized_payment';
  return null;
}

const tokenUnusable = (error: unknown) => error instanceof MercadoPagoError
  && ['MP_RECONNECT_REQUIRED', 'MP_NOT_CONNECTED'].includes(error.code);

// A qué gimnasios puede pertenecer el aviso. Primero por la referencia de Gymhour (checkout o
// débito); si no viene, por la cuenta de Mercado Pago que figura en el aviso.
async function candidateTenants(input: { reference: string | null; mpUserId: string | null; tenantId?: number }): Promise<number[]> {
  if (input.tenantId) return [input.tenantId];
  if (input.reference) {
    const [attempt, debit] = await Promise.all([
      systemPrisma.cuotaPago.findUnique({ where: { externalReference: input.reference }, select: { tenantId: true } }),
      systemPrisma.debitoAutomatico.findUnique({ where: { externalReference: input.reference }, select: { tenantId: true } }),
    ]);
    const tenantId = attempt?.tenantId ?? debit?.tenantId;
    if (tenantId) return [tenantId];
  }
  if (input.mpUserId && /^\d{1,20}$/.test(input.mpUserId)) {
    const accounts = await systemPrisma.mercadoPagoAccount.findMany({
      where: { mpUserId: input.mpUserId, status: { not: 'DISCONNECTED' } }, select: { tenantId: true },
    });
    return accounts.map(account => account.tenantId);
  }
  return [];
}

async function processForTenant(tenantId: number, topic: NotificationTopic, resourceId: string): Promise<string> {
  try {
    return await withTenantToken(tenantId, async ({ account, accessToken }) => {
      if (topic === 'payment') {
        const payment = await getPayment(accessToken, resourceId);
        const applied = await applyPaymentUpdate(tenantId, account, payment);
        return applied !== 'IGNORADO' ? applied : applyDebitPaymentByReference(tenantId, account, payment);
      }
      if (topic === 'authorized_payment') return applyAuthorizedPayment(tenantId, account, accessToken, resourceId);
      const debit = await systemPrisma.debitoAutomatico.findUnique({ where: { preapprovalId: resourceId } });
      if (!debit || debit.tenantId !== tenantId) return 'IGNORADO';
      await syncDebit(debit, account, accessToken);
      return 'SINCRONIZADO';
    });
  } catch (error) {
    // Sin un token que sirva, el aviso se guarda y se procesa cuando el gimnasio reconecta.
    if (tokenUnusable(error)) {
      await queueNotification(tenantId, topic, resourceId);
      return 'EN_COLA';
    }
    // El recurso no es de esta cuenta: puede ser de otro gimnasio con la misma cuenta.
    if (error instanceof MercadoPagoError && error.code === 'MP_NOT_FOUND') return 'IGNORADO';
    throw error;
  }
}

export async function processMercadoPagoNotification(input: {
  topic: unknown; resourceId: string; reference?: string | null; mpUserId?: string | null; tenantId?: number;
}): Promise<string> {
  const topic = normalizeTopic(input.topic);
  if (!topic || !/^[\w-]{1,64}$/.test(input.resourceId)) return 'IGNORADO';
  if (topic === 'preapproval' && !input.tenantId) {
    const debit = await systemPrisma.debitoAutomatico.findUnique({ where: { preapprovalId: input.resourceId }, select: { tenantId: true } });
    return debit ? processForTenant(debit.tenantId, topic, input.resourceId) : 'IGNORADO';
  }
  const tenants = await candidateTenants({ reference: input.reference ?? null, mpUserId: input.mpUserId ?? null, tenantId: input.tenantId });
  for (const tenantId of tenants) {
    const result = await processForTenant(tenantId, topic, input.resourceId);
    if (result !== 'IGNORADO') return result;
  }
  return 'IGNORADO';
}

// Procesa los avisos que quedaron en cola mientras el token del gimnasio no servía.
export async function processQueuedNotifications(tenantId: number): Promise<number> {
  const pending = await systemPrisma.mercadoPagoPendingNotification.findMany({
    where: { tenantId, processedAt: null }, orderBy: { receivedAt: 'asc' }, take: 200,
  });
  let processed = 0;
  for (const item of pending) {
    try {
      const result = await processMercadoPagoNotification({ topic: item.topic, resourceId: item.resourceId, tenantId });
      if (result === 'EN_COLA') break;
      await systemPrisma.mercadoPagoPendingNotification.update({ where: { id: item.id }, data: { processedAt: new Date() } });
      processed += 1;
    } catch (error) {
      console.error('[mercadopago] aviso en cola sin procesar', item.id, (error as Error).message);
    }
  }
  return processed;
}
