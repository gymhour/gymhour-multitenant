import { AsyncResource } from 'node:async_hooks';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { preserveTenantContext } from '../src/services/multer.service.js';
import { getTenantContext, runWithTenantContext, type TenantContext } from '../src/services/tenantContext.service.js';

const tenantContext = {
  tenantId: 17,
  user: {
    id: 4,
    tenantId: 17,
    email: 'admin@gym.test',
    role: 'ADMIN',
    authVersion: 1,
    setupGuideDismissedAt: null,
  },
  tenant: { id: 17, name: 'Gym Test', slug: 'gym-test', status: 'ACTIVE' },
  db: {} as TenantContext['db'],
  source: 'TEST',
} satisfies TenantContext;

describe('Multer tenant context', () => {
  it('restaura el contexto cuando el parser multipart finaliza desde otro recurso asíncrono', async () => {
    const multipartResource = new AsyncResource('multipart-test');
    const multipartMiddleware: RequestHandler = (_req, _res, next) => {
      multipartResource.runInAsyncScope(() => next());
    };
    const tenantAwareMiddleware = preserveTenantContext(multipartMiddleware);

    const observedTenantId = await new Promise<number>((resolve, reject) => {
      const next: NextFunction = error => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(getTenantContext().tenantId);
        } catch (contextError) {
          reject(contextError);
        }
      };

      runWithTenantContext(tenantContext, () => {
        tenantAwareMiddleware({} as Request, {} as Response, next);
      });
    });

    multipartResource.emitDestroy();
    expect(observedTenantId).toBe(17);
  });
});
