import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticateToken, isAdmin } from '../services/auth.service.js';
import { catalog, confirmCard, confirmTransfer, createOrder, rebillWebhook } from '../controllers/billing.Controller.js';
import { cancelScheduledDowngrade, confirmPlanChange, createPlanChange, quotePlanChange } from '../controllers/billingChange.Controller.js';
import { cancelSubscription, cardUpdateLink } from '../controllers/billingSubscription.Controller.js';

const router = express.Router();
const safe = (handler: (req: any, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => { void handler(req, res).catch(next); };

router.post('/webhooks/rebill', safe(rebillWebhook));
router.use(authenticateToken, isAdmin);
// Mientras espera una transferencia, el modal consulta cada 15 segundos: tiene su propio límite
// para no agotar el general y dejar al admin sin poder cargar los planes.
const verificationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 120, standardHeaders: 'draft-7', legacyHeaders: false });
router.post('/orders/:id/confirm-transfer', verificationLimiter, safe(confirmTransfer));
router.post('/plan-change/:id/confirm', verificationLimiter, safe(confirmPlanChange));
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: 'draft-7', legacyHeaders: false }));
router.get('/catalog', safe(catalog));
router.get('/plan-change/quote', safe(quotePlanChange));
router.post('/plan-change', safe(createPlanChange));
router.post('/plan-change/cancel-scheduled', safe(cancelScheduledDowngrade));
router.post('/orders', safe(createOrder));
router.post('/orders/:id/confirm-card', safe(confirmCard));
router.post('/subscription/cancel', safe(cancelSubscription));
router.post('/subscription/card-update-link', safe(cardUpdateLink));

export default router;
