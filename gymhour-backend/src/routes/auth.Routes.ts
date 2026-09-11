import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { authMethods } from '../controllers/auth.Controller.js';
import { authenticateToken } from '../services/auth.service.js';

const authRouter = express.Router();

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 15,
    skipSuccessfulRequests: true,
    message: { message: 'Demasiados intentos de inicio de sesión. Esperá unos minutos e intentá de nuevo.' },
    standardHeaders: true,
    legacyHeaders: false,
});

const forgotPasswordLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { message: 'Demasiadas solicitudes de recuperación. Intentá nuevamente más tarde.' },
    standardHeaders: true,
    legacyHeaders: false,
});

authRouter.post('/tenants', loginLimiter, authMethods.registerTenant);
authRouter.post('/login', loginLimiter, authMethods.loginWithoutTenant);
authRouter.post('/login/select-tenant', loginLimiter, authMethods.selectLoginTenant);
authRouter.post('/tenants/:slug/login', loginLimiter, authMethods.login);
authRouter.post('/tenants/:slug/forgot-password', forgotPasswordLimiter, authMethods.forgotPassword);
authRouter.post("/reset-password", authMethods.resetPassword);
authRouter.put("/change-password", authenticateToken, authMethods.changePassword);
authRouter.get('/me', authenticateToken, authMethods.me);

export default authRouter;
