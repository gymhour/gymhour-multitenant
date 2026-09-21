import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { platformMethods } from '../controllers/platform.Controller.js';
import { authenticatePlatformSession, requirePlatformCsrf } from '../services/platformSecurity.service.js';

const platformRouter = express.Router();
const safe = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

platformRouter.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const allowedOrigin = process.env.PLATFORM_FRONTEND_URL || 'http://localhost:3001';
  const origin = req.headers.origin;
  if (origin && origin !== allowedOrigin) { res.status(403).json({ message: 'Origen no autorizado.' }); return; }
  next();
});

const passwordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Demasiados intentos. Esperá 15 minutos.' },
});
const mfaLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false,
  message: { message: 'Demasiados intentos. Esperá unos minutos.' },
});

platformRouter.post('/auth/login', passwordLimiter, safe(platformMethods.login));
platformRouter.post('/auth/mfa', mfaLimiter, safe(platformMethods.verifyMfa));

platformRouter.use(safe(authenticatePlatformSession));
platformRouter.get('/auth/me', safe(platformMethods.me));
platformRouter.post('/auth/logout', requirePlatformCsrf, safe(platformMethods.logout));
platformRouter.get('/dashboard', safe(platformMethods.dashboard));
platformRouter.get('/tenants', safe(platformMethods.listTenants));
platformRouter.get('/tenants/:id', safe(platformMethods.tenantDetail));
platformRouter.patch('/tenants/:id/status', requirePlatformCsrf, safe(platformMethods.changeTenantStatus));
platformRouter.post('/tenants/:id/purge', requirePlatformCsrf, safe(platformMethods.purgeTenant));
platformRouter.get('/audit', safe(platformMethods.auditList));

platformRouter.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[platform]', error);
  if (!res.headersSent) res.status(500).json({ message: 'No pudimos completar la operación. Intentá nuevamente.' });
});

export default platformRouter;
