import express from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  adhere, adminCancelDebit, adminDebits, adminVerifyDebit, alerts, cancelMyDebit, checkout, connect, disconnect,
  getConnection, mercadoPagoWebhook, myState, oauthCallback, reviewAlert, verify, verifyDebit,
} from '../controllers/mercadoPago.Controller.js';
import { authenticateToken, isAdmin, requireRoles } from '../services/auth.service.js';
import { requirePaidFeature } from '../services/planAccess.service.js';

// Cobro de cuotas a socios con Mercado Pago. Ver MERCADOPAGO.md, "Endpoints".
const router = express.Router();
const safe = (handler: (req: any, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => { void handler(req, res).catch(next); };
const limiter = (max: number) => rateLimit({ windowMs: 15 * 60 * 1000, max, standardHeaders: 'draft-7', legacyHeaders: false });
const isStudent = requireRoles('STUDENT');
const memberPayments = requirePaidFeature('MEMBER_PAYMENTS');

// Públicas: las llama Mercado Pago (aviso) o el navegador al volver de autorizar (callback).
router.post('/webhooks/mercadopago', safe(mercadoPagoWebhook));
router.get('/mercadopago/oauth/callback', limiter(30), safe(oauthCallback));

router.use(authenticateToken);

// Admin
router.get('/mercadopago', isAdmin, safe(getConnection));
router.post('/mercadopago/conectar', isAdmin, memberPayments, limiter(20), safe(connect));
router.delete('/mercadopago', isAdmin, limiter(20), safe(disconnect));
router.get('/avisos', isAdmin, safe(alerts));
router.post('/avisos/:id/revisado', isAdmin, limiter(120), safe(reviewAlert));
router.get('/debitos', isAdmin, safe(adminDebits));
router.post('/debitos/:id/verificar', isAdmin, limiter(60), safe(adminVerifyDebit));
router.post('/debitos/:id/cancelar', isAdmin, limiter(60), safe(adminCancelDebit));

// Socio
router.get('/mi-estado', isStudent, safe(myState));
router.post('/cuotas/:id/checkout', isStudent, memberPayments, limiter(30), safe(checkout));
router.post('/intentos/:ref/verificar', requireRoles('STUDENT', 'ADMIN'), limiter(120), safe(verify));
router.post('/debito', isStudent, memberPayments, limiter(20), safe(adhere));
router.post('/debito/verificar', isStudent, limiter(60), safe(verifyDebit));
router.post('/debito/cancelar', isStudent, limiter(20), safe(cancelMyDebit));

export default router;
