import type { Request, Response } from 'express';
import { systemPrisma } from '../models/Prisma.js';
import { createRebillCardUpdateLink } from '../services/rebill.service.js';
import { notifySubscriptionCancelled } from '../services/billingNotifications.service.js';
import { cancelTenantSubscriptions, liveSubscriptionOrders } from '../services/tenantSubscription.service.js';

export async function cancelSubscription(req: Request, res: Response): Promise<void> {
  const tenantId = req.user!.tenantId;
  const reason = String(req.body?.reason ?? '').trim();
  if (reason.length < 3) { res.status(400).json({ message: 'Contanos el motivo de la baja.' }); return; }
  if (!(await liveSubscriptionOrders(tenantId)).length) {
    res.status(409).json({ message: 'No hay una suscripción automática para cancelar.' }); return;
  }
  try {
    await cancelTenantSubscriptions(tenantId, reason, req.user!.email);
  } catch (error) {
    console.error('[billing/cancel]', error);
    res.status(503).json({ message: 'No pudimos cancelar la suscripción en este momento. El débito sigue activo; intentá de nuevo.' }); return;
  }
  const tenant = await systemPrisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { paidUntil: true } });
  notifySubscriptionCancelled(tenantId, tenant.paidUntil);
  res.json({ status: 'CANCELLED', accessUntil: tenant.paidUntil });
}

export async function cardUpdateLink(req: Request, res: Response): Promise<void> {
  const [order] = await liveSubscriptionOrders(req.user!.tenantId);
  if (!order) { res.status(409).json({ message: 'No hay una suscripción automática para actualizar.' }); return; }
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ url: await createRebillCardUpdateLink(order.rebillSubscriptionId!) });
  } catch (error) {
    console.error('[billing/card-link]', error);
    res.status(503).json({ message: 'No pudimos preparar el cambio de tarjeta. Intentá de nuevo.' });
  }
}
