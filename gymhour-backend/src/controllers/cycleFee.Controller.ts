import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { createCycleFee, FeeCycleError, getNextFeePreview } from '../services/feeCycle.service.js';

export async function previewCycleFee(req: Request, res: Response): Promise<void> {
  try {
    const id = Number(req.params.idUsuario);
    if (!Number.isInteger(id) || id < 1) { res.status(400).json({ message: 'Alumno inválido.' }); return; }
    res.json(await getNextFeePreview(id, typeof req.query.fechaInicioCobro === 'string' ? req.query.fechaInicioCobro : undefined));
  } catch (error) {
    if (error instanceof FeeCycleError) { res.status(error.status).json({ message: error.message }); return; }
    console.error('[cuotas/preview]', error);
    res.status(500).json({ message: 'No se pudo preparar la próxima cuota.' });
  }
}

export async function createManualCycleFee(req: Request, res: Response): Promise<void> {
  try {
    const id = Number(req.params.idUsuario);
    if (!Number.isInteger(id) || id < 1) { res.status(400).json({ message: 'Alumno inválido.' }); return; }
    const result = await createCycleFee(id, {
      fechaInicioCobro: req.body?.fechaInicioCobro,
      fechaFin: req.body?.fechaFin,
      importe: req.body?.importe,
      pagada: req.body?.pagada,
      formaPago: req.body?.formaPago,
      fechaPago: req.body?.fechaPago,
    });
    res.status(201).json({ message: 'Cuota creada.', ...result });
  } catch (error) {
    if (error instanceof FeeCycleError) { res.status(error.status).json({ message: error.message }); return; }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ message: 'Ya existe una cuota para ese período.' }); return;
    }
    console.error('[cuotas/manual]', error);
    res.status(500).json({ message: 'No se pudo crear la cuota.' });
  }
}
