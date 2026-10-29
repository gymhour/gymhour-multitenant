import type { Request, Response } from 'express';
import { systemPrisma } from '../models/Prisma.js';
import { BILLING_CATALOG, BILLING_TIERS, billingOfferForActiveStudentCount, paidUntilFromPurchase } from '../services/billingCatalog.service.js';
import { getBillingAccess } from '../services/billing.service.js';
import { fetchRebillPayment, fetchRebillSubscription, findOrCreateRebillPlan, rebillSubscriptionMatchesOrder, validRebillSignature } from '../services/rebill.service.js';
import { tenantBillingTier } from '../services/tenantBilling.service.js';

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
    ? BILLING_CATALOG.filter(plan => plan.tierCode === offer.tier.code).map(plan => ({
      ...plan, cardAvailable: Boolean(process.env.REBILL_PUBLIC_KEY && process.env.REBILL_SECRET_KEY),
      transferAvailable: Boolean(process.env.REBILL_PUBLIC_KEY && process.env.REBILL_SECRET_KEY),
    })) : [],
    rebillPublicKey: process.env.REBILL_PUBLIC_KEY || null,
    billing: getBillingAccess(tenant), order: await latestOrder(tenant.id),
  });
}

export async function createOrder(req: Request, res: Response): Promise<void> {
  const plan = findPlan(req.body?.planCode);
  const method = req.body?.method;
  const { activeStudents } = await tenantBillingTier(req.user!.tenantId);
  const offer = billingOfferForActiveStudentCount(activeStudents);
  if (!plan || offer.kind !== 'SELF_SERVICE' || plan.tierCode !== offer.tier.code
    || !['CARD', 'TRANSFER'].includes(method)) {
    res.status(400).json({ message: 'El plan seleccionado no corresponde a tu gimnasio.' }); return;
  }
  if (method === 'TRANSFER' && (!process.env.REBILL_PUBLIC_KEY || !process.env.REBILL_SECRET_KEY)) {
    res.status(503).json({ message: 'El pago por transferencia todavía no está configurado en Rebill.' }); return;
  }
  if (method === 'CARD' && (!process.env.REBILL_PUBLIC_KEY || !process.env.REBILL_SECRET_KEY)) {
    res.status(503).json({ message: 'El pago con tarjeta todavía no está configurado.' }); return;
  }
  const cardOrders = await systemPrisma.tenantBillingOrder.findMany({ where: {
    tenantId: req.user!.tenantId, method: 'CARD', status: 'PAID', rebillSubscriptionId: { not: null },
  } });
  const activeCard = cardOrders.some(item => !['cancelled', 'finished'].includes(item.rebillSubscriptionStatus || 'active'));
  if (activeCard) { res.status(409).json({ message: 'Este gimnasio ya tiene una suscripción automática.' }); return; }
  let planId: string | null = null;
  if (method === 'CARD') {
    try { planId = await findOrCreateRebillPlan(plan); }
    catch { res.status(503).json({ message: 'No pudimos preparar la suscripción en Rebill. Intentá de nuevo.' }); return; }
  }
  const pending = await systemPrisma.tenantBillingOrder.findFirst({ where: {
    tenantId: req.user!.tenantId, status: 'PENDING', method, planCode: plan.code,
    ...(method === 'TRANSFER' ? { rebillPaymentId: null } : {}),
  }, orderBy: { createdAt: 'desc' } });
  const order = pending ?? await systemPrisma.tenantBillingOrder.create({ data: {
    tenantId: req.user!.tenantId, planCode: plan.code, method, amountArs: plan.amountArs, months: plan.months,
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
  if (payment.id !== paymentId || payment.status !== 'approved' || payment.amount !== order.amountArs
    || payment.currency !== 'ARS' || subscription.id !== subscriptionId
    || (payment.subscriptionId && payment.subscriptionId !== subscriptionId)
    || !rebillSubscriptionMatchesOrder(subscription, order)
    || (subscription.orderId && subscription.orderId !== order.id)
    || (payment.orderId && payment.orderId !== order.id)
    || payment.createdAt < order.createdAt
    || (payment.planId && subscription.planId && payment.planId !== subscription.planId)
    || payment.customerEmail !== req.user!.email.toLowerCase()
    || !Number.isFinite(payment.createdAt.getTime())) {
    res.status(409).json({ message: 'Rebill no confirmó este pago para el plan y la cuenta seleccionados.' }); return;
  }
  const paidUntil = paidUntilFromPurchase(payment.createdAt, order.months);
  await systemPrisma.$transaction(async tx => {
    const changed = await tx.tenantBillingOrder.updateMany({ where: { id: order.id, status: 'PENDING' }, data: {
      status: 'PAID', rebillPaymentId: paymentId, rebillSubscriptionId: subscriptionId,
      rebillSubscriptionStatus: subscription.status,
      paidAt: payment.createdAt, paidUntil,
    } });
    if (changed.count) {
      await tx.rebillProcessedPayment.create({ data: { paymentId } });
      await tx.tenant.update({ where: { id: order.tenantId }, data: { paidUntil, billingExempt: false } });
    }
  });
  res.json({ paidUntil });
}

export async function confirmTransfer(req: Request, res: Response): Promise<void> {
  const order = await systemPrisma.tenantBillingOrder.findFirst({ where: {
    id: req.params.id, tenantId: req.user!.tenantId, method: 'TRANSFER',
  } });
  if (!order) { res.status(404).json({ message: 'Pago no encontrado.' }); return; }
  const paymentId = String(req.body?.paymentId ?? order.rebillPaymentId ?? '');
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
  await systemPrisma.$transaction(async tx => {
    const changed = await tx.tenantBillingOrder.updateMany({ where: { id: order.id, status: 'PENDING' }, data: {
      status: 'PAID', rebillPaymentId: paymentId, paidAt: payment.createdAt, paidUntil,
    } });
    if (changed.count) {
      await tx.rebillProcessedPayment.create({ data: { paymentId } });
      await tx.tenant.update({ where: { id: order.tenantId }, data: { paidUntil, billingExempt: false } });
    }
  });
  res.json({ paidUntil });
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
    await systemPrisma.$transaction(async tx => {
      if (await tx.rebillWebhookEvent.findUnique({ where: { logId } })) return;
      await tx.tenantBillingOrder.updateMany({ where: { rebillSubscriptionId: req.body.data.id },
        data: { rebillSubscriptionStatus: String(req.body.data.status ?? '').slice(0, 40) } });
      await tx.rebillWebhookEvent.create({ data: { logId, event } });
    });
    res.status(204).end(); return;
  }
  if (['payment.created', 'payment.updated'].includes(event) && typeof paymentId === 'string' && !subscriptionId) {
    const payment = await fetchRebillPayment(paymentId);
    if (payment.status === 'approved' && payment.orderId && !payment.subscriptionId) {
      const order = await systemPrisma.tenantBillingOrder.findUnique({ where: { id: payment.orderId } });
      const admin = order && payment.customerEmail ? await systemPrisma.user.findFirst({ where: {
        tenantId: order.tenantId, role: 'ADMIN', email: payment.customerEmail,
      } }) : null;
      if (order?.method === 'TRANSFER' && order.status === 'PENDING' && admin
        && (!order.rebillPaymentId || order.rebillPaymentId === paymentId)
        && payment.id === paymentId && payment.amount === order.amountArs && payment.currency === 'ARS'
        && Number.isFinite(payment.createdAt.getTime())) {
        await systemPrisma.$transaction(async tx => {
          if (await tx.rebillWebhookEvent.findUnique({ where: { logId } })) return;
          const paidUntil = paidUntilFromPurchase(payment.createdAt, order.months);
          const changed = await tx.tenantBillingOrder.updateMany({ where: { id: order.id, status: 'PENDING' }, data: {
            status: 'PAID', rebillPaymentId: paymentId, paidAt: payment.createdAt, paidUntil,
          } });
          if (changed.count) {
            await tx.rebillProcessedPayment.create({ data: { paymentId } });
            await tx.tenant.update({ where: { id: order.tenantId }, data: { paidUntil, billingExempt: false } });
          }
          await tx.rebillWebhookEvent.create({ data: { logId, event } });
        });
        res.status(204).end(); return;
      }
    }
  }
  if (event === 'payment.created' && typeof subscriptionId === 'string' && typeof paymentId === 'string') {
    const order = await systemPrisma.tenantBillingOrder.findUnique({ where: { rebillSubscriptionId: subscriptionId } });
    if (order?.status === 'PAID' && order.rebillPaymentId !== paymentId) {
      const [payment, subscription] = await Promise.all([
        fetchRebillPayment(paymentId), fetchRebillSubscription(subscriptionId),
      ]);
      if (payment.id !== paymentId || payment.status !== 'approved' || subscription.id !== subscriptionId
        || (payment.subscriptionId && payment.subscriptionId !== subscriptionId)
        || !rebillSubscriptionMatchesOrder(subscription, order)
        || (subscription.orderId && subscription.orderId !== order.id)
        || payment.amount !== order.amountArs || payment.currency !== 'ARS'
        || !Number.isFinite(payment.createdAt.getTime())) {
        res.status(409).end(); return;
      }
      await systemPrisma.$transaction(async tx => {
        if (await tx.rebillWebhookEvent.findUnique({ where: { logId } })) return;
        if (await tx.rebillProcessedPayment.findUnique({ where: { paymentId } })) {
          await tx.rebillWebhookEvent.create({ data: { logId, event } }); return;
        }
        const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: order.tenantId } });
        const start = tenant.paidUntil && tenant.paidUntil > payment.createdAt ? tenant.paidUntil : payment.createdAt;
        const paidUntil = paidUntilFromPurchase(start, order.months);
        await tx.tenant.update({ where: { id: order.tenantId }, data: { paidUntil } });
        await tx.rebillProcessedPayment.create({ data: { paymentId } });
        await tx.rebillWebhookEvent.create({ data: { logId, event } });
      });
      res.status(204).end(); return;
    }
  }
  await systemPrisma.rebillWebhookEvent.create({ data: { logId, event } });
  res.status(204).end();
}
