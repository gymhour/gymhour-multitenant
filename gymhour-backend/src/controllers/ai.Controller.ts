import type { Request, Response } from 'express';
import { getAiHome } from '../services/aiInsights.service.js';
import {
  AiServiceError, createConversation, deleteConversation, getConversation,
  getRoutineDraft, listConversations, streamAssistantReply,
} from '../services/aiAssistant.service.js';
import { respondUnexpected } from '../services/apiError.service.js';

const intParam = (value: unknown): number => Number.parseInt(String(value), 10);
const handleError = (res: Response, error: unknown, action: string) => {
  if (error instanceof AiServiceError) { res.status(error.status).json({ message: error.message }); return; }
  respondUnexpected(res, error, action);
};

export async function home(req: Request, res: Response): Promise<void> {
  try { res.json(await getAiHome(req.user!.role, req.user!.id)); }
  catch (error) { handleError(res, error, 'cargar el inicio inteligente'); }
}

export async function conversations(req: Request, res: Response): Promise<void> {
  try { res.json(await listConversations(req.user!.id, intParam(req.query.page) || 1, intParam(req.query.take) || 20)); }
  catch (error) { handleError(res, error, 'cargar las conversaciones'); }
}

export async function create(req: Request, res: Response): Promise<void> {
  try { res.status(201).json(await createConversation(req.user!.id)); }
  catch (error) { handleError(res, error, 'crear la conversación'); }
}

export async function detail(req: Request, res: Response): Promise<void> {
  try { res.json(await getConversation(intParam(req.params.id), req.user!.id)); }
  catch (error) { handleError(res, error, 'cargar la conversación'); }
}

export async function remove(req: Request, res: Response): Promise<void> {
  try { await deleteConversation(intParam(req.params.id), req.user!.id); res.status(204).send(); }
  catch (error) { handleError(res, error, 'eliminar la conversación'); }
}

export async function draft(req: Request, res: Response): Promise<void> {
  try { res.json(await getRoutineDraft(intParam(req.params.messageId), req.user!.id)); }
  catch (error) { handleError(res, error, 'cargar el borrador'); }
}

export async function message(req: Request, res: Response): Promise<void> {
  const controller = new AbortController();
  res.on('close', () => { if (!res.writableEnded) controller.abort(); });
  const emit = (event: string, data: unknown) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  try {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    await streamAssistantReply({
      conversationId: intParam(req.params.id), userId: req.user!.id, role: req.user!.role,
      tenantName: req.tenant!.name, content: req.body?.content, emit, signal: controller.signal,
    });
  } catch (error) {
    const status = error instanceof AiServiceError ? error.status : 500;
    emit('response.error', { status, message: error instanceof Error ? error.message : 'No se pudo consultar la IA.' });
  } finally {
    if (!res.writableEnded) res.end();
  }
}

export const aiMethods = { home, conversations, create, detail, remove, draft, message };
