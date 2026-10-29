import type { Request, Response } from 'express';
import { systemPrisma } from '../models/Prisma.js';
import { BILLING_CATALOG, paidUntilFromPurchase } from '../services/billingCatalog.service.js';
import { tenantBillingTier } from '../services/tenantBilling.service.js';
import { tenantPlanAccess } from '../services/planAccess.service.js';
import { planChangeCharge } from '../services/planChange.service.js';
import {
  changeRebillSubscriptionPlan, fetchRebillPayment, fetchRebillSubscription,
  findOrCreateRebillPlan, rebillSubscriptionMatchesOrder,
} from '../services/rebill.service.js';

async function context(tenantId: number, targetCode: unknown) {
  const target = BILLING_CATALOG.find(plan => plan.code === targetCode);
  const [tenant, access, { activeStudents }, order] = await Promise.all([
    systemPrisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    tenantPlanAccess(tenantId), tenantBillingTier(tenantId),
    systemPrisma.tenantBillingOrder.findFirst({ where: { tenantId, status: 'PAID' }, orderBy: { paidAt: 'desc' } }),
  ]);
  if (!target || !order || access.state !== 'PAID' || !['CARD', 'TRANSFER'].includes(order.method)
    || !BILLING_CATALOG.some(plan => plan.code === order.planCode)
    || target.code === order.planCode || activeStudents > target.maxUsers
    || !tenant.paidUntil) {
    throw new Error('PLAN_CHANGE_UNAVAILABLE');
  }
  let periodStart = order.currentPeriodStart;
  if (!periodStart && order.paidAt) {
    for (let cycle = 1; cycle <= 120; cycle += 1) {
      const end = paidUntilFromPurchase(order.paidAt, order.months * cycle);
      if (end.getTime() === tenant.paidUntil.getTime()) {
        periodStart = cycle === 1 ? order.paidAt : paidUntilFromPurchase(order.paidAt, order.months * (cycle - 1));
        break;
      }
      if (end > tenant.paidUntil) break;
    }
  }
  if (!periodStart) throw new Error('PLAN_CHANGE_PERIOD_UNKNOWN');
  if (order.method === 'CARD') {
    if (!order.rebillSubscriptionId) throw new Error('SUBSCRIPTION_MISSING');
    const subscription = await fetchRebillSubscription(order.rebillSubscriptionId);
    if (subscription.status !== 'active' || !rebillSubscriptionMatchesOrder(subscription, order)
      || (subscription.orderId && subscription.orderId !== order.id)) {
      throw new Error('SUBSCRIPTION_NOT_VERIFIED');
    }
  }
  const amountArs = planChangeCharge(order.planCode, target.code, periodStart, tenant.paidUntil);
  return { target, tenant, order, periodStart, periodEnd: tenant.paidUntil, amountArs };
}

export async function quotePlanChange(req: Request, res: Response): Promise<void> {
  try {
    const value = await context(req.user!.tenantId, req.query.planCode);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ fromPlanCode: value.order.planCode, toPlanCode: value.target.code,
      amountArs: value.amountArs, periodEnd: value.periodEnd,
      adjustment: value.amountArs > 0 ? 'CHARGE' : 'SCHEDULED', method: value.order.method,
      nextAmountArs: value.target.amountArs });
  } catch {
    res.status(409).json({ message: 'No podemos calcular el cambio de plan para este período. Contactanos para revisarlo.' });
  }
}

export async function applyChange(changeId: string, tenantId: number) {
  const change = await systemPrisma.tenantPlanChange.findFirst({ where: { id: changeId, tenantId } });
  if (!change || change.status !== 'PAYMENT_CONFIRMED' || change.amountArs <= 0) throw new Error('PLAN_CHANGE_NOT_READY');
  const target = BILLING_CATALOG.find(plan => plan.code === change.toPlanCode);
  const [order, tenant] = await Promise.all([
    systemPrisma.tenantBillingOrder.findFirst({ where: { id: change.orderId, tenantId, status: 'PAID' } }),
    systemPrisma.tenant.findUnique({ where: { id: tenantId } }),
  ]);
  if (!target || !order || order.planCode !== change.fromPlanCode
    || tenant?.paidUntil?.getTime() !== change.periodEnd.getTime()) throw new Error('PLAN_CHANGE_STALE');
  if (order.method === 'CARD') {
    if (!order.rebillSubscriptionId) throw new Error('SUBSCRIPTION_MISSING');
    let subscription = await fetchRebillSubscription(order.rebillSubscriptionId);
    if (subscription.status !== 'active') throw new Error('SUBSCRIPTION_NOT_ACTIVE');
    if (!rebillSubscriptionMatchesOrder(subscription, { ...order, planCode: target.code, amountArs: target.amountArs })) {
      if (!rebillSubscriptionMatchesOrder(subscription, order)) throw new Error('SUBSCRIPTION_CHANGED');
      const planId = await findOrCreateRebillPlan(target);
      await changeRebillSubscriptionPlan(order.rebillSubscriptionId, planId);
      subscription = await fetchRebillSubscription(order.rebillSubscriptionId);
      if (subscription.status !== 'active'
        || !rebillSubscriptionMatchesOrder(subscription, { ...order, planCode: target.code, amountArs: target.amountArs })) {
        throw new Error('SUBSCRIPTION_PLAN_NOT_CONFIRMED');
      }
    }
  }
  await systemPrisma.$transaction(async tx => {
    const changed = await tx.tenantPlanChange.updateMany({ where: { id: change.id, status: 'PAYMENT_CONFIRMED' },
      data: { status: 'APPLIED', appliedAt: new Date() } });
    if (!changed.count) return;
    await tx.tenantBillingOrder.update({ where: { id: order.id }, data: {
      planCode: target.code, amountArs: target.amountArs, months: target.months,
    } });
  });
}

export async function scheduleDowngrade(changeId: string, tenantId: number) {
  const change = await systemPrisma.tenantPlanChange.findFirst({ where: { id: changeId, tenantId } });
  const target = BILLING_CATALOG.find(plan => plan.code === change?.toPlanCode);
  const order = change && await systemPrisma.tenantBillingOrder.findFirst({ where: {
    id: change.orderId, tenantId, status: 'PAID',
  } });
  const [tenant, { activeStudents }] = await Promise.all([
    systemPrisma.tenant.findUnique({ where: { id: tenantId } }), tenantBillingTier(tenantId),
  ]);
  if (!change || !target || !order || !tenant || change.amountArs !== 0
    || change.fromPlanCode !== 'PRO_MONTHLY' || change.toPlanCode !== 'ESSENTIAL_MONTHLY'
    || change.periodEnd.getTime() !== tenant.paidUntil?.getTime()
    || change.periodEnd <= new Date() || order.planCode !== change.fromPlanCode || activeStudents > 100
    || !['PENDING', 'APPLIED'].includes(change.status)) throw new Error('DOWNGRADE_NOT_AVAILABLE');
  if (order.method === 'CARD') {
    if (!order.rebillSubscriptionId) throw new Error('SUBSCRIPTION_MISSING');
    let subscription = await fetchRebillSubscription(order.rebillSubscriptionId);
    if (subscription.status !== 'active') throw new Error('SUBSCRIPTION_NOT_ACTIVE');
    if (!rebillSubscriptionMatchesOrder(subscription, { ...order, planCode: target.code, amountArs: target.amountArs })) {
      if (!rebillSubscriptionMatchesOrder(subscription, order)) throw new Error('SUBSCRIPTION_CHANGED');
      const planId = await findOrCreateRebillPlan(target);
      await changeRebillSubscriptionPlan(order.rebillSubscriptionId, planId);
      subscription = await fetchRebillSubscription(order.rebillSubscriptionId);
      if (subscription.status !== 'active'
        || !rebillSubscriptionMatchesOrder(subscription, { ...order, planCode: target.code, amountArs: target.amountArs })) {
        throw new Error('DOWNGRADE_NOT_CONFIRMED');
      }
    }
  }
  // APPLIED records the instruction to charge Esencial next; the paid Pro entitlement remains until periodEnd.
  await systemPrisma.tenantPlanChange.updateMany({ where: { id: change.id, status: 'PENDING' }, data: {
    status: 'APPLIED', appliedAt: new Date(),
  } });
  return { status: 'SCHEDULED', effectiveAt: change.periodEnd };
}

export async function cancelScheduledDowngrade(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const [tenant, order] = await Promise.all([
    systemPrisma.tenant.findUnique({ where: { id: tenantId } }),
    systemPrisma.tenantBillingOrder.findFirst({ where: { tenantId, status: 'PAID' }, orderBy: { paidAt: 'desc' } }),
  ]);
  if (!tenant?.paidUntil || !order || order.planCode !== 'PRO_MONTHLY') {
    res.status(409).json({ message: 'No hay un cambio programado que se pueda cancelar.' }); return;
  }
  const change = await systemPrisma.tenantPlanChange.findFirst({ where: {
    tenantId, orderId: order.id, amountArs: 0, fromPlanCode: 'PRO_MONTHLY', toPlanCode: 'ESSENTIAL_MONTHLY',
    periodEnd: tenant.paidUntil,
    OR: [{ status: 'APPLIED' }, { status: 'FAILED', rebillRefundId: 'CANCELLING_DOWNGRADE' }],
  }, orderBy: { createdAt: 'desc' } });
  if (!change) { res.status(409).json({ message: 'No hay un cambio programado que se pueda cancelar.' }); return; }
  if (change.periodEnd <= new Date()) {
    res.status(409).json({ message: 'La renovación ya comenzó. Contactanos para revisar la cancelación.' }); return;
  }
  if (change.status === 'APPLIED' && order.method === 'CARD' && change.periodEnd.getTime() - Date.now() <= 15 * 60_000) {
    res.status(409).json({ message: 'La renovación está demasiado cerca para cancelar el cambio automáticamente. Contactanos para revisarlo.' }); return;
  }
  if (change.status === 'APPLIED') {
    // Reserve the existing adjustment reference for recoverable cancellation states; no refund is issued.
    const locked = await systemPrisma.tenantPlanChange.updateMany({ where: { id: change.id, status: 'APPLIED' },
      data: { status: 'FAILED', rebillRefundId: 'CANCELLING_DOWNGRADE' } });
    if (!locked.count) { res.status(409).json({ message: 'El cambio ya se está procesando. Actualizá la página.' }); return; }
  }
  try {
    if (order.method === 'CARD') {
      if (!order.rebillSubscriptionId) throw new Error('SUBSCRIPTION_MISSING');
      const essential = BILLING_CATALOG.find(plan => plan.code === 'ESSENTIAL_MONTHLY')!;
      const pro = BILLING_CATALOG.find(plan => plan.code === 'PRO_MONTHLY')!;
      let subscription = await fetchRebillSubscription(order.rebillSubscriptionId);
      if (subscription.status !== 'active' || (subscription.orderId && subscription.orderId !== order.id)) throw new Error('SUBSCRIPTION_NOT_ACTIVE');
      if (!rebillSubscriptionMatchesOrder(subscription, order)) {
        if (!rebillSubscriptionMatchesOrder(subscription, { ...order, planCode: essential.code, amountArs: essential.amountArs })) throw new Error('SUBSCRIPTION_CHANGED');
        const planId = await findOrCreateRebillPlan(pro);
        await changeRebillSubscriptionPlan(order.rebillSubscriptionId, planId);
        subscription = await fetchRebillSubscription(order.rebillSubscriptionId);
        if (subscription.status !== 'active' || !rebillSubscriptionMatchesOrder(subscription, order)) throw new Error('SUBSCRIPTION_NOT_CONFIRMED');
      }
    }
    const completed = await systemPrisma.tenantPlanChange.updateMany({ where: {
      id: change.id, status: 'FAILED', rebillRefundId: 'CANCELLING_DOWNGRADE',
    }, data: { rebillRefundId: 'CANCELLED_DOWNGRADE' } });
    if (!completed.count) throw new Error('CANCELLATION_STATE_CHANGED');
    res.json({ status: 'CANCELLED' });
  } catch {
    res.status(202).json({ status: 'PENDING', message: 'No pudimos confirmar la cancelación todavía. Reintentá en unos instantes.' });
  }
}

export async function confirmPaidPlanChangePayment(changeId: string, paymentId: string, email: string) {
  const change = await systemPrisma.tenantPlanChange.findUnique({ where: { id: changeId } });
  if (!change || change.amountArs <= 0 || change.status === 'FAILED') throw new Error('PLAN_CHANGE_NOT_FOUND');
  if (change.status === 'APPLIED') return;
  if (change.status === 'PENDING') {
    const [order, tenant, admin, payment] = await Promise.all([
      systemPrisma.tenantBillingOrder.findUnique({ where: { id: change.orderId } }),
      systemPrisma.tenant.findUnique({ where: { id: change.tenantId } }),
      systemPrisma.user.findFirst({ where: { tenantId: change.tenantId, role: 'ADMIN', email: email.toLowerCase() } }),
      fetchRebillPayment(paymentId),
    ]);
    if (!order || !tenant || !admin || order.planCode !== change.fromPlanCode
      || change.periodEnd.getTime() !== tenant.paidUntil?.getTime()
      || payment.id !== paymentId || payment.status !== 'approved' || payment.amount !== change.amountArs
      || payment.currency !== 'ARS' || payment.changeId !== change.id || payment.subscriptionId
      || payment.customerEmail !== email.toLowerCase() || payment.createdAt < change.createdAt) {
      throw new Error('PLAN_CHANGE_PAYMENT_NOT_VERIFIED');
    }
    await systemPrisma.$transaction(async tx => {
      const changed = await tx.tenantPlanChange.updateMany({ where: { id: change.id, status: 'PENDING' }, data: {
        status: 'PAYMENT_CONFIRMED', rebillPaymentId: paymentId,
      } });
      if (changed.count) await tx.rebillProcessedPayment.create({ data: { paymentId } });
    });
  }
  await applyChange(change.id, change.tenantId);
}

export async function createPlanChange(req: Request, res: Response): Promise<void> {
  let value: Awaited<ReturnType<typeof context>>;
  try { value = await context(req.user!.tenantId, req.body?.planCode); }
  catch { res.status(409).json({ message: 'El cambio de plan ya no está disponible para este período.' }); return; }
  if (req.body?.expectedAmountArs !== value.amountArs) {
    res.status(409).json({ message: 'El proporcional cambió. Revisá el importe actualizado antes de confirmar.' }); return;
  }
  if (value.order.method === 'CARD') {
    try { await findOrCreateRebillPlan(value.target); }
    catch { res.status(503).json({ message: 'No pudimos preparar el nuevo plan en Rebill. Intentá de nuevo.' }); return; }
  }
  let previous = await systemPrisma.tenantPlanChange.findFirst({ where: {
    tenantId: req.user!.tenantId, orderId: value.order.id,
    periodStart: value.periodStart, periodEnd: value.periodEnd,
  }, orderBy: { createdAt: 'desc' } });
  if (previous?.status === 'FAILED' && previous.rebillRefundId === 'CANCELLED_DOWNGRADE'
    && previous.toPlanCode === value.target.code && value.amountArs === 0) {
    const reset = await systemPrisma.tenantPlanChange.updateMany({ where: { id: previous.id, status: 'FAILED', rebillRefundId: 'CANCELLED_DOWNGRADE' },
      data: { status: 'PENDING', rebillRefundId: null, appliedAt: null } });
    if (!reset.count) { res.status(409).json({ message: 'El cambio ya se está procesando. Intentá nuevamente.' }); return; }
    previous = await systemPrisma.tenantPlanChange.findUnique({ where: { id: previous.id } });
  }
  if (previous?.status === 'APPLIED') {
    res.status(409).json({ message: 'Ya programaste o realizaste un cambio en este período.' }); return;
  }
  if (previous && previous.toPlanCode !== value.target.code) {
    res.status(409).json({ message: 'Hay un cambio de plan pendiente. Completalo antes de elegir otro.' }); return;
  }
  const change = previous ?? await systemPrisma.tenantPlanChange.upsert({
    where: { tenantId_orderId_periodStart_periodEnd: {
      tenantId: req.user!.tenantId, orderId: value.order.id,
      periodStart: value.periodStart, periodEnd: value.periodEnd,
    } },
    create: {
      tenantId: req.user!.tenantId, orderId: value.order.id,
      fromPlanCode: value.order.planCode, toPlanCode: value.target.code,
      amountArs: value.amountArs, periodStart: value.periodStart, periodEnd: value.periodEnd,
    }, update: {},
  });
  if (change.toPlanCode !== value.target.code || change.amountArs !== value.amountArs) {
    res.status(409).json({ message: 'Hay un cambio de plan pendiente con otro importe. Contactanos para revisarlo.' }); return;
  }
  if (change.amountArs > 0) {
    res.status(previous ? 200 : 201).json({ change }); return;
  }
  try { res.json(await scheduleDowngrade(change.id, req.user!.tenantId)); }
  catch { res.status(202).json({ changeId: change.id, message: 'El cambio quedó pendiente. Reintentá completar la programación.' }); }
}

export async function confirmPlanChange(req: Request, res: Response): Promise<void> {
  const change = await systemPrisma.tenantPlanChange.findFirst({ where: { id: req.params.id, tenantId: req.user!.tenantId } });
  if (!change) { res.status(404).json({ message: 'Cambio de plan no encontrado.' }); return; }
  if (change.status === 'APPLIED') {
    res.json(change.amountArs === 0 && change.periodEnd > new Date()
      ? { status: 'SCHEDULED', effectiveAt: change.periodEnd } : { status: 'APPLIED' }); return;
  }
  if (change.status === 'FAILED') { res.status(409).json({ message: 'Este cambio necesita revisión antes de continuar.' }); return; }
  if (change.amountArs === 0) {
    try { res.json(await scheduleDowngrade(change.id, req.user!.tenantId)); }
    catch { res.status(202).json({ changeId: change.id, message: 'Reintentá completar la programación del cambio.' }); }
    return;
  }
  if (change.amountArs < 0) { res.status(409).json({ message: 'Este ajuste anterior necesita revisión.' }); return; }
  if (change.amountArs > 0 && change.status === 'PENDING') {
    const paymentId = String(req.body?.paymentId ?? '');
    if (!/^(test_)?pay_[\w-]+$/.test(paymentId)) { res.status(400).json({ message: 'Pago inválido.' }); return; }
    try { await confirmPaidPlanChangePayment(change.id, paymentId, req.user!.email); }
    catch { res.status(202).json({ changeId: change.id, message: 'Estamos verificando el pago y el nuevo plan. Reintentá en unos instantes sin volver a pagar.' }); return; }
    res.json({ status: 'APPLIED' }); return;
  }
  try { await applyChange(change.id, req.user!.tenantId); }
  catch { res.status(202).json({ changeId: change.id, message: 'El pago quedó confirmado. Reintentá completar el cambio de plan.' }); return; }
  res.json({ status: 'APPLIED' });
}
