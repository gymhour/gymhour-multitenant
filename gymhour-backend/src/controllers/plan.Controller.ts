import { Request, Response } from 'express';
import { respondUnexpected } from "../services/apiError.service.js";
import prisma from '../models/Prisma.js';
import { getMaxSessionsForDuration, normalizePlanDuration } from '../services/accessRules.service.js';
import { parseFeeDuration, serializeFeeDuration } from '../services/feeDates.service.js';

// Crear un nuevo plan
export const createPlan = async (req: Request, res: Response): Promise<void> => {
    try {
        const { nombre, precio, desc, duracion, duracionUnidad, duracionCantidad, sesionesPorSemana, sesionesTotales, sesionesGracia, requiereTurno } = req.body;
        const precioNumber = Number(precio);
        if (!nombre || !Number.isFinite(precioNumber)) {
            res.status(400).json({ message: "Completá el nombre y el precio del plan." });
            return;
        }
        const dur = duracionUnidad !== undefined || duracionCantidad !== undefined
            ? serializeFeeDuration(duracionUnidad, duracionCantidad) : normalizePlanDuration(duracion);
        if (!dur || (duracion !== undefined && !parseFeeDuration(duracion) && duracionUnidad === undefined)) {
            res.status(400).json({ message: 'Elegí una duración válida: 1–52 semanas o 1–24 meses.' }); return;
        }
        const totales = Number(sesionesTotales || 0);
        const maxSesiones = getMaxSessionsForDuration(dur);
        if (totales > maxSesiones) {
            res.status(400).json({ message: `Las sesiones totales (${totales}) no pueden superar ${maxSesiones} para un plan ${dur.toLowerCase()}.` });
            return;
        }
        const plan = await prisma.plan.create({
            data: {
                nombre,
                precio: precioNumber,
                desc,
                duracion: dur,
                sesionesPorSemana: Number(sesionesPorSemana || 0),
                sesionesTotales: totales,
                sesionesGracia: Number(sesionesGracia || 0),
                requiereTurno: requiereTurno !== false,
            }
        });
        res.status(201).json({ message: 'Plan creado', plan });
    } catch (error: any) {
        respondUnexpected(res, error, "crear el plan");
    }
};

// Listar todos los planes
export const getAllPlans = async (req: Request, res: Response): Promise<void> => {
    try {
        const plans = await prisma.plan.findMany();
        res.status(200).json(plans);
    } catch (error: any) {
        respondUnexpected(res, error, "cargar los planes");
    }
};

// Obtener un plan por ID
export const getPlanById = async (req: Request, res: Response): Promise<void> => {
    try {
        const ID_Plan = Number(req.params.id);
        const plan = await prisma.plan.findUnique({ where: { ID_Plan } });
        if (!plan) {
            res.status(404).json({ message: 'No encontramos ese plan.' });
            return;
        }
        res.status(200).json(plan);
    } catch (error: any) {
        respondUnexpected(res, error, "cargar el plan");
    }
};

// Actualizar un plan
export const updatePlan = async (req: Request, res: Response): Promise<void> => {
    try {
        const ID_Plan = Number(req.params.id);
        const { nombre, precio, desc, duracion, duracionUnidad, duracionCantidad, sesionesPorSemana, sesionesTotales, sesionesGracia, requiereTurno } = req.body;
        if (!nombre && precio === undefined && desc === undefined && duracion === undefined && duracionUnidad === undefined && duracionCantidad === undefined && sesionesPorSemana === undefined && sesionesTotales === undefined && sesionesGracia === undefined && requiereTurno === undefined) {
            res.status(400).json({ message: 'No hay cambios para guardar.' });
            return;
        }
        const requestedDuration = duracionUnidad !== undefined || duracionCantidad !== undefined
            ? serializeFeeDuration(duracionUnidad, duracionCantidad) : duracion;
        if (requestedDuration === null || (requestedDuration !== undefined && !parseFeeDuration(requestedDuration))) {
            res.status(400).json({ message: 'Elegí una duración válida: 1–52 semanas o 1–24 meses.' }); return;
        }
        if (sesionesTotales !== undefined || requestedDuration !== undefined) {
            const current = await prisma.plan.findUnique({ where: { ID_Plan }, select: { duracion: true, sesionesTotales: true } });
            if (!current) { res.status(404).json({ message: 'No encontramos ese plan.' }); return; }
            const dur = requestedDuration ?? current.duracion;
            const totales = Number(sesionesTotales ?? current.sesionesTotales);
            const maxSesiones = getMaxSessionsForDuration(dur);
            if (totales > maxSesiones) {
                res.status(400).json({ message: `Las sesiones totales (${totales}) no pueden superar ${maxSesiones} para un plan ${dur.toLowerCase()}.` });
                return;
            }
        }
        const updated = await prisma.plan.update({
            where: { ID_Plan },
            data: {
                ...(nombre && { nombre }),
                ...(precio !== undefined && { precio: Number(precio) }),
                ...(desc !== undefined && { desc }),
                ...(requestedDuration !== undefined && { duracion: requestedDuration }),
                ...(sesionesPorSemana !== undefined && { sesionesPorSemana: Number(sesionesPorSemana) }),
                ...(sesionesTotales !== undefined && { sesionesTotales: Number(sesionesTotales) }),
                ...(sesionesGracia !== undefined && { sesionesGracia: Number(sesionesGracia) }),
                ...(requiereTurno !== undefined && { requiereTurno: Boolean(requiereTurno) }),
            }
        });
        res.status(200).json({ message: 'Plan actualizado', plan: updated });
    } catch (error: any) {
        respondUnexpected(res, error, "actualizar el plan");
    }
};

// Borrar un plan
export const deletePlan = async (req: Request, res: Response): Promise<void> => {
    try {
        const ID_Plan = Number(req.params.id);
        await prisma.plan.delete({ where: { ID_Plan } });
        res.status(200).json({ message: 'Plan eliminado' });
    } catch (error: any) {
        respondUnexpected(res, error, "eliminar el plan");
    }
};


export const planMethods = {
    createPlan,
    deletePlan,
    getPlanById,
    getAllPlans,
    updatePlan,
}
