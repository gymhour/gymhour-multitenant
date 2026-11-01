import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { authenticateToken, isAdmin } from '../services/auth.service.js';
import { catalog, confirmCard, confirmTransfer, createOrder, rebillWebhook } from '../controllers/billing.Controller.js';
import { cancelScheduledDowngrade, confirmPlanChange, createPlanChange, quotePlanChange } from '../controllers/billingChange.Controller.js';

const router = express.Router();
const safe = (handler: (req: any, res: express.Response) => Promise<void>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) => { void handler(req, res).catch(next); };

router.post('/webhooks/rebill', safe(rebillWebhook));
router.use(authenticateToken, isAdmin);
router.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: 'draft-7', legacyHeaders: false }));
router.get('/catalog', safe(catalog));
router.get('/plan-change/quote', safe(quotePlanChange));
router.post('/plan-change', safe(createPlanChange));
router.post('/plan-change/cancel-scheduled', safe(cancelScheduledDowngrade));
router.post('/plan-change/:id/confirm', safe(confirmPlanChange));
router.post('/orders', safe(createOrder));
router.post('/orders/:id/confirm-card', safe(confirmCard));
router.post('/orders/:id/confirm-transfer', safe(confirmTransfer));

export default router;
