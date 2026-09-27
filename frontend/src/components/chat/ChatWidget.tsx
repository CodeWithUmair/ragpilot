// src/components/chat/ChatWidget.tsx
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeHighlight from 'rehype-highlight';
import {
  ArrowUp, ChevronLeft, ChevronRight, Home, MessageSquare, MessagesSquare,
  Send, Square, X,
} from 'lucide-react';
import { config } from '../../lib/config';

interface ChatWidgetProps {
  token?: string;
  url?: string;
  hostPageUrl?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatTurn {
  question: string;
  answer: string;
}

// A conversation in the visitor's own history (Fin-style Messages tab).
interface Conversation {
  sessionId: string;
  title: string;
  preview: string;
  messageCount: number;
  startedAt: string;
  lastActivityAt: string;
}

type View = 'home' | 'messages' | 'chat';

// ── Persistent identity ───────────────────────────────────────────────────────
// The PRIMARY visitor identity is a first-party id persisted in localStorage —
// stable per browser, survives reloads, and is what lets a returning visitor see
// their past conversations. (IP is only a weak secondary signal, captured
// server-side; it's shared behind NAT and changes on mobile/VPN, so it's wrong
// to key identity on it.) Falls back to an in-memory id if storage is blocked.
function uuid(): string {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function getVisitorId(token?: string): string {
  if (typeof window === 'undefined') return uuid();
  const key = `ragpilot:visitor:${token ?? 'default'}`;
  try {
    let id = localStorage.getItem(key);
    if (!id) { id = uuid(); localStorage.setItem(key, id); }
    return id;
  } catch {
    return uuid();
  }
}

// Lead-capture config the widget receives from /api/chatbots/public/:token.
interface LeadConfig {
  enabled: boolean;
  fields: string[];
  required: string[];
  heading: string;
  successMessage: string;
}
interface LeadForm {
  heading: string;
  fields: string[];
  required: string[];
  successMessage: string;
}
const LEAD_FIELD_META: Record<string, { placeholder: string; type: string }> = {
  name: { placeholder: 'Your name', type: 'text' },
  email: { placeholder: 'Email address', type: 'email' },
  phone: { placeholder: 'Phone number', type: 'tel' },
  company: { placeholder: 'Company', type: 'text' },
};

interface BotInfo {
  name: string;
  welcomeMessage?: string;
  themeColor?: string;
  primaryColor?: string;
  botAvatar?: string;
  inputPlaceholder?: string;
  showPoweredBy?: boolean;
  leadConfig?: LeadConfig;
}

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return '';
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  return `${days}d`;
}

export default function ChatWidget({ token, url, hostPageUrl }: ChatWidgetProps) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('home');

  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);

  // Active conversation thread.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  // The visitor's conversation list.
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [convLoading, setConvLoading] = useState(false);

  // Lead capture.
  const [leadForm, setLeadForm] = useState<LeadForm | null>(null);
  const [leadValues, setLeadValues] = useState<Record<string, string>>({});
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadError, setLeadError] = useState('');
  const leadDoneRef = useRef(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const visitorId = useMemo(() => getVisitorId(token), [token]);
  const themeColor = botInfo?.primaryColor || botInfo?.themeColor || '#6B46C1';
  const botName = botInfo?.name ?? 'AI Assistant';

  // ── Fetch bot info ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!token) return;
    fetch(`${config.apiUrl}/api/chatbots/public/${token}`)
      .then((r) => r.json())
      .then((d) => { if (d.chatbot) setBotInfo(d.chatbot); })
      .catch(() => {});
  }, [token]);

  // ── Load the visitor's conversation list ────────────────────────────────────
  function loadConversations() {
    if (!token) return;
    setConvLoading(true);
    fetch(`${config.apiUrl}/api/chat/conversations?token=${encodeURIComponent(token)}&visitorId=${encodeURIComponent(visitorId)}`)
      .then((r) => r.json())
      .then((d) => setConversations(Array.isArray(d.conversations) ? d.conversations : []))
      .catch(() => {})
      .finally(() => setConvLoading(false));
  }

  // Load conversations the first time the widget opens.
  useEffect(() => {
    if (open && token) loadConversations();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ── Auto-scroll + textarea autogrow ─────────────────────────────────────────
  useEffect(() => {
    if (view === 'chat') bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading, view, leadForm]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const LINE_HEIGHT = 20;
    const VERTICAL_PADDING = 16;
    const MAX_HEIGHT = LINE_HEIGHT * 3 + VERTICAL_PADDING;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, MAX_HEIGHT) + 'px';
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';
  }, [input]);

  // Tell the embed loader to resize the iframe.
  useEffect(() => {
    if (typeof window === 'undefined' || window.parent === window) return;
    try {
      window.parent.postMessage({ type: open ? 'chatbot:open' : 'chatbot:close' }, '*');
    } catch {}
  }, [open]);

  // ── Conversation navigation ─────────────────────────────────────────────────
  function startNewConversation() {
    abortRef.current?.abort();
    setSessionId(uuid());
    setMessages([]);
    setHistory([]);
    setLeadForm(null);
    leadDoneRef.current = false;
    setView('chat');
  }

  async function openConversation(id: string) {
    abortRef.current?.abort();
    setSessionId(id);
    setMessages([]);
    setHistory([]);
    setLeadForm(null);
    leadDoneRef.current = false;
    setView('chat');
    try {
      const res = await fetch(`${config.apiUrl}/api/chat/history/${encodeURIComponent(id)}`);
      const data = await res.json();
      const turns: { question: string; answer: string }[] = data.messages ?? [];
      const restored: Message[] = [];
      for (const t of turns) {
        restored.push({ id: uuid(), role: 'user', content: t.question });
        restored.push({ id: uuid(), role: 'assistant', content: t.answer });
      }
      setMessages(restored);
      setHistory(turns.slice(-6).map((t) => ({ question: t.question, answer: t.answer })));
    } catch {
      // Leave the thread empty; the visitor can keep chatting.
    }
  }

  function appendToLast(delta: string) {
    setMessages((prev) => {
      const msgs = [...prev];
      const last = msgs[msgs.length - 1];
      if (last?.role === 'assistant') {
        msgs[msgs.length - 1] = { ...last, content: last.content + delta };
      }
      return msgs;
    });
  }

  function handleLeadEvent(payload: Partial<LeadForm>) {
    if (leadDoneRef.current) return;
    if (botInfo?.leadConfig && botInfo.leadConfig.enabled === false) return;
    setLeadForm((cur) =>
      cur ?? {
        heading: payload.heading || 'Leave your details and our team will reach out:',
        fields: payload.fields?.length ? payload.fields : ['name', 'email', 'phone'],
        required: payload.required?.length ? payload.required : ['email'],
        successMessage: payload.successMessage || 'Thanks! Our team will get back to you shortly.',
      },
    );
  }

  async function submitLead() {
    if (!leadForm || leadSubmitting) return;
    for (const f of leadForm.required) {
      if (!leadValues[f]?.trim()) { setLeadError(`Please enter your ${f}.`); return; }
    }
    if (!leadValues.email?.trim() && !leadValues.phone?.trim()) {
      setLeadError('Please enter an email or phone number.');
      return;
    }
    setLeadSubmitting(true);
    setLeadError('');
    try {
      const res = await fetch(`${config.apiUrl}/api/leads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token, sessionId, visitorId, hostPageUrl,
          name: leadValues.name, email: leadValues.email,
          phone: leadValues.phone, company: leadValues.company,
        }),
      });
      if (!res.ok) throw new Error('failed');
      leadDoneRef.current = true;
      const successMessage = leadForm.successMessage;
      setLeadForm(null);
      setMessages((prev) => [
        ...prev,
        { id: uuid(), role: 'assistant', content: successMessage },
      ]);
    } catch {
      setLeadError('Something went wrong. Please try again.');
    } finally {
      setLeadSubmitting(false);
    }
  }

  async function sendMessage() {
    const q = input.trim();
    if (!q || loading) return;
    setInput('');

    // Ensure we have an active session (e.g. when sending the first message).
    let sid = sessionId;
    if (!sid) { sid = uuid(); setSessionId(sid); }

    const userMsg: Message = { id: uuid(), role: 'user', content: q };
    const assistantMsg: Message = { id: uuid(), role: 'assistant', content: '' };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setLoading(true);

    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(`${config.apiUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: abort.signal,
        body: JSON.stringify({
          question: q, token, url,
          sessionId: sid, visitorId, hostPageUrl, history,
        }),
      });
      if (!res.ok) throw new Error('Request failed');

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let fullAnswer = '';
      let currentEvent = 'message';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (line.startsWith('event: ')) { currentEvent = line.slice(7).trim(); continue; }
          if (line.startsWith('data: ')) {
            try {
              const payload = JSON.parse(line.slice(6));
              if (currentEvent === 'lead') handleLeadEvent(payload);
              else if (payload.content) { fullAnswer += payload.content; appendToLast(payload.content); }
            } catch {}
          }
        }
      }

      setHistory((prev) => [...prev.slice(-5), { question: q, answer: fullAnswer }]);
      // Refresh the conversation list so the new/updated thread surfaces in
      // Messages and Home without a manual reload.
      loadConversations();
    } catch (err: any) {
      if (err.name !== 'AbortError') appendToLast('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
      abortRef.current = null;
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @keyframes ragpilotTyping {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.35; }
          30%          { transform: translateY(-4px); opacity: 1; }
        }
        .ragpilot-scroll::-webkit-scrollbar { width: 6px; }
        .ragpilot-scroll::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.15); border-radius: 4px; }
      `}</style>

      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open chat"
          style={{
            position: 'fixed', bottom: 20, right: 20, width: 56, height: 56,
            borderRadius: '50%', background: themeColor, border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 28px rgba(0,0,0,0.28)', zIndex: 9999,
          }}
        >
          <MessagesSquare size={24} color="#fff" />
        </button>
      )}

      {open && (
        <div
          className="ragpilot-scroll"
          style={{
            position: 'fixed', bottom: 20, right: 20, width: 400,
            maxWidth: 'calc(100vw - 24px)', height: 620, maxHeight: 'calc(100vh - 40px)',
            background: '#f4f5f7', borderRadius: 20, overflow: 'hidden',
            boxShadow: '0 24px 70px rgba(0,0,0,0.28)', zIndex: 9999,
            display: 'flex', flexDirection: 'column',
            border: '1px solid rgba(0,0,0,0.06)',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          }}
        >
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            {view === 'home' && (
              <HomeView
                botName={botName} botInfo={botInfo} themeColor={themeColor}
                conversations={conversations}
                onClose={() => setOpen(false)}
                onNewChat={startNewConversation}
                onOpenConversation={openConversation}
              />
            )}
            {view === 'messages' && (
              <MessagesView
                themeColor={themeColor}
                conversations={conversations} loading={convLoading}
                onClose={() => setOpen(false)}
                onNewChat={startNewConversation}
                onOpenConversation={openConversation}
              />
            )}
            {view === 'chat' && (
              <ChatView
                botName={botName} botInfo={botInfo} themeColor={themeColor}
                messages={messages} loading={loading}
                input={input} setInput={setInput}
                onSend={sendMessage} onStop={() => abortRef.current?.abort()}
                onBack={() => setView(conversations.length ? 'messages' : 'home')}
                onClose={() => setOpen(false)}
                textareaRef={textareaRef} bottomRef={bottomRef}
                leadForm={leadForm} leadValues={leadValues} setLeadValues={setLeadValues}
                leadError={leadError} leadSubmitting={leadSubmitting} onSubmitLead={submitLead}
              />
            )}
          </div>

          {/* Bottom navigation (Fin-style) — hidden while inside a chat thread. */}
          {view !== 'chat' && (
            <BottomNav view={view} themeColor={themeColor} onChange={setView} />
          )}
        </div>
      )}
    </>
  );
}

// ── Home view ─────────────────────────────────────────────────────────────────
function HomeView({
  botName, botInfo, themeColor, conversations, onClose, onNewChat, onOpenConversation,
}: {
  botName: string;
  botInfo: BotInfo | null;
  themeColor: string;
  conversations: Conversation[];
  onClose: () => void;
  onNewChat: () => void;
  onOpenConversation: (id: string) => void;
}) {
  const recent = conversations[0];
  return (
    <div className="ragpilot-scroll" style={{ flex: 1, minHeight: 0, overflowY: 'auto', background: '#f4f5f7', display: 'flex', flexDirection: 'column' }}>
      {/* Gradient hero */}
      <div
        style={{
          background: `linear-gradient(160deg, ${themeColor} 0%, ${shade(themeColor, -28)} 100%)`,
          padding: '20px 20px 26px', color: '#fff', flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Avatar src={botInfo?.botAvatar} name={botName} size={40} ring />
          <button onClick={onClose} aria-label="Close" style={iconBtn}>
            <X size={18} />
          </button>
        </div>
        <h1 style={{ margin: '22px 0 0', fontSize: 25, fontWeight: 700, lineHeight: 1.25, opacity: 0.92 }}>
          Hello there.
        </h1>
        <h2 style={{ margin: 0, fontSize: 25, fontWeight: 700, lineHeight: 1.25 }}>
          How can we help?
        </h2>
      </div>

      {/* Cards — sit below the hero (no overlap), each robustly constrained so
          nothing clips at the 400px widget width. */}
      <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {/* Recent message */}
        {recent && (
          <button
            onClick={() => onOpenConversation(recent.sessionId)}
            style={{ ...card, textAlign: 'left', cursor: 'pointer', display: 'block', width: '100%', boxSizing: 'border-box' }}
          >
            <p style={{ margin: '0 0 8px', fontSize: 12, fontWeight: 700, color: '#6b7280' }}>Recent message</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Avatar src={botInfo?.botAvatar} name={botName} size={34} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {recent.title}
                  </span>
                  <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }}>{timeAgo(recent.lastActivityAt)}</span>
                </div>
                <p style={{ margin: '2px 0 0', fontSize: 13, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {recent.preview || 'Continue the conversation'}
                </p>
              </div>
              <ChevronRight size={18} color="#9ca3af" style={{ flexShrink: 0 }} />
            </div>
          </button>
        )}

        {/* Send us a message */}
        <button
          onClick={onNewChat}
          style={{ ...card, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 12, width: '100%', boxSizing: 'border-box', textAlign: 'left' }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827' }}>Send us a message</p>
            <p style={{ margin: '2px 0 0', fontSize: 13, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {botInfo?.welcomeMessage?.trim() || 'We typically reply in a few minutes'}
            </p>
          </div>
          <span style={{ width: 34, height: 34, borderRadius: '50%', background: themeColor, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Send size={16} color="#fff" />
          </span>
        </button>
      </div>
    </div>
  );
}

// ── Messages (conversation list) view ───────────────────────────────────────
function MessagesView({
  themeColor, conversations, loading, onClose, onNewChat, onOpenConversation,
}: {
  themeColor: string;
  conversations: Conversation[];
  loading: boolean;
  onClose: () => void;
  onNewChat: () => void;
  onOpenConversation: (id: string) => void;
}) {
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 18px', borderBottom: '1px solid #eef0f3' }}>
        <span style={{ fontSize: 17, fontWeight: 700, color: '#111827' }}>Messages</span>
        <button onClick={onClose} aria-label="Close" style={{ ...iconBtn, background: '#f3f4f6', color: '#6b7280' }}>
          <X size={18} />
        </button>
      </div>

      <div className="ragpilot-scroll" style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <p style={{ padding: 20, fontSize: 13, color: '#9ca3af', textAlign: 'center' }}>Loading…</p>
        ) : conversations.length === 0 ? (
          <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <MessageSquare size={28} color="#cbd5e1" style={{ margin: '0 auto 10px' }} />
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#374151' }}>No conversations yet</p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#9ca3af' }}>Start a new one below.</p>
          </div>
        ) : (
          conversations.map((c) => (
            <button
              key={c.sessionId}
              onClick={() => onOpenConversation(c.sessionId)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '14px 18px', background: 'none', border: 'none', borderBottom: '1px solid #f3f4f6', cursor: 'pointer' }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#111827', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.title}</span>
                  <span style={{ fontSize: 12, color: '#9ca3af', flexShrink: 0 }}>{timeAgo(c.lastActivityAt)}</span>
                </div>
                <p style={{ margin: '3px 0 0', fontSize: 13, color: '#6b7280', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.preview}</p>
              </div>
              <ChevronRight size={18} color="#cbd5e1" />
            </button>
          ))
        )}
      </div>

      <div style={{ padding: 14 }}>
        <button
          onClick={onNewChat}
          style={{ width: '100%', padding: '12px', borderRadius: 12, background: themeColor, color: '#fff', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
        >
          Send us a message <Send size={15} />
        </button>
      </div>
    </div>
  );
}

// ── Chat thread view ──────────────────────────────────────────────────────────
function ChatView(props: {
  botName: string;
  botInfo: BotInfo | null;
  themeColor: string;
  messages: Message[];
  loading: boolean;
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onBack: () => void;
  onClose: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  leadForm: LeadForm | null;
  leadValues: Record<string, string>;
  setLeadValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  leadError: string;
  leadSubmitting: boolean;
  onSubmitLead: () => void;
}) {
  const {
    botName, botInfo, themeColor, messages, loading, input, setInput, onSend, onStop,
    onBack, onClose, textareaRef, bottomRef, leadForm, leadValues, setLeadValues,
    leadError, leadSubmitting, onSubmitLead,
  } = props;

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: '#f9fafb' }}>
      {/* Header */}
      <div style={{ background: themeColor, padding: '14px 16px', color: '#fff', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <button onClick={onBack} aria-label="Back" style={iconBtn}><ChevronLeft size={20} /></button>
        <Avatar src={botInfo?.botAvatar} name={botName} size={32} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontWeight: 700, fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{botName}</p>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, opacity: 0.9 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#34d399' }} /> Active now
          </span>
        </div>
        <button onClick={onClose} aria-label="Close" style={iconBtn}><X size={18} /></button>
      </div>

      {/* Messages */}
      <div className="ragpilot-scroll" style={{ flex: 1, overflowY: 'auto', padding: '16px 16px 8px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <Bubble role="assistant" themeColor={themeColor}>
            {botInfo?.welcomeMessage?.trim() || `Hi! I'm ${botName}. Ask me anything.`}
          </Bubble>
        )}

        {messages.map((msg) => (
          <Bubble key={msg.id} role={msg.role} themeColor={themeColor}>
            {msg.role === 'assistant'
              ? (msg.content
                ? <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeHighlight]}>{msg.content}</ReactMarkdown>
                : <TypingDots />)
              : msg.content}
          </Bubble>
        ))}

        {leadForm && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ width: '100%', maxWidth: '92%', padding: 14, borderRadius: 16, background: '#fff', border: `1px solid ${themeColor}40`, boxShadow: '0 1px 6px rgba(0,0,0,0.08)' }}>
              <p style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 600, color: '#111827', lineHeight: 1.4 }}>{leadForm.heading}</p>
              {leadForm.fields.map((f) => (
                <input
                  key={f}
                  type={LEAD_FIELD_META[f]?.type ?? 'text'}
                  placeholder={LEAD_FIELD_META[f]?.placeholder ?? f}
                  value={leadValues[f] ?? ''}
                  onChange={(e) => setLeadValues((s) => ({ ...s, [f]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') onSubmitLead(); }}
                  style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', marginBottom: 8, fontSize: 14, border: '1px solid #e5e7eb', borderRadius: 10, outline: 'none', fontFamily: 'inherit', color: '#111827', background: '#fff' }}
                />
              ))}
              {leadError && <p style={{ color: '#dc2626', fontSize: 12, margin: '0 0 8px' }}>{leadError}</p>}
              <button onClick={onSubmitLead} disabled={leadSubmitting} style={{ width: '100%', padding: '9px 12px', fontSize: 14, fontWeight: 600, color: '#fff', background: themeColor, border: 'none', borderRadius: 10, cursor: leadSubmitting ? 'default' : 'pointer', opacity: leadSubmitting ? 0.6 : 1 }}>
                {leadSubmitting ? 'Sending…' : 'Submit'}
              </button>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ padding: '12px 16px', background: '#fff', borderTop: '1px solid #eef0f3', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: '#f3f4f6', borderRadius: 22, padding: '6px 6px 6px 14px' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
            placeholder={botInfo?.inputPlaceholder?.trim() || 'Ask a question...'}
            disabled={loading}
            rows={1}
            style={{ flex: 1, border: 'none', background: 'transparent', outline: 'none', fontSize: 14, lineHeight: '20px', padding: '8px 0', color: '#111827', resize: 'none', fontFamily: 'inherit' }}
          />
          <button
            onClick={loading ? onStop : onSend}
            style={{ width: 36, height: 36, borderRadius: '50%', background: loading ? '#e5e7eb' : themeColor, border: 'none', cursor: input.trim() || loading ? 'pointer' : 'not-allowed', opacity: input.trim() || loading ? 1 : 0.5, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginBottom: 1 }}
            aria-label={loading ? 'Stop' : 'Send'}
          >
            {loading ? <Square size={14} color="#6b7280" /> : <ArrowUp size={16} color="#fff" />}
          </button>
        </div>
        {botInfo?.showPoweredBy !== false && (
          <p style={{ textAlign: 'center', fontSize: 10, color: '#9ca3af', marginTop: 6 }}>Powered by RagPilot</p>
        )}
      </div>
    </div>
  );
}

// ── Bottom navigation ─────────────────────────────────────────────────────────
function BottomNav({ view, themeColor, onChange }: { view: View; themeColor: string; onChange: (v: View) => void }) {
  const items: { key: View; label: string; icon: typeof Home }[] = [
    { key: 'home', label: 'Home', icon: Home },
    { key: 'messages', label: 'Messages', icon: MessageSquare },
  ];
  return (
    <div style={{ display: 'flex', borderTop: '1px solid #eef0f3', background: '#fff', flexShrink: 0 }}>
      {items.map((it) => {
        const active = view === it.key;
        return (
          <button
            key={it.key}
            onClick={() => onChange(it.key)}
            style={{ flex: 1, padding: '10px 0 12px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, color: active ? themeColor : '#9ca3af' }}
          >
            <it.icon size={20} />
            <span style={{ fontSize: 11, fontWeight: active ? 700 : 500 }}>{it.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Small presentational helpers ──────────────────────────────────────────────
function Bubble({ role, themeColor, children }: { role: 'user' | 'assistant'; themeColor: string; children: React.ReactNode }) {
  const isUser = role === 'user';
  return (
    <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
      <div style={{
        maxWidth: '82%', padding: '10px 14px',
        borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
        background: isUser ? themeColor : '#ffffff',
        color: isUser ? '#fff' : '#111827',
        fontSize: 14, lineHeight: 1.55,
        boxShadow: isUser ? 'none' : '0 1px 4px rgba(0,0,0,0.06)',
        border: isUser ? 'none' : '1px solid #eef0f3',
        wordBreak: 'break-word',
      }}>
        {children}
      </div>
    </div>
  );
}

function Avatar({ src, name, size, ring }: { src?: string; name: string; size: number; ring?: boolean }) {
  const initial = name?.[0]?.toUpperCase() ?? '?';
  const common: React.CSSProperties = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    boxShadow: ring ? '0 0 0 3px rgba(255,255,255,0.25)' : undefined,
    objectFit: 'cover',
  };
  if (src) return <img src={src} alt={name} style={common} />;
  return (
    <div style={{ ...common, background: 'rgba(255,255,255,0.22)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: size * 0.42 }}>
      {initial}
    </div>
  );
}

function TypingDots() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 17 }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#9ca3af', display: 'inline-block', animation: 'ragpilotTyping 1.2s infinite ease-in-out', animationDelay: `${i * 0.18}s` }} />
      ))}
    </span>
  );
}

// Shared inline-style constants.
const iconBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.18)', border: 'none', color: '#fff',
  width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
};

const card: React.CSSProperties = {
  background: '#fff', borderRadius: 16, padding: '14px 16px',
  border: '1px solid #eef0f3', boxShadow: '0 4px 16px rgba(0,0,0,0.06)',
};

// Darken/lighten a hex color by `amt` percent (negative = darker) for the hero
// gradient, so it works with any owner-chosen theme color.
function shade(hex: string, amt: number): string {
  const m = hex.replace('#', '');
  if (m.length !== 6) return hex;
  const num = parseInt(m, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  const r = clamp((num >> 16) + Math.round(2.55 * amt));
  const g = clamp(((num >> 8) & 0xff) + Math.round(2.55 * amt));
  const b = clamp((num & 0xff) + Math.round(2.55 * amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
