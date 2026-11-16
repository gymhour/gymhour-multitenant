import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const client: any = {
    tenantSettings: { findFirst: vi.fn() },
    user: { findMany: vi.fn(), createMany: vi.fn() },
    plan: { findMany: vi.fn() },
    cuota: { createMany: vi.fn() },
    movimientoSocio: { createMany: vi.fn() },
  };
  client.$transaction = vi.fn((fn: (tx: unknown) => unknown) => fn(client));
  return client;
});

vi.mock('../src/models/Prisma.js', () => ({ default: db, systemPrisma: db }));
vi.mock('../src/services/cloudinary.service.js', () => ({
  deleteImage: vi.fn(), getImageUrl: vi.fn(), getMedicalRecordUrl: vi.fn(), uploadImageBuffer: vi.fn(),
}));
vi.mock('../src/services/email.service.js', () => ({ sendWelcomeEmail: vi.fn() }));

import { importUsers } from '../src/controllers/user.Controller.js';

const monthly = { ID_Plan: 3, nombre: 'Mensual', precio: 20000, duracion: 'MONTHS:1', sesionesTotales: 8, requiereTurno: true };
const row = (index: number, extra = {}) => ({
  email: `socio${index}@example.com`, dni: `3000000${index}`, nombre: 'Socio', apellido: String(index), ID_Plan: '3', ...extra,
});
const send = async (usuarios: unknown[]) => {
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  await importUsers({ body: { usuarios } } as any, res);
  return res;
};
const fieldErrors = (res: any) => res.json.mock.calls[0][0].errors.map((item: any) => item.campo);

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T15:00:00.000Z'));
  db.tenantSettings.findFirst.mockResolvedValue({ timezone: 'America/Argentina/Cordoba' });
  db.plan.findMany.mockResolvedValue([monthly]);
  db.user.createMany.mockImplementation(async ({ data }: any) => ({ count: data.length }));
  db.user.findMany.mockImplementation(async ({ where, select }: any) => (
    select?.ID_Usuario ? where.email.in.map((email: string, index: number) => ({ ID_Usuario: index + 100, email })) : []
  ));
});

afterEach(() => { vi.useRealTimers(); });

describe('importación con datos de cobro', () => {
  it('con inicio crea la cuota y activa el cobro; sin inicio deja el cobro en pausa', async () => {
    const res = await send([
      row(1, { inicioPeriodo: '20/10/2026', cuotaPaga: 'SI' }),
      row(2, { inicioPeriodo: '20/10/2026' }),
      row(3),
      row(4, { ID_Plan: '' }),
    ]);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ count: 4, cuotasCreadas: 2 }));

    const users = db.user.createMany.mock.calls[0][0].data;
    expect(users[0]).toMatchObject({ cobroAutomaticoActivo: true, proximoInicioCuota: new Date('2026-11-20T00:00:00.000Z'), diaAnclaCobro: 20 });
    expect(users[2]).toMatchObject({ cobroAutomaticoActivo: false, proximoInicioCuota: new Date('2026-11-02T00:00:00.000Z') });
    expect(users[3].cobroAutomaticoActivo).toBeUndefined();

    const fees = db.cuota.createMany.mock.calls[0][0].data;
    expect(fees).toHaveLength(2);
    expect(fees[0]).toMatchObject({ ID_Usuario: 100, pagada: true, vencida: false, origen: 'IMPORTACION', planSesionesTotalesSnapshot: 8 });
    expect(fees[1]).toMatchObject({ ID_Usuario: 101, pagada: false, vencida: true });
  });

  it('sin filas con inicio no crea cuotas', async () => {
    await send([row(1)]);
    expect(db.cuota.createMany).not.toHaveBeenCalled();
  });

  it.each([
    ['inicio sin plan', { ID_Plan: '', inicioPeriodo: '20/10/2026' }, 'inicioPeriodo'],
    ['fecha inválida', { inicioPeriodo: '31/02/2026' }, 'inicioPeriodo'],
    ['período ya terminado', { inicioPeriodo: '01/09/2026' }, 'inicioPeriodo'],
    ['valor inválido de pago', { inicioPeriodo: '20/10/2026', cuotaPaga: 'TAL VEZ' }, 'cuotaPaga'],
    ['paga sin inicio', { cuotaPaga: 'SI' }, 'cuotaPaga'],
  ])('rechaza la importación completa: %s', async (_name, extra, campo) => {
    const res = await send([row(1), row(2, extra)]);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(fieldErrors(res)).toContain(campo);
    expect(db.user.createMany).not.toHaveBeenCalled();
    expect(db.cuota.createMany).not.toHaveBeenCalled();
  });

  it('acepta SÍ con acento y en minúsculas', async () => {
    await send([row(1, { inicioPeriodo: '20/10/2026', cuotaPaga: 'sí' })]);
    expect(db.cuota.createMany.mock.calls[0][0].data[0].pagada).toBe(true);
  });
});
