import { Request, Response } from "express";
import { respondUnexpected } from "../services/apiError.service.js";
import prisma from "../models/Prisma.js";

const isStaff = (req: Request): boolean => req.user?.role === 'ADMIN' || req.user?.role === 'TRAINER';
const canAccessMeasurement = async (req: Request, measurementId: number): Promise<boolean> => {
  const measurement = await prisma.ejercicioMedicion.findUnique({
    where: { ID_EjercicioMedicion: measurementId },
    select: { ID_Usuario: true },
  });
  return Boolean(measurement && (isStaff(req) || measurement.ID_Usuario === req.user?.id));
};

const findAccessibleHistory = async (req: Request, id: number) => {
  const history = await prisma.historicoEjercicio.findUnique({
    where: { ID_HistoricoEjercicio: id },
    include: { EjercicioMedicion: true },
  });
  return history && (isStaff(req) || history.EjercicioMedicion.ID_Usuario === req.user?.id) ? history : null;
};

const createHistoricoEjercicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const { ID_EjercicioMedicion, Cantidad, Fecha } = req.body;

    // Validar que se envíen los datos obligatorios
    if (!ID_EjercicioMedicion || !Cantidad) {
      res.status(400).json({ message: "Elegí el ejercicio y escribí la cantidad." });
      return;
    }
    if (!await canAccessMeasurement(req, Number(ID_EjercicioMedicion))) {
      res.status(404).json({ message: "No encontramos esa medición." });
      return;
    }

    // Crear el registro de histórico; si Fecha no se envía, se usará el valor por defecto (now) según el modelo
    const nuevoHistorico = await prisma.historicoEjercicio.create({
      data: {
        ID_EjercicioMedicion: Number(ID_EjercicioMedicion),
        Cantidad: Number(Cantidad), // Convierte a número
        Fecha: Fecha ? new Date(Fecha) : undefined,
      },
      include: {
        EjercicioMedicion: true,
      },
    });


    res.status(201).json({ message: "Histórico de ejercicio creado exitosamente", historicoEjercicio: nuevoHistorico });
  } catch (error: any) {
      respondUnexpected(res, error, "guardar el registro del ejercicio");
  }
};

// GET ONE by ID
const getHistoricoEjercicioById = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ message: "No pudimos identificar el registro del ejercicio. Actualizá la página e intentá de nuevo." });
      return;
    }
    const historico = await findAccessibleHistory(req, id);
    if (!historico) {
      res.status(404).json({ message: "No encontramos ese registro del ejercicio." });
      return;
    }
    res.status(200).json(historico);
  } catch (error: any) {
      respondUnexpected(res, error, "cargar el historial del ejercicio");
  }
};

// UPDATE
const updateHistoricoEjercicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    const { Cantidad, Fecha } = req.body as {
      Cantidad?: number;
      Fecha?: string;
    };

    if (isNaN(id)) {
      res.status(400).json({ message: "No pudimos identificar el registro del ejercicio. Actualizá la página e intentá de nuevo." });
      return;
    }
    if (Cantidad === undefined && Fecha === undefined) {
      res.status(400).json({ message: "No hay cambios para guardar." });
      return;
    }

    if (!await findAccessibleHistory(req, id)) {
      res.status(404).json({ message: "No encontramos ese registro del ejercicio." });
      return;
    }

    const data: any = {};
    if (Cantidad !== undefined) data.Cantidad = Number(Cantidad);
    if (Fecha !== undefined) data.Fecha = Fecha ? new Date(Fecha) : undefined;

    const updated = await prisma.historicoEjercicio.update({
      where: { ID_HistoricoEjercicio: id },
      data,
      include: { EjercicioMedicion: true }
    });

    res.status(200).json({
      message: "Histórico de ejercicio actualizado",
      historicoEjercicio: updated
    });
  } catch (error: any) {
    console.error("Error al actualizar histórico de ejercicio:", error);
    if (error.code === "P2025") {
      res.status(404).json({ message: "No encontramos ese registro del ejercicio." });
    } else {
        respondUnexpected(res, error, "actualizar el registro del ejercicio");
    }
  }
};

// DELETE
const deleteHistoricoEjercicio = async (req: Request, res: Response): Promise<void> => {
  try {
    const id = Number(req.params.id);
    if (isNaN(id)) {
      res.status(400).json({ message: "No pudimos identificar el registro del ejercicio. Actualizá la página e intentá de nuevo." });
      return;
    }
    if (!await findAccessibleHistory(req, id)) {
      res.status(404).json({ message: "No encontramos ese registro del ejercicio." });
      return;
    }
    await prisma.historicoEjercicio.delete({
      where: { ID_HistoricoEjercicio: id }
    });
    res.status(200).json({ message: "Histórico de ejercicio eliminado" });
  } catch (error: any) {
    console.error("Error al eliminar histórico de ejercicio:", error);
    if (error.code === "P2025") {
      res.status(404).json({ message: "No encontramos ese registro del ejercicio." });
    } else {
        respondUnexpected(res, error, "eliminar el registro del ejercicio");
    }
  }
};

export const historicoEjercicioMethods = {
  createHistoricoEjercicio,
  getHistoricoEjercicioById,
  updateHistoricoEjercicio,
  deleteHistoricoEjercicio
};
