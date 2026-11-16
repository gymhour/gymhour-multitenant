import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const client: any = {
    tenantSettings: { findFirst: vi.fn() },
    user: { findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    cuota: { findFirst: vi.fn(), create: vi.fn() },
  };
  client.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(client));
  return client;
});

vi.mock('../src/models/Prisma.js', () => ({ default: db, systemPrisma: db }));
vi.mock('../src/services/accessRules.service.js', () => ({
  buildCuotaPlanSnapshot: (plan: { nombre?: string }) => ({ planNombreSnapshot: plan.nombre ?? null }),
  generateFixedTurnosForCuota: vi.fn().mockResolvedValue({ created: 0, errores: [] }),
}));

import { buildImportedFeeCycle, generateDueFees } from '../src/services/feeCycle.service.js';

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const plan = { ID_Plan: 3, nombre: 'Mensual', precio: 20000, duracion: 'MONTHS:1' };

describe('generación automática de cuotas', () => {
  let student: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-02T15:00:00.000Z'));
    db.tenantSettings.findFirst.mockResolvedValue({ timezone: 'America/Argentina/Cordoba' });
    db.user.findMany.mockResolvedValue([{ ID_Usuario: 9 }]);
    db.user.findFirst.mockImplementation(async () => student);
    db.user.update.mockImplementation(async ({ data }: any) => { student = { ...student, ...data }; });
    db.cuota.findFirst.mockResolvedValue(null);
    db.cuota.create.mockImplementation(async ({ data }: any) => ({ ID_Cuota: 1, ...data }));
  });

  afterEach(() => { vi.useRealTimers(); });

  it('al volver de un bloqueo crea solo la cuota del período actual', async () => {
    student = { ID_Usuario: 9, ID_Plan: 3, plan, diaAnclaCobro: 10, proximoInicioCuota: day('2026-08-10') };

    const result = await generateDueFees();

    expect(result).toEqual({ created: 1, skipped: 0, errors: 0 });
    expect(db.cuota.create).toHaveBeenCalledTimes(1);
    const { data } = db.cuota.create.mock.calls[0][0];
    expect(data.fechaInicio).toEqual(day('2026-10-10'));
    expect(data.vencida).toBe(true);
    expect(data.origen).toBe('AUTOMATICA');
    expect(student.proximoInicioCuota).toEqual(day('2026-11-10'));
  });

  it('crea la próxima cuota tres días antes sin marcarla vencida', async () => {
    student = { ID_Usuario: 9, ID_Plan: 3, plan, diaAnclaCobro: 5, proximoInicioCuota: day('2026-11-05') };

    await generateDueFees();

    const { data } = db.cuota.create.mock.calls[0][0];
    expect(data.fechaInicio).toEqual(day('2026-11-05'));
    expect(data.vencida).toBe(false);
    expect(student.proximoInicioCuota).toEqual(day('2026-12-05'));
  });

  it('no duplica una cuota que ya existe con el mismo inicio', async () => {
    student = { ID_Usuario: 9, ID_Plan: 3, plan, diaAnclaCobro: 5, proximoInicioCuota: day('2026-11-05') };
    db.cuota.findFirst.mockResolvedValueOnce({ fechaInicio: day('2026-11-05'), fechaFin: new Date('2026-12-04T23:59:59.999Z') });

    const result = await generateDueFees();

    expect(result.skipped).toBe(1);
    expect(db.cuota.create).not.toHaveBeenCalled();
    expect(student.proximoInicioCuota).toEqual(day('2026-12-05'));
  });
});

describe('ciclo de un socio importado', () => {
  const today = day('2026-11-02');

  it('sin fecha de inicio deja el cobro en pausa y no crea cuota', () => {
    const cycle = buildImportedFeeCycle(plan, null, false, today);
    expect(cycle.fee).toBeNull();
    expect(cycle.user).toEqual({ fechaInicioCobro: today, proximoInicioCuota: today, diaAnclaCobro: 2, cobroAutomaticoActivo: false });
  });

  it('con inicio pasado e impaga crea la cuota vencida y activa el cobro', () => {
    const cycle = buildImportedFeeCycle(plan, day('2026-10-20'), false, today);
    expect(cycle.user).toMatchObject({ fechaInicioCobro: day('2026-10-20'), proximoInicioCuota: day('2026-11-20'), diaAnclaCobro: 20, cobroAutomaticoActivo: true });
    expect(cycle.fee).toMatchObject({ mes: '2026-10', pagada: false, vencida: true, fechaPago: null, formaPago: null, origen: 'IMPORTACION', importe: 20000 });
  });

  it('informada como paga queda pagada y sin vencer', () => {
    const cycle = buildImportedFeeCycle(plan, day('2026-10-20'), true, today);
    expect(cycle.fee).toMatchObject({ pagada: true, vencida: false, fechaPago: today, formaPago: 'Informado al importar' });
  });

  it('con inicio futuro queda impaga sin vencer', () => {
    const cycle = buildImportedFeeCycle(plan, day('2026-11-15'), false, today);
    expect(cycle.fee).toMatchObject({ pagada: false, vencida: false });
  });

  it('un plan gratuito queda pagado automáticamente', () => {
    const cycle = buildImportedFeeCycle({ ...plan, precio: 0 }, day('2026-10-20'), false, today);
    expect(cycle.fee).toMatchObject({ pagada: true, vencida: false, formaPago: 'Plan gratuito' });
  });
});
