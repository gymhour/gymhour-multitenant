import React, { useEffect, useRef, useState } from 'react';
import { AlertCircle, Bot, ChevronRight, History, MessageSquare, MessageSquarePlus, Send, Square, Trash2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import apiService from '../../services/apiService';
import './AIHomePanel.css';

const messageKey = message => message.id || message.localId;

const AIHomePanel = ({ role }) => {
  const navigate = useNavigate();
  const [home, setHome] = useState({ enabled: false, configured: false, disabledReason: null, insights: [], suggestions: [], usage: null });
  const [conversations, setConversations] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const abortRef = useRef(null);
  const endRef = useRef(null);

  const refreshConversations = async () => {
    const result = await apiService.getAiConversations();
    setConversations(result?.data || []);
  };

  useEffect(() => {
    let active = true;
    Promise.all([apiService.getAiHome(), apiService.getAiConversations()])
      .then(([homeData, conversationsData]) => {
        if (!active) return;
        setHome(homeData);
        setConversations(conversationsData?.data || []);
      })
      .catch(error => toast.error(error.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; abortRef.current?.abort(); };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [messages, sending]);

  useEffect(() => {
    const suggestionCount = Math.min(home.suggestions.length, 3);
    setSuggestionIndex(0);
    if (suggestionCount < 2) return undefined;
    const interval = window.setInterval(() => {
      setSuggestionIndex(previous => (previous + 1) % suggestionCount);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [home.suggestions]);

  const openConversation = async id => {
    if (sending) return;
    try {
      const conversation = await apiService.getAiConversation(id);
      setConversationId(id);
      setMessages(conversation.messages || []);
      setHistoryOpen(false);
    } catch (error) { toast.error(error.message); }
  };

  const newConversation = () => {
    if (sending) return;
    setConversationId(null);
    setMessages([]);
    setInput('');
    setHistoryOpen(false);
  };

  const removeConversation = async (event, id) => {
    event.stopPropagation();
    if (!window.confirm('¿Eliminar esta conversación? Esta acción no elimina rutinas ya creadas.')) return;
    try {
      await apiService.deleteAiConversation(id);
      if (conversationId === id) newConversation();
      await refreshConversations();
    } catch (error) { toast.error(error.message); }
  };

  const send = async event => {
    event?.preventDefault();
    const content = input.trim();
    if (!content || sending || !home.enabled) return;
    setInput('');
    setSending(true);
    let activeId = conversationId;
    try {
      if (!activeId) {
        const created = await apiService.createAiConversation();
        activeId = created.id;
        setConversationId(activeId);
      }
      const userLocalId = `user-${Date.now()}`;
      const assistantLocalId = `assistant-${Date.now()}`;
      setMessages(previous => [
        ...previous,
        { localId: userLocalId, role: 'USER', content, status: 'COMPLETED', kind: 'TEXT' },
        { localId: assistantLocalId, role: 'ASSISTANT', content: '', status: 'PENDING', kind: 'TEXT' },
      ]);
      const controller = new AbortController();
      abortRef.current = controller;
      await apiService.streamAiMessage({
        conversationId: activeId, content, signal: controller.signal,
        onEvent: (type, data) => {
          if (type === 'message.accepted') {
            setMessages(previous => previous.map(message => {
              if (message.localId === userLocalId) return { ...message, id: data.userMessageId };
              if (message.localId === assistantLocalId) return { ...message, id: data.assistantMessageId };
              return message;
            }));
          } else if (type === 'response.delta') {
            setMessages(previous => previous.map(message => message.localId === assistantLocalId
              ? { ...message, content: `${message.content || ''}${data.delta || ''}` } : message));
          } else if (type === 'routine.draft') {
            setMessages(previous => previous.map(message => message.localId === assistantLocalId
              ? { ...message, id: data.messageId, kind: 'ROUTINE_DRAFT', metadata: { summary: data.summary } } : message));
          } else if (type === 'response.completed') {
            setMessages(previous => previous.map(message => message.localId === assistantLocalId
              ? { ...data.message, localId: assistantLocalId } : message));
          } else if (type === 'response.error') {
            setMessages(previous => previous.map(message => message.localId === assistantLocalId
              ? { ...message, status: 'FAILED', content: data.message || 'No se pudo completar la respuesta.' } : message));
          }
        },
      });
      const [homeData] = await Promise.all([apiService.getAiHome(), refreshConversations()]);
      setHome(homeData);
    } catch (error) {
      if (error.name !== 'AbortError') toast.error(error.message);
    } finally {
      abortRef.current = null;
      setSending(false);
    }
  };

  const stop = () => abortRef.current?.abort();
  const openDraft = message => {
    const path = role === 'ADMIN' ? '/admin/asignar-rutinas' : '/entrenador/asignar-rutinas';
    navigate(`${path}?aiDraft=${message.id}`);
  };
  return (
    <section className="ai-home" aria-busy={loading}>
      <div className="ai-shell">
        <button type="button" className="ai-history-toggle" onClick={() => setHistoryOpen(true)} aria-expanded={historyOpen} aria-controls="ai-conversation-history"><History size={16} /> Ver conversaciones</button>
        <button type="button" className={`ai-history-backdrop ${historyOpen ? 'visible' : ''}`} onClick={() => setHistoryOpen(false)} aria-label="Cerrar conversaciones" tabIndex={historyOpen ? 0 : -1} />
        <aside id="ai-conversation-history" className={`ai-history ${historyOpen ? 'open' : ''}`} aria-hidden={!historyOpen}>
          <div className="ai-drawer-heading"><span>Conversaciones</span><button type="button" onClick={() => setHistoryOpen(false)} aria-label="Cerrar"><X size={18} /></button></div>
          <button type="button" className="ai-new-chat" onClick={newConversation}><MessageSquarePlus size={18} /> Nuevo chat</button>
          <div className="ai-history-header"><span>RECIENTES</span></div>
          <div className="ai-history-list">
            {conversations.map(item => <button type="button" key={item.id} onClick={() => openConversation(item.id)} className={conversationId === item.id ? 'active' : ''}><MessageSquare size={14} className="ai-history-icon" /><span>{item.title}</span><Trash2 size={14} className="ai-delete-icon" onClick={event => removeConversation(event, item.id)} /></button>)}
            {!conversations.length && !loading && <small>Tus conversaciones aparecerán acá.</small>}
          </div>
        </aside>

        <div className={`ai-chat ${messages.length ? 'has-messages' : 'is-empty'}`}>
          <div className="ai-messages" aria-live="polite">
            {!messages.length && <div className="ai-empty"><h1>¿En qué puedo ayudarte?</h1></div>}
            {messages.map(message => <article key={messageKey(message)} className={`ai-message ${message.role.toLowerCase()} ${message.status?.toLowerCase()}`}>
              {message.role === 'ASSISTANT' && <Bot size={18} className="ai-avatar" />}
              <div className="ai-message-body">
                {message.content ? <ReactMarkdown>{message.content}</ReactMarkdown> : <span className="ai-thinking">Analizando datos…</span>}
                {message.kind === 'ROUTINE_DRAFT' && <div className="ai-routine-card">
                  <div><strong>{message.metadata?.summary?.student?.name || 'Rutina propuesta'}</strong><span>{message.metadata?.summary?.goal} · {message.metadata?.summary?.days} días</span>{message.metadata?.summary?.newExercises?.length > 0 && <small>{message.metadata.summary.newExercises.length} ejercicios nuevos requieren revisión</small>}</div>
                  <button type="button" onClick={() => openDraft(message)}>Revisar y asignar <ChevronRight size={16} /></button>
                </div>}
              </div>
            </article>)}
            <div ref={endRef} />
          </div>

          {!home.enabled && !loading && <div className="ai-disabled"><AlertCircle size={18} /><span>{home.disabledReason === 'MONTHLY_LIMIT' ? 'Alcanzaste tus 100 consultas de IA de este mes. El cupo se renueva el primer día del próximo mes.' : 'La integración con IA todavía no está configurada.'}</span></div>}
          <form className="ai-composer" onSubmit={send}>
            <textarea value={input} onChange={event => setInput(event.target.value)} placeholder="Escribí tu consulta..." maxLength={2000} disabled={!home.enabled || sending} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(event); } }} />
            {sending ? <button type="button" onClick={stop} aria-label="Detener respuesta"><Square size={17} /></button> : <button type="submit" disabled={!input.trim() || !home.enabled} aria-label="Enviar"><Send size={18} /></button>}
          </form>
          {!messages.length && home.suggestions.length > 0 && <div className="ai-suggestions"><button type="button" key={suggestionIndex} onClick={() => setInput(home.suggestions[suggestionIndex])}>{home.suggestions[suggestionIndex]}</button></div>}
          {home.usage && <p className="ai-usage">{home.usage.usedPrompts} de {home.usage.limitPrompts} consultas usadas este mes</p>}
          {/* <p className="ai-privacy">Gymhour AI puede cometer errores. Verificá la información importante.</p> */}
        </div>
      </div>

    </section>
  );
};

export default AIHomePanel;
