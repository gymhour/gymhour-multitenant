import { describe, expect, it } from 'vitest';
import { buildStudentSearchFilter, fitAiRoutineDraftToStorage, getToolsForRole, summarizeFeeStatus } from '../src/services/aiTools.service.js';

describe('Herramientas del asistente IA', () => {
  it('expone finanzas únicamente al administrador', () => {
    const adminNames = getToolsForRole('ADMIN').map(tool => tool.name);
    const trainerNames = getToolsForRole('TRAINER').map(tool => tool.name);
    const studentNames = getToolsForRole('STUDENT').map(tool => tool.name);
    expect(adminNames).toContain('get_financial_summary');
    expect(trainerNames).not.toContain('get_financial_summary');
    expect(trainerNames).toContain('build_routine_draft');
    expect(studentNames).toEqual([]);
  });

  it('define esquemas estrictos y cerrados', () => {
    for (const role of ['ADMIN', 'TRAINER', 'STUDENT'] as const) {
      for (const tool of getToolsForRole(role)) {
        expect(tool.strict).toBe(true);
        expect(tool.parameters.type).toBe('object');
        expect(tool.parameters.additionalProperties).toBe(false);
        expect(Array.isArray(tool.parameters.required)).toBe(true);
      }
    }
  });

  it('limita el tamaño estructural de una rutina', () => {
    const tool = getToolsForRole('TRAINER').find(item => item.name === 'build_routine_draft');
    expect(tool.parameters.properties.days.maxItems).toBe(7);
    expect(tool.parameters.properties.days.items.properties.blocks.maxItems).toBe(8);
    expect(tool.parameters.properties.days.items.properties.blocks.items.properties.exercises.maxItems).toBe(12);
    expect(tool.parameters.properties.name.maxLength).toBe(191);
    expect(tool.parameters.properties.days.items.properties.name.maxLength).toBe(191);
    expect(tool.parameters.properties.days.items.properties.blocks.items.properties.exercises.items.properties.reps.maxLength).toBe(191);
  });

  it('ajusta los campos cortos de borradores existentes sin recortar las descripciones', () => {
    const long = 'a'.repeat(250);
    const draft = fitAiRoutineDraftToStorage({
      nombre: long,
      desc: long,
      dias: {
        dia1: {
          nombre: long,
          descripcion: long,
          bloques: [{
            descTabata: long,
            bloqueEjercicios: [{ reps: long, setRepWeight: long, nuevoEjercicio: { nombre: long } }],
          }],
        },
      },
    });

    expect(Array.from(draft.nombre)).toHaveLength(191);
    expect(draft.desc).toHaveLength(250);
    expect(draft.dias.dia1.descripcion).toHaveLength(250);
    expect(draft.dias.dia1.bloques[0].descTabata).toHaveLength(250);
    expect(Array.from(draft.dias.dia1.bloques[0].bloqueEjercicios[0].reps)).toHaveLength(191);
    expect(Array.from(draft.dias.dia1.bloques[0].bloqueEjercicios[0].nuevoEjercicio.nombre)).toHaveLength(191);
  });

  it('busca nombres completos haciendo coincidir cada término', () => {
    expect(buildStudentSearchFilter('Valentino Casesi')).toEqual({
      AND: [
        { OR: [{ nombre: { contains: 'Valentino' } }, { apellido: { contains: 'Valentino' } }, { dni: { contains: 'Valentino' } }] },
        { OR: [{ nombre: { contains: 'Casesi' } }, { apellido: { contains: 'Casesi' } }, { dni: { contains: 'Casesi' } }] },
      ],
    });
    expect(buildStudentSearchFilter('  ')).toEqual({});
  });

  it('resume el estado de la cuota correspondiente al mes actual', () => {
    const now = new Date('2026-09-14T12:00:00.000Z');
    expect(summarizeFeeStatus([
      { mes: '2026-09', pagada: true, vencida: false, vence: new Date('2026-09-10'), fechaPago: new Date('2026-09-05') },
    ], now)).toMatchObject({ mes: '2026-09', estado: 'PAGADA', cuotasVencidas: 0 });
    expect(summarizeFeeStatus([
      { mes: '2026-09', pagada: false, vencida: false, vence: new Date('2026-09-10') },
    ], now)).toMatchObject({ estado: 'VENCIDA', cuotasVencidas: 1 });
  });
});
