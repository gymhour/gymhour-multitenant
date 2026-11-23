import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakePrisma, sharedFakePrisma as db } from './helpers/fakePrisma.js';

vi.mock('../src/models/Prisma.js', async () => {
  const { sharedFakePrisma } = await import('./helpers/fakePrisma.js');
  return { systemPrisma: sharedFakePrisma, default: sharedFakePrisma };
});
const mp = vi.hoisted(() => ({ getPayment: vi.fn() }));
vi.mock('../src/services/mercadoPago.service.js', async importOriginal => ({ ...(await importOriginal<any>()), ...mp }));
const accounts = vi.hoisted(() => ({ withTenantToken: vi.fn(), queueNotification: vi.fn() }));
vi.mock('../src/services/mercadoPagoAccount.service.js', async importOriginal => ({ ...(await importOriginal<any>()), ...accounts }));
const payments = vi.hoisted(() => ({ applyPaymentUpdate: vi.fn() }));
vi.mock('../src/services/memberPayments.service.js', async importOriginal => ({ ...(await importOriginal<any>()), ...payments }));
const debits = vi.hoisted(() => ({ applyAuthorizedPayment: vi.fn(), applyDebitPaymentByReference: vi.fn(), syncDebit: vi.fn() }));
vi.mock('../src/services/automaticDebit.service.js', async importOriginal => ({ ...(await importOriginal<any>()), ...debits }));

import { MercadoPagoError } from '../src/services/mercadoPago.service.js';
import { processMercadoPagoNotification, processQueuedNotifications } from '../src/services/mercadoPagoWebhook.service.js';
import { mercadoPagoWebhook } from '../src/controllers/mercadoPago.Controller.js';

const response = () => {
  const res: any = { status: vi.fn().mockReturnThis(), end: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return res;
};
const tokenInput = (tenantId: number) => ({ account: { tenantId, mpUserId: '99' }, accessToken: `TOKEN-${tenantId}` });

beforeEach(async () => {
  vi.clearAllMocks();
  resetFakePrisma();
  process.env.MP_WEBHOOK_SECRET = 'webhook-secret';
  accounts.withTenantToken.mockImplementation((tenantId: number, operation: (input: unknown) => unknown) => operation(tokenInput(tenantId)));
  mp.getPayment.mockResolvedValue({ id: '1001', status: 'approved', externalReference: 'ref-checkout-0001' });
  payments.applyPaymentUpdate.mockResolvedValue('APLICADO');
  await db.cuotaPago.create({ data: { tenantId: 7, ID_Cuota: 10, ID_Usuario: 1, externalReference: 'ref-checkout-0001', status: 'INICIADO' } });
});

describe('a qué gimnasio corresponde cada aviso', () => {
  it('un pago con la referencia de un checkout se consulta con el token de ese gimnasio', async () => {
    await expect(processMercadoPagoNotification({ topic: 'payment', resourceId: '1001', reference: 'ref-checkout-0001' })).resolves.toBe('APLICADO');
    expect(mp.getPayment).toHaveBeenCalledWith('TOKEN-7', '1001');
    expect(payments.applyPaymentUpdate).toHaveBeenCalledWith(7, expect.objectContaining({ tenantId: 7 }), expect.objectContaining({ id: '1001' }));
  });

  it('sin referencia, prueba con los gimnasios de esa cuenta de Mercado Pago', async () => {
    await db.mercadoPagoAccount.create({ data: { tenantId: 7, mpUserId: '99', status: 'CONNECTED' } });
    await db.mercadoPagoAccount.create({ data: { tenantId: 8, mpUserId: '99', status: 'CONNECTED' } });
    payments.applyPaymentUpdate.mockResolvedValueOnce('IGNORADO').mockResolvedValueOnce('APLICADO');
    debits.applyDebitPaymentByReference.mockResolvedValue('IGNORADO');
    await expect(processMercadoPagoNotification({ topic: 'payment', resourceId: '1001', mpUserId: '99' })).resolves.toBe('APLICADO');
    expect(payments.applyPaymentUpdate.mock.calls.map(call => call[0])).toEqual([7, 8]);
  });

  it('un pago que no es de un checkout se prueba como cobro de un débito', async () => {
    payments.applyPaymentUpdate.mockResolvedValue('IGNORADO');
    debits.applyDebitPaymentByReference.mockResolvedValue('APLICADO');
    await expect(processMercadoPagoNotification({ topic: 'payment', resourceId: '1001', reference: 'ref-checkout-0001' })).resolves.toBe('APLICADO');
  });

  it('los avisos de suscripciones y de cobros del débito van a su servicio', async () => {
    await db.debitoAutomatico.create({ data: { tenantId: 7, ID_Usuario: 1, preapprovalId: 'pre_000001', externalReference: 'deb-ref-1', status: 'ACTIVO' } });
    await expect(processMercadoPagoNotification({ topic: 'subscription_preapproval', resourceId: 'pre_000001' })).resolves.toBe('SINCRONIZADO');
    expect(debits.syncDebit).toHaveBeenCalled();
    await db.mercadoPagoAccount.create({ data: { tenantId: 7, mpUserId: '99', status: 'CONNECTED' } });
    debits.applyAuthorizedPayment.mockResolvedValue('APLICADO');
    await expect(processMercadoPagoNotification({ topic: 'subscription_authorized_payment', resourceId: '555', mpUserId: '99' })).resolves.toBe('APLICADO');
    expect(debits.applyAuthorizedPayment).toHaveBeenCalledWith(7, expect.anything(), 'TOKEN-7', '555');
  });

  it('ignora tópicos desconocidos, IDs inválidos y recursos de otra cuenta', async () => {
    await expect(processMercadoPagoNotification({ topic: 'merchant_order', resourceId: '1' })).resolves.toBe('IGNORADO');
    await expect(processMercadoPagoNotification({ topic: 'payment', resourceId: '../x', reference: 'ref-checkout-0001' })).resolves.toBe('IGNORADO');
    mp.getPayment.mockRejectedValue(new MercadoPagoError(404, 'MP_NOT_FOUND'));
    await expect(processMercadoPagoNotification({ topic: 'payment', resourceId: '1001', reference: 'ref-checkout-0001' })).resolves.toBe('IGNORADO');
  });

  it('si el token del gimnasio no sirve, el aviso queda en cola para cuando reconecte', async () => {
    accounts.withTenantToken.mockRejectedValue(new MercadoPagoError(409, 'MP_RECONNECT_REQUIRED'));
    await expect(processMercadoPagoNotification({ topic: 'payment', resourceId: '1001', reference: 'ref-checkout-0001' })).resolves.toBe('EN_COLA');
    expect(accounts.queueNotification).toHaveBeenCalledWith(7, 'payment', '1001');
  });

  it('al reconectar, procesa la cola y marca cada aviso', async () => {
    await db.mercadoPagoPendingNotification.create({ data: { tenantId: 7, topic: 'payment', resourceId: '1001', processedAt: null, receivedAt: new Date() } });
    await expect(processQueuedNotifications(7)).resolves.toBe(1);
    expect(db.mercadoPagoPendingNotification.rows[0].processedAt).toBeInstanceOf(Date);
  });
});

describe('endpoint del webhook', () => {
  const signed = (dataId: string, requestId = 'req-1') => {
    const ts = String(Math.floor(Date.now() / 1000));
    const v1 = crypto.createHmac('sha256', 'webhook-secret').update(`id:${dataId};request-id:${requestId};ts:${ts};`).digest('hex');
    return { 'x-signature': `ts=${ts},v1=${v1}`, 'x-request-id': requestId };
  };
  const call = async (req: Record<string, unknown>) => {
    const res = response();
    await mercadoPagoWebhook({ query: {}, body: {}, headers: {}, ...req } as any, res);
    return res;
  };

  it('procesa un aviso firmado y responde 200', async () => {
    const res = await call({ query: { ref: 'ref-checkout-0001', 'data.id': '1001', type: 'payment' }, headers: signed('1001') });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(payments.applyPaymentUpdate).toHaveBeenCalled();
  });

  it('rechaza una firma inválida sin procesar nada', async () => {
    const res = await call({ query: { ref: 'ref-checkout-0001', 'data.id': '1001', type: 'payment' }, headers: signed('9999') });
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mp.getPayment).not.toHaveBeenCalled();
  });

  it('los avisos con formato IPN se confirman con 200 sin procesar: el mismo pago llega con formato Webhooks', async () => {
    const res = await call({ query: { ref: 'ref-checkout-0001', id: '1001', topic: 'payment' }, headers: signed('otro') });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mp.getPayment).not.toHaveBeenCalled();
  });

  it('los tópicos que no usa, como merchant_order, se confirman con 200 sin verificar ni procesar', async () => {
    const res = await call({ query: { ref: 'ref-checkout-0001', id: '46366038949', topic: 'merchant_order' }, headers: signed('otro') });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mp.getPayment).not.toHaveBeenCalled();
  });

  it('un aviso sin ID se confirma sin procesar', async () => {
    const res = await call({ body: { type: 'payment' } });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(mp.getPayment).not.toHaveBeenCalled();
  });

  it('si falla el procesamiento responde 500 para que Mercado Pago reintente', async () => {
    mp.getPayment.mockRejectedValue(new MercadoPagoError(503, 'MP_UNAVAILABLE'));
    const res = await call({ body: { type: 'payment', data: { id: '1001' } }, query: { ref: 'ref-checkout-0001' } });
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
