// src/app/dashboard/chatbots/new/page.tsx
'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Globe, FileText, Type, ChevronRight, ChevronLeft,
  Check, Bot, Palette, Sparkles, Code2,
  Upload, Sun, Moon, Monitor,
  ArrowRight, Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { config } from '@/lib/config';
import { useCreateChatbot, useMe } from '@/hooks/useApi';
import { planAllows } from '@/lib/plans';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

type Source = 'website' | 'file' | 'text';
type PersonalityType = 'general' | 'customer_support' | 'sales' | 'custom';
type WidgetTheme = 'light' | 'dark' | 'auto';

interface OnboardingState {
  // Step 1 - Source
  source: Source;
  url: string;
  file: File | null;
  text: string;

  // Step 2 - UI
  name: string;
  widgetTheme: WidgetTheme;
  primaryColor: string;
  logoUrl: string;
  showPoweredBy: boolean;

  // Step 3 - Personality
  personalityType: PersonalityType;
  customPrompt: string;
  welcomeMessage: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PRESET_COLORS = [
  '#6B46C1', '#2563EB', '#059669', '#DC2626',
  '#D97706', '#0891B2', '#7C3AED', '#DB2777',
];

const PERSONALITIES = {
  general: {
    label: 'General AI Agent',
    description: 'Helpful assistant for any topic',
    icon: '🤖',
    prompt: `### Role
You are a helpful AI assistant. Your goal is to assist users with their inquiries in a friendly and efficient manner.

### Constraints
1. Only answer using the provided context
2. If you don't know, say so honestly. Never make things up
3. Keep responses concise and clear
4. Always end on a helpful note`,
  },
  customer_support: {
    label: 'Customer Support',
    description: 'Empathetic, solution-focused support',
    icon: '🎧',
    prompt: `### Role
You are a customer support specialist. You listen attentively, empathize with users, and provide clear solutions.

### Constraints
1. Always acknowledge the user's frustration before solving
2. Offer step-by-step solutions
3. If you can't solve it, escalate gracefully
4. Never make the user feel dismissed`,
  },
  sales: {
    label: 'Sales Agent',
    description: 'Qualify leads and drive conversions',
    icon: '📈',
    prompt: `### Role
You are a sales assistant focused on understanding user needs and guiding them toward the right solution.

### Constraints
1. Ask qualifying questions to understand the user's need
2. Highlight benefits, not just features
3. When user shows genuine interest, suggest booking a call
4. Never be pushy, be consultative`,
  },
  custom: {
    label: 'Custom Prompt',
    description: 'Write your own instructions',
    icon: '✏️',
    prompt: '',
  },
};

const STEPS = [
  { id: 1, label: 'Source', icon: Globe },
  { id: 2, label: 'Appearance', icon: Palette },
  { id: 3, label: 'Personality', icon: Sparkles },
  { id: 4, label: 'Deploy', icon: Code2 },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NewChatbotPage() {
  const router = useRouter();
  const createMutation = useCreateChatbot();

  const [step, setStep] = useState(1);
  const [creating, setCreating] = useState(false);
  const [createdBot, setCreatedBot] = useState<any>(null);

  const [state, setState] = useState<OnboardingState>({
    source: 'website',
    url: '',
    file: null,
    text: '',
    name: '',
    widgetTheme: 'auto',
    primaryColor: '#6B46C1',
    logoUrl: '',
    showPoweredBy: true,
    personalityType: 'general',
    customPrompt: '',
    welcomeMessage: 'Hey! What are you looking for today?',
  });

  function update<K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) {
    setState((prev) => ({ ...prev, [key]: value }));
  }

  function canProceed() {
    if (step === 1) {
      if (state.source === 'website') return state.url.trim().length > 0;
      if (state.source === 'text') return state.text.trim().length > 0;
      if (state.source === 'file') return state.file !== null;
    }
    if (step === 2) return state.name.trim().length > 0;
    if (step === 3) {
      if (state.personalityType === 'custom') return state.customPrompt.trim().length > 0;
      return true;
    }
    return true;
  }

  async function handleCreate() {
    setCreating(true);
    try {
      const systemPrompt = state.personalityType === 'custom'
        ? state.customPrompt
        : PERSONALITIES[state.personalityType].prompt;

      const response = await createMutation.mutateAsync({
        name: state.name || new URL(state.url).hostname,
        url: state.url,
        systemPrompt,
        personalityType: state.personalityType,
        welcomeMessage: state.welcomeMessage,
        themeColor: state.primaryColor,
        primaryColor: state.primaryColor,
        widgetTheme: state.widgetTheme,
        showPoweredBy: state.showPoweredBy,
      });

      const bot = response.data.chatbot;
      setCreatedBot(bot);
      setStep(4);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create chatbot');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Step indicator bar */}
      <div className="flex h-14 items-center justify-between border-b border-border px-6 shrink-0">
        <div />
        {/* Steps */}
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1">
              <button
                onClick={() => step > s.id && setStep(s.id)}
                className={cn(
                  'flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-all',
                  step === s.id
                    ? 'bg-primary text-primary-foreground'
                    : step > s.id
                      ? 'bg-primary/15 text-primary cursor-pointer hover:bg-primary/20'
                      : 'bg-muted text-muted-foreground cursor-default'
                )}
              >
                {step > s.id ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <s.icon className="h-3 w-3" />
                )}
                <span className="hidden sm:block">{s.label}</span>
              </button>
              {i < STEPS.length - 1 && (
                <div className={cn(
                  'h-px w-4 transition-colors',
                  step > s.id ? 'bg-primary/40' : 'bg-border'
                )} />
              )}
            </div>
          ))}
        </div>

        <button
          onClick={() => router.push('/dashboard/chatbots')}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>

      {/* Main layout — 2 columns */}
      <div className="flex flex-1 min-h-0">
        {/* Left — Form */}
        <div className="flex flex-1 flex-col min-h-0">
          <div className="flex-1 overflow-y-auto px-6 py-10 max-w-lg mx-auto w-full">

            {step === 1 && <Step1Source state={state} update={update} />}
            {step === 2 && <Step2Appearance state={state} update={update} />}
            {step === 3 && <Step3Personality state={state} update={update} />}
            {step === 4 && createdBot && <Step4Deploy bot={createdBot} />}

          </div>

          {/* Bottom navigation */}
          {step < 4 && (
            <div className="border-t border-border px-6 py-4 flex items-center justify-between">
              <button
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                disabled={step === 1}
                className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </button>

              {step < 3 ? (
                <button
                  onClick={() => setStep((s) => s + 1)}
                  disabled={!canProceed()}
                  className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Continue
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  onClick={handleCreate}
                  disabled={!canProceed() || creating}
                  className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {creating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      Create Bot
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Right — Preview */}
        <div className="hidden lg:flex w-[480px] border-l border-border bg-muted/30 items-center justify-center p-8 overflow-y-auto">
          <ChatPreview state={state} />
        </div>
      </div>
    </div>
  );
}

// ─── Step 1: Source ───────────────────────────────────────────────────────────

function Step1Source({ state, update }: StepProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Add your knowledge source</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Your bot will be trained on this content and answer questions about it.
        </p>
      </div>

      {/* Source tabs */}
      <div className="flex gap-2">
        {([
          { key: 'website', label: 'Website', icon: Globe },
          { key: 'file', label: 'File', icon: FileText },
          { key: 'text', label: 'Text', icon: Type },
        ] as const).map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => update('source', key)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-xl border py-3 text-sm font-medium transition-all',
              state.source === key
                ? 'border-primary bg-primary/8 text-primary'
                : 'border-border text-muted-foreground hover:border-primary/40 hover:text-foreground'
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Website */}
      {state.source === 'website' && (
        <div className="space-y-3">
          <label className="block text-sm font-medium">Website URL</label>
          <div className="flex rounded-xl border border-input overflow-hidden focus-within:ring-2 focus-within:ring-ring">
            <div className="flex items-center gap-1 bg-muted px-3 border-r border-input">
              <Globe className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">https://</span>
            </div>
            <input
              value={state.url.replace(/^https?:\/\//, '')}
              onChange={(e) => {
                const val = e.target.value.replace(/^https?:\/\//, '');
                update('url', `https://${val}`);
              }}
              placeholder="yourwebsite.com"
              className="flex-1 bg-background px-3 py-2.5 text-sm outline-none"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            We'll crawl your site and discover all pages automatically.
          </p>
        </div>
      )}

      {/* File */}
      {state.source === 'file' && (
        <div>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.docx,.txt,.md,.csv"
            className="hidden"
            onChange={(e) => update('file', e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className={cn(
              'w-full rounded-xl border-2 border-dashed p-10 text-center transition-colors',
              state.file
                ? 'border-primary bg-primary/5'
                : 'border-border hover:border-primary/40 hover:bg-accent/30'
            )}
          >
            {state.file ? (
              <div className="space-y-1">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mx-auto">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <p className="font-medium text-sm">{state.file.name}</p>
                <p className="text-xs text-muted-foreground">
                  {(state.file.size / 1024).toFixed(1)} KB, click to change
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted mx-auto">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium">Drop file here or click to browse</p>
                <p className="text-xs text-muted-foreground">PDF, DOCX, TXT, MD, CSV, up to 10MB</p>
              </div>
            )}
          </button>
        </div>
      )}

      {/* Text */}
      {state.source === 'text' && (
        <div className="space-y-2">
          <label className="block text-sm font-medium">Paste your content</label>
          <textarea
            value={state.text}
            onChange={(e) => update('text', e.target.value)}
            placeholder="Paste any text, FAQ, documentation, product info..."
            rows={10}
            className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground text-right">
            {state.text.length} characters
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Step 2: Appearance ───────────────────────────────────────────────────────

function Step2Appearance({ state, update }: StepProps) {
  const { data: me } = useMe();
  const canRemoveBranding = planAllows(me?.plan ?? 'free', 'removeBranding');
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Style your chatbot</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Customize it to match your brand. You can change this later.
        </p>
      </div>

      {/* Name */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Bot name</label>
        <input
          value={state.name}
          onChange={(e) => update('name', e.target.value)}
          placeholder="My Assistant"
          className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Welcome message */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Welcome message</label>
        <input
          value={state.welcomeMessage}
          onChange={(e) => update('welcomeMessage', e.target.value)}
          placeholder="Hey! What are you looking for today?"
          className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <p className="text-xs text-muted-foreground">
          A question gets visitors qualifying themselves from message one, which beats a
          plain hello.
        </p>
      </div>

      {/* Theme */}
      <div className="space-y-2">
        <label className="block text-sm font-medium">Widget appearance</label>
        <div className="flex gap-2">
          {([
            { key: 'light', label: 'Light', icon: Sun },
            { key: 'dark', label: 'Dark', icon: Moon },
            { key: 'auto', label: 'Auto', icon: Monitor },
          ] as const).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => update('widgetTheme', key)}
              className={cn(
                'flex flex-1 items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium transition-all',
                state.widgetTheme === key
                  ? 'border-primary bg-primary/8 text-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Primary color */}
      <div className="space-y-3">
        <label className="block text-sm font-medium">Primary color</label>
        <div className="flex items-center gap-3">
          <div className="flex gap-2 flex-wrap">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => update('primaryColor', color)}
                className={cn(
                  'h-8 w-8 rounded-full border-2 transition-all',
                  state.primaryColor === color
                    ? 'border-foreground scale-110'
                    : 'border-transparent hover:scale-105'
                )}
                style={{ background: color }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-input px-3 py-1.5">
            <div
              className="h-5 w-5 rounded-full border border-border"
              style={{ background: state.primaryColor }}
            />
            <input
              type="text"
              value={state.primaryColor}
              onChange={(e) => update('primaryColor', e.target.value)}
              className="w-20 bg-transparent text-sm outline-none font-mono"
            />
          </div>
        </div>
      </div>

      {/* Powered by toggle */}
      <div className="flex items-center justify-between rounded-xl border border-border p-4">
        <div>
          <p className="text-sm font-medium">Show "Powered by RagPilot"</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {canRemoveBranding ? 'Turn off to remove branding' : 'Upgrade to Pro to remove branding'}
          </p>
        </div>
        <button
          onClick={() => update('showPoweredBy', !state.showPoweredBy)}
          disabled={!canRemoveBranding}
          className={cn(
            'relative h-6 w-10 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            state.showPoweredBy || !canRemoveBranding ? 'bg-primary' : 'bg-muted'
          )}
        >
          <div className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform',
            state.showPoweredBy || !canRemoveBranding ? 'translate-x-4' : 'translate-x-0.5'
          )} />
        </button>
      </div>
    </div>
  );
}

// ─── Step 3: Personality ──────────────────────────────────────────────────────

function Step3Personality({ state, update }: StepProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Define the personality</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Choose how your bot behaves and communicates.
        </p>
      </div>

      {/* Preset cards */}
      <div className="grid grid-cols-2 gap-3">
        {(Object.entries(PERSONALITIES) as [PersonalityType, typeof PERSONALITIES[keyof typeof PERSONALITIES]][]).map(([key, p]) => (
          <button
            key={key}
            onClick={() => {
              update('personalityType', key);
              if (key !== 'custom') update('customPrompt', p.prompt);
            }}
            className={cn(
              'flex flex-col items-start rounded-xl border p-4 text-left transition-all',
              state.personalityType === key
                ? 'border-primary bg-primary/8'
                : 'border-border hover:border-primary/40 hover:bg-accent/30'
            )}
          >
            <span className="text-2xl mb-2">{p.icon}</span>
            <p className={cn(
              'text-sm font-semibold',
              state.personalityType === key ? 'text-primary' : 'text-foreground'
            )}>
              {p.label}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{p.description}</p>
          </button>
        ))}
      </div>

      {/* Prompt preview / custom editor */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">
            {state.personalityType === 'custom' ? 'Your instructions' : 'System prompt preview'}
          </label>
          {state.personalityType !== 'custom' && (
            <span className="text-xs text-muted-foreground">Read-only, edit via Custom</span>
          )}
        </div>
        <textarea
          value={state.personalityType === 'custom'
            ? state.customPrompt
            : PERSONALITIES[state.personalityType].prompt}
          onChange={(e) => {
            if (state.personalityType === 'custom') {
              update('customPrompt', e.target.value);
            }
          }}
          readOnly={state.personalityType !== 'custom'}
          rows={8}
          placeholder={state.personalityType === 'custom'
            ? 'Describe how your bot should behave. What can it do? What can\'t it do? What tone should it use?'
            : ''}
          className={cn(
            'w-full rounded-xl border border-input px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring font-mono',
            state.personalityType !== 'custom'
              ? 'bg-muted text-muted-foreground cursor-default'
              : 'bg-background'
          )}
        />
      </div>
    </div>
  );
}

// ─── Step 4: Deploy ───────────────────────────────────────────────────────────

function Step4Deploy({ bot }: { bot: any }) {
  const router = useRouter();
  const embedCode = `<script
  src="${typeof window !== 'undefined' ? window.location.origin : config.appUrl}/chatbot-embed.js"
  data-token="${bot?.embedToken ?? 'your-token'}"
  defer
></script>`;

  function copy(text: string) {
    navigator.clipboard.writeText(text);
    toast.success('Copied!');
  }

  return (
    <div className="space-y-6">
      {/* Success */}
      <div className="flex flex-col items-center text-center py-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30 mb-4">
          <Check className="h-7 w-7 text-green-600 dark:text-green-400" />
        </div>
        <h1 className="text-2xl font-bold">Your bot is ready!</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Add the snippet to your website or start training it right away.
        </p>
      </div>

      {/* Embed code */}
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted border-b border-border">
          <span className="text-xs font-medium text-muted-foreground">Embed snippet</span>
          <button
            onClick={() => copy(embedCode)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Copy
          </button>
        </div>
        <pre className="px-4 py-3 text-xs text-foreground overflow-x-auto bg-card font-mono leading-relaxed">
          {embedCode}
        </pre>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <button
          onClick={() => router.push(`/dashboard/chatbots/${bot?.id}`)}
          className="w-full rounded-xl bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          Train your bot →
        </button>
        <button
          onClick={() => router.push('/dashboard/chatbots')}
          className="w-full rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          Go to chatbots
        </button>
      </div>
    </div>
  );
}

// ─── Chat Preview (right panel) ───────────────────────────────────────────────

function ChatPreview({ state }: { state: OnboardingState }) {
  const botName = state.name || 'My Assistant';
  const themeColor = state.primaryColor || '#6B46C1';

  const isDark = state.widgetTheme === 'dark';

  const bg = isDark ? '#111827' : '#ffffff';
  const msgBg = isDark ? '#1f2937' : '#f3f4f6';
  const textColor = isDark ? '#f9fafb' : '#111827';
  const subTextColor = isDark ? '#9ca3af' : '#6b7280';
  const borderColor = isDark ? '#374151' : '#e5e7eb';

  const demoMessages = [
    { role: 'assistant', content: state.welcomeMessage || 'Hey! What are you looking for today?' },
    { role: 'user', content: 'What services do you offer?' },
    { role: 'assistant', content: "Great question! I can help you explore our offerings. What are you looking for specifically?" },
  ];

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
        Live Preview
      </p>

      <div
        className="w-[340px] rounded-2xl overflow-hidden shadow-2xl"
        style={{
          border: `1px solid ${borderColor}`,
          background: bg,
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ background: themeColor }}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20">
              <Bot className="h-4 w-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">{botName}</p>
              <div className="flex items-center gap-1">
                <div className="h-1.5 w-1.5 rounded-full bg-green-400" />
                <p className="text-xs text-white/70">Online</p>
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div
          className="flex flex-col gap-3 p-4"
          style={{ background: isDark ? '#0f172a' : '#f9fafb', minHeight: 200 }}
        >
          {demoMessages.map((msg, i) => (
            <div
              key={i}
              className="flex"
              style={{ justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}
            >
              <div
                className="max-w-[78%] rounded-2xl px-3 py-2 text-xs leading-relaxed"
                style={
                  msg.role === 'user'
                    ? { background: themeColor, color: '#fff', borderRadius: '18px 18px 4px 18px' }
                    : { background: bg, color: textColor, border: `1px solid ${borderColor}`, borderRadius: '18px 18px 18px 4px' }
                }
              >
                {msg.content}
              </div>
            </div>
          ))}
        </div>

        {/* Input */}
        <div
          className="flex items-center gap-2 px-3 py-3"
          style={{ background: bg, borderTop: `1px solid ${borderColor}` }}
        >
          <div
            className="flex flex-1 items-center rounded-full px-3 py-1.5 text-xs"
            style={{ background: msgBg, color: subTextColor }}
          >
            Ask a question...
          </div>
          <div
            className="flex h-7 w-7 items-center justify-center rounded-full shrink-0"
            style={{ background: themeColor }}
          >
            <ArrowRight className="h-3 w-3 text-white" />
          </div>
        </div>

        {/* Powered by */}
        {state.showPoweredBy && (
          <div
            className="text-center py-1.5 text-[10px]"
            style={{ color: subTextColor, background: bg, borderTop: `1px solid ${borderColor}` }}
          >
            Powered by <span style={{ color: themeColor }}>RagPilot</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Step Props type ──────────────────────────────────────────────────────────

interface StepProps {
  state: OnboardingState;
  update: <K extends keyof OnboardingState>(key: K, value: OnboardingState[K]) => void;
}