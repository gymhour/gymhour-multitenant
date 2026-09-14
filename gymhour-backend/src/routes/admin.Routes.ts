import express from 'express';
import { adminMethods } from '../controllers/admin.Controller.js';
import { authenticateToken, isAdmin } from '../services/auth.service.js';

const adminRouter = express.Router();

// Sólo accesible por admins (usa tu middleware de autenticación/autorización)
adminRouter.get('/dashboard', authenticateToken, isAdmin, adminMethods.getDashboardStats);
adminRouter.patch('/setup-guide/preference', authenticateToken, isAdmin, adminMethods.updateSetupGuidePreference);
adminRouter.post('/setup-guide/complete', authenticateToken, isAdmin, adminMethods.completeSetupGuide);
adminRouter.get('/churn-risk', authenticateToken, isAdmin, adminMethods.getChurnRisk);
adminRouter.post('/churn-risk/contact', authenticateToken, isAdmin, adminMethods.sendChurnContactEmail);

export default adminRouter;
