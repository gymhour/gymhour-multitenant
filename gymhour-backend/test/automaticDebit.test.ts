import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetFakePrisma, sharedFakePrisma as db } from './helpers/fakePrisma.js';

vi.mock('../src/models/Prisma.js', async () => {
  const { sharedFakePrisma } = await import('./helpers/fakePrisma.js');
  return { systemPrisma: sharedFakePrisma, default: sharedFakePrisma };
});
const mp = vi.hoisted(() => ({
  createPreapproval: vi.fn(), getPreapproval: vi.fn(), cancelPreapproval: vi.fn(), updatePreapprovalAmount: vi.fn(),
  getAuthorizedPayment: vi.fn(), getPayment: vi.fn(), createPreference: vi.fn(), searchPaymentsByReference: vi.fn(),
}));
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
const feeCycle = vi.hoisted(() => ({ generateDueFeesForUser: vi.fn() }));
vi.mock('../src/services/feeCycle.service.js', () => feeCycle);

import { MercadoPagoError } from '../src/services/mercadoPago.service.js';
import {
  adhereDebit, applyDebitPayment, cancelDebit, debitFrequency, firstDebitDate, onUserPlanChange, reconcileActiveDebits,
  reconcileDebitCharges, syncDebit, syncDebitsWithPlan, verifyDebit,
} from '../src/services/automaticDebit.service.js';

const DAY = 86_400_000;
const account = { tenantId: 7, mpUserId: '99', status: 'CONNECTED' } as any;
const utcDay = (offsetDays: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) + offsetDays * DAY);
};
const payment = (overrides: Record<string, unknown> = {}) => ({
  id: '7001', status: 'approved', statusDetail: 'accredited', amount: 25000, refundedAmount: 0, currency: 'ARS',
  externalReference: 'deb-ref', collectorId: '99', merchantOrderId: null, paymentMethod: 'Visa crédito',
  netAmount: 24000, payerEmail: 'socio@example.com', dateApproved: new Date(), dateCreated: new Date(), ...overrides,
}) as any;
const plan = { ID_Plan: 3, nombre: 'Mensual', precio: 25000, duracion: 'MONTHS:1' };

const seedDebit = (overrides: Record<string, unknown> = {}) => db.debitoAutomatico.create({ data: {
  tenantId: 7, ID_Usuario: 1, ID_Plan: 3, preapprovalId: 'pre_000001', externalReference: 'deb-ref', activeKey: '7:1',
  status: 'ACTIVO', payerEmail: 'socio@example.com', amount: 25000, frequency: 1, frequencyType: 'months',
  startDate: utcDay(1), ...overrides,
} });

beforeEach(async () => {
  vi.clearAllMocks();
  resetFakePrisma();
  feeCycle.generateDueFeesForUser.mockReset().mockResolvedValue({ created: 0, skipped: 0, errors: 0 });
  process.env.FRONTEND_URL = 'https://app.gymhour.test';
  await db.tenant.create({ data: { id: 7, name: 'Gym Test', slug: 'gym-test', status: 'ACTIVE' } });
  await db.tenantSettings.create({ data: { tenantId: 7, timezone: 'America/Argentina/Cordoba' } });
  await db.user.create({ data: { ID_Usuario: 1, tenantId: 7, role: 'STUDENT', estado: true, email: 'socio@gym.test',
    ID_Plan: 3, plan, cobroAutomaticoActivo: true, proximoInicioCuota: utcDay(1), diaAnclaCobro: utcDay(1).getUTCDate() } });
  mp.createPreapproval.mockResolvedValue({ id: 'pre_000001', status: 'pending', externalReference: null, collectorId: '99',
    amount: 25000, currency: 'ARS', frequency: 1, frequencyType: 'months', nextPaymentDate: null,
    initPoint: 'https://www.mercadopago.com.ar/subscriptions/checkout?preapproval_id=pre_000001' });
});

describe('frecuencia y primer cobro', () => {
  it('los planes por meses se cobran cada n meses y los de semanas en días', () => {
    expect(debitFrequency('MONTHS:1')).toEqual({ frequency: 1, frequencyType: 'months' });
    expect(debitFrequency('MENSUAL')).toEqual({ frequency: 1, frequencyType: 'months' });
    expect(debitFrequency('WEEKS:2')).toEqual({ frequency: 14, frequencyType: 'days' });
    expect(debitFrequency('OTRA')).toBeNull();
  });

  it('el primer cobro es el primer período futuro sin pagar', async () => {
    const user = { ID_Usuario: 1, proximoInicioCuota: utcDay(1), diaAnclaCobro: utcDay(1).getUTCDate(), plan };
    expect(await firstDebitDate(7, user, utcDay(0))).toEqual(utcDay(1));
    // La cuota del próximo período ya existe (el cron la crea 3 días antes) y está impaga: arranca ahí.
    await db.cuota.create({ data: { ID_Cuota: 50, tenantId: 7, ID_Usuario: 1, fechaInicio: utcDay(2), pagada: false } });
    expect(await firstDebitDate(7, { ...user, proximoInicioCuota: utcDay(32) }, utcDay(0))).toEqual(utcDay(2));
    // Si ya la pagó, arranca en el período siguiente.
    db.cuota.rows[0].pagada = true;
    expect(await firstDebitDate(7, { ...user, proximoInicioCuota: utcDay(32) }, utcDay(0))).toEqual(utcDay(32));
  });

  it('si el cursor quedó atrás, el primer cobro es el próximo período después de hoy', async () => {
    const start = await firstDebitDate(7, { ID_Usuario: 1, proximoInicioCuota: utcDay(-40), diaAnclaCobro: null, plan }, utcDay(0));
    expect(start.getTime()).toBeGreaterThan(utcDay(0).getTime());
  });
});

describe('adhesión', () => {
  it('crea la suscripción con el email de Mercado Pago, el precio del plan y la fecha del primer cobro', async () => {
    const result = await adhereDebit({ tenantId: 7, userId: 1, payerEmail: ' Socio@Example.com ' });
    expect(result).toMatchObject({ status: 'PENDIENTE', initPoint: expect.stringContaining('pre_000001') });
    const body = mp.createPreapproval.mock.calls[0][1];
    expect(body).toMatchObject({ payer_email: 'socio@example.com', status: 'pending', back_url: expect.stringContaining('/alumno/cuotas?debito=') });
    expect(body.auto_recurring).toMatchObject({ frequency: 1, frequency_type: 'months', transaction_amount: 25000, currency_id: 'ARS' });
    expect(new Date(body.auto_recurring.start_date).getTime()).toBeGreaterThan(Date.now());
    expect(db.debitoAutomatico.rows[0]).toMatchObject({ activeKey: '7:1', preapprovalId: 'pre_000001', status: 'PENDIENTE' });
  });

  it('valida el email, el plan, el ciclo y los pagos en curso', async () => {
    await expect(adhereDebit({ tenantId: 7, userId: 1, payerEmail: 'no-es-email' })).rejects.toMatchObject({ code: 'EMAIL_INVALIDO' });
    db.user.rows[0].cobroAutomaticoActivo = false;
    await expect(adhereDebit({ tenantId: 7, userId: 1, payerEmail: 'a@b.com' })).rejects.toMatchObject({ code: 'CICLO_INACTIVO' });
    db.user.rows[0].cobroAutomaticoActivo = true;
    db.user.rows[0].plan = { ...plan, precio: 0 };
    await expect(adhereDebit({ tenantId: 7, userId: 1, payerEmail: 'a@b.com' })).rejects.toMatchObject({ code: 'PLAN_GRATUITO' });
    db.user.rows[0].plan = plan;
    await db.cuotaPago.create({ data: { tenantId: 7, ID_Usuario: 1, ID_Cuota: 1, lockKey: '7:1', externalReference: 'ref-checkout-1', status: 'INICIADO' } });
    await expect(adhereDebit({ tenantId: 7, userId: 1, payerEmail: 'a@b.com' })).rejects.toMatchObject({ code: 'PAGO_EN_CURSO' });
    expect(mp.createPreapproval).not.toHaveBeenCalled();
  });

  it('si Mercado Pago no acepta la suscripción, no queda nada a medias', async () => {
    mp.createPreapproval.mockRejectedValue(new MercadoPagoError(400, 'MP_BAD_REQUEST'));
    await expect(adhereDebit({ tenantId: 7, userId: 1, payerEmail: 'a@b.com' })).rejects.toMatchObject({ code: 'DEBITO_RECHAZADO' });
    expect(db.debitoAutomatico.rows).toHaveLength(0);
  });

  it('un segundo intento retoma la autorización pendiente; con un débito activo responde 409', async () => {
    const first = await adhereDebit({ tenantId: 7, userId: 1, payerEmail: 'a@b.com' });
    await expect(adhereDebit({ tenantId: 7, userId: 1, payerEmail: 'a@b.com' })).resolves.toMatchObject({ id: first.id, resumed: true });
    db.debitoAutomatico.rows[0].status = 'ACTIVO';
    await expect(adhereDebit({ tenantId: 7, userId: 1, payerEmail: 'a@b.com' })).rejects.toMatchObject({ code: 'DEBITO_ACTIVO' });
  });
});

describe('cobros del débito', () => {
  beforeEach(async () => {
    await db.cuota.create({ data: { ID_Cuota: 60, tenantId: 7, ID_Usuario: 1, importe: 25000, fechaInicio: utcDay(1),
      fechaFin: utcDay(30), vence: new Date(utcDay(1).getTime() + DAY - 1), pagada: false, vencida: false } });
  });

  it('un cobro aprobado marca la cuota del período con el número de operación', async () => {
    const debit = await seedDebit({ status: 'CON_RECHAZO' });
    expect(await applyDebitPayment(debit, account, payment(), utcDay(1))).toBe('APLICADO');
    expect(db.cuota.rows[0]).toMatchObject({ pagada: true, formaPago: 'Mercado Pago (débito automático)', referenciaPago: '7001', recargo: 0 });
    expect(db.debitoAutomatico.rows[0]).toMatchObject({ status: 'ACTIVO', lastChargeStatus: 'approved' });
    expect(db.cuotaPago.rows[0]).toMatchObject({ origen: 'DEBITO', status: 'APROBADO', debitoId: debit.id });
    // El mismo aviso otra vez no hace nada.
    expect(await applyDebitPayment(debit, account, payment(), utcDay(1))).toBe('SIN_CAMBIOS');
    expect(db.cuotaPago.rows).toHaveLength(1);
  });

  it('si cobró un monto distinto, igual la marca pagada y avisa al admin', async () => {
    const debit = await seedDebit();
    await applyDebitPayment(debit, account, payment({ amount: 30000 }), utcDay(1));
    expect(db.cuota.rows[0].pagada).toBe(true);
    expect(db.cuotaPago.rows[0].reviewNote).toMatch(/30000/);
  });

  it('un cobro rechazado deja el débito con rechazo y la cuota impaga', async () => {
    const debit = await seedDebit();
    expect(await applyDebitPayment(debit, account, payment({ status: 'rejected' }), utcDay(1))).toBe('RECHAZADO');
    expect(db.debitoAutomatico.rows[0]).toMatchObject({ status: 'CON_RECHAZO', lastChargeStatus: 'rejected' });
    expect(db.cuota.rows[0].pagada).toBe(false);
  });

  it('si la cuota del período no existe, la crea con la lógica del cron', async () => {
    db.cuota.rows.length = 0;
    const debit = await seedDebit();
    feeCycle.generateDueFeesForUser.mockImplementation(async () => {
      await db.cuota.create({ data: { ID_Cuota: 61, tenantId: 7, ID_Usuario: 1, importe: 25000, fechaInicio: utcDay(1), pagada: false } });
      return { created: 1, skipped: 0, errors: 0 };
    });
    expect(await applyDebitPayment(debit, account, payment(), utcDay(1))).toBe('APLICADO');
    expect(feeCycle.generateDueFeesForUser).toHaveBeenCalledWith(1);
    expect(db.cuota.rows[0]).toMatchObject({ ID_Cuota: 61, pagada: true });
  });

  it('un cobro de un período ya pagado queda como duplicado', async () => {
    db.cuota.rows[0].pagada = true;
    const debit = await seedDebit();
    expect(await applyDebitPayment(debit, account, payment(), utcDay(1))).toBe('DUPLICADO');
    expect(db.cuotaPago.rows[0]).toMatchObject({ status: 'DUPLICADO', mpPaymentId: '7001', ID_Cuota: 60 });
  });

  it('ignora cobros de otra cuenta de Mercado Pago', async () => {
    const debit = await seedDebit();
    expect(await applyDebitPayment(debit, account, payment({ collectorId: '1234' }), utcDay(1))).toBe('IGNORADO');
    expect(db.cuota.rows[0].pagada).toBe(false);
  });
});

describe('baja y cambios', () => {
  it('cancelar exige que Mercado Pago confirme la baja', async () => {
    const debit = await seedDebit();
    mp.cancelPreapproval.mockResolvedValue({ status: 'authorized' });
    await expect(cancelDebit(debit, { by: 'Socio · x', reason: 'Baja' })).rejects.toMatchObject({ code: 'DEBITO_NO_CANCELADO' });
    expect(db.debitoAutomatico.rows[0]).toMatchObject({ status: 'ACTIVO', activeKey: '7:1' });
    mp.cancelPreapproval.mockResolvedValue({ status: 'cancelled' });
    await cancelDebit(debit, { by: 'Socio · x', reason: 'Baja' });
    expect(db.debitoAutomatico.rows[0]).toMatchObject({ status: 'CANCELADO', activeKey: null, cancelledBy: 'Socio · x' });
  });

  it('si ya estaba cancelada en Mercado Pago, lo confirma consultándola', async () => {
    const debit = await seedDebit();
    mp.cancelPreapproval.mockRejectedValue(new MercadoPagoError(400, 'MP_BAD_REQUEST'));
    mp.getPreapproval.mockResolvedValue({ status: 'cancelled' });
    await cancelDebit(debit, { by: 'Admin · x', reason: 'Baja' });
    expect(db.debitoAutomatico.rows[0].status).toBe('CANCELADO');
  });

  it('un cambio de precio actualiza el monto; un cambio de duración cancela el débito', async () => {
    await seedDebit();
    mp.updatePreapprovalAmount.mockResolvedValue({});
    expect(await syncDebitsWithPlan(7, { ID_Plan: 3, precio: 30000, duracion: 'MONTHS:1' })).toMatchObject({ updated: 1 });
    expect(mp.updatePreapprovalAmount).toHaveBeenCalledWith('TOKEN', 'pre_000001', 30000);
    expect(db.debitoAutomatico.rows[0].amount).toBe(30000);
    mp.cancelPreapproval.mockResolvedValue({ status: 'cancelled' });
    expect(await syncDebitsWithPlan(7, { ID_Plan: 3, precio: 30000, duracion: 'MONTHS:3' })).toMatchObject({ cancelled: 1 });
    expect(db.debitoAutomatico.rows[0].status).toBe('CANCELADO');
  });

  it('si el socio cambia a un plan con la misma frecuencia se ajusta el monto; si no, se cancela', async () => {
    await seedDebit();
    mp.updatePreapprovalAmount.mockResolvedValue({});
    await onUserPlanChange(7, 1, { ID_Plan: 4, precio: 28000, duracion: 'MONTHS:1' });
    expect(db.debitoAutomatico.rows[0]).toMatchObject({ ID_Plan: 4, amount: 28000 });
    mp.cancelPreapproval.mockResolvedValue({ status: 'cancelled' });
    await onUserPlanChange(7, 1, { ID_Plan: 5, precio: 9000, duracion: 'WEEKS:1' });
    expect(db.debitoAutomatico.rows[0].status).toBe('CANCELADO');
  });

  it('la sincronización refleja la baja o la pausa hechas desde Mercado Pago', async () => {
    const debit = await seedDebit({ status: 'CON_RECHAZO' });
    mp.getPreapproval.mockResolvedValue({ status: 'authorized', externalReference: 'deb-ref', collectorId: '99', nextPaymentDate: null, initPoint: null });
    expect((await syncDebit(debit, account, 'TOKEN')).status).toBe('CON_RECHAZO');
    mp.getPreapproval.mockResolvedValue({ status: 'paused', externalReference: 'deb-ref', collectorId: '99', nextPaymentDate: null, initPoint: null });
    expect((await syncDebit(debit, account, 'TOKEN')).status).toBe('PAUSADO');
    mp.getPreapproval.mockResolvedValue({ status: 'cancelled', externalReference: 'deb-ref', collectorId: '99', nextPaymentDate: null, initPoint: null });
    expect(await syncDebit({ ...db.debitoAutomatico.rows[0] }, account, 'TOKEN')).toMatchObject({ status: 'CANCELADO', activeKey: null, cancelledBy: 'Mercado Pago' });
  });
});

describe('conciliación de cobros (aviso perdido)', () => {
  const preapproval = (status: string) => ({ status, externalReference: 'deb-ref', collectorId: '99', nextPaymentDate: null, initPoint: null });

  beforeEach(async () => {
    await db.cuota.create({ data: { ID_Cuota: 70, tenantId: 7, ID_Usuario: 1, importe: 25000, fechaInicio: utcDay(-1),
      fechaFin: utcDay(28), vence: new Date(utcDay(-1).getTime() + DAY - 1), pagada: false, vencida: true } });
  });

  it('registra un cobro aprobado que nunca llegó por aviso, y no lo repite', async () => {
    const debit = await seedDebit({ startDate: utcDay(-1) });
    mp.searchPaymentsByReference.mockResolvedValue([payment({ id: '8001', dateApproved: new Date() })]);
    expect(await reconcileDebitCharges(debit, account, 'TOKEN')).toBe(1);
    expect(mp.searchPaymentsByReference).toHaveBeenCalledWith('TOKEN', 'deb-ref');
    expect(db.cuota.rows.find((row: any) => row.ID_Cuota === 70)).toMatchObject({
      pagada: true, referenciaPago: '8001', formaPago: 'Mercado Pago (débito automático)',
    });
    expect(await reconcileDebitCharges(debit, account, 'TOKEN')).toBe(0);
    expect(db.cuotaPago.rows).toHaveLength(1);
  });

  it('ignora los rechazados y refleja una devolución hecha desde Mercado Pago', async () => {
    const debit = await seedDebit({ startDate: utcDay(-1) });
    mp.searchPaymentsByReference.mockResolvedValue([payment({ id: '8002', status: 'rejected' })]);
    expect(await reconcileDebitCharges(debit, account, 'TOKEN')).toBe(0);
    expect(db.cuotaPago.rows).toHaveLength(0);

    mp.searchPaymentsByReference.mockResolvedValue([payment({ id: '8003' })]);
    await reconcileDebitCharges(debit, account, 'TOKEN');
    mp.searchPaymentsByReference.mockResolvedValue([payment({ id: '8003', status: 'refunded' })]);
    await reconcileDebitCharges(debit, account, 'TOKEN');
    expect(db.cuota.rows.find((row: any) => row.ID_Cuota === 70)).toMatchObject({ pagada: false, referenciaPago: null });
    expect(db.cuotaPago.rows[0].status).toBe('DEVUELTO');
  });

  it('la tarea diaria concilia los débitos activos y con rechazo, y sincroniza los que vencieron', async () => {
    await seedDebit({ startDate: utcDay(-1), nextChargeDate: utcDay(20) });
    await seedDebit({ ID_Usuario: 2, activeKey: '7:2', preapprovalId: 'pre_000002', externalReference: 'deb-ref-2', status: 'CON_RECHAZO' });
    await seedDebit({ ID_Usuario: 3, activeKey: '7:3', preapprovalId: 'pre_000003', externalReference: 'deb-ref-3', status: 'PAUSADO' });
    await seedDebit({ ID_Usuario: 4, activeKey: null, preapprovalId: 'pre_000004', externalReference: 'deb-ref-4', status: 'CANCELADO' });
    mp.searchPaymentsByReference.mockResolvedValue([]);
    mp.getPreapproval.mockResolvedValue({ ...preapproval('authorized'), externalReference: 'deb-ref-2' });
    await reconcileActiveDebits(7);
    expect(mp.searchPaymentsByReference.mock.calls.map(call => call[1]).sort()).toEqual(['deb-ref', 'deb-ref-2']);
    // Solo el que tuvo un rechazo necesita sincronizarse: el otro todavía no llegó a su fecha de cobro.
    expect(mp.getPreapproval.mock.calls.map(call => call[1])).toEqual(['pre_000002']);
  });

  it('la verificación a pedido devuelve cuántos cobros registró', async () => {
    const debit = await seedDebit({ startDate: utcDay(-1) });
    mp.getPreapproval.mockResolvedValue(preapproval('authorized'));
    mp.searchPaymentsByReference.mockResolvedValue([payment({ id: '8004' })]);
    await expect(verifyDebit(debit)).resolves.toMatchObject({ status: 'ACTIVO', cobrosRegistrados: 1 });
  });
});
