import { describe, expect, it } from 'vitest';
import { planChangeCharge, proratedPlanDifference } from '../src/services/planChange.service.js';

describe('cambio proporcional de plan', () => {
  const start = new Date('2026-10-01T00:00:00.000Z');
  const end = new Date('2026-10-31T00:00:00.000Z');

  it('cobra la mitad de la diferencia al subir a Pro a mitad del ciclo', () => {
    expect(proratedPlanDifference('ESSENTIAL_MONTHLY', 'PRO_MONTHLY', start, end,
      new Date('2026-10-16T00:00:00.000Z'))).toBe(25_000);
  });

  it('programa la baja sin cobro ni devolución en el ciclo actual', () => {
    expect(planChangeCharge('PRO_MONTHLY', 'ESSENTIAL_MONTHLY', start, end,
      new Date('2026-10-16T00:00:00.000Z'))).toBe(0);
  });

  it('rechaza períodos vencidos y planes idénticos', () => {
    expect(() => proratedPlanDifference('ESSENTIAL_MONTHLY', 'PRO_MONTHLY', start, end, end)).toThrow();
    expect(() => proratedPlanDifference('PRO_MONTHLY', 'PRO_MONTHLY', start, end, start)).toThrow();
  });

  it('mantiene un cobro mínimo en una subida durante el último instante del ciclo', () => {
    expect(planChangeCharge('ESSENTIAL_MONTHLY', 'PRO_MONTHLY', start, end,
      new Date(end.getTime() - 1))).toBe(1);
  });
});
