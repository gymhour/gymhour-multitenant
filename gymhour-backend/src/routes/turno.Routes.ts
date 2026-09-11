import express from 'express';
import { turnoMethods } from '../controllers/turno.Controller.js';
import { authenticateToken, isAdmin, isAdminOrEntrenador } from '../services/auth.service.js';

const turnoRouter = express.Router();

turnoRouter.get('/me', authenticateToken, (req, res) => {
  req.params.idUsuario = String(req.user!.id);
  return turnoMethods.getTurnosByUsuario(req, res);
});
turnoRouter.get('/usuario/:idUsuario', authenticateToken, isAdminOrEntrenador, turnoMethods.getTurnosByUsuario);
turnoRouter.get('/', authenticateToken, isAdminOrEntrenador, turnoMethods.getAllTurnos)
turnoRouter.post('/', authenticateToken, turnoMethods.createTurno)
turnoRouter.get('/:id', authenticateToken, turnoMethods.getTurnoById)
turnoRouter.put('/:id', authenticateToken, isAdminOrEntrenador, turnoMethods.updateTurno)
turnoRouter.delete('/:id/fisico', authenticateToken, isAdmin, turnoMethods.deleteTurnoFisico)
turnoRouter.delete('/:id', authenticateToken, turnoMethods.deleteTurno)

export default turnoRouter;
