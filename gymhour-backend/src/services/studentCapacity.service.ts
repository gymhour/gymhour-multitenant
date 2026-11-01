import type { NextFunction, Request, Response } from 'express';
import { systemPrisma } from '../models/Prisma.js';
import { tenantPlanAccess } from './planAccess.service.js';

type Change = 'CREATE' | 'UPDATE' | 'STATUS' | 'IMPORT';

export const requireStudentCapacity = (change: Change) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.user!.tenantId;
    const access = await tenantPlanAccess(tenantId);
    if (!access.scheduledPlanCode && (access.state === 'EXEMPT' || access.state === 'TRIAL'
      || access.trialEndsAt && access.trialEndsAt > new Date())) { next(); return; }
    const limit = access.tierCode === 'ESSENTIAL' || access.scheduledPlanCode === 'ESSENTIAL_MONTHLY'
      ? 100 : access.tierCode === 'PRO' ? 200 : null;
    if (limit === null) { next(); return; }

    let additional = 0;
    if (change === 'CREATE') additional = String(req.body.role || 'STUDENT').toUpperCase() === 'STUDENT' ? 1 : 0;
    if (change === 'IMPORT' && Array.isArray(req.body.usuarios)) additional = req.body.usuarios.length;
    if (change === 'UPDATE' || change === 'STATUS') {
      const current = await systemPrisma.user.findFirst({ where: { tenantId, ID_Usuario: Number(req.params.id) },
        select: { role: true, estado: true } });
      const nextRole = change === 'UPDATE' && req.body.role ? String(req.body.role).toUpperCase() : current?.role;
      const nextActive = change === 'STATUS' ? req.body.estado === true
        : req.body.estado === undefined ? current?.estado : req.body.estado === true;
      if (current && nextRole === 'STUDENT' && nextActive && (current.role !== 'STUDENT' || !current.estado)) additional = 1;
    }
    if (additional === 0) { next(); return; }
    const active = await systemPrisma.user.count({ where: { tenantId, role: 'STUDENT', estado: true } });
    if (active + additional <= limit) { next(); return; }
    res.status(409).json({ code: 'PLAN_STUDENT_LIMIT', message: access.scheduledPlanCode
      ? `Tenés un cambio a Esencial programado y su límite es de ${limit} socios activos.`
      : `Tu plan permite hasta ${limit} socios activos. Cambiá al plan superior para agregar más.` });
  } catch (error) { next(error); }
};
