import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakePrisma, sharedFakePrisma as db } from './helpers/fakePrisma.js';

vi.mock('../src/models/Prisma.js', async () => {
  const { sharedFakePrisma } = await import('./helpers/fakePrisma.js');
  return { systemPrisma: sharedFakePrisma, default: sharedFakePrisma };
});
const mp = vi.hoisted(() => ({ createPreference: vi.fn(), searchPaymentsByReference: vi.fn() }));
vi.mock('../src/services/mercadoPago.service.js', async importOriginal => ({ ...(await importOriginal<any>()), ...mp }));
vi.mock('../src/services/mercadoPagoAccount.service.js', () => ({
  lockKeyFor: (tenantId: number, userId: number) => `${tenantId}:${userId}`,
  withTenantToken: vi.fn((tenantId: number, operation: (input: unknown) => unknown) => operation({
    account: { tenantId, mpUserId: '99', status: 'CONNECTED' }, accessToken: 'TOKEN',
  })),
}));
vi.mock('../src/services/planAccess.service.js', () => ({
  tenantPlanAccess: vi.fn(async () => ({ features: { MEMBER_PAYMENTS: true } })),
}));

import {
  applyPaymentUpdate, attachOnlinePayments, listAlerts, markAlertReviewed, onlinePaymentLock, settleExpiredAttempt,
  startCheckout, verifyAttempt,
} from '../src/services/memberPayments.service.js';

const DAY = 86_400_000;
const account = { tenantId: 7, mpUserId: '99', status: 'CONNECTED' } as any;
const utcDay = (offsetDays: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offsetDays * DAY);
};
const payment = (overrides: Record<string, unknown> = {}) => ({
  id: '1001', status: 'approved', statusDetail: 'accredited', amount: 26500, refundedAmount: 0, currency: 'ARS',
  externalReference: null, collectorId: '99', merchantOrderId: '555', paymentMethod: 'Visa débito',
  netAmount: 25100, payerEmail: 'socio@example.com', dateApproved: new Date(), dateCreated: new Date(), ...overrides,
}) as any;

const cuota = (id: number) => db.cuota.rows.find((row: any) => row.ID_Cuota === id);
const attemptOf = (ref: string) => db.cuotaPago.rows.find((row: any) => row.externalReference === ref);

beforeEach(async () => {
  vi.clearAllMocks();
  resetFakePrisma();
  process.env.FRONTEND_URL = 'https://app.gymhour.test';
  process.env.API_PUBLIC_URL = 'https://api.gymhour.test';
  await db.tenant.create({ data: { id: 7, name: 'Gym Test', slug: 'gym-test', status: 'ACTIVE' } });
  await db.tenantSettings.create({ data: {
    tenantId: 7, timezone: 'America/Argentina/Cordoba', recargoTipo: 'FIJO', recargoValor: 1500, recargoTope: null, recargoDiasGracia: 0,
  } });
  // Cuota vencida hace 5 días (lleva recargo), otra al día y una de otro socio.
  await db.cuota.create({ data: { ID_Cuota: 10, tenantId: 7, ID_Usuario: 1, importe: 25000, vence: new Date(utcDay(-5).getTime() + DAY - 1),
    fechaInicio: utcDay(-5), fechaFin: utcDay(25), mes: '2026-11', pagada: false, vencida: true } });
  await db.cuota.create({ data: { ID_Cuota: 11, tenantId: 7, ID_Usuario: 1, importe: 25000, vence: new Date(utcDay(26).getTime() + DAY - 1),
    fechaInicio: utcDay(26), fechaFin: utcDay(55), mes: '2026-12', pagada: false, vencida: false } });
  await db.cuota.create({ data: { ID_Cuota: 20, tenantId: 7, ID_Usuario: 2, importe: 25000, vence: utcDay(3),
    fechaInicio: utcDay(3), fechaFin: utcDay(33), mes: '2026-11', pagada: false, vencida: false } });
  mp.createPreference.mockResolvedValue({ id: 'pref_1', initPoint: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref_1' });
  mp.searchPaymentsByReference.mockResolvedValue([]);
});

describe('botón de pago', () => {
  it('crea el checkout con el monto del servidor, sin efectivo, en un pago y con vencimiento de 10 minutos', async () => {
    const before = Date.now();
    const result = await startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 });
    expect(result).toMatchObject({ amount: 26500, recargo: 1500, status: 'INICIADO', initPoint: expect.stringContaining('pref_1') });
    const body = mp.createPreference.mock.calls[0][1];
    expect(mp.createPreference.mock.calls[0][0]).toBe('TOKEN');
    expect(body.items[0]).toMatchObject({ quantity: 1, unit_price: 26500, currency_id: 'ARS' });
    expect(body.payment_methods).toEqual({ excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }], installments: 1 });
    expect(body.external_reference).toBe(result.ref);
    expect(body.notification_url).toBe(`https://api.gymhour.test/pagos/webhooks/mercadopago?ref=${result.ref}`);
    expect(body.back_urls.success).toBe(`https://app.gymhour.test/alumno/cuotas?pago=${result.ref}`);
    expect(body.auto_return).toBe('approved');
    const expires = new Date(body.expiration_date_to).getTime();
    expect(expires - before).toBeGreaterThanOrEqual(10 * 60 * 1000 - 1000);
    expect(expires - before).toBeLessThanOrEqual(10 * 60 * 1000 + 1000);
    expect(attemptOf(result.ref)).toMatchObject({ lockKey: '7:1', amount: 26500, recargo: 1500, preferenceId: 'pref_1' });
  });

  it('no deja pagar la cuota de otro socio ni una cuota pagada', async () => {
    await expect(startCheckout({ tenantId: 7, userId: 1, cuotaId: 20 })).rejects.toMatchObject({ status: 404 });
    cuota(10).pagada = true;
    await expect(startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 })).rejects.toMatchObject({ code: 'CUOTA_PAGADA' });
  });

  it('un solo pago en curso por socio: retoma el mismo checkout y bloquea las demás cuotas', async () => {
    const first = await startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 });
    const again = await startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 });
    expect(again).toMatchObject({ ref: first.ref, resumed: true });
    expect(mp.createPreference).toHaveBeenCalledTimes(1);
    await expect(startCheckout({ tenantId: 7, userId: 1, cuotaId: 11 })).rejects.toMatchObject({ status: 409, code: 'PAGO_EN_CURSO' });
  });

  it('una cuota cubierta por un débito automático no se paga con el botón', async () => {
    await db.debitoAutomatico.create({ data: { tenantId: 7, ID_Usuario: 1, activeKey: '7:1', status: 'ACTIVO',
      externalReference: 'deb-ref-0001', startDate: utcDay(26), amount: 25000 } });
    await expect(startCheckout({ tenantId: 7, userId: 1, cuotaId: 11 })).rejects.toMatchObject({ code: 'CUOTA_CON_DEBITO' });
    // La cuota anterior al débito sí se puede pagar.
    await expect(startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 })).resolves.toMatchObject({ status: 'INICIADO' });
  });

  it('si Mercado Pago no crea el checkout, libera el bloqueo', async () => {
    mp.createPreference.mockRejectedValue(Object.assign(new Error('MP_UNAVAILABLE'), { code: 'MP_UNAVAILABLE' }));
    await expect(startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 })).rejects.toThrow();
    expect(db.cuotaPago.rows[0]).toMatchObject({ status: 'EXPIRADO', lockKey: null });
  });
});

describe('aplicación de pagos', () => {
  const start = async () => (await startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 })).ref;

  it('un pago aprobado marca la cuota con el número de operación, y repetir el aviso no cambia nada', async () => {
    const ref = await start();
    expect(await applyPaymentUpdate(7, account, payment({ externalReference: ref }))).toBe('APLICADO');
    expect(cuota(10)).toMatchObject({ pagada: true, vencida: false, formaPago: 'Mercado Pago', referenciaPago: '1001', recargo: 1500 });
    expect(attemptOf(ref)).toMatchObject({ status: 'APROBADO', lockKey: null, mpPaymentId: '1001', paymentMethod: 'Visa débito', netAmount: 25100 });
    expect(await applyPaymentUpdate(7, account, payment({ externalReference: ref }))).toBe('SIN_CAMBIOS');
    expect(db.cuotaPago.rows).toHaveLength(1);
  });

  it('un pago que no coincide en monto, moneda o cuenta no se aplica y queda para revisar', async () => {
    const ref = await start();
    expect(await applyPaymentUpdate(7, account, payment({ externalReference: ref, amount: 100 }))).toBe('REVISAR');
    expect(cuota(10).pagada).toBe(false);
    expect(attemptOf(ref)).toMatchObject({ status: 'REVISAR', lockKey: null });
    const other = await start();
    expect(await applyPaymentUpdate(7, account, payment({ id: '1002', externalReference: other, collectorId: '1234' }))).toBe('REVISAR');
  });

  it('un pago de otro gimnasio o sin referencia de Gymhour se ignora', async () => {
    const ref = await start();
    expect(await applyPaymentUpdate(8, { ...account, tenantId: 8 }, payment({ externalReference: ref }))).toBe('IGNORADO');
    expect(await applyPaymentUpdate(7, account, payment({ externalReference: 'otra-referencia' }))).toBe('IGNORADO');
    expect(cuota(10).pagada).toBe(false);
  });

  it('un segundo pago aprobado del mismo checkout queda como duplicado, sin pagar dos veces', async () => {
    const ref = await start();
    await applyPaymentUpdate(7, account, payment({ externalReference: ref }));
    expect(await applyPaymentUpdate(7, account, payment({ id: '1003', externalReference: ref }))).toBe('DUPLICADO');
    const duplicate = db.cuotaPago.rows.find((row: any) => row.mpPaymentId === '1003');
    expect(duplicate).toMatchObject({ status: 'DUPLICADO', ID_Cuota: 10 });
    expect(cuota(10).referenciaPago).toBe('1001');
  });

  it('si el admin ya la había pagado, el pago aprobado queda como duplicado', async () => {
    const ref = await start();
    Object.assign(cuota(10), { pagada: true, formaPago: 'Efectivo' });
    expect(await applyPaymentUpdate(7, account, payment({ externalReference: ref }))).toBe('DUPLICADO');
    expect(attemptOf(ref)).toMatchObject({ status: 'DUPLICADO', lockKey: null });
    expect(cuota(10).formaPago).toBe('Efectivo');
  });

  it('una devolución o un contracargo vuelven la cuota a impaga y avisan al admin', async () => {
    const ref = await start();
    await applyPaymentUpdate(7, account, payment({ externalReference: ref }));
    expect(await applyPaymentUpdate(7, account, payment({ externalReference: ref, status: 'refunded' }))).toBe('DEVUELTO');
    expect(cuota(10)).toMatchObject({ pagada: false, referenciaPago: null, formaPago: null, recargo: 0, vencida: true });
    expect(attemptOf(ref)).toMatchObject({ status: 'DEVUELTO', reviewedAt: null });
    expect(await listAlerts(7)).toEqual([expect.objectContaining({ status: 'DEVUELTO', mpPaymentId: '1001' })]);
  });

  it('un contracargo queda como CONTRACARGO', async () => {
    const ref = await start();
    await applyPaymentUpdate(7, account, payment({ externalReference: ref }));
    expect(await applyPaymentUpdate(7, account, payment({ externalReference: ref, status: 'charged_back' }))).toBe('CONTRACARGO');
    expect(cuota(10).pagada).toBe(false);
  });

  it('un rechazo deja reintentar dentro del mismo checkout; un pago en revisión mantiene el bloqueo', async () => {
    const ref = await start();
    await applyPaymentUpdate(7, account, payment({ id: '2001', externalReference: ref, status: 'rejected' }));
    expect(attemptOf(ref)).toMatchObject({ status: 'INICIADO', lockKey: '7:1', mpStatus: 'rejected' });
    await applyPaymentUpdate(7, account, payment({ id: '2002', externalReference: ref, status: 'in_process' }));
    expect(attemptOf(ref)).toMatchObject({ status: 'PENDIENTE', lockKey: '7:1', mpPaymentId: '2002' });
    expect(await onlinePaymentLock(7, 10)).toMatchObject({ code: 'PAGO_EN_CURSO' });
    await applyPaymentUpdate(7, account, payment({ id: '2002', externalReference: ref, status: 'rejected' }));
    expect(attemptOf(ref)).toMatchObject({ status: 'RECHAZADO', lockKey: null });
    expect(cuota(10).pagada).toBe(false);
  });
});

describe('vencimiento del checkout', () => {
  it('antes de liberar el bloqueo consulta a Mercado Pago, y aplica el pago si lo hubo', async () => {
    const { ref } = await startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 });
    const attempt = attemptOf(ref);
    attempt.expiresAt = new Date(Date.now() - 1000);
    mp.searchPaymentsByReference.mockResolvedValue([payment({ externalReference: ref })]);
    const settled = await settleExpiredAttempt({ ...attempt }, account, 'TOKEN');
    expect(settled).toMatchObject({ status: 'APROBADO', lockKey: null });
    expect(cuota(10).pagada).toBe(true);
  });

  it('sin pagos, el checkout vencido se libera; con un rechazo queda RECHAZADO', async () => {
    const { ref } = await startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 });
    attemptOf(ref).expiresAt = new Date(Date.now() - 1000);
    expect(await onlinePaymentLock(7, 10)).toBeNull();
    expect(attemptOf(ref)).toMatchObject({ status: 'EXPIRADO', lockKey: null });

    const second = await startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 });
    attemptOf(second.ref).expiresAt = new Date(Date.now() - 1000);
    mp.searchPaymentsByReference.mockResolvedValue([payment({ id: '3001', externalReference: second.ref, status: 'rejected' })]);
    await settleExpiredAttempt({ ...attemptOf(second.ref) }, account, 'TOKEN');
    expect(attemptOf(second.ref)).toMatchObject({ status: 'RECHAZADO', lockKey: null });
  });

  it('si no se puede consultar a Mercado Pago, el bloqueo sigue', async () => {
    const { ref } = await startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 });
    attemptOf(ref).expiresAt = new Date(Date.now() - 1000);
    mp.searchPaymentsByReference.mockRejectedValue(new Error('MP_UNAVAILABLE'));
    expect(await onlinePaymentLock(7, 10)).toMatchObject({ code: 'PAGO_EN_CURSO' });
  });
});

describe('verificación y pantallas', () => {
  it('un socio no puede verificar el pago de otro', async () => {
    const { ref } = await startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 });
    await expect(verifyAttempt(7, ref, 2)).rejects.toMatchObject({ status: 404 });
    await expect(verifyAttempt(7, ref, 1)).resolves.toMatchObject({ status: 'INICIADO' });
  });

  it('la vuelta del socio aplica el pago aprobado', async () => {
    const { ref } = await startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 });
    mp.searchPaymentsByReference.mockResolvedValue([payment({ externalReference: ref })]);
    await expect(verifyAttempt(7, ref, 1)).resolves.toMatchObject({ status: 'APROBADO', mpPaymentId: '1001' });
  });

  it('la lista de cuotas muestra el pago en curso y las cuotas cubiertas por el débito, sin el link de pago', async () => {
    await startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 });
    await db.debitoAutomatico.create({ data: { tenantId: 7, ID_Usuario: 2, activeKey: '7:2', status: 'ACTIVO',
      externalReference: 'deb-ref-0002', startDate: utcDay(0), amount: 25000 } });
    const rows = await attachOnlinePayments(7, [cuota(10), cuota(11), cuota(20)].map(row => ({ ...row })));
    expect(rows[0].pagoEnLinea).toMatchObject({ status: 'INICIADO' });
    expect(rows[0].pagoEnLinea).not.toHaveProperty('initPoint');
    expect(rows[1]).toMatchObject({ pagoEnLinea: null, cubiertaPorDebito: false });
    expect(rows[2]).toMatchObject({ cubiertaPorDebito: true });
  });

  it('el admin marca un aviso como revisado y deja de verlo', async () => {
    const { ref } = await startCheckout({ tenantId: 7, userId: 1, cuotaId: 10 });
    await applyPaymentUpdate(7, account, payment({ externalReference: ref, amount: 5 }));
    const [alert] = await listAlerts(7);
    await markAlertReviewed(7, alert.id, 99);
    expect(await listAlerts(7)).toEqual([]);
    await expect(markAlertReviewed(8, alert.id, 99)).rejects.toMatchObject({ status: 404 });
  });
});
