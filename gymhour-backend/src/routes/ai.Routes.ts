import express from 'express';
import { aiMethods } from '../controllers/ai.Controller.js';
import { authenticateToken } from '../services/auth.service.js';

const router = express.Router();
router.use(authenticateToken);
router.get('/home', aiMethods.home);
router.get('/conversations', aiMethods.conversations);
router.post('/conversations', aiMethods.create);
router.get('/conversations/:id', aiMethods.detail);
router.delete('/conversations/:id', aiMethods.remove);
router.post('/conversations/:id/messages', aiMethods.message);
router.get('/drafts/:messageId', aiMethods.draft);

export default router;
