import { describe, expect, it } from 'vitest';
import { getToolsForRole } from '../src/services/aiTools.service.js';

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
  });
});
