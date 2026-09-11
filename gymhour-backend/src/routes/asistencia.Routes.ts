import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { asistenciaMethods } from '../controllers/asistencia.Controller.js';
import { authServices } from '../services/auth.service.js';
import { authenticateKiosk, authenticatePublicTenant } from '../services/kioskAuth.service.js';

const asistenciaRoutes = express.Router();

// Rate limit dedicado al check-in público (anti-spam / enumeración de DNIs).
// Techo holgado: la PC kiosko y los celulares en el Wi-Fi del gym comparten la misma IP (NAT),
// así que el límite es por IP pero generoso. Ajustar 'max' según el pico real de recepción.
// El anti-duplicado diario ya frena reintentos del mismo DNI; esto apunta a floods externos.
const registrarLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 40,
  message: { message: 'Demasiados intentos de ingreso. Esperá un momento e intentá de nuevo.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Staff usa JWT; el kiosco usa una credencial opaca que resuelve el tenant.
asistenciaRoutes.post('/registrar', authServices.authenticateToken, authServices.isAdminOrEntrenador, asistenciaMethods.registrarAsistencia);
asistenciaRoutes.post('/kiosk/registrar', registrarLimiter, authenticateKiosk, asistenciaMethods.registrarAsistencia);
asistenciaRoutes.post('/public/:slug/registrar', registrarLimiter, authenticatePublicTenant, asistenciaMethods.registrarAsistencia);

// 2. Obtener asistencias del usuario autenticado
asistenciaRoutes.get(
  '/mis-asistencias',
  authServices.authenticateToken,
  asistenciaMethods.obtenerMisAsistencias
);

// 3. Obtener bitácora/historial de ingresos (Solo Administradores o Entrenadores)
asistenciaRoutes.get(
  '/historial',
  authServices.authenticateToken,
  authServices.isAdminOrEntrenador,
  asistenciaMethods.obtenerHistorialAsistencias
);

export default asistenciaRoutes;
