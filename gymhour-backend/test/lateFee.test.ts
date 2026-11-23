import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const client: any = {
    cuota: { findUnique: vi.fn(), updateMany: vi.fn() },
    tenantSettings: { findFirst: vi.fn() },
  };
  client.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(client));
  return client;
});
const feeCycle = vi.hoisted(() => ({ localFeeToday: vi.fn() }));
const online = vi.hoisted(() => ({ onlinePaymentLock: vi.fn(), attachOnlinePayments: vi.fn((_tenantId: number, rows: unknown[]) => rows) }));

vi.mock('../src/models/Prisma.js', () => ({ systemPrisma: db, default: db }));
vi.mock('../src/services/feeCycle.service.js', () => feeCycle);
vi.mock('../src/services/memberPayments.service.js', () => online);

import { calculateLateFee, lateFeeDays, parseLateFeeSettings } from '../src/services/lateFee.service.js';
import { cuotaMethods } from '../src/controllers/cuota.Controller.js';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
// Vencimiento guardado como fin del día local, igual que lo crea el ciclo de cuotas.
const dueOn = (value: string) => new Date(day(value).getTime() + 86_400_000 - 1);
const settings = (overrides: Record<string, unknown> = {}) => ({
  recargoTipo: 'NINGUNO', recargoValor: 0, recargoTope: null, recargoDiasGracia: 0, ...overrides,
}) as any;

describe('días de atraso', () => {
  it('pagar el día del vencimiento no tiene atraso, y el día siguiente es 1', () => {
    expect(lateFeeDays(dueOn('2026-11-18'), day('2026-11-18'))).toBe(0);
    expect(lateFeeDays(dueOn('2026-11-18'), day('2026-11-19'))).toBe(1);
    expect(lateFeeDays(dueOn('2026-11-18'), day('2026-11-24'))).toBe(6);
  });

  it('un pago adelantado no da días negativos', () => {
    expect(lateFeeDays(dueOn('2026-11-18'), day('2026-11-10'))).toBe(0);
  });
});

describe('cálculo del recargo', () => {
  const cuota = { importe: 25000, vence: dueOn('2026-11-18') };
  const paidOn = day('2026-11-24');

  it('sin configuración o sin atraso no cobra nada', () => {
    expect(calculateLateFee(cuota, null, paidOn).monto).toBe(0);
    expect(calculateLateFee(cuota, settings({ recargoTipo: 'FIJO', recargoValor: 2000 }), day('2026-11-18')).monto).toBe(0);
  });

  it('monto fijo', () => {
    expect(calculateLateFee(cuota, settings({ recargoTipo: 'FIJO', recargoValor: 2000 }), paidOn))
      .toEqual({ tipo: 'FIJO', dias: 6, diasCobrables: 6, monto: 2000 });
  });

  it('porcentaje único', () => {
    expect(calculateLateFee(cuota, settings({ recargoTipo: 'PORCENTAJE', recargoValor: 10 }), paidOn).monto).toBe(2500);
  });

  it('porcentaje diario con tope', () => {
    const daily = settings({ recargoTipo: 'PORCENTAJE_DIARIO', recargoValor: 0.3, recargoTope: 15 });
    expect(calculateLateFee(cuota, daily, paidOn).monto).toBe(450);
    expect(calculateLateFee(cuota, { ...daily, recargoTope: 1 }, paidOn).monto).toBe(250);
  });

  it('los días de gracia se descuentan del atraso', () => {
    const graced = settings({ recargoTipo: 'PORCENTAJE_DIARIO', recargoValor: 1, recargoTope: 50, recargoDiasGracia: 3 });
    expect(calculateLateFee({ importe: 10000, vence: dueOn('2026-11-18') }, graced, paidOn))
      .toEqual({ tipo: 'PORCENTAJE_DIARIO', dias: 6, diasCobrables: 3, monto: 300 });
    expect(calculateLateFee(cuota, settings({ recargoTipo: 'FIJO', recargoValor: 2000, recargoDiasGracia: 6 }), paidOn).monto).toBe(0);
  });

  it('redondea a pesos enteros', () => {
    expect(calculateLateFee({ importe: 1000, vence: dueOn('2026-11-18') },
      settings({ recargoTipo: 'PORCENTAJE', recargoValor: 0.333 }), paidOn).monto).toBe(3);
  });
});

describe('validación de Ajustes', () => {
  it('si no se tocan los campos, no cambia nada', () => {
    expect(parseLateFeeSettings({ paymentAlias: 'MI.GYM' })).toEqual({ data: null });
  });

  it('sin recargo limpia el valor y el tope', () => {
    expect(parseLateFeeSettings({ recargoTipo: 'NINGUNO', recargoValor: 10 }).data)
      .toEqual({ recargoTipo: 'NINGUNO', recargoValor: 0, recargoTope: null, recargoDiasGracia: 0 });
  });

  it('rechaza valores inválidos', () => {
    expect(parseLateFeeSettings({ recargoTipo: 'OTRO' }).error).toBeTruthy();
    expect(parseLateFeeSettings({ recargoTipo: 'FIJO', recargoValor: 0 }).error).toBeTruthy();
    expect(parseLateFeeSettings({ recargoTipo: 'PORCENTAJE', recargoValor: 150 }).error).toBeTruthy();
    expect(parseLateFeeSettings({ recargoTipo: 'PORCENTAJE_DIARIO', recargoValor: 0.5 }).error).toMatch(/tope/);
    expect(parseLateFeeSettings({ recargoTipo: 'FIJO', recargoValor: 1000, recargoDiasGracia: 2.5 }).error).toBeTruthy();
  });

  it('acepta un recargo diario con tope y días de gracia', () => {
    expect(parseLateFeeSettings({ recargoTipo: 'porcentaje_diario', recargoValor: '0.5', recargoTope: '20', recargoDiasGracia: '3' }).data)
      .toEqual({ recargoTipo: 'PORCENTAJE_DIARIO', recargoValor: 0.5, recargoTope: 20, recargoDiasGracia: 3 });
  });
});

describe('pago manual con recargo', () => {
  const response = () => {
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    return res;
  };
  const pay = async (body: Record<string, unknown>) => {
    const res = response();
    await cuotaMethods.payCuota({ params: { id: '15' }, body, tenant: { id: 7 } } as any, res);
    return res;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    online.onlinePaymentLock.mockResolvedValue(null);
    feeCycle.localFeeToday.mockResolvedValue(day('2026-11-24'));
    db.cuota.findUnique.mockResolvedValueOnce({ ID_Cuota: 15, importe: 25000, vence: dueOn('2026-11-18'), pagada: false })
      .mockResolvedValueOnce({ ID_Cuota: 15, pagada: true });
    db.cuota.updateMany.mockResolvedValue({ count: 1 });
    db.tenantSettings.findFirst.mockResolvedValue(settings({ recargoTipo: 'FIJO', recargoValor: 2000 }));
  });

  it('cobra el recargo calculado en el servidor solo si el admin lo confirma', async () => {
    await pay({ formaPago: 'Efectivo', fechaPago: '2026-11-24', aplicarRecargo: true, referenciaPago: '  0001-123  ' });
    expect(db.cuota.updateMany).toHaveBeenCalledWith({ where: { ID_Cuota: 15, pagada: false }, data: expect.objectContaining({
      recargo: 2000, referenciaPago: '0001-123', formaPago: 'Efectivo',
    }) });
  });

  it('si el admin lo perdona, no cobra recargo', async () => {
    await pay({ formaPago: 'Efectivo', fechaPago: '2026-11-24', recargo: 999999 });
    expect(db.cuota.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ recargo: 0, referenciaPago: null }) }));
  });

  it('con un pago de Mercado Pago en curso o un débito automático, no deja registrar el pago a mano', async () => {
    online.onlinePaymentLock.mockResolvedValue({ code: 'PAGO_EN_CURSO', message: 'El socio está pagando esta cuota con Mercado Pago.' });
    const res = await pay({ formaPago: 'Efectivo' });
    expect(online.onlinePaymentLock).toHaveBeenCalledWith(7, 15);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'PAGO_EN_CURSO' }));
    expect(db.cuota.updateMany).not.toHaveBeenCalled();
  });

  it('una cuota ya pagada responde 409', async () => {
    db.cuota.findUnique.mockReset().mockResolvedValue({ ID_Cuota: 15, importe: 25000, vence: dueOn('2026-11-18'), pagada: true });
    const res = await pay({ formaPago: 'Efectivo' });
    expect(res.status).toHaveBeenCalledWith(409);
    expect(db.cuota.updateMany).not.toHaveBeenCalled();
  });
});
