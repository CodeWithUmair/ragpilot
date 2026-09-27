// src/stores/ui.store.ts
import { create } from 'zustand';

// ── Sidebar store ─────────────────────────────────────────────────────────────

interface SidebarStore {
  isOpen: boolean;
  toggle: () => void;
  open: () => void;
  close: () => void;
}

export const useSidebarStore = create<SidebarStore>((set) => ({
  isOpen: true,
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}));

// ── Active chatbot store ──────────────────────────────────────────────────────

interface Chatbot {
  id: string;
  name: string;
  url: string;
  embedToken: string;
  status: string;
  isTrained: boolean;
}

interface ChatbotStore {
  activeChatbot: Chatbot | null;
  setActiveChatbot: (chatbot: Chatbot | null) => void;
}

export const useChatbotStore = create<ChatbotStore>((set) => ({
  activeChatbot: null,
  setActiveChatbot: (chatbot) => set({ activeChatbot: chatbot }),
}));

// ── Chat widget store (for dashboard preview) ─────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

interface ChatWidgetStore {
  messages: ChatMessage[];
  isOpen: boolean;
  isLoading: boolean;
  addMessage: (msg: ChatMessage) => void;
  appendToLastMessage: (delta: string) => void;
  setLoading: (loading: boolean) => void;
  toggleOpen: () => void;
  reset: () => void;
}

export const useChatWidgetStore = create<ChatWidgetStore>((set) => ({
  messages: [],
  isOpen: false,
  isLoading: false,
  addMessage: (msg) =>
    set((s) => ({ messages: [...s.messages, msg] })),
  appendToLastMessage: (delta) =>
    set((s) => {
      const messages = [...s.messages];
      const last = messages[messages.length - 1];
      if (last?.role === 'assistant') {
        messages[messages.length - 1] = {
          ...last,
          content: last.content + delta,
        };
      }
      return { messages };
    }),
  setLoading: (isLoading) => set({ isLoading }),
  toggleOpen: () => set((s) => ({ isOpen: !s.isOpen })),
  reset: () => set({ messages: [], isLoading: false }),
}));
