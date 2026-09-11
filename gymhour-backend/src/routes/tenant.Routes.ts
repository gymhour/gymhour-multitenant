import express from 'express';
import { tenantMethods } from '../controllers/tenant.Controller.js';
import { authenticateToken, isAdmin } from '../services/auth.service.js';
import upload from '../services/multer.service.js';

const tenantRouter = express.Router();
tenantRouter.use(authenticateToken, isAdmin);
tenantRouter.get('/kiosks', tenantMethods.listKiosks);
tenantRouter.post('/kiosks', tenantMethods.createKiosk);
tenantRouter.post('/kiosks/:id/rotate', tenantMethods.rotateKiosk);
tenantRouter.delete('/kiosks/:id', tenantMethods.revokeKiosk);
tenantRouter.patch('/settings', tenantMethods.updateSettings);
tenantRouter.patch('/profile', upload.single('logo'), tenantMethods.updateProfile);
tenantRouter.put('/onboarding', upload.single('logo'), tenantMethods.completeOnboarding);
export default tenantRouter;
