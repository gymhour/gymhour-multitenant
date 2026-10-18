import express from 'express';
import { cuotaMethods } from '../controllers/cuota.Controller.js';
import { createManualCycleFee, previewCycleFee } from '../controllers/cycleFee.Controller.js';
import { authenticateToken, isAdmin, isAdminOrEntrenador } from '../services/auth.service.js';

const cuotaRouter = express.Router();


cuotaRouter.get("/", authenticateToken, isAdmin, cuotaMethods.getAllCuotas);
cuotaRouter.get("/me", authenticateToken, (req, res) => {
  req.params.idUsuario = String(req.user!.id);
  return cuotaMethods.getAllCuotasByUsuario(req, res);
});
cuotaRouter.get("/me/reminder", authenticateToken, (req, res) => {
  req.params.idUsuario = String(req.user!.id);
  return cuotaMethods.getCuotasVencenPronto(req, res);
});
cuotaRouter.get("/usuario/:idUsuario/cuotas", authenticateToken, isAdminOrEntrenador, cuotaMethods.getAllCuotasByUsuario);
cuotaRouter.get("/usuario/:idUsuario/preview", authenticateToken, isAdmin, previewCycleFee);
cuotaRouter.get("/reminder/:idUsuario", authenticateToken, isAdminOrEntrenador, cuotaMethods.getCuotasVencenPronto);
cuotaRouter.post("/usuario/:idUsuario", authenticateToken, isAdmin, createManualCycleFee);
cuotaRouter.post("/usuario/:idUsuario/regenerate-turnos-fijos", authenticateToken, isAdmin, cuotaMethods.regenerateTurnosFijosByUsuario);
cuotaRouter.put("/:id", authenticateToken, isAdmin, cuotaMethods.updateCuota);
cuotaRouter.put("/:id/pay", authenticateToken, isAdmin, cuotaMethods.payCuota);

export default cuotaRouter;
