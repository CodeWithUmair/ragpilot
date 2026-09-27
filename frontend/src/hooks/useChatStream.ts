// src/hooks/useChatStream.ts
import { useCallback, useRef, useState } from 'react';
import { config } from '../lib/config';
import { useChatWidgetStore } from '../stores/ui.store';
import { randomUUID } from 'crypto';

interface ChatTurn {
  question: string;
  answer: string;
}

interface UseChatStreamOptions {
  token?: string;    // chatbot embedToken
  url?: string;      // fallback: chatbot source URL
  sessionId?: string;
  visitorId?: string;
  hostPageUrl?: string;
}

export function useChatStream(opts: UseChatStreamOptions) {
  const { addMessage, appendToLastMessage, setLoading } = useChatWidgetStore();
  const [history, setHistory] = useState<ChatTurn[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    async (question: string) => {
      if (!question.trim()) return;
      if (abortRef.current) abortRef.current.abort();

      const abort = new AbortController();
      abortRef.current = abort;

      // Add user message
      addMessage({
        id: crypto.randomUUID(),
        role: 'user',
        content: question,
        createdAt: new Date(),
      });

      // Add empty assistant message that we'll stream into
      const assistantId = crypto.randomUUID();
      addMessage({
        id: assistantId,
        role: 'assistant',
        content: '',
        createdAt: new Date(),
      });

      setLoading(true);

      try {
        const response = await fetch(`${config.apiUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          signal: abort.signal,
          body: JSON.stringify({
            question,
            token: opts.token,
            url: opts.url,
            sessionId: opts.sessionId,
            visitorId: opts.visitorId,
            hostPageUrl: opts.hostPageUrl,
            history,
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let fullAnswer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (line.startsWith('event: ')) continue; // skip event: lines
            if (line.startsWith('data: ')) {
              try {
                const payload = JSON.parse(line.slice(6));

                if (payload.content !== undefined) {
                  // delta event
                  fullAnswer += payload.content;
                  appendToLastMessage(payload.content);
                }
              } catch {}
            }
          }
        }

        // Update history
        setHistory((prev) => [...prev.slice(-5), { question, answer: fullAnswer }]);
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          appendToLastMessage('\n\n_Something went wrong. Please try again._');
        }
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [opts, history, addMessage, appendToLastMessage, setLoading]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
  }, [setLoading]);

  return { sendMessage, stop };
}
