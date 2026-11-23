import type { Request, Response } from 'express';
import { systemPrisma } from '../models/Prisma.js';
import {
  adhereDebit, cancelAllDebits, cancelDebit, cancelDebitForUser, debitStateForUser, listDebits,
  verifyDebit as verifyDebitCharges, verifyMyDebit,
} from '../services/automaticDebit.service.js';
import { MercadoPagoError, frontendUrl, verifyWebhookSignature } from '../services/mercadoPago.service.js';
import {
  MercadoPagoConnectionError, activeOnlineOperations, completeConnection, connectionStatus, disconnectAccount,
  startConnection,
} from '../services/mercadoPagoAccount.service.js';
import { processMercadoPagoNotification, processQueuedNotifications } from '../services/mercadoPagoWebhook.service.js';
import {
  MemberPaymentError, listAlerts, markAlertReviewed, memberPaymentState, startCheckout, verifyAttempt,
} from '../services/memberPayments.service.js';
import { tenantPlanAccess } from '../services/planAccess.service.js';

// Cobro de cuotas a socios con Mercado Pago. Ver MERCADOPAGO.md.

const MP_ERRORS: Record<string, { status: number; message: string }> = {
  MP_NOT_CONFIGURED: { status: 503, message: 'Los cobros con Mercado Pago todavía no están habilitados en Gymhour.' },
  MP_NOT_CONNECTED: { status: 409, message: 'El gimnasio no tiene Mercado Pago conectado.' },
  MP_RECONNECT_REQUIRED: { status: 409, message: 'La conexión del gimnasio con Mercado Pago necesita reconectarse.' },
  MP_UNAVAILABLE: { status: 503, message: 'Mercado Pago no respondió. Probá de nuevo en unos minutos.' },
};

function respondPaymentError(res: Response, error: unknown, action: string): void {
  if (error instanceof MemberPaymentError) {
    res.status(error.status).json({ code: error.code, message: error.message, ...(error.details ?? {}) });
    return;
  }
  if (error instanceof MercadoPagoError) {
    const known = MP_ERRORS[error.code];
    res.status(known?.status ?? 502).json({
      code: error.code, message: known?.message ?? `No pudimos ${action} con Mercado Pago. Probá de nuevo en unos minutos.`,
    });
    return;
  }
  console.error(`[mercadopago] ${action}`, error);
  res.status(500).json({ message: `No pudimos ${action}. Probá de nuevo en unos minutos.` });
}

const tenantIdOf = (req: Request) => req.tenant!.id;

// --- Conexión (admin) ---

export async function getConnection(req: Request, res: Response): Promise<void> {
  try {
    const [status, access] = await Promise.all([connectionStatus(tenantIdOf(req)), tenantPlanAccess(tenantIdOf(req))]);
    res.json({ ...status, featureEnabled: access.features.MEMBER_PAYMENTS });
  } catch (error) { respondPaymentError(res, error, 'cargar la conexión'); }
}

export async function connect(req: Request, res: Response): Promise<void> {
  try {
    res.json({ url: await startConnection(tenantIdOf(req), req.user!.id) });
  } catch (error) { respondPaymentError(res, error, 'iniciar la conexión'); }
}

// Mercado Pago vuelve acá desde el navegador del admin, sin la sesión de Gymhour: el gimnasio y el
// admin salen del `state`, nunca de la URL.
export async function oauthCallback(req: Request, res: Response): Promise<void> {
  const back = (params: string) => res.redirect(302, `${frontendUrl()}/admin/configuracion?${params}`);
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!state || !code) { back(`mp=error&motivo=${req.query.error ? 'CANCELADO' : 'STATE_INVALID'}`); return; }
  try {
    const { tenantId } = await completeConnection(state, code);
    void processQueuedNotifications(tenantId).catch(error => console.error('[mercadopago] cola al reconectar', error));
    back('mp=conectado');
  } catch (error) {
    const motivo = error instanceof MercadoPagoConnectionError || error instanceof MercadoPagoError ? error.code : 'ERROR';
    if (!(error instanceof MercadoPagoConnectionError)) console.error('[mercadopago] conexión', error);
    back(`mp=error&motivo=${encodeURIComponent(motivo)}`);
  }
}

export async function disconnect(req: Request, res: Response): Promise<void> {
  const tenantId = tenantIdOf(req);
  try {
    const active = await activeOnlineOperations(tenantId);
    if (active.attempts) {
      res.status(409).json({ code: 'PAGOS_EN_CURSO', message: 'Hay socios pagando con Mercado Pago en este momento. Esperá unos minutos y probá de nuevo.' });
      return;
    }
    if (active.debits && req.query.cancelarDebitos !== 'true') {
      res.status(409).json({ code: 'DEBITOS_ACTIVOS', debitos: active.debits,
        message: `Se van a cancelar ${active.debits} débitos automáticos. Confirmá para desconectar.` });
      return;
    }
    const cancelled = active.debits
      ? await cancelAllDebits(tenantId, { by: `Admin · ${req.user!.email}`, reason: 'El gimnasio desconectó Mercado Pago.' })
      : 0;
    await disconnectAccount(tenantId);
    res.json({ ok: true, debitosCancelados: cancelled });
  } catch (error) { respondPaymentError(res, error, 'desconectar Mercado Pago'); }
}

// --- Avisos y débitos (admin) ---

export async function alerts(req: Request, res: Response): Promise<void> {
  try { res.json(await listAlerts(tenantIdOf(req))); } catch (error) { respondPaymentError(res, error, 'cargar los avisos'); }
}

export async function reviewAlert(req: Request, res: Response): Promise<void> {
  try {
    await markAlertReviewed(tenantIdOf(req), String(req.params.id), req.user!.id);
    res.json({ ok: true });
  } catch (error) { respondPaymentError(res, error, 'marcar el aviso'); }
}

export async function adminDebits(req: Request, res: Response): Promise<void> {
  try { res.json(await listDebits(tenantIdOf(req))); } catch (error) { respondPaymentError(res, error, 'cargar los débitos'); }
}

// El admin verifica el débito de un socio: estado y cobros que todavía no figuren en Gymhour.
export async function adminVerifyDebit(req: Request, res: Response): Promise<void> {
  try {
    const debit = await systemPrisma.debitoAutomatico.findFirst({ where: { id: String(req.params.id), tenantId: tenantIdOf(req) } });
    if (!debit) { res.status(404).json({ message: 'No encontramos ese débito.' }); return; }
    res.json(await verifyDebitCharges(debit));
  } catch (error) { respondPaymentError(res, error, 'verificar los cobros del débito'); }
}

export async function adminCancelDebit(req: Request, res: Response): Promise<void> {
  try {
    const debit = await systemPrisma.debitoAutomatico.findFirst({ where: { id: String(req.params.id), tenantId: tenantIdOf(req) } });
    if (!debit) { res.status(404).json({ message: 'No encontramos ese débito.' }); return; }
    const reason = String(req.body?.motivo ?? '').trim() || 'Cancelado por el gimnasio.';
    res.json(await cancelDebit(debit, { by: `Admin · ${req.user!.email}`, reason }));
  } catch (error) { respondPaymentError(res, error, 'cancelar el débito'); }
}

// --- Socio ---

export async function myState(req: Request, res: Response): Promise<void> {
  try {
    const [state, debito] = await Promise.all([
      memberPaymentState(tenantIdOf(req), req.user!.id),
      debitStateForUser(tenantIdOf(req), req.user!.id),
    ]);
    res.json({ ...state, debito });
  } catch (error) { respondPaymentError(res, error, 'cargar el estado de tus pagos'); }
}

export async function checkout(req: Request, res: Response): Promise<void> {
  const cuotaId = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(cuotaId)) { res.status(400).json({ message: 'No pudimos identificar la cuota.' }); return; }
  try {
    res.json(await startCheckout({ tenantId: tenantIdOf(req), userId: req.user!.id, cuotaId }));
  } catch (error) { respondPaymentError(res, error, 'iniciar el pago'); }
}

export async function verify(req: Request, res: Response): Promise<void> {
  const reference = String(req.params.ref ?? '');
  if (!/^[\w-]{8,64}$/.test(reference)) { res.status(400).json({ message: 'No pudimos identificar el pago.' }); return; }
  try {
    const userId = req.user!.role === 'ADMIN' ? undefined : req.user!.id;
    res.json(await verifyAttempt(tenantIdOf(req), reference, userId));
  } catch (error) { respondPaymentError(res, error, 'verificar el pago'); }
}

export async function adhere(req: Request, res: Response): Promise<void> {
  try {
    res.json(await adhereDebit({ tenantId: tenantIdOf(req), userId: req.user!.id, payerEmail: String(req.body?.email ?? '') }));
  } catch (error) { respondPaymentError(res, error, 'crear el débito automático'); }
}

export async function verifyDebit(req: Request, res: Response): Promise<void> {
  try { res.json(await verifyMyDebit(tenantIdOf(req), req.user!.id)); } catch (error) { respondPaymentError(res, error, 'verificar el débito'); }
}

export async function cancelMyDebit(req: Request, res: Response): Promise<void> {
  try {
    const reason = String(req.body?.motivo ?? '').trim() || 'Baja pedida por el socio.';
    const debit = await cancelDebitForUser(tenantIdOf(req), req.user!.id, { by: `Socio · ${req.user!.email}`, reason });
    if (!debit) { res.status(404).json({ message: 'No tenés un débito automático activo.' }); return; }
    res.json(await debitStateForUser(tenantIdOf(req), req.user!.id));
  } catch (error) { respondPaymentError(res, error, 'dar de baja el débito'); }
}

// --- Avisos de Mercado Pago (webhook) ---

export async function mercadoPagoWebhook(req: Request, res: Response): Promise<void> {
  const topic = req.body?.type ?? req.body?.topic ?? req.query.type ?? req.query.topic;
  const queryDataId = typeof req.query['data.id'] === 'string' ? req.query['data.id'] : null;
  const resourceId = String(queryDataId ?? req.body?.data?.id ?? req.query.id ?? '');
  const reference = typeof req.query.ref === 'string' ? req.query.ref : null;
  if (!resourceId || resourceId.length > 64) { res.status(200).end(); return; }

  const signature = verifyWebhookSignature({
    signature: req.headers['x-signature'], requestId: req.headers['x-request-id'],
    dataId: queryDataId ?? resourceId, secret: process.env.MP_WEBHOOK_SECRET ?? '',
  });
  if (signature === 'invalid') {
    console.error('[mercadopago] aviso con firma inválida', { topic, resourceId });
    res.status(401).end();
    return;
  }
  try {
    const mpUserId = req.body?.user_id !== undefined ? String(req.body.user_id) : null;
    await processMercadoPagoNotification({ topic, resourceId, reference, mpUserId });
    res.status(200).end();
  } catch (error) {
    // Mercado Pago reintenta los avisos que no respondieron 200.
    console.error('[mercadopago] aviso sin procesar', { topic, resourceId }, error);
    res.status(500).end();
  }
}
