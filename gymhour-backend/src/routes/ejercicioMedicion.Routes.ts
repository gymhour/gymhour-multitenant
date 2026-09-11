import { Router } from 'express';
import { ejercicioMedicionMethods } from '../controllers/ejercicioMedicion.Controller.js';
import { authenticateToken, isAdminOrEntrenador } from '../services/auth.service.js';

const ejercicioMedicionRouter = Router();

ejercicioMedicionRouter.get('/me', authenticateToken, (req, res) => {
  req.params.idUsuario = String(req.user!.id);
  return ejercicioMedicionMethods.getEjerciciosMedicionByUsuario(req, res);
});
ejercicioMedicionRouter.get('/usuario/:idUsuario', authenticateToken, isAdminOrEntrenador, ejercicioMedicionMethods.getEjerciciosMedicionByUsuario);
ejercicioMedicionRouter.post('/', authenticateToken, ejercicioMedicionMethods.createEjercicioMedicion);
ejercicioMedicionRouter.get('/max/:id', authenticateToken, ejercicioMedicionMethods.getMaxCantidadByEjercicioMedicion);
ejercicioMedicionRouter.get('/', authenticateToken, isAdminOrEntrenador, ejercicioMedicionMethods.getAllEjerciciosMedicion);
ejercicioMedicionRouter.get('/:id', authenticateToken, ejercicioMedicionMethods.getEjercicioMedicionById);
ejercicioMedicionRouter.put('/:id', authenticateToken, ejercicioMedicionMethods.updateEjercicioMedicion);
ejercicioMedicionRouter.delete('/:id', authenticateToken, ejercicioMedicionMethods.deleteEjercicioMedicion);

export default ejercicioMedicionRouter;
