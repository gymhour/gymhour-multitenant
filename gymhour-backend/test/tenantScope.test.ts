import { describe, expect, it } from 'vitest';
import { scopeTenantArgs, TENANT_MODELS } from '../src/models/Prisma.js';
import prisma from '../src/models/Prisma.js';

describe('Prisma tenant scope', () => {
  it.each(Array.from(TENANT_MODELS))('aísla lecturas del modelo %s', model => {
    const scoped = scopeTenantArgs(model, 'findMany', { where: {} }, 23);
    expect(scoped.where.tenantId).toBe(23);
  });

  it.each(['findMany', 'findFirst', 'findUnique', 'count', 'aggregate', 'groupBy', 'update', 'delete'])(
    'agrega tenantId en %s',
    operation => {
      const scoped = scopeTenantArgs('User', operation, { where: { estado: true } }, 7);
      expect(scoped.where).toEqual({ estado: true, tenantId: 7 });
    },
  );

  it('inyecta tenantId en creates y escrituras anidadas', () => {
    const scoped = scopeTenantArgs('Rutina', 'create', {
      data: {
        nombre: 'Fuerza',
        Bloques: { create: [{ type: 'ROUNDS', bloqueEjercicios: { create: [{ reps: '10' }] } }] },
      },
    }, 12);
    expect(scoped.data.tenantId).toBe(12);
    expect(scoped.data.Bloques.create[0].tenantId).toBe(12);
    expect(scoped.data.Bloques.create[0].bloqueEjercicios.create[0].tenantId).toBe(12);
  });

  it('rechaza tenantId del frontend cuando no coincide', () => {
    expect(() => scopeTenantArgs('Plan', 'create', { data: { tenantId: 99 } }, 1))
      .toThrow('CROSS_TENANT_WRITE_REJECTED');
    expect(() => scopeTenantArgs('Plan', 'findMany', { where: { tenantId: 99 } }, 1))
      .toThrow('CROSS_TENANT_WRITE_REJECTED');
  });

  it('no modifica modelos globales', () => {
    const args = { where: { id: 1 } };
    expect(scopeTenantArgs('PlatformUser', 'findUnique', args, 4)).toBe(args);
    expect(args.where).toEqual({ id: 1 });
  });

  it('falla cerrado si un modelo tenant se usa sin TenantContext', async () => {
    await expect(prisma.user.findMany()).rejects.toThrow('TENANT_CONTEXT_REQUIRED:User.findMany');
  });
});
