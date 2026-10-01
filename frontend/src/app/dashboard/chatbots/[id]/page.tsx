// src/app/dashboard/chatbots/[id]/page.tsx
'use client';

import { use, useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Bot, Code, RefreshCw, Globe,
  CheckCircle2, Clock, Zap, FileText, Type, XCircle, X,
  ChevronDown, ChevronRight, Palette, MessageCircle, Send,
  Sparkles, Headphones, ShoppingBag, BookOpen, Users,
} from 'lucide-react';
import Link from 'next/link';
import {
  useChatbot,
  useMe,
  queryKeys,
  useSaveCategories,
  useResetKnowledge,
  useDiscoverCategories,
  useUploadFile,
  DEFAULT_LEAD_CONFIG,
  type ChatbotCategory,
  type LeadField,
} from '../../../../hooks/useApi';
import { useScrapeStream } from '../../../../hooks/useScrapeStream';
import { cn } from '../../../../lib/utils';
import { planAllows } from '../../../../lib/plans';
import { StatusBadge } from '../../../../components/ui/StatusBadge';
import { Button } from '../../../../components/ui/button';
import { ColorPicker } from '../../../../components/ui/color-picker';
import { GoogleSheetGuide, ForwardTestButton } from '../../../../components/dashboard/GoogleSheetGuide';
import toast from 'react-hot-toast';

type Tab = 'train' | 'customize' | 'embed' | 'settings';

export default function ChatbotDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const { data, isLoading } = useChatbot(id);
  const [tab, setTab] = useState<Tab>('train');

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!data) return null;
  const { chatbot, vectorCount } = data;

  return (
    <div className="p-6 max-w-full mx-auto">
      <Link
        href="/dashboard/chatbots"
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to chatbots
      </Link>

      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 shrink-0">
          <Bot className="h-6 w-6 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold">{chatbot.name}</h1>
          <a
            href={chatbot.url}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-muted-foreground hover:text-foreground truncate"
          >
            {chatbot.url}
          </a>
        </div>
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>{vectorCount.toLocaleString()} vectors</span>
          <StatusBadge tone={chatbot.isTrained ? 'success' : 'warning'}>
            {chatbot.isTrained ? 'Trained' : 'Not trained'}
          </StatusBadge>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border mb-6">
        {(['train', 'customize', 'embed', 'settings'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2.5 text-sm font-medium capitalize border-b-2 -mb-px transition-colors',
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'train' && <TrainTab chatbotId={id} chatbot={chatbot} onTrained={() => setTab('customize')} />}
      {tab === 'customize' && <CustomizeTab chatbotId={id} chatbot={chatbot} onSaved={() => setTab('embed')} />}
      {tab === 'embed' && <EmbedTab chatbot={chatbot} />}
      {tab === 'settings' && <SettingsTab chatbotId={id} chatbot={chatbot} />}
    </div>
  );
}

// ─── Train Tab ────────────────────────────────────────────────────────────────

// Shape of a category as returned by /scrape (Phase 1 discovery).
interface DiscoveredCategory {
  name: string;
  pages: number;
  urls: string[];
}

function TrainTab({
  chatbotId,
  chatbot,
  onTrained,
}: {
  chatbotId: string;
  chatbot: any;
  onTrained?: () => void;
}) {
  const [source, setSource] = useState<'website' | 'file' | 'text'>('website');
  const [discoveredCategories, setDiscoveredCategories] = useState<DiscoveredCategory[]>([]);
  const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState('');

  const discoverMutation = useDiscoverCategories();
  const saveCategoryMutation = useSaveCategories(chatbotId);
  const uploadMutation = useUploadFile();
  const scrapeStream = useScrapeStream();
  const indexing = scrapeStream.progress.phase === 'crawling' || scrapeStream.progress.phase === 'indexing';
  const discovered = discoveredCategories.length > 0;

  // Warn before the user reloads/closes the tab mid-training. Training streams
  // over an SSE connection tied to this page — a refresh closes it, aborts the
  // remaining pages on the server, and drops the "Trained" flag. The native
  // beforeunload dialog is the only cross-browser way to intercept a reload.
  useEffect(() => {
    if (!indexing) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Legacy browsers require returnValue to be set to trigger the prompt.
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [indexing]);

  const totalUrls = useMemo(
    () => discoveredCategories.reduce((sum, c) => sum + c.urls.length, 0),
    [discoveredCategories]
  );

  async function handleDiscover() {
    const result = await discoverMutation.mutateAsync(chatbot.url);
    const cats: DiscoveredCategory[] = result.categories.map((c: any) => ({
      name: c.name,
      pages: c.pages,
      urls: c.urls ?? [],
    }));
    setDiscoveredCategories(cats);
    // Default: every page selected.
    setSelectedUrls(new Set(cats.flatMap((c) => c.urls)));
    // Default: every category collapsed (avoid wall-of-checkboxes).
    setOpenCategories(new Set());
  }

  function toggleCategoryOpen(name: string) {
    setOpenCategories((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleUrl(url: string) {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  function toggleCategoryUrls(cat: DiscoveredCategory, select: boolean) {
    setSelectedUrls((prev) => {
      const next = new Set(prev);
      for (const u of cat.urls) {
        if (select) next.add(u);
        else next.delete(u);
      }
      return next;
    });
  }

  async function handleIndex() {
    const urls = Array.from(selectedUrls);
    if (!urls.length) { toast.error('Select at least one page'); return; }

    // Backend still wants categories (legacy fallback) plus the explicit urls.
    const categoryNames = discoveredCategories
      .filter((c) => c.urls.some((u) => selectedUrls.has(u)))
      .map((c) => c.name);

    const result = await scrapeStream.start({
      url: chatbot.url,
      categories: categoryNames,
      urls,
    });

    if (result.success) {
      // Persist the per-category snapshot so the chatbot row reflects what
      // was trained. We mark a category as "enabled" if any of its URLs were
      // selected (no per-URL persistence yet — that's an enhancement).
      const persistedCategories: ChatbotCategory[] = discoveredCategories.map((c) => ({
        id: '',
        name: c.name,
        pages: c.urls.filter((u) => selectedUrls.has(u)).length,
        enabled: c.urls.some((u) => selectedUrls.has(u)),
        indexed: c.urls.every((u) => selectedUrls.has(u)),
      }));
      await saveCategoryMutation.mutateAsync({
        categories: persistedCategories,
        isTrained: true,
        lastTrainedAt: new Date().toISOString(),
      });
      toast.success(`Trained! ${result.recordsStored ?? 0} chunks indexed.`);
      // Hand off to the Settings tab so the user can customise theme / tone /
      // welcome message now that the bot actually has knowledge.
      onTrained?.();
    } else if (result.error === 'Cancelled') {
      // User clicked Cancel — silent, the UI already reset itself.
    } else {
      toast.error(result.error ?? 'Training failed');
    }
  }

  async function handleFileUpload() {
    if (!file) return;
    await uploadMutation.mutateAsync({ namespace: chatbot.embedToken, file });
    setFile(null);
  }

  async function handleTextIndex() {
    if (!rawText.trim()) return;
    const { api } = await import('../../../../lib/api');
    await api.post('/scrape/text', { namespace: chatbot.embedToken, text: rawText });
    toast.success('Text indexed');
    setRawText('');
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {([
          { key: 'website', label: 'Website', icon: Globe },
          { key: 'file', label: 'File', icon: FileText },
          { key: 'text', label: 'Text', icon: Type },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setSource(key)}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
              source === key
                ? 'border-primary bg-primary/10 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/50'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {source === 'website' && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-medium">Website Crawler</h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                Crawl {new URL(chatbot.url).hostname} and index selected categories.
              </p>
            </div>
            {!discovered && (
              <button
                onClick={handleDiscover}
                disabled={discoverMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {discoverMutation.isPending ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                Discover Pages
              </button>
            )}
          </div>
          {discovered && (
            <>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {selectedUrls.size} of {totalUrls} pages selected
                  · {discoveredCategories.length} categories
                </span>
                <div className="flex gap-3">
                  <button
                    onClick={() => setSelectedUrls(new Set(discoveredCategories.flatMap((c) => c.urls)))}
                    disabled={indexing}
                    className="hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Select all
                  </button>
                  <span className="text-border">|</span>
                  <button
                    onClick={() => setSelectedUrls(new Set())}
                    disabled={indexing}
                    className="hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                {discoveredCategories.map((cat) => (
                  <CategoryAccordion
                    key={cat.name}
                    category={cat}
                    isOpen={openCategories.has(cat.name)}
                    selectedUrls={selectedUrls}
                    disabled={indexing}
                    onToggleOpen={() => toggleCategoryOpen(cat.name)}
                    onToggleUrl={toggleUrl}
                    onToggleAll={(select) => toggleCategoryUrls(cat, select)}
                  />
                ))}
              </div>

              <ScrapeProgressPanel stream={scrapeStream} />

              <button
                onClick={handleIndex}
                disabled={indexing || selectedUrls.size === 0}
                className="w-full flex items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {indexing
                  ? <><RefreshCw className="h-4 w-4 animate-spin" /> {scrapeStream.progress.message || 'Training…'}</>
                  : <><Zap className="h-4 w-4" /> Train on {selectedUrls.size} {selectedUrls.size === 1 ? 'page' : 'pages'}</>}
              </button>
            </>
          )}
        </div>
      )}

      {source === 'file' && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 className="font-medium">Upload File</h3>
          <p className="text-sm text-muted-foreground">Supports PDF, DOCX, TXT, CSV (max 20MB)</p>
          <input
            type="file"
            accept=".pdf,.docx,.txt,.csv"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-muted-foreground file:mr-4 file:rounded-lg file:border-0 file:bg-primary/10 file:px-4 file:py-2 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/20"
          />
          {file && (
            <button
              onClick={handleFileUpload}
              disabled={uploadMutation.isPending}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {uploadMutation.isPending ? 'Indexing...' : 'Index File'}
            </button>
          )}
        </div>
      )}

      {source === 'text' && (
        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <h3 className="font-medium">Paste Text</h3>
          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            placeholder="Paste any text content here: FAQs, documentation, product descriptions..."
            rows={8}
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          <button
            onClick={handleTextIndex}
            disabled={!rawText.trim()}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Zap className="h-4 w-4" />
            Index Text
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Category accordion ──────────────────────────────────────────────────────

function CategoryAccordion({
  category,
  isOpen,
  selectedUrls,
  disabled,
  onToggleOpen,
  onToggleUrl,
  onToggleAll,
}: {
  category: DiscoveredCategory;
  isOpen: boolean;
  selectedUrls: Set<string>;
  disabled: boolean;
  onToggleOpen: () => void;
  onToggleUrl: (url: string) => void;
  onToggleAll: (select: boolean) => void;
}) {
  const selectedCount = category.urls.reduce((n, u) => n + (selectedUrls.has(u) ? 1 : 0), 0);
  const allSelected = selectedCount === category.urls.length;
  const someSelected = selectedCount > 0 && !allSelected;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header row */}
      <div
        className={cn(
          'flex items-center gap-3 px-3 py-2.5 transition-colors',
          !disabled && 'hover:bg-accent/40',
        )}
      >
        <button
          type="button"
          onClick={onToggleOpen}
          disabled={disabled}
          aria-expanded={isOpen}
          className="flex items-center gap-1.5 -ml-1 p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isOpen
            ? <ChevronDown className="h-4 w-4" />
            : <ChevronRight className="h-4 w-4" />}
        </button>

        {/* Master checkbox — tri-state */}
        <input
          type="checkbox"
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = someSelected;
          }}
          onChange={(e) => onToggleAll(e.target.checked)}
          disabled={disabled}
          className="h-4 w-4 rounded border-input accent-primary disabled:cursor-not-allowed"
          aria-label={`Select all ${category.name} pages`}
        />

        <button
          type="button"
          onClick={onToggleOpen}
          disabled={disabled}
          className="flex items-center gap-3 flex-1 min-w-0 text-left disabled:cursor-not-allowed"
        >
          <span className="text-sm font-medium capitalize truncate">{category.name}</span>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0 ml-auto">
            {selectedCount} / {category.urls.length} pages
          </span>
        </button>
      </div>

      {/* Expanded URL list */}
      {isOpen && category.urls.length > 0 && (
        <ul className="border-t border-border bg-background/40 max-h-64 overflow-y-auto divide-y divide-border">
          {category.urls.map((url) => {
            const checked = selectedUrls.has(url);
            return (
              <li key={url} className="flex items-center gap-3 pl-10 pr-3 py-2 hover:bg-accent/30">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => onToggleUrl(url)}
                  disabled={disabled}
                  className="h-3.5 w-3.5 rounded border-input accent-primary disabled:cursor-not-allowed"
                />
                <span
                  className={cn(
                    'text-xs font-mono truncate flex-1',
                    checked ? 'text-foreground' : 'text-muted-foreground',
                  )}
                  title={url}
                >
                  {url}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Scrape progress panel ────────────────────────────────────────────────────

function ScrapeProgressPanel({
  stream,
}: {
  stream: ReturnType<typeof useScrapeStream>;
}) {
  const { progress } = stream;
  if (progress.phase === 'idle') return null;

  const pct = progress.total > 0
    ? Math.min(100, Math.round((progress.current / progress.total) * 100))
    : 0;

  const isActive = progress.phase === 'crawling' || progress.phase === 'indexing';
  const isError = progress.phase === 'error';
  const isDone = progress.phase === 'done';

  return (
    <div className={cn(
      'rounded-lg border p-4 space-y-3',
      isError ? 'border-destructive/50 bg-destructive/5'
      : isDone ? 'border-green-500/40 bg-green-500/5'
      : 'border-primary/30 bg-primary/5',
    )}>
      {/* Status header */}
      <div className="flex items-center gap-2">
        {isError ? <XCircle className="h-4 w-4 text-destructive" />
         : isDone ? <CheckCircle2 className="h-4 w-4 text-green-500" />
         : <RefreshCw className="h-4 w-4 text-primary animate-spin" />}
        <span className={cn(
          'text-sm font-medium',
          isError && 'text-destructive',
          isDone && 'text-green-700 dark:text-green-400',
        )}>
          {progress.message || (isActive ? 'Working…' : '')}
        </span>
        {progress.total > 0 && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {progress.current} / {progress.total} pages · {progress.recordsStored} chunks
          </span>
        )}
      </div>

      {/* Progress bar */}
      {progress.total > 0 && (
        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-300',
              isError ? 'bg-destructive' : isDone ? 'bg-green-500' : 'bg-primary',
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* Current URL */}
      {isActive && progress.currentUrl && (
        <div className="text-xs text-muted-foreground truncate">
          <span className="font-medium text-foreground">Now:</span>{' '}
          <span className="font-mono">{progress.currentUrl}</span>
        </div>
      )}

      {/* Per-page log — newest at top, capped to last 6 */}
      {progress.log.length > 0 && (
        <div className="rounded-md border border-border bg-background/60 max-h-44 overflow-y-auto">
          <ul className="divide-y divide-border text-xs">
            {progress.log.slice().reverse().slice(0, 8).map((entry, idx) => (
              <li key={`${entry.url}-${idx}`} className="flex items-start gap-2 px-3 py-1.5">
                {entry.status === 'ok'
                  ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 mt-0.5 shrink-0" />
                  : <XCircle className="h-3.5 w-3.5 text-destructive mt-0.5 shrink-0" />}
                <span className="font-mono truncate flex-1 text-muted-foreground">{entry.url}</span>
                {entry.status === 'ok' && (
                  <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                    {entry.chunks} chunks · {entry.ms}ms
                  </span>
                )}
                {entry.status === 'err' && (
                  <span className="text-[10px] text-destructive shrink-0 truncate max-w-50">
                    {entry.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Keep-open warning — refreshing/closing mid-training aborts it */}
      {isActive && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <Clock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Training in progress: keep this tab open. Reloading or closing it
            will stop training and the bot won&apos;t be marked as trained.
          </span>
        </div>
      )}

      {/* Error / Cancel actions */}
      {isError && progress.error && (
        <p className="text-xs text-destructive">{progress.error}</p>
      )}
      {isActive && (
        <button
          onClick={stream.cancel}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive transition-colors"
        >
          <X className="h-3 w-3" />
          Cancel
        </button>
      )}
    </div>
  );
}

// ─── Embed Tab ────────────────────────────────────────────────────────────────

function EmbedTab({ chatbot }: { chatbot: any }) {
  const embedScript = `<script
  src="${typeof window !== 'undefined' ? window.location.origin : 'https://yourdomain.com'}/chatbot-embed.js"
  data-token="${chatbot.embedToken}"
  defer
></script>`;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-1">
          <Code className="h-4 w-4 text-primary" />
          <h3 className="font-medium">Embed Code</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Paste this script tag before the closing <code className="bg-muted px-1 rounded">&lt;/body&gt;</code> tag on any page.
        </p>
        <div className="relative">
          <pre className="rounded-lg bg-muted px-4 py-3 text-xs font-mono overflow-x-auto">
            {embedScript}
          </pre>
          <button
            onClick={() => {
              navigator.clipboard.writeText(embedScript);
              toast.success('Copied!');
            }}
            className="absolute top-2 right-2 rounded-md bg-background border border-border px-2.5 py-1 text-xs hover:bg-accent transition-colors"
          >
            Copy
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5">
        <h3 className="font-medium mb-1">Embed Token</h3>
        <p className="text-sm text-muted-foreground mb-3">
          Use this token directly if you have a custom embed setup.
        </p>
        <div className="relative">
          <code className="block rounded-lg bg-muted px-4 py-3 pr-20 text-sm font-mono break-all">
            {chatbot.embedToken}
          </code>
          <button
            onClick={() => {
              navigator.clipboard.writeText(chatbot.embedToken);
              toast.success('Copied!');
            }}
            className="absolute top-2 right-2 rounded-md bg-background border border-border px-2.5 py-1 text-xs hover:bg-accent transition-colors"
          >
            Copy
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

const PERSONALITY_OPTIONS: Array<{
  key: string;
  label: string;
  description: string;
  systemPrompt: string;
  icon: typeof Bot;
  // What the preview should show as a sample reply, to give the user a feel
  // for the tone without spending tokens.
  sampleReply: string;
}> = [
  {
    key: 'support',
    label: 'Friendly Support',
    description: 'Warm, helpful, fixes problems',
    icon: Headphones,
    systemPrompt:
      "You are a warm and friendly customer support assistant. Keep replies concise: usually 1-2 short sentences. Be conversational, never robotic. Use only the provided context. If you don't know, say so honestly and offer to connect them to a human.",
    sampleReply: "Hey! Thanks for reaching out, I'd be happy to help. Could you tell me a bit more about what you're seeing?",
  },
  {
    key: 'sales',
    label: 'Sales & Lead Capture',
    description: 'Engages visitors, asks qualifying questions',
    icon: ShoppingBag,
    systemPrompt:
      "You are an enthusiastic sales assistant. Your job is to help visitors and gently capture leads. Keep replies short and conversational, never paragraphs. Ask one qualifying question at a time when relevant. Never be pushy. Use only the provided context.",
    sampleReply: "Great question! To point you to the right plan, is this for a personal project or a team?",
  },
  {
    key: 'docs',
    label: 'Technical Docs',
    description: 'Precise, code-friendly, accurate',
    icon: BookOpen,
    systemPrompt:
      "You are a precise technical documentation assistant. Answer accurately, referencing specific section names when relevant. Use short paragraphs and code blocks when helpful. Say 'I don't know' if the context doesn't cover it. Never fabricate.",
    sampleReply: "See the Getting Started section. Install with `npm i @example/lib`, then import the default export.",
  },
  {
    key: 'general',
    label: 'General Q&A',
    description: 'Balanced, neutral, answers anything',
    icon: MessageCircle,
    systemPrompt:
      "You are a helpful assistant. Keep replies concise and on-point: short sentences, not paragraphs. Answer only from the provided context. Be honest when you don't know.",
    sampleReply: "Sure, that's covered on our pricing page. The basic plan is free; paid plans start at $29/month.",
  },
];

const THEME_COLORS = [
  '#6B46C1', '#0EA5E9', '#10B981', '#F59E0B',
  '#EF4444', '#EC4899', '#111827', '#475569',
];

// ─── Customize Tab ────────────────────────────────────────────────────────────
// Playground-style two-pane page: controls on the left, live widget preview
// on the right (with the dotted-grid background like Chatbase).

function CustomizeTab({
  chatbotId,
  chatbot,
  onSaved,
}: {
  chatbotId: string;
  chatbot: any;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    welcomeMessage: chatbot.welcomeMessage ?? 'Hi! How can I help you today?',
    inputPlaceholder: chatbot.inputPlaceholder ?? 'Message...',
    personalityType: chatbot.personalityType ?? 'general',
    primaryColor: chatbot.primaryColor ?? '#6B46C1',
    widgetTheme: (chatbot.widgetTheme ?? 'auto') as 'light' | 'dark' | 'auto',
    showPoweredBy: chatbot.showPoweredBy ?? true,
    // We track this so picking a tone preset can replace the prompt, but it
    // isn't exposed as an editable field on this tab (advanced editing lives
    // in Settings).
    systemPrompt: chatbot.systemPrompt ?? '',
  });
  const [saving, setSaving] = useState(false);
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  // Hiding the badge is Pro-only (the API enforces it too); free users see it locked on.
  const canRemoveBranding = planAllows(me?.plan ?? 'free', 'removeBranding');
  const showBadge = canRemoveBranding ? form.showPoweredBy : true;

  // Lead capture config (stored as a JSON blob on the chatbot). `required` is
  // derived on save (a contact method is always required).
  const LEAD_FIELDS: LeadField[] = ['name', 'email', 'phone', 'company'];
  const [leadConfig, setLeadConfig] = useState({
    enabled: chatbot.leadConfig?.enabled ?? DEFAULT_LEAD_CONFIG.enabled,
    fields: (chatbot.leadConfig?.fields?.length
      ? chatbot.leadConfig.fields
      : DEFAULT_LEAD_CONFIG.fields) as LeadField[],
    heading: chatbot.leadConfig?.heading ?? DEFAULT_LEAD_CONFIG.heading,
    successMessage: chatbot.leadConfig?.successMessage ?? DEFAULT_LEAD_CONFIG.successMessage,
    notifyEmail: chatbot.leadConfig?.notifyEmail ?? DEFAULT_LEAD_CONFIG.notifyEmail,
    webhookUrl: chatbot.leadConfig?.webhookUrl ?? '',
    sheetUrl: chatbot.leadConfig?.sheetUrl ?? '',
    slackWebhookUrl: chatbot.leadConfig?.slackWebhookUrl ?? '',
    discordWebhookUrl: chatbot.leadConfig?.discordWebhookUrl ?? '',
    telegramBotToken: chatbot.leadConfig?.telegramBotToken ?? '',
    telegramChatId: chatbot.leadConfig?.telegramChatId ?? '',
  });

  // ── Resizable split: drag the divider to widen the controls panel so the
  //    preview can shrink (and vice-versa). Clamped between MIN/MAX. Only
  //    active at the lg breakpoint where the two columns sit side by side.
  const LEFT_MIN = 300;
  const LEFT_MAX = 720;
  const [leftWidth, setLeftWidth] = useState(380);
  const [isLg, setIsLg] = useState(false);
  const dragRef = useRef<{ startX: number; startW: number } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsLg(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  const onDragMove = useCallback((e: MouseEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const next = Math.min(LEFT_MAX, Math.max(LEFT_MIN, d.startW + (e.clientX - d.startX)));
    setLeftWidth(next);
  }, []);

  const onDragEnd = useCallback(() => {
    dragRef.current = null;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
  }, [onDragMove]);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startW: leftWidth };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
  }, [leftWidth, onDragMove, onDragEnd]);

  // Clean up listeners if the component unmounts mid-drag.
  useEffect(() => () => {
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
  }, [onDragMove, onDragEnd]);

  function pickPersonality(key: string) {
    const p = PERSONALITY_OPTIONS.find((o) => o.key === key);
    if (!p) return;
    setForm((f) => ({ ...f, personalityType: key, systemPrompt: p.systemPrompt }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { api } = await import('../../../../lib/api');
      // A contact method is always required by the widget; derive it from the
      // selected fields (prefer email, fall back to phone).
      const required: LeadField[] = leadConfig.fields.includes('email')
        ? ['email']
        : leadConfig.fields.includes('phone')
          ? ['phone']
          : [];
      await api.patch(`/chatbots/${chatbotId}`, {
        ...form,
        themeColor: form.primaryColor,
        leadConfig: { ...leadConfig, required, trigger: 'intent' },
      });
      toast.success('Customizations saved');
      // Refetch so coming back to this tab shows what was just saved, then hand
      // off to Embed (the next step: put the widget on the site).
      queryClient.invalidateQueries({ queryKey: queryKeys.chatbot(chatbotId) });
      onSaved();
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="grid grid-cols-1 gap-6 lg:gap-0"
      style={isLg ? { gridTemplateColumns: `${leftWidth}px 24px minmax(0,1fr)` } : undefined}
    >
      {/* ─────────── LEFT: controls ─────────── */}
      <div className="space-y-4 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:pr-1">
        {/* Identity / greeting */}
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h3 className="font-medium text-sm">Greeting</h3>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Welcome message</label>
            <input
              value={form.welcomeMessage}
              onChange={(e) => setForm({ ...form, welcomeMessage: e.target.value })}
              disabled={saving}
              placeholder="What are you looking for today?"
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed"
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              Ask a question instead of a plain hello. It gets visitors qualifying
              themselves from message one.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Input placeholder</label>
            <input
              value={form.inputPlaceholder}
              onChange={(e) => setForm({ ...form, inputPlaceholder: e.target.value })}
              disabled={saving}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed"
            />
          </div>
        </section>

        {/* Lead capture */}
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-primary" />
              <h3 className="font-medium text-sm">Lead capture</h3>
            </div>
            <button
              type="button"
              onClick={() => setLeadConfig((c) => ({ ...c, enabled: !c.enabled }))}
              aria-pressed={leadConfig.enabled}
              className={cn(
                'relative h-5 w-9 rounded-full transition-colors shrink-0',
                leadConfig.enabled ? 'bg-primary' : 'bg-muted',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                  leadConfig.enabled ? 'right-0.5' : 'left-0.5',
                )}
              />
            </button>
          </div>
          <p className="text-xs text-muted-foreground leading-relaxed">
            When a visitor shows interest (pricing, getting started, contact…), the chat shows a
            form to collect their details. New leads appear under{' '}
            <span className="font-medium text-foreground">Leads</span>.
          </p>

          {leadConfig.enabled && (
            <div className="space-y-3 pt-1">
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Fields to collect</label>
                <div className="flex flex-wrap gap-2">
                  {LEAD_FIELDS.map((f) => {
                    const on = leadConfig.fields.includes(f);
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() =>
                          setLeadConfig((c) => ({
                            ...c,
                            fields: on ? c.fields.filter((x) => x !== f) : [...c.fields, f],
                          }))
                        }
                        className={cn(
                          'text-xs font-medium px-3 py-1.5 rounded-full border capitalize transition-colors',
                          on
                            ? 'bg-primary/10 text-primary border-transparent'
                            : 'border-border text-muted-foreground hover:bg-accent',
                        )}
                      >
                        {f}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Form heading</label>
                <input
                  value={leadConfig.heading}
                  onChange={(e) => setLeadConfig((c) => ({ ...c, heading: e.target.value }))}
                  disabled={saving}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Thank-you message</label>
                <input
                  value={leadConfig.successMessage}
                  onChange={(e) => setLeadConfig((c) => ({ ...c, successMessage: e.target.value }))}
                  disabled={saving}
                  className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed"
                />
              </div>
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={leadConfig.notifyEmail}
                    onChange={(e) => setLeadConfig((c) => ({ ...c, notifyEmail: e.target.checked }))}
                  />
                  Email me each new lead
                </label>
                {leadConfig.notifyEmail && (
                  <ForwardTestButton chatbotId={chatbotId} destination="email" label="Send test email" />
                )}
              </div>

              {/* Forwarding destinations (webhook + Google Sheet) */}
              <div className="pt-3 border-t border-border space-y-3">
                <p className="text-xs font-medium text-muted-foreground">Forward new leads to (optional)</p>
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">
                    Webhook URL: Zapier, Make, n8n, or any CRM endpoint
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      placeholder="https://hooks.zapier.com/..."
                      value={leadConfig.webhookUrl}
                      onChange={(e) => setLeadConfig((c) => ({ ...c, webhookUrl: e.target.value }))}
                      disabled={saving}
                      className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed"
                    />
                    <ForwardTestButton
                      chatbotId={chatbotId}
                      destination="webhook"
                      url={leadConfig.webhookUrl}
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">
                    Google Sheet: Apps Script web-app URL
                  </label>
                  <input
                    type="url"
                    placeholder="https://script.google.com/macros/s/.../exec"
                    value={leadConfig.sheetUrl}
                    onChange={(e) => setLeadConfig((c) => ({ ...c, sheetUrl: e.target.value }))}
                    disabled={saving}
                    className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed"
                  />
                  <div className="mt-2">
                    <GoogleSheetGuide chatbotId={chatbotId} sheetUrl={leadConfig.sheetUrl} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">
                    Slack: Incoming Webhook URL
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      placeholder="https://hooks.slack.com/services/..."
                      value={leadConfig.slackWebhookUrl}
                      onChange={(e) => setLeadConfig((c) => ({ ...c, slackWebhookUrl: e.target.value }))}
                      disabled={saving}
                      className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed"
                    />
                    <ForwardTestButton chatbotId={chatbotId} destination="slack" url={leadConfig.slackWebhookUrl} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">
                    Discord: Webhook URL
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      placeholder="https://discord.com/api/webhooks/..."
                      value={leadConfig.discordWebhookUrl}
                      onChange={(e) => setLeadConfig((c) => ({ ...c, discordWebhookUrl: e.target.value }))}
                      disabled={saving}
                      className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed"
                    />
                    <ForwardTestButton chatbotId={chatbotId} destination="discord" url={leadConfig.discordWebhookUrl} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5 text-muted-foreground">
                    Telegram: Bot token + Chat ID
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Bot token"
                      value={leadConfig.telegramBotToken}
                      onChange={(e) => setLeadConfig((c) => ({ ...c, telegramBotToken: e.target.value }))}
                      disabled={saving}
                      className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed"
                    />
                    <input
                      type="text"
                      placeholder="Chat ID"
                      value={leadConfig.telegramChatId}
                      onChange={(e) => setLeadConfig((c) => ({ ...c, telegramChatId: e.target.value }))}
                      disabled={saving}
                      className="w-28 rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed"
                    />
                    <ForwardTestButton chatbotId={chatbotId} destination="telegram" label="Test" />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    Save your settings first. The test message uses what&apos;s saved, not what&apos;s typed above.
                  </p>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Color */}
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Palette className="h-4 w-4 text-primary" />
            <h3 className="font-medium text-sm">Color</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {THEME_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setForm({ ...form, primaryColor: c })}
                disabled={saving}
                style={{ background: c }}
                className={cn(
                  'h-7 w-7 rounded-full transition-shadow disabled:cursor-not-allowed disabled:opacity-50',
                  form.primaryColor === c
                    ? 'ring-2 ring-offset-2 ring-offset-card ring-foreground'
                    : 'hover:ring-2 hover:ring-offset-2 hover:ring-offset-card hover:ring-foreground/40',
                )}
                aria-label={c}
              />
            ))}
            <ColorPicker
              value={form.primaryColor}
              onChange={(hex) => setForm({ ...form, primaryColor: hex })}
              disabled={saving}
            >
              <button
                type="button"
                disabled={saving}
                aria-label="Pick a custom color"
                className={cn(
                  'h-7 w-7 rounded-full border border-border flex items-center justify-center cursor-pointer text-xs text-muted-foreground hover:border-primary/50 transition-colors',
                  saving && 'cursor-not-allowed opacity-50',
                )}
              >
                +
              </button>
            </ColorPicker>
          </div>
          <p className="text-xs font-mono text-muted-foreground">{form.primaryColor}</p>

          <div>
            <label className="block text-xs font-medium mb-1.5 text-muted-foreground">Theme</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['light', 'dark', 'auto'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setForm({ ...form, widgetTheme: t })}
                  disabled={saving}
                  className={cn(
                    'rounded-lg border-2 px-2 py-1.5 text-xs capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    form.widgetTheme === t
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/40',
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <div>
              <p className="text-xs font-medium">Show &ldquo;Powered by&rdquo;</p>
              <p className="text-xs text-muted-foreground">
                {canRemoveBranding ? (
                  'Turn off to hide this badge.'
                ) : (
                  <>
                    <Link href="/dashboard/settings" className="text-primary hover:underline">Upgrade to Pro</Link>{' '}
                    to hide this badge.
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={showBadge}
              onClick={() => setForm({ ...form, showPoweredBy: !form.showPoweredBy })}
              disabled={saving || !canRemoveBranding}
              className={cn(
                'relative h-5 w-9 rounded-full transition-colors shrink-0 disabled:cursor-not-allowed disabled:opacity-50',
                showBadge ? 'bg-primary' : 'bg-muted',
              )}
            >
              <span
                className={cn(
                  'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all',
                  showBadge ? 'right-0.5' : 'left-0.5',
                )}
              />
            </button>
          </div>
        </section>

        {/* Tone */}
        <section className="rounded-xl border border-border bg-card p-4 space-y-3">
          <div className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-primary" />
            <h3 className="font-medium text-sm">Tone</h3>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {PERSONALITY_OPTIONS.map((p) => {
              const Icon = p.icon;
              const active = form.personalityType === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => pickPersonality(p.key)}
                  disabled={saving}
                  className={cn(
                    'text-left rounded-lg border-2 p-2.5 transition-all disabled:cursor-not-allowed disabled:opacity-50 flex items-start gap-2.5',
                    active
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/40',
                  )}
                >
                  <div className={cn(
                    'h-7 w-7 rounded-md flex items-center justify-center shrink-0',
                    active ? 'bg-primary text-primary-foreground' : 'bg-muted',
                  )}>
                    <Icon className="h-3.5 w-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-xs">{p.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5 leading-tight">{p.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <Button
          onClick={handleSave}
          size="md"
          loading={saving}
          className="w-full"
        >
          Save customizations
        </Button>
      </div>

      {/* ─────────── Drag handle (lg only) ─────────── */}
      <div
        onMouseDown={onDragStart}
        onDoubleClick={() => setLeftWidth(380)}
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize · double-click to reset"
        className="hidden lg:flex items-stretch justify-center cursor-col-resize group select-none"
      >
        <div className="w-px bg-border group-hover:bg-primary/60 transition-colors" />
      </div>

      {/* ─────────── RIGHT: live preview ─────────── */}
      <div className="rounded-xl border border-border bg-muted/30 relative overflow-hidden min-h-[640px] flex items-start justify-center p-8">
        {/* Dotted-grid background, à la Chatbase Playground */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-50 pointer-events-none"
          style={{
            backgroundImage:
              'radial-gradient(currentColor 1px, transparent 1px)',
            backgroundSize: '16px 16px',
            color: 'var(--color-border)',
          }}
        />
        <div className="relative z-10 w-full max-w-sm">
          <WidgetPreview
            botName={chatbot.name}
            welcomeMessage={form.welcomeMessage}
            inputPlaceholder={form.inputPlaceholder}
            primaryColor={form.primaryColor}
            theme={form.widgetTheme}
            showPoweredBy={showBadge}
            personalityKey={form.personalityType}
          />
        </div>
      </div>
    </div>
  );
}

// Visual mock of the embedded chat widget. No API calls — just renders the
// current form state. We keep the structure close to what ChatWidget.tsx
// would output so it feels representative.
function WidgetPreview({
  botName,
  welcomeMessage,
  inputPlaceholder,
  primaryColor,
  theme,
  showPoweredBy,
  personalityKey,
}: {
  botName: string;
  welcomeMessage: string;
  inputPlaceholder: string;
  primaryColor: string;
  theme: 'light' | 'dark' | 'auto';
  showPoweredBy: boolean;
  personalityKey: string;
}) {
  // `auto` follows the dashboard's actual theme — we don't have a guaranteed
  // way to read system-prefers here, so just show light styling for `auto`
  // (the real widget on the customer's site will respect their browser).
  const dark = theme === 'dark';
  const tone = PERSONALITY_OPTIONS.find((p) => p.key === personalityKey);

  return (
    <div
      className={cn(
        'rounded-2xl shadow-2xl overflow-hidden flex flex-col',
        dark ? 'bg-zinc-900 text-zinc-100' : 'bg-white text-zinc-900',
      )}
      style={{ height: 540 }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center justify-between"
        style={{ background: primaryColor, color: '#fff' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-6 w-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">
            <Bot className="h-3.5 w-3.5" />
          </div>
          <span className="font-semibold text-sm truncate">{botName || 'Your Bot'}</span>
        </div>
        <button type="button" aria-label="Refresh" className="opacity-80 hover:opacity-100">
          <RefreshCw className="h-4 w-4" />
        </button>
      </div>

      {/* Body */}
      <div className={cn('flex-1 overflow-y-auto px-3 py-4 space-y-2 text-sm', dark ? 'bg-zinc-900' : 'bg-zinc-50')}>
        {/* Welcome bubble */}
        <div className={cn(
          'inline-block max-w-[85%] rounded-2xl rounded-bl-sm px-3 py-2',
          dark ? 'bg-zinc-800 text-zinc-100' : 'bg-white text-zinc-800',
          'shadow-sm',
        )}>
          {welcomeMessage || 'Hi! How can I help?'}
        </div>

        {/* Sample exchange so the user can sanity-check tone + bubble styling */}
        <div className="flex justify-end pt-3">
          <div
            className="inline-block max-w-[85%] rounded-2xl rounded-br-sm px-3 py-2 text-white"
            style={{ background: primaryColor }}
          >
            What does this company do?
          </div>
        </div>
        <div className={cn(
          'inline-block max-w-[85%] rounded-2xl rounded-bl-sm px-3 py-2',
          dark ? 'bg-zinc-800 text-zinc-100' : 'bg-white text-zinc-800',
          'shadow-sm',
        )}>
          {tone?.sampleReply ?? 'Here is a helpful answer based on your training data.'}
        </div>
      </div>

      {/* Footer */}
      {showPoweredBy && (
        <div className={cn(
          'text-center text-[10px] py-1.5 border-t',
          dark ? 'border-zinc-800 text-zinc-500' : 'border-zinc-200 text-zinc-400',
        )}>
          Powered by <span className="font-semibold">RagPilot</span>
        </div>
      )}

      {/* Input */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-2.5 border-t',
        dark ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-200 bg-white',
      )}>
        <input
          readOnly
          placeholder={inputPlaceholder || 'Message...'}
          className={cn(
            'flex-1 bg-transparent text-sm outline-none px-2 py-1.5 rounded-lg cursor-default',
            dark ? 'placeholder:text-zinc-500' : 'placeholder:text-zinc-400',
          )}
        />
        <button
          type="button"
          aria-label="Send"
          className="h-8 w-8 rounded-full flex items-center justify-center text-white shrink-0"
          style={{ background: primaryColor }}
        >
          <Send className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Settings Tab (slim — name + advanced system prompt + danger zone) ──────

function SettingsTab({ chatbotId, chatbot }: { chatbotId: string; chatbot: any }) {
  const [form, setForm] = useState({
    name: chatbot.name,
    systemPrompt: chatbot.systemPrompt ?? '',
  });
  const [saving, setSaving] = useState(false);
  const resetMutation = useResetKnowledge(chatbotId);
  const queryClient = useQueryClient();

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const { api } = await import('../../../../lib/api');
      await api.patch(`/chatbots/${chatbotId}`, form);
      // Refetch: the other tabs seed their forms from this cached chatbot, so a
      // stale copy would show old values (and overwrite this save on their next one).
      queryClient.invalidateQueries({ queryKey: queryKeys.chatbot(chatbotId) });
      toast.success('Settings saved');
    } catch {
      toast.error('Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-2xl">
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <h3 className="font-medium">Bot settings</h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Name and advanced behavior. Visual styling lives on the Customize tab.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Chatbot name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            disabled={saving}
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">System prompt (advanced)</label>
          <p className="text-xs text-muted-foreground mb-2">
            Picking a tone on the Customize tab swaps this for a preset. Edit here for fine-tuning.
          </p>
          <textarea
            value={form.systemPrompt}
            onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })}
            disabled={saving}
            placeholder="You are a helpful assistant for..."
            rows={6}
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring resize-none disabled:cursor-not-allowed font-mono"
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" size="md" loading={saving}>
            Save settings
          </Button>
        </div>
      </section>

      {/* Danger zone */}
      <section className="rounded-xl border border-destructive/30 bg-destructive/5 p-5">
        <h3 className="font-medium text-destructive">Danger zone</h3>
        <p className="text-sm text-muted-foreground mt-1 mb-3">
          Reset all indexed vectors. The chatbot will lose all learned knowledge.
        </p>
        <button
          type="button"
          onClick={() => {
            if (confirm('Reset all knowledge? This cannot be undone.')) {
              resetMutation.mutate();
            }
          }}
          disabled={resetMutation.isPending}
          className="rounded-lg border border-destructive/50 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {resetMutation.isPending ? 'Resetting...' : 'Reset Knowledge'}
        </button>
      </section>
    </form>
  );
}