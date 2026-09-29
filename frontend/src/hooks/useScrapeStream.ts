// src/hooks/useScrapeStream.ts
//
// Consumes the SSE stream from GET /api/scrape?url=...&categories=...&urls=...
// (Phase 2). Exposes live progress so the Train tab can show a real progress
// bar instead of a blind spinner.
//
// IMPORTANT: this uses fetch() + a ReadableStream reader, NOT EventSource.
// The backend and frontend are on different domains, so auth is done with a
// `Authorization: Bearer <token>` header (cookies don't cross domains here —
// see lib/auth-token.ts). EventSource cannot set request headers, so it could
// only ever send cookies → the request hit the protected /api/scrape route
// unauthenticated and got 401, leaving training stuck. fetch() lets us attach
// the bearer token, exactly like useChatStream does.
'use client';

import { useCallback, useRef, useState } from 'react';
import { config } from '@/lib/config';
import { getToken } from '@/lib/auth-token';

export type ScrapePhase = 'idle' | 'crawling' | 'indexing' | 'done' | 'error';

export interface PageLogEntry {
  url: string;
  status: 'ok' | 'err';
  chunks?: number;
  ms?: number;
  error?: string;
}

export interface ScrapeProgress {
  phase: ScrapePhase;
  message: string;
  current: number;      // pages processed so far
  total: number;        // pages matching selected categories
  recordsStored: number;
  log: PageLogEntry[];
  currentUrl: string | null;
  error: string | null;
}

const INITIAL: ScrapeProgress = {
  phase: 'idle',
  message: '',
  current: 0,
  total: 0,
  recordsStored: 0,
  log: [],
  currentUrl: null,
  error: null,
};

export interface ScrapeResult {
  success: boolean;
  pagesIndexed?: number;
  recordsStored?: number;
  error?: string;
}

export interface UseScrapeStreamResult {
  progress: ScrapeProgress;
  start: (params: { url: string; categories?: string[]; urls?: string[] }) => Promise<ScrapeResult>;
  cancel: () => void;
  reset: () => void;
}

// If the stream goes this long without ANY event (connection never opened, or
// opened then silently stalled), we stop waiting and surface an error instead
// of leaving the UI stuck on "Connecting…" forever. The real flow sends an
// event within ~3s and then steadily during indexing, so this only trips on a
// genuinely dead/hung connection.
const STREAM_WATCHDOG_MS = 45_000;

export function useScrapeStream(): UseScrapeStreamResult {
  const [progress, setProgress] = useState<ScrapeProgress>(INITIAL);
  // Aborts the in-flight fetch (cancel button / new run / watchdog). Aborting
  // closes the TCP socket, which makes the backend stop indexing too.
  const abortRef = useRef<AbortController | null>(null);
  // Pending resolver for the in-flight start() Promise, so cancel() can resolve
  // the awaiting caller — otherwise handleIndex would hang and the "indexing"
  // button state would never clear.
  const resolveRef = useRef<((r: ScrapeResult) => void) | null>(null);
  // Watchdog timer — reset on every event, fired if the stream goes silent.
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    clearWatchdog();
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (resolveRef.current) {
      resolveRef.current({ success: false, error: 'Cancelled' });
      resolveRef.current = null;
    }
    // Reset so the progress panel hides and the Train button re-enables.
    setProgress(INITIAL);
  }, [clearWatchdog]);

  const reset = useCallback(() => {
    cancel();
  }, [cancel]);

  const start = useCallback(
    ({ url, categories, urls }: { url: string; categories?: string[]; urls?: string[] }) => {
      cancel();
      setProgress({ ...INITIAL, phase: 'crawling', message: 'Connecting…' });

      const q = new URLSearchParams({ url });
      if (categories?.length) q.set('categories', categories.join(','));
      if (urls?.length) q.set('urls', urls.join(','));
      const endpoint = `${config.apiUrl}/api/scrape?${q.toString()}`;

      const abort = new AbortController();
      abortRef.current = abort;

      return new Promise<ScrapeResult>((resolve) => {
        resolveRef.current = resolve;

        // Single settle path — resolves the awaiting caller exactly once and
        // tears down the watchdog + abort handle.
        let settled = false;
        const finish = (result: ScrapeResult) => {
          if (settled) return;
          settled = true;
          clearWatchdog();
          abortRef.current = null;
          resolveRef.current = null;
          resolve(result);
        };

        // Reset the silence watchdog on every event. If it ever fires we've had
        // no traffic for STREAM_WATCHDOG_MS → the connection is dead/hung, so
        // fail loudly (and abort) instead of spinning on "Connecting…" forever.
        const bumpWatchdog = () => {
          clearWatchdog();
          watchdogRef.current = setTimeout(() => {
            setProgress((p) => ({
              ...p,
              phase: 'error',
              error:
                'Training didn’t respond. The connection may have dropped or you may need to sign in again. Please try again.',
            }));
            abort.abort();
            finish({ success: false, error: 'Timed out waiting for training to respond' });
          }, STREAM_WATCHDOG_MS);
        };

        const dispatch = (event: string, data: any) => {
          bumpWatchdog();
          switch (event) {
            case 'phase':
              setProgress((p) => ({
                ...p,
                phase: data.phase === 'crawling' ? 'crawling' : p.phase,
                message: data.message ?? p.message,
              }));
              break;
            case 'crawl-done':
              setProgress((p) => ({
                ...p,
                phase: 'indexing',
                message: `Indexing ${data.totalPages} pages…`,
                total: data.totalPages,
              }));
              break;
            case 'page-start':
              setProgress((p) => ({
                ...p,
                currentUrl: data.url,
                message: `Indexing page ${data.current} of ${data.total}`,
              }));
              break;
            case 'page-done':
              setProgress((p) => ({
                ...p,
                current: data.current,
                recordsStored: data.recordsStored,
                log: [...p.log, { url: data.url, status: 'ok', chunks: data.chunks, ms: data.ms }],
              }));
              break;
            case 'page-error':
              setProgress((p) => ({
                ...p,
                current: data.current,
                log: [...p.log, { url: data.url, status: 'err', error: data.error }],
              }));
              break;
            case 'done':
              setProgress((p) => ({
                ...p,
                phase: 'done',
                message: `Indexed ${data.pagesIndexed} pages, ${data.recordsStored} chunks stored.`,
                recordsStored: data.recordsStored,
                currentUrl: null,
              }));
              finish({ success: true, pagesIndexed: data.pagesIndexed, recordsStored: data.recordsStored });
              break;
            case 'error': {
              const msg = data.error ?? 'Training failed';
              setProgress((p) => ({ ...p, phase: 'error', error: msg }));
              finish({ success: false, error: msg });
              break;
            }
          }
        };

        bumpWatchdog();

        void (async () => {
          try {
            const token = getToken();
            const res = await fetch(endpoint, {
              method: 'GET',
              headers: {
                Accept: 'text/event-stream',
                // Cross-domain auth — the piece EventSource couldn't do.
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
              },
              credentials: 'include',
              signal: abort.signal,
            });

            if (!res.ok) {
              const msg =
                res.status === 401
                  ? 'Your session has expired. Please sign in again, then retry training.'
                  : `Training service error (HTTP ${res.status}). Please try again.`;
              setProgress((p) => ({ ...p, phase: 'error', error: msg }));
              finish({ success: false, error: msg });
              return;
            }
            if (!res.body) {
              const msg = 'Training stream unavailable. Please try again.';
              setProgress((p) => ({ ...p, phase: 'error', error: msg }));
              finish({ success: false, error: msg });
              return;
            }

            // Connected. Move off "Connecting…" unless an event already did.
            bumpWatchdog();
            setProgress((p) =>
              p.message === 'Connecting…' ? { ...p, message: 'Connected, preparing pages…' } : p,
            );

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              // SSE frames are separated by a blank line. JSON payloads are
              // single-line (JSON.stringify), so a simple split is safe.
              const frames = buffer.split('\n\n');
              buffer = frames.pop() ?? '';

              for (const frame of frames) {
                let event = 'message';
                let dataStr = '';
                for (const line of frame.split('\n')) {
                  if (line.startsWith('event:')) event = line.slice(6).trim();
                  else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
                }
                if (!dataStr) continue;
                let data: any;
                try { data = JSON.parse(dataStr); } catch { continue; }
                dispatch(event, data);
                if (settled) break;
              }
              if (settled) break;
            }

            // Stream ended without a 'done'/'error' event → the server closed
            // mid-flight (crash, restart, proxy timeout). Don't leave it hanging.
            if (!settled) {
              setProgress((p) => ({
                ...p,
                phase: 'error',
                error: 'Training connection closed before finishing. Some pages may have been saved, please retry.',
              }));
              finish({ success: false, error: 'Connection closed before completion' });
            }
          } catch (err: any) {
            // cancel()/watchdog already settled + reset the UI on abort.
            if (err?.name === 'AbortError' || settled) return;
            const msg =
              'Couldn’t reach the training service. Make sure you’re signed in, then try again.';
            setProgress((p) => ({ ...p, phase: 'error', error: msg }));
            finish({ success: false, error: msg });
          }
        })();
      });
    },
    [cancel, clearWatchdog]
  );

  return { progress, start, cancel, reset };
}
