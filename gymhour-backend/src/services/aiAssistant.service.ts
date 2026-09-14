import type { TenantRole } from '@prisma/client';
import OpenAI from 'openai';
import prisma from '../models/Prisma.js';
import { executeAiTool, getToolsForRole } from './aiTools.service.js';
import { MONTHLY_USER_PROMPT_LIMIT } from './aiLimits.js';

const MODEL = process.env.OPENAI_MODEL || 'gpt-5.6-terra';
const CONTEXT_MESSAGE_LIMIT = Math.max(4, Number(process.env.AI_CONTEXT_MESSAGE_LIMIT) || 20);
const MAX_OUTPUT_TOKENS = Math.max(500, Number(process.env.AI_MAX_OUTPUT_TOKENS) || 3000);

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export class AiServiceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const startOfUtcMonth = () => {
  const value = new Date(); value.setUTCDate(1); value.setUTCHours(0, 0, 0, 0); return value;
};

async function getOwnedConversation(id: number, userId: number) {
  return prisma.aiConversation.findFirst({ where: { id, userId } });
}

export async function assertAiAvailable(userId: number): Promise<void> {
  if (!openai) throw new AiServiceError(503, 'La integración con IA todavía no está configurada.');
  const monthlyPrompts = await prisma.aiMessage.count({
    where: { userId, role: 'USER', createdAt: { gte: startOfUtcMonth() } },
  });
  if (monthlyPrompts >= MONTHLY_USER_PROMPT_LIMIT) {
    throw new AiServiceError(429, 'Alcanzaste el límite de 100 consultas de IA de este mes.');
  }
}

export async function listConversations(userId: number, page = 1, take = 20) {
  const safeTake = Math.min(50, Math.max(1, take));
  const [total, data] = await Promise.all([
    prisma.aiConversation.count({ where: { userId } }),
    prisma.aiConversation.findMany({
      where: { userId }, orderBy: { updatedAt: 'desc' }, skip: (Math.max(1, page) - 1) * safeTake, take: safeTake,
      include: { messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { content: true, kind: true } } },
    }),
  ]);
  return { data, pagination: { page: Math.max(1, page), take: safeTake, total, totalPages: Math.ceil(total / safeTake) } };
}

export async function createConversation(userId: number) {
  return prisma.aiConversation.create({ data: { userId } });
}

export async function getConversation(id: number, userId: number) {
  const conversation = await prisma.aiConversation.findFirst({
    where: { id, userId },
    include: { messages: { orderBy: { createdAt: 'asc' } } },
  });
  if (!conversation) throw new AiServiceError(404, 'Conversación no encontrada.');
  return conversation;
}

export async function deleteConversation(id: number, userId: number) {
  const result = await prisma.aiConversation.deleteMany({ where: { id, userId } });
  if (!result.count) throw new AiServiceError(404, 'Conversación no encontrada.');
}

export async function getRoutineDraft(messageId: number, userId: number) {
  const message = await prisma.aiMessage.findFirst({
    where: { id: messageId, userId, role: 'ASSISTANT', kind: 'ROUTINE_DRAFT', status: 'COMPLETED' },
    select: { id: true, metadata: true, createdAt: true },
  });
  const metadata = message?.metadata as any;
  if (!message || !metadata?.draft) throw new AiServiceError(404, 'Borrador no encontrado.');
  return { id: message.id, draft: metadata.draft, summary: metadata.summary, createdAt: message.createdAt };
}

export async function markRoutineDraftUsed(messageId: number, userId: number, routineId: number) {
  const message = await prisma.aiMessage.findFirst({ where: { id: messageId, userId, kind: 'ROUTINE_DRAFT' } });
  if (!message) throw new AiServiceError(404, 'Borrador de IA no encontrado.');
  const metadata = (message.metadata || {}) as Record<string, any>;
  await prisma.aiMessage.update({
    where: { id: message.id },
    data: { metadata: { ...metadata, consumedAt: new Date().toISOString(), routineId } },
  });
}

const instructionsFor = (role: TenantRole, tenantName: string) => `
Sos el asistente de gestión de ${tenantName}. Respondé en español rioplatense, claro y breve.
Usá herramientas para cualquier afirmación sobre datos del gimnasio; indicá siempre período o fecha de actualización.
No inventes cifras, alumnos ni resultados. Si una búsqueda es ambigua, pedí que el usuario elija un alumno por nombre e ID.
No des diagnósticos médicos. Para rutinas, tratá observaciones de salud como restricciones y exigí revisión profesional.
Antes de construir una rutina identificá al alumno y confirmá objetivo, días disponibles y restricciones relevantes.
Priorizá ejercicios del catálogo; los nuevos deben quedar marcados para revisión en el borrador.
El borrador no asigna ni guarda una rutina: explicá que debe revisarse en el editor.
Rol actual: ${role}.
${role === 'TRAINER' ? 'No reveles ingresos, gastos, ganancia, cobranza ni deuda agregada del gimnasio. Sí podés informar el estado de cuota de alumnos concretos.' : ''}
${role === 'STUDENT' ? 'Ayudá únicamente con orientación general de entrenamiento y uso de la plataforma. No reveles datos del gimnasio, de otros usuarios ni información financiera. No afirmes conocer datos personales o rutinas que no estén escritos en esta conversación.' : ''}
`;

type StreamEmitter = (event: string, data: unknown) => void;

export async function streamAssistantReply({
  conversationId, userId, role, tenantName, content, emit, signal,
}: {
  conversationId: number; userId: number; role: TenantRole; tenantName: string;
  content: string; emit: StreamEmitter; signal?: AbortSignal;
}) {
  await assertAiAvailable(userId);
  const conversation = await getOwnedConversation(conversationId, userId);
  if (!conversation) throw new AiServiceError(404, 'Conversación no encontrada.');
  const cleanContent = String(content || '').trim();
  if (!cleanContent || cleanContent.length > 2000) throw new AiServiceError(400, 'El mensaje debe tener entre 1 y 2000 caracteres.');

  const startedAt = Date.now();
  const userMessage = await prisma.aiMessage.create({
    data: { conversationId, userId, role: 'USER', content: cleanContent, status: 'COMPLETED' },
  });
  if (conversation.title === 'Nueva conversación') {
    await prisma.aiConversation.update({ where: { id: conversation.id }, data: { title: cleanContent.replace(/\s+/g, ' ').slice(0, 80) } });
  } else {
    await prisma.aiConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
  }
  const assistantMessage = await prisma.aiMessage.create({
    data: { conversationId, userId, role: 'ASSISTANT', content: '', status: 'PENDING', model: MODEL },
  });
  emit('message.accepted', { userMessageId: userMessage.id, assistantMessageId: assistantMessage.id });

  try {
    const history = await prisma.aiMessage.findMany({
      where: { conversationId, status: 'COMPLETED', id: { not: assistantMessage.id } },
      orderBy: { createdAt: 'desc' }, take: CONTEXT_MESSAGE_LIMIT,
      select: { role: true, content: true },
    });
    const input: any[] = history.reverse().map(message => ({ role: message.role === 'USER' ? 'user' : 'assistant', content: message.content }));
    const tools = getToolsForRole(role);
    let toolRounds = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let finalText = '';
    let routineMetadata: any = null;

    while (true) {
      const allowTools = toolRounds < 3;
      const stream: any = await openai!.responses.create({
        model: MODEL,
        instructions: instructionsFor(role, tenantName),
        input,
        tools: allowTools ? tools : [],
        tool_choice: allowTools ? 'auto' : 'none',
        parallel_tool_calls: false,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        reasoning: { effort: 'low' },
        stream: true,
        store: false,
      } as any, { signal } as any);

      let completed: any = null;
      let roundText = '';
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta') {
          roundText += event.delta;
          emit('response.delta', { delta: event.delta });
        } else if (event.type === 'response.completed') {
          completed = event.response;
        } else if (event.type === 'error') {
          throw new Error(event.message || 'Error de OpenAI');
        }
      }
      if (!completed) throw new Error('OpenAI no completó la respuesta.');
      totalInputTokens += Number(completed.usage?.input_tokens || 0);
      totalOutputTokens += Number(completed.usage?.output_tokens || 0);
      const calls = (completed.output || []).filter((item: any) => item.type === 'function_call');
      if (!calls.length) {
        finalText += roundText || completed.output_text || '';
        break;
      }

      if (roundText) finalText += roundText;
      input.push(...completed.output);
      for (const call of calls) {
        const args = JSON.parse(call.arguments || '{}');
        const result = await executeAiTool(call.name, args, role);
        if (call.name === 'build_routine_draft' && result?.draft) {
          routineMetadata = result;
          emit('routine.draft', { messageId: assistantMessage.id, summary: result.summary });
        }
        input.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify(result) });
      }
      toolRounds += 1;
    }

    const fallbackText = routineMetadata ? 'Preparé un borrador de rutina para que lo revises antes de asignarlo.' : 'No pude generar una respuesta con contenido.';
    const saved = await prisma.aiMessage.update({
      where: { id: assistantMessage.id },
      data: {
        content: finalText.trim() || fallbackText,
        status: 'COMPLETED', kind: routineMetadata ? 'ROUTINE_DRAFT' : 'TEXT',
        metadata: routineMetadata || undefined,
        inputTokens: totalInputTokens, outputTokens: totalOutputTokens, durationMs: Date.now() - startedAt,
      },
    });
    await prisma.aiConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
    emit('response.completed', {
      message: saved,
      usage: { inputTokens: totalInputTokens, outputTokens: totalOutputTokens },
    });
  } catch (error: any) {
    const cancelled = signal?.aborted;
    await prisma.aiMessage.update({
      where: { id: assistantMessage.id },
      data: { status: cancelled ? 'CANCELLED' : 'FAILED', content: cancelled ? 'Respuesta cancelada.' : 'No se pudo completar la respuesta.', durationMs: Date.now() - startedAt },
    }).catch(() => undefined);
    if (cancelled) emit('response.error', { message: 'Respuesta cancelada.' });
    else emit('response.error', { message: error?.message || 'No se pudo consultar la IA.' });
  }
}
