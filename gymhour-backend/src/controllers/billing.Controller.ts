import type { Request, Response } from 'express';
import { systemPrisma } from '../models/Prisma.js';
import { BILLING_CATALOG, BILLING_TIERS, billingOfferForActiveStudentCount, paidUntilFromPurchase } from '../services/billingCatalog.service.js';
import { fetchRebillPayment, fetchRebillSubscription, findOrCreateRebillPlan, findRebillPaymentIdByMetadata, rebillSubscriptionMatchesOrder, validRebillSignature } from '../services/rebill.service.js';
import { tenantBillingTier } from '../services/tenantBilling.service.js';
import { tenantPlanAccess } from '../services/planAccess.service.js';
import { cardGraceUntil } from '../services/billing.service.js';
import { activateCardOrder, cardPaymentMatchesOrder } from '../services/cardOrder.service.js';
import { notifyPaymentFailed, notifyPurchaseConfirmed, notifyRenewal, notifySubscriptionPaused } from '../services/billingNotifications.service.js';
import { cancelTenantSubscriptions, collectAfterCardUpdate, liveSubscriptionOrders } from '../services/tenantSubscription.service.js';
import { confirmPaidPlanChangePayment } from './billingChange.Controller.js';

const findPlan = (code: unknown) => BILLING_CATALOG.find(plan => plan.code === code);
const latestOrder = (tenantId: number) => systemPrisma.tenantBillingOrder.findFirst({
  where: { tenantId }, orderBy: { createdAt: 'desc' },
});

export async function catalog(req: Request, res: Response): Promise<void> {
  const { activeStudents } = await tenantBillingTier(req.user!.tenantId);
  const offer = billingOfferForActiveStudentCount(activeStudents);
  const tenant = await systemPrisma.tenant.findUniqueOrThrow({ where: { id: req.user!.tenantId } });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ activeStudents, offer, tiers: BILLING_TIERS, plans: offer.kind === 'SELF_SERVICE'
    ? BILLING_CATALOG.filter(plan => activeStudents <= plan.maxUsers).map(plan => ({
      ...plan, cardAvailable: Boolean(process.env.REBILL_PUBLIC_KEY && process.env.REBILL_SECRET_KEY),
      transferAvailable: Boolean(process.env.REBILL_PUBLIC_KEY && process.env.REBILL_SECRET_KEY),
    })) : [],
    rebillPublicKey: process.env.REBILL_PUBLIC_KEY || null,
    billing: await tenantPlanAccess(tenant.id), billingCreditArs: tenant.billingCreditArs,
    order: await latestOrder(tenant.id),
    planChange: await systemPrisma.tenantPlanChange.findFirst({ where: {
      tenantId: tenant.id, periodEnd: { gt: new Date() },
      OR: [
        { status: { in: ['PENDING', 'PAYMENT_CONFIRMED'] } },
        { status: 'FAILED', OR: [{ rebillRefundId: null }, { rebillRefundId: { notIn: ['CANCELLING_DOWNGRADE', 'CANCELLED_DOWNGRADE'] } }] },
      ],
    }, orderBy: { createdAt: 'desc' } }),
  });
}

export async function createOrder(req: Request, res: Response): Promise<void> {
  const plan = findPlan(req.body?.planCode);
  const method = req.body?.method;
  const { activeStudents } = await tenantBillingTier(req.user!.tenantId);
  const offer = billingOfferForActiveStudentCount(activeStudents);
  if (!plan || offer.kind !== 'SELF_SERVICE' || activeStudents > plan.maxUsers
    || !['CARD', 'TRANSFER'].includes(method)) {
    res.status(400).json({ message: 'El plan seleccionado no corresponde a tu gimnasio.' }); return;
  }
  const access = await tenantPlanAccess(req.user!.tenantId);
  if (access.state === 'PAID' && !access.inGrace) {
    res.status(409).json({ message: 'Tu suscripción sigue activa. Elegí el nuevo plan desde Mi suscripción.' }); return;
  }
  if (access.scheduledPlanCode && plan.code !== access.scheduledPlanCode) {
    res.status(409).json({ message: 'Tenés un cambio a Esencial programado. La próxima cuota corresponde a ese plan.' }); return;
  }
  const tenantCredit = await systemPrisma.tenant.findUniqueOrThrow({ where: { id: req.user!.tenantId }, select: { billingCreditArs: true } });
  if (method === 'CARD' && tenantCredit.billingCreditArs > 0) {
    res.status(409).json({ message: 'Tenés saldo a favor de una transferencia. Usalo en la próxima cuota por transferencia antes de activar la tarjeta.' }); return;
  }
  if (method === 'TRANSFER' && (!process.env.REBILL_PUBLIC_KEY || !process.env.REBILL_SECRET_KEY)) {
    res.status(503).json({ message: 'El pago por transferencia todavía no está configurado en Rebill.' }); return;
  }
  if (method === 'CARD' && (!process.env.REBILL_PUBLIC_KEY || !process.env.REBILL_SECRET_KEY)) {
    res.status(503).json({ message: 'El pago con tarjeta todavía no está configurado.' }); return;
  }
  const hasLiveSubscription = (await liveSubscriptionOrders(req.user!.tenantId)).length > 0;
  if (hasLiveSubscription && req.body?.replaceSubscription !== true) {
    res.status(409).json({ code: 'SUBSCRIPTION_RECOVERY_REQUIRED',
      message: 'Este gimnasio tiene una suscripción con tarjeta. Actualizá la tarjeta o confirmá que querés reemplazarla.' });
    return;
  }
  let planId: string | null = null;
  if (method === 'CARD') {
    try { planId = await findOrCreateRebillPlan(plan); }
    catch { res.status(503).json({ message: 'No pudimos preparar la suscripción en Rebill. Intentá de nuevo.' }); return; }
  }
  // Se cancela antes de iniciar el pago nuevo para que no queden dos débitos activos.
  if (hasLiveSubscription) {
    try { await cancelTenantSubscriptions(req.user!.tenantId, 'Reemplazada por una nueva compra', req.user!.email); }
    catch { res.status(503).json({ message: 'No pudimos cancelar la suscripción anterior. Intentá de nuevo.' }); return; }
  }
  const pending = await systemPrisma.tenantBillingOrder.findFirst({ where: {
    tenantId: req.user!.tenantId, status: 'PENDING', method, planCode: plan.code,
    ...(method === 'TRANSFER' ? { rebillPaymentId: null } : {}),
  }, orderBy: { createdAt: 'desc' } });
  const tenant = await systemPrisma.tenant.findUniqueOrThrow({ where: { id: req.user!.tenantId } });
  const creditUsedArs = method === 'TRANSFER' ? Math.min(tenant.billingCreditArs, plan.amountArs - 1) : 0;
  const order = pending ?? await systemPrisma.tenantBillingOrder.create({ data: {
    tenantId: req.user!.tenantId, planCode: plan.code, method,
    amountArs: plan.amountArs - creditUsedArs, creditUsedArs, months: plan.months,
  } });
  res.status(pending ? 200 : 201).json({ order, planId });
}

export async function confirmCard(req: Request, res: Response): Promise<void> {
  const order = await systemPrisma.tenantBillingOrder.findFirst({ where: {
    id: req.params.id, tenantId: req.user!.tenantId, method: 'CARD',
  } });
  if (!order) { res.status(404).json({ message: 'Pago no encontrado.' }); return; }
  const paymentId = String(req.body?.paymentId ?? '');
  const subscriptionId = String(req.body?.subscriptionId ?? '');
  if (!/^(test_)?pay_[\w-]+$/.test(paymentId) || !/^(test_)?sub_[\w-]+$/.test(subscriptionId)) {
    res.status(400).json({ message: 'Identificadores de pago inválidos.' }); return;
  }
  if (order.status === 'PAID' && order.rebillPaymentId === paymentId && order.rebillSubscriptionId === subscriptionId) {
    res.json({ paidUntil: order.paidUntil }); return;
  }
  if (order.status !== 'PENDING') { res.status(409).json({ message: 'Esta solicitud ya fue procesada.' }); return; }
  const [payment, subscription] = await Promise.all([
    fetchRebillPayment(paymentId), fetchRebillSubscription(subscriptionId),
  ]);
  if (payment.id !== paymentId || subscription.id !== subscriptionId
    || !cardPaymentMatchesOrder(order, payment, subscription)
    || payment.customerEmail !== req.user!.email.toLowerCase()) {
    res.status(409).json({ message: 'Rebill no confirmó este pago para el plan y la cuenta seleccionados.' }); return;
  }
  const { activated, paidUntil } = await systemPrisma.$transaction(tx => activateCardOrder(tx, order, payment, subscription));
  if (activated) notifyPurchaseConfirmed(order.tenantId, order.planCode, paidUntil);
  res.json({ paidUntil });
}

export async function confirmTransfer(req: Request, res: Response): Promise<void> {
  const order = await systemPrisma.tenantBillingOrder.findFirst({ where: {
    id: req.params.id, tenantId: req.user!.tenantId, method: 'TRANSFER',
  } });
  if (!order) { res.status(404).json({ message: 'Pago no encontrado.' }); return; }
  let paymentId = String(req.body?.paymentId ?? order.rebillPaymentId ?? '');
  if (!paymentId && order.status === 'PENDING') {
    try { paymentId = await findRebillPaymentIdByMetadata('gymhourOrderId', order.id, req.user!.email.toLowerCase()) ?? ''; }
    catch { res.status(503).json({ message: 'No pudimos consultar Rebill. Intentá de nuevo en unos minutos.' }); return; }
    if (!paymentId) {
      res.status(202).json({ status: 'PENDING', message: 'Todavía no recibimos la transferencia. Si ya la hiciste, puede demorar unos minutos.' });
      return;
    }
  }
  if (!/^(test_)?pay_[\w-]+$/.test(paymentId)) {
    res.status(400).json({ message: 'Identificador de pago inválido.' }); return;
  }
  if (order.status === 'PAID' && order.rebillPaymentId === paymentId) {
    res.json({ paidUntil: order.paidUntil }); return;
  }
  if (order.status !== 'PENDING' || (order.rebillPaymentId && order.rebillPaymentId !== paymentId)) {
    res.status(409).json({ message: 'Esta solicitud ya fue procesada.' }); return;
  }
  const payment = await fetchRebillPayment(paymentId);
  if (payment.id !== paymentId || payment.amount !== order.amountArs || payment.currency !== 'ARS'
    || payment.orderId !== order.id || payment.subscriptionId
    || payment.customerEmail !== req.user!.email.toLowerCase()
    || !Number.isFinite(payment.createdAt.getTime())) {
    res.status(409).json({ message: 'Rebill no confirmó este pago para la cuenta y el período seleccionados.' }); return;
  }
  if (payment.status !== 'approved') {
    await systemPrisma.tenantBillingOrder.updateMany({ where: { id: order.id, status: 'PENDING', rebillPaymentId: null },
      data: { rebillPaymentId: paymentId } });
    res.status(202).json({ status: 'PENDING', message: 'La transferencia sigue pendiente de acreditación en Rebill.' }); return;
  }
  const paidUntil = paidUntilFromPurchase(payment.createdAt, order.months);
  const credited = await systemPrisma.$transaction(async tx => {
    const changed = await tx.tenantBillingOrder.updateMany({ where: { id: order.id, status: 'PENDING' }, data: {
      status: 'PAID', rebillPaymentId: paymentId, currentPeriodStart: payment.createdAt,
      paidAt: payment.createdAt, paidUntil,
    } });
    if (!changed.count) return false;
    await tx.rebillProcessedPayment.create({ data: { paymentId } });
    const tenant = await tx.tenant.updateMany({ where: { id: order.tenantId, billingCreditArs: { gte: order.creditUsedArs } },
      data: { paidUntil, billingExempt: false, billingCreditArs: { decrement: order.creditUsedArs } } });
    if (!tenant.count) throw new Error('BILLING_CREDIT_CHANGED');
    return true;
  });
  if (credited) notifyPurchaseConfirmed(order.tenantId, order.planCode, paidUntil);
  res.json({ paidUntil });
}

// El primer pago con tarjeta se vincula solo si el navegador completa confirm-card.
// Si no, el webhook lo guarda para que el backoffice lo vincule a mano.
async function recordUnlinkedPayment(paymentId: string, subscriptionId: string): Promise<void> {
  const payment = await fetchRebillPayment(paymentId);
  if (payment.status !== 'approved' || (payment.subscriptionId && payment.subscriptionId !== subscriptionId)
    || !Number.isFinite(payment.createdAt.getTime())) return;
  await systemPrisma.rebillUnlinkedPayment.upsert({ where: { paymentId: payment.id }, update: {}, create: {
    paymentId: payment.id, subscriptionId, customerEmail: payment.customerEmail,
    amountArs: payment.amount, currency: payment.currency.slice(0, 10), paidAt: payment.createdAt,
  } });
}

export async function rebillWebhook(req: Request & { rawBody?: Buffer }, res: Response): Promise<void> {
  if (!validRebillSignature(req.rawBody, req.headers['x-rebill-signature'])) {
    res.status(401).end(); return;
  }
  const event = req.body?.webhook?.event;
  const logId = req.body?.webhook?.logId;
  if (typeof logId !== 'string' || logId.length > 100 || typeof event !== 'string') {
    res.status(400).end(); return;
  }
  if (await systemPrisma.rebillWebhookEvent.findUnique({ where: { logId } })) { res.status(204).end(); return; }
  const subscriptionId = req.body?.data?.subscriptionId;
  const paymentId = req.body?.data?.payment?.id ?? req.body?.data?.id;
  if (event === 'subscription.updated' && typeof req.body?.data?.id === 'string') {
    const order = await systemPrisma.tenantBillingOrder.findUnique({ where: { rebillSubscriptionId: req.body.data.id } });
    // Un cambio de tarjeta no cambia el estado. Si este cobro falla, responde 500 y Rebill reintenta.
    if (req.body.data.cardUpdated === true) {
      if (order) await collectAfterCardUpdate(order);
      await systemPrisma.rebillWebhookEvent.create({ data: { logId, event } });
      res.status(204).end(); return;
    }
    const status = String(req.body.data.status ?? '').slice(0, 40);
    const processed = await systemPrisma.$transaction(async tx => {
      if (await tx.rebillWebhookEvent.findUnique({ where: { logId } })) return false;
      await tx.tenantBillingOrder.updateMany({ where: { rebillSubscriptionId: req.body.data.id },
        data: { rebillSubscriptionStatus: status } });
      if (order && ['paused', 'cancelled', 'finished'].includes(status)) {
        await tx.tenant.update({ where: { id: order.tenantId }, data: { billingGraceUntil: null } });
      }
      await tx.rebillWebhookEvent.create({ data: { logId, event } });
      return true;
    });
    // Una pausa que pidió Gymhour al suspender el gimnasio no se avisa como falta de pago.
    if (processed && order && status === 'paused' && order.rebillSubscriptionStatus !== 'paused' && !order.pausedBySuspensionAt) {
      const tenant = await systemPrisma.tenant.findUnique({ where: { id: order.tenantId }, select: { status: true } });
      if (tenant?.status === 'ACTIVE') notifySubscriptionPaused(order.tenantId);
    }
    res.status(204).end(); return;
  }
  if (['payment.created', 'payment.updated'].includes(event) && typeof paymentId === 'string' && !subscriptionId) {
    const payment = await fetchRebillPayment(paymentId);
    if (payment.status === 'approved' && payment.changeId && payment.customerEmail) {
      await confirmPaidPlanChangePayment(payment.changeId, paymentId, payment.customerEmail);
      await systemPrisma.rebillWebhookEvent.create({ data: { logId, event } });
      res.status(204).end(); return;
    }
    if (payment.status === 'approved' && payment.orderId && !payment.subscriptionId) {
      const order = await systemPrisma.tenantBillingOrder.findUnique({ where: { id: payment.orderId } });
      const admin = order && payment.customerEmail ? await systemPrisma.user.findFirst({ where: {
        tenantId: order.tenantId, role: 'ADMIN', email: payment.customerEmail,
      } }) : null;
      if (order?.method === 'TRANSFER' && order.status === 'PENDING' && admin
        && (!order.rebillPaymentId || order.rebillPaymentId === paymentId)
        && payment.id === paymentId && payment.amount === order.amountArs && payment.currency === 'ARS'
        && Number.isFinite(payment.createdAt.getTime())) {
        const paidUntil = paidUntilFromPurchase(payment.createdAt, order.months);
        const credited = await systemPrisma.$transaction(async tx => {
          if (await tx.rebillWebhookEvent.findUnique({ where: { logId } })) return false;
          const changed = await tx.tenantBillingOrder.updateMany({ where: { id: order.id, status: 'PENDING' }, data: {
            status: 'PAID', rebillPaymentId: paymentId, currentPeriodStart: payment.createdAt,
            paidAt: payment.createdAt, paidUntil,
          } });
          if (changed.count) {
            await tx.rebillProcessedPayment.create({ data: { paymentId } });
            const tenant = await tx.tenant.updateMany({ where: { id: order.tenantId, billingCreditArs: { gte: order.creditUsedArs } },
              data: { paidUntil, billingExempt: false, billingCreditArs: { decrement: order.creditUsedArs } } });
            if (!tenant.count) throw new Error('BILLING_CREDIT_CHANGED');
          }
          await tx.rebillWebhookEvent.create({ data: { logId, event } });
          return changed.count > 0;
        });
        if (credited) notifyPurchaseConfirmed(order.tenantId, order.planCode, paidUntil);
        res.status(204).end(); return;
      }
    }
  }
  if (event === 'payment.created' && typeof subscriptionId === 'string' && typeof paymentId === 'string') {
    const order = await systemPrisma.tenantBillingOrder.findUnique({ where: { rebillSubscriptionId: subscriptionId } });
    if (order?.status === 'PAID' && order.rebillPaymentId !== paymentId) {
      const [payment, subscription, scheduled, cancelling] = await Promise.all([
        fetchRebillPayment(paymentId), fetchRebillSubscription(subscriptionId),
        systemPrisma.tenantPlanChange.findFirst({ where: {
          tenantId: order.tenantId, orderId: order.id, status: 'APPLIED', amountArs: 0,
          fromPlanCode: order.planCode, toPlanCode: 'ESSENTIAL_MONTHLY',
        }, orderBy: { createdAt: 'desc' } }),
        systemPrisma.tenantPlanChange.findFirst({ where: { tenantId: order.tenantId, orderId: order.id,
          status: 'FAILED', rebillRefundId: 'CANCELLING_DOWNGRADE' } }),
      ]);
      // Un cobro rechazado no se aprueba después: Rebill reintenta con un pago nuevo.
      // Se avisa una sola vez por período, aunque Rebill reintente varias veces.
      if (payment.status === 'rejected') {
        const notify = Boolean(order.paidUntil) && order.failureNotifiedUntil?.getTime() !== order.paidUntil?.getTime();
        await systemPrisma.$transaction(async tx => {
          if (notify) {
            await tx.tenantBillingOrder.update({ where: { id: order.id }, data: { failureNotifiedUntil: order.paidUntil } });
          }
          await tx.rebillWebhookEvent.create({ data: { logId, event } });
        });
        if (notify) {
          const tenant = await systemPrisma.tenant.findUnique({ where: { id: order.tenantId }, select: { billingGraceUntil: true } });
          notifyPaymentFailed(order.tenantId, tenant?.billingGraceUntil ?? null);
        }
        res.status(204).end(); return;
      }
      if (cancelling) { res.status(503).end(); return; }
      const nextPlan = scheduled ? findPlan(scheduled.toPlanCode) : null;
      // Rebill already has the new recurring plan; Gymhour changes the entitlement with this renewal.
      const expectedOrder = nextPlan ? { ...order, planCode: nextPlan.code,
        amountArs: nextPlan.amountArs, months: nextPlan.months } : order;
      if (payment.id !== paymentId || payment.status !== 'approved' || subscription.id !== subscriptionId
        || (payment.subscriptionId && payment.subscriptionId !== subscriptionId)
        || !rebillSubscriptionMatchesOrder(subscription, expectedOrder)
        || (subscription.orderId && subscription.orderId !== order.id)
        || payment.amount !== expectedOrder.amountArs || payment.currency !== 'ARS'
        || !Number.isFinite(payment.createdAt.getTime())) {
        res.status(409).end(); return;
      }
      const renewedUntil = await systemPrisma.$transaction(async tx => {
        if (await tx.rebillWebhookEvent.findUnique({ where: { logId } })) return null;
        if (await tx.rebillProcessedPayment.findUnique({ where: { paymentId } })) {
          await tx.rebillWebhookEvent.create({ data: { logId, event } }); return null;
        }
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: order.tenantId } });
        if (scheduled && tenant.paidUntil?.getTime() !== scheduled.periodEnd.getTime()) {
          throw new Error('SCHEDULED_DOWNGRADE_PERIOD_CHANGED');
        }
        if (scheduled) {
          const locked = await tx.tenantPlanChange.updateMany({ where: { id: scheduled.id, status: 'APPLIED' },
            data: { appliedAt: scheduled.appliedAt } });
          if (!locked.count) throw new Error('SCHEDULED_DOWNGRADE_CHANGED');
        }
        const start = tenant.paidUntil && tenant.paidUntil > payment.createdAt ? tenant.paidUntil : payment.createdAt;
        const paidUntil = paidUntilFromPurchase(start, expectedOrder.months);
        await tx.tenant.update({ where: { id: order.tenantId }, data: { paidUntil, billingGraceUntil: cardGraceUntil(paidUntil) } });
        await tx.tenantBillingOrder.update({ where: { id: order.id }, data: {
          currentPeriodStart: start, paidUntil, rebillLatestPaymentId: paymentId,
          ...(nextPlan ? { planCode: nextPlan.code, amountArs: nextPlan.amountArs, months: nextPlan.months } : {}),
        } });
        await tx.rebillProcessedPayment.create({ data: { paymentId } });
        await tx.rebillWebhookEvent.create({ data: { logId, event } });
        return paidUntil;
      });
      if (renewedUntil) notifyRenewal(order.tenantId, renewedUntil);
      res.status(204).end(); return;
    }
    // Si falla la consulta a Rebill, responde 500 y Rebill reintenta: el pago no se pierde.
    if (!order) await recordUnlinkedPayment(paymentId, subscriptionId);
  }
  await systemPrisma.rebillWebhookEvent.create({ data: { logId, event } });
  res.status(204).end();
}
