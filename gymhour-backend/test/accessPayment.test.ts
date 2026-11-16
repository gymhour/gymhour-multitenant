import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  user: { findFirst: vi.fn() },
  cuota: { findFirst: vi.fn() },
  turno: { findFirst: vi.fn(), updateMany: vi.fn() },
  asistencia: { create: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
}));

vi.mock('../src/models/Prisma.js', () => ({ default: db, systemPrisma: db }));

import { registrarAsistencia } from '../src/controllers/asistencia.Controller.js';
import { findActiveCuota, validateCuotaPaymentForBooking } from '../src/services/accessRules.service.js';

const cuotaBase = {
  ID_Cuota: 5, pagada: false, vencida: false, planRequiereTurnoSnapshot: false, planSesionesTotalesSnapshot: 0,
};
const student = { ID_Usuario: 9, nombre: 'Ana', apellido: 'López', estado: true, email: 'ana@example.com', role: 'STUDENT', dni: '30111222' };

const mockFees = ({ active = null, overdue = null }: { active?: unknown; overdue?: unknown }) => {
  db.cuota.findFirst.mockImplementation(async ({ where }: any) => {
    if (where.pagada === false) return overdue;
    if (where.fechaInicio) return active;
    return null;
  });
};
const checkIn = async () => {
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  await registrarAsistencia({ body: { dni: '30111222' } } as any, res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findFirst.mockResolvedValue(student);
  db.asistencia.findFirst.mockResolvedValue(null);
  db.asistencia.count.mockResolvedValue(0);
  db.asistencia.create.mockImplementation(async ({ data }: any) => ({ ID_Asistencia: 1, ...data }));
});

describe('ingreso según el pago de la cuota', () => {
  it('permite ingresar con una cuota impaga que todavía no venció', async () => {
    mockFees({ active: cuotaBase });
    const res = await checkIn();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      permitido: true, motivo: 'Acceso autorizado. La cuota está pendiente de pago.',
    }));
  });

  it('permite ingresar con la cuota paga', async () => {
    mockFees({ active: { ...cuotaBase, pagada: true } });
    const res = await checkIn();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ permitido: true, motivo: 'Acceso autorizado. Cuota al día.' }));
  });

  it('rechaza si hay una cuota vencida e impaga, aunque la actual esté paga', async () => {
    mockFees({ active: { ...cuotaBase, pagada: true }, overdue: { ID_Cuota: 4 } });
    const res = await checkIn();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ resultado: 'DENEGADO_CUOTA', motivo: 'Acceso denegado. Registra cuotas vencidas impagas.' }));
  });

  it('rechaza si no hay cuota activa', async () => {
    mockFees({});
    const res = await checkIn();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      resultado: 'DENEGADO_CUOTA', motivo: 'Acceso denegado. No se encontró una cuota activa para la fecha actual.',
    }));
  });
});

describe('búsqueda de la cuota activa', () => {
  it('el respaldo por mes aplica solo a cuotas viejas sin período', async () => {
    db.cuota.findFirst.mockResolvedValue(null);
    await findActiveCuota(9, new Date('2026-10-05T12:00:00.000Z'));
    expect(db.cuota.findFirst.mock.calls[1][0].where).toEqual({
      ID_Usuario: 9, mes: '2026-10', OR: [{ fechaInicio: null }, { fechaFin: null }],
    });
  });
});

describe('reservas según el pago', () => {
  it('solo bloquea la deuda vencida', async () => {
    db.cuota.findFirst.mockResolvedValue(null);
    expect(await validateCuotaPaymentForBooking(9)).toBeNull();

    db.cuota.findFirst.mockResolvedValue({ mes: '2026-10' });
    expect(await validateCuotaPaymentForBooking(9)).toMatch(/octubre 2026 vencida/);
  });
});
