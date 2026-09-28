'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'motion/react';
import toast from 'react-hot-toast';
import {
  Sparkles, Zap, ArrowRight, ArrowLeft, Check,
  MessageCircle, Headphones, ShoppingBag, BookOpen, Bot,
  Paintbrush, Rocket, Crown, FileUp, Globe,
} from 'lucide-react';
import { useCreateChatbot, useCompleteOnboarding, useMe } from '../../hooks/useApi';
import { PLAN_LIST } from '../../lib/plans';
import { cn } from '../../lib/utils';
import { Button } from '../../components/ui/button';

// ─── Types ────────────────────────────────────────────────────────────────────

type PersonalityKey = 'support' | 'sales' | 'docs' | 'general';

interface OnboardingData {
  businessName: string;
  url: string;
  personality: PersonalityKey;
  themeColor: string;
  welcomeMessage: string;
  features: {
    crawl: boolean;
    fileUpload: boolean;
    // Pro features are not individually selectable — having Pro unlocks all of them.
    interestedInPro: boolean;
  };
}

const PERSONALITIES: Record<PersonalityKey, {
  label: string; tagline: string; icon: typeof Bot;
  systemPrompt: string;
}> = {
  support: {
    label: 'Friendly Support',
    tagline: 'Warm, helpful, fixes problems',
    icon: Headphones,
    systemPrompt:
      "You are a warm and friendly customer support assistant. Keep replies concise — usually 1-2 short sentences. Be conversational, never robotic. Use only the provided context. If you don't know, say so honestly and offer to connect them to a human.",
  },
  sales: {
    label: 'Sales & Lead Capture',
    tagline: 'Engages visitors, asks qualifying questions',
    icon: ShoppingBag,
    systemPrompt:
      "You are an enthusiastic sales assistant. Your job is to help visitors and gently capture leads. Keep replies short and conversational — never paragraphs. Ask one qualifying question at a time when relevant. Never be pushy. Use only the provided context.",
  },
  docs: {
    label: 'Technical Docs',
    tagline: 'Precise, code-friendly, accurate',
    icon: BookOpen,
    systemPrompt:
      "You are a precise technical documentation assistant. Answer accurately, referencing specific section names when relevant. Use short paragraphs and code blocks when helpful. Say 'I don't know' if the context doesn't cover it. Never fabricate.",
  },
  general: {
    label: 'General Q&A',
    tagline: 'Balanced, neutral, answers anything',
    icon: MessageCircle,
    systemPrompt:
      "You are a helpful assistant. Keep replies concise and on-point — short sentences, not paragraphs. Answer only from the provided context. Be honest when you don't know.",
  },
};

const THEME_COLORS: Array<{ name: string; hex: string }> = [
  { name: 'Violet', hex: '#6B46C1' },
  { name: 'Sky', hex: '#0EA5E9' },
  { name: 'Emerald', hex: '#10B981' },
  { name: 'Amber', hex: '#F59E0B' },
  { name: 'Red', hex: '#EF4444' },
  { name: 'Pink', hex: '#EC4899' },
  { name: 'Midnight', hex: '#111827' },
  { name: 'Slate', hex: '#475569' },
];

/** Friendly name for a theme hex; falls back to the hex for custom values. */
function themeName(hex: string): string {
  return THEME_COLORS.find((t) => t.hex.toLowerCase() === hex.toLowerCase())?.name ?? hex;
}

const STEPS = [
  'welcome', 'business', 'personality', 'appearance', 'features', 'review', 'finish',
] as const;
type StepKey = typeof STEPS[number];

// What Pro unlocks — shown together as a single upgrade card.
const PRO_PERKS = [
  { label: 'Lead capture → Google Sheets', description: 'Captured leads flow into a sheet you connect.' },
  { label: 'Proactive CTA bubble', description: 'Bot pops a friendly nudge after a few seconds on the page.' },
  { label: 'Remove "Powered by" branding', description: 'Clean, white-labelled widget on your site.' },
  { label: '3 chatbots, 2,000 messages / month', description: 'Up from 1 bot and 100 messages on Free.' },
];

const stepVariants = {
  enter: (d: number) => ({ x: 24 * d, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (d: number) => ({ x: -24 * d, opacity: 0 }),
};

// ─── Main page ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter();
  const { data: me } = useMe();
  const createBot = useCreateChatbot();
  const completeOnboarding = useCompleteOnboarding();

  const [stepIdx, setStepIdx] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [submitting, setSubmitting] = useState(false);

  const [data, setData] = useState<OnboardingData>({
    businessName: '',
    url: '',
    personality: 'support',
    themeColor: '#6B46C1',
    welcomeMessage: '',
    features: {
      crawl: true,
      fileUpload: true,
      interestedInPro: false,
    },
  });

  const step: StepKey = STEPS[stepIdx];
  const isLast = stepIdx === STEPS.length - 1;
  const userOnFreePlan = (me?.plan ?? 'free') === 'free';
  const userInterestedInPro = userOnFreePlan && data.features.interestedInPro;

  function next() {
    if (stepIdx < STEPS.length - 1) {
      setDirection(1);
      setStepIdx((i) => i + 1);
    }
  }

  function back() {
    if (stepIdx > 0) {
      setDirection(-1);
      setStepIdx((i) => i - 1);
    }
  }

  function patch(partial: Partial<OnboardingData>) {
    setData((d) => ({ ...d, ...partial }));
  }

  function patchFeature(key: keyof OnboardingData['features'], value: boolean) {
    setData((d) => ({ ...d, features: { ...d.features, [key]: value } }));
  }

  async function handleFinish() {
    setSubmitting(true);
    try {
      const personality = PERSONALITIES[data.personality];
      const onPro = (me?.plan ?? 'free') === 'pro';
      await createBot.mutateAsync({
        url: data.url,
        name: data.businessName || undefined,
        systemPrompt: personality.systemPrompt,
        personalityType: data.personality,
        welcomeMessage:
          data.welcomeMessage ||
          `Hi! I'm ${data.businessName || 'your assistant'}. What are you looking for today?`,
        themeColor: data.themeColor,
        primaryColor: data.themeColor,
        // Pro users get clean (unbranded) widget; Free users see "Powered by".
        showPoweredBy: !onPro,
      });
      await completeOnboarding.mutateAsync();
      router.replace('/dashboard');
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  // step validity for advancing
  function canAdvance(): boolean {
    if (step === 'business') return !!data.url.trim() && data.url.startsWith('http');
    return true;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Progress bar */}
      <header className="px-6 py-4 border-b border-border">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
              <Zap className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-bold">RagPilot</span>
          </div>
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              initial={false}
              animate={{ width: `${((stepIdx + 1) / STEPS.length) * 100}%` }}
              transition={{ type: 'spring', stiffness: 280, damping: 30 }}
            />
          </div>
          <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-12 text-right">
            {stepIdx + 1} / {STEPS.length}
          </span>
        </div>
      </header>

      {/* Step content with slide transitions */}
      <main className="flex-1 px-6 py-8 overflow-y-auto">
        <div className="max-w-2xl mx-auto">
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={stepVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.28, ease: 'easeOut' }}
            >
              {step === 'welcome' && <WelcomeStep />}
              {step === 'business' && (
                <BusinessStep data={data} patch={patch} />
              )}
              {step === 'personality' && (
                <PersonalityStep data={data} patch={patch} />
              )}
              {step === 'appearance' && (
                <AppearanceStep data={data} patch={patch} />
              )}
              {step === 'features' && (
                <FeaturesStep
                  data={data}
                  patchFeature={patchFeature}
                  userOnFreePlan={userOnFreePlan}
                />
              )}
              {step === 'review' && (
                <ReviewStep
                  data={data}
                  userInterestedInPro={userInterestedInPro}
                  userOnFreePlan={userOnFreePlan}
                />
              )}
              {step === 'finish' && (
                <FinishStep
                  userInterestedInPro={userInterestedInPro}
                  userOnFreePlan={userOnFreePlan}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>

      {/* Footer / navigation */}
      <footer className="px-6 py-4 border-t border-border">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <Button
            variant="ghost"
            size="md"
            onClick={back}
            disabled={stepIdx === 0 || submitting}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>

          {!isLast ? (
            <Button
              size="md"
              onClick={next}
              disabled={!canAdvance() || submitting}
            >
              {step === 'review' ? 'Looks good — create my bot' : 'Continue'}
              <ArrowRight className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="md"
              onClick={handleFinish}
              loading={submitting}
            >
              Go to dashboard
              <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </footer>
    </div>
  );
}

// ─── Steps ────────────────────────────────────────────────────────────────────

function StepHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{title}</h1>
      <p className="text-muted-foreground mt-1.5 text-sm sm:text-base">{subtitle}</p>
    </div>
  );
}

function ProBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-violet-600 text-white px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
        'dark:bg-violet-500',
        className,
      )}
    >
      <Crown className="h-2.5 w-2.5" />
      Pro
    </span>
  );
}

// ── Welcome ───────────────────────────────────────────────────────────────────

function WelcomeStep() {
  return (
    <div className="py-10 text-center">
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 18 }}
        className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-violet-600 shadow-lg shadow-primary/20 mb-6"
      >
        <Sparkles className="h-10 w-10 text-white" />
      </motion.div>
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
        Let&apos;s build your AI assistant
      </h1>
      <p className="text-muted-foreground mt-3 max-w-md mx-auto">
        In the next 60 seconds we&apos;ll create a chatbot tailored to your
        site. You can change anything later — nothing here is permanent.
      </p>
      <div className="grid grid-cols-3 gap-3 mt-10 max-w-md mx-auto">
        {[
          { icon: Globe, label: 'Trained on your site' },
          { icon: Paintbrush, label: 'Styled to match your brand' },
          { icon: Rocket, label: 'Live in under a minute' },
        ].map((item, i) => (
          <motion.div
            key={item.label}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.15 + i * 0.08 }}
            className="rounded-xl border border-border bg-card p-3 text-center"
          >
            <item.icon className="h-4 w-4 text-primary mx-auto mb-1.5" />
            <p className="text-[11px] text-muted-foreground leading-tight">{item.label}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ── Business ──────────────────────────────────────────────────────────────────

function BusinessStep({
  data,
  patch,
}: {
  data: OnboardingData;
  patch: (p: Partial<OnboardingData>) => void;
}) {
  return (
    <div>
      <StepHeading
        title="Tell us about your business"
        subtitle="Your bot will be trained on this site's content."
      />
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">Business name</label>
          <input
            value={data.businessName}
            onChange={(e) => patch({ businessName: e.target.value })}
            placeholder="Acme Inc."
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">
            Website URL <span className="text-destructive">*</span>
          </label>
          <input
            value={data.url}
            onChange={(e) => patch({ url: e.target.value })}
            placeholder="https://yourcompany.com"
            type="url"
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            We&apos;ll crawl up to 50 pages from this domain after onboarding.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Personality ───────────────────────────────────────────────────────────────

function PersonalityStep({
  data,
  patch,
}: {
  data: OnboardingData;
  patch: (p: Partial<OnboardingData>) => void;
}) {
  return (
    <div>
      <StepHeading
        title="Pick a personality"
        subtitle="This shapes how the bot talks. You can fine-tune the system prompt later."
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {Object.entries(PERSONALITIES).map(([key, p]) => {
          const Icon = p.icon;
          const active = data.personality === key;
          return (
            <motion.button
              key={key}
              whileTap={{ scale: 0.97 }}
              onClick={() => patch({ personality: key as PersonalityKey })}
              className={cn(
                'text-left rounded-xl border-2 p-4 transition-all',
                active
                  ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                  : 'border-border bg-card hover:border-primary/40',
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'h-9 w-9 rounded-lg flex items-center justify-center shrink-0',
                    active ? 'bg-primary text-primary-foreground' : 'bg-muted',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-medium text-sm">{p.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{p.tagline}</div>
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

// ── Appearance ────────────────────────────────────────────────────────────────

function AppearanceStep({
  data,
  patch,
}: {
  data: OnboardingData;
  patch: (p: Partial<OnboardingData>) => void;
}) {
  return (
    <div>
      <StepHeading
        title="Make it look like you"
        subtitle="Theme color and the opening message visitors see."
      />
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium mb-2.5">Theme color</label>
          <div className="flex flex-wrap gap-2">
            {THEME_COLORS.map((c) => (
              <motion.button
                key={c.hex}
                whileTap={{ scale: 0.92 }}
                onClick={() => patch({ themeColor: c.hex })}
                style={{ background: c.hex }}
                className={cn(
                  'h-9 w-9 rounded-full transition-shadow',
                  data.themeColor === c.hex
                    ? 'ring-2 ring-offset-2 ring-offset-background ring-foreground'
                    : 'hover:ring-2 hover:ring-offset-2 hover:ring-offset-background hover:ring-foreground/40',
                )}
                aria-label={c.name}
                title={c.name}
              />
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">Welcome message</label>
          <textarea
            value={data.welcomeMessage}
            onChange={(e) => patch({ welcomeMessage: e.target.value })}
            placeholder="Hi! I'm here to help — what brings you in today?"
            rows={3}
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <p className="text-xs text-muted-foreground mt-1.5">
            Ask a question instead of just saying hello — it gets visitors qualifying
            themselves from message one (e.g. &ldquo;What are you looking for today?&rdquo;
            beats &ldquo;How can I help?&rdquo;).
          </p>
        </div>

        {/* Live preview */}
        <div className="rounded-xl border border-border bg-muted/30 p-4">
          <p className="text-xs text-muted-foreground mb-2">Preview</p>
          <div className="flex items-end gap-2">
            <div
              className="h-10 w-10 rounded-full flex items-center justify-center shadow-md"
              style={{ background: data.themeColor }}
            >
              <MessageCircle className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 rounded-2xl rounded-bl-sm border border-border bg-card px-3 py-2 text-sm">
              {data.welcomeMessage ||
                `Hi! I'm ${data.businessName || 'your assistant'}. What are you looking for today?`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Features ──────────────────────────────────────────────────────────────────

function FeaturesStep({
  data,
  patchFeature,
  userOnFreePlan,
}: {
  data: OnboardingData;
  patchFeature: (k: keyof OnboardingData['features'], v: boolean) => void;
  userOnFreePlan: boolean;
}) {
  const FREE_FEATURES: Array<{
    key: keyof Pick<OnboardingData['features'], 'crawl' | 'fileUpload'>;
    label: string;
    description: string;
    icon: typeof Bot;
  }> = [
    { key: 'crawl', label: 'Website training', description: 'Crawl and learn from your site (up to 50 pages).', icon: Globe },
    { key: 'fileUpload', label: 'File upload training', description: 'Add knowledge from PDF, DOCX, TXT, CSV.', icon: FileUp },
  ];

  return (
    <div>
      <StepHeading
        title="Pick the features you want"
        subtitle="Free includes the essentials. Pro unlocks everything as a bundle — no à la carte."
      />

      <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2.5">
        Included on Free
      </p>
      <div className="space-y-2.5 mb-6">
        {FREE_FEATURES.map((f) => {
          const Icon = f.icon;
          const enabled = data.features[f.key];
          return (
            <div
              key={f.key}
              className={cn(
                'rounded-xl border p-4 transition-colors',
                enabled ? 'border-primary/40 bg-primary/5' : 'border-border bg-card',
              )}
            >
              <div className="flex items-start gap-3">
                <div
                  className={cn(
                    'h-9 w-9 rounded-lg flex items-center justify-center shrink-0',
                    enabled ? 'bg-primary text-primary-foreground' : 'bg-muted',
                  )}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{f.label}</div>
                  <p className="text-xs text-muted-foreground mt-0.5">{f.description}</p>
                </div>
                <span className="flex items-center gap-1 text-xs font-medium text-primary shrink-0 mt-0.5">
                  <Check className="h-3.5 w-3.5" />
                  Included
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-xs uppercase tracking-wide text-muted-foreground font-medium mb-2.5 flex items-center gap-2">
        Pro perks <ProBadge />
      </p>
      {userOnFreePlan ? (
        <FreeUserProCard
          interested={data.features.interestedInPro}
          onToggle={(v) => patchFeature('interestedInPro', v)}
        />
      ) : (
        <ProUserProCard />
      )}
    </div>
  );
}

function FreeUserProCard({
  interested,
  onToggle,
}: {
  interested: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <motion.div
      whileHover={{ y: -1 }}
      className={cn(
        'rounded-xl border-2 p-5 transition-all relative overflow-hidden',
        interested
          ? 'border-violet-500 bg-gradient-to-br from-violet-50 to-fuchsia-50 dark:from-violet-950/30 dark:to-fuchsia-950/20'
          : 'border-border bg-card hover:border-violet-400',
      )}
    >
      <div className="absolute -top-8 -right-8 h-24 w-24 rounded-full bg-violet-500/10 blur-3xl pointer-events-none" />

      <div className="relative">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center text-white">
            <Crown className="h-4 w-4" />
          </div>
          <div>
            <p className="font-semibold text-sm">Everything in Pro</p>
            <p className="text-xs text-muted-foreground">$29 / month — unlocks the bundle below</p>
          </div>
        </div>

        <ul className="space-y-2 mb-4">
          {PRO_PERKS.map((perk) => (
            <li key={perk.label} className="flex items-start gap-2 text-xs">
              <Check className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
              <div>
                <span className="font-medium">{perk.label}</span>
                <span className="text-muted-foreground"> — {perk.description}</span>
              </div>
            </li>
          ))}
        </ul>

        <button
          onClick={() => onToggle(!interested)}
          className={cn(
            'w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-all',
            interested
              ? 'bg-violet-600 text-white hover:bg-violet-700'
              : 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-200 hover:bg-violet-100 dark:hover:bg-violet-950/60 border border-violet-200 dark:border-violet-800',
          )}
        >
          {interested ? (
            <>
              <Check className="h-4 w-4" />
              Interested in Pro — we&apos;ll remind you at the end
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              I&apos;m interested in Pro
            </>
          )}
        </button>
      </div>
    </motion.div>
  );
}

function ProUserProCard() {
  return (
    <div className="rounded-xl border-2 border-violet-500 bg-gradient-to-br from-violet-50 to-fuchsia-50 dark:from-violet-950/30 dark:to-fuchsia-950/20 p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-600 flex items-center justify-center text-white">
          <Crown className="h-4 w-4" />
        </div>
        <div>
          <p className="font-semibold text-sm">You&apos;re on Pro 🎉</p>
          <p className="text-xs text-muted-foreground">
            All Pro perks are enabled automatically. No checkboxes needed.
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {PRO_PERKS.map((perk) => (
          <li key={perk.label} className="flex items-start gap-2 text-xs">
            <Check className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400 mt-0.5 shrink-0" />
            <span className="font-medium">{perk.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Review + pricing ──────────────────────────────────────────────────────────

function ReviewStep({
  data,
  userInterestedInPro,
  userOnFreePlan,
}: {
  data: OnboardingData;
  userInterestedInPro: boolean;
  userOnFreePlan: boolean;
}) {
  const personality = PERSONALITIES[data.personality];
  return (
    <div>
      <StepHeading
        title="Review and pick your plan"
        subtitle="Your bot is ready to be created. Quick recap, then pick the plan that fits."
      />

      {/* Summary card */}
      <div className="rounded-xl border border-border bg-card p-4 mb-6 space-y-2.5 text-sm">
        <SummaryRow label="Business" value={data.businessName || '—'} />
        <SummaryRow label="Website" value={data.url || '—'} />
        <SummaryRow label="Personality" value={personality.label} />
        <SummaryRow
          label="Theme"
          value={
            <span className="inline-flex items-center gap-2">
              <span className="h-3.5 w-3.5 rounded-full" style={{ background: data.themeColor }} />
              {themeName(data.themeColor)}
            </span>
          }
        />
      </div>

      {/* Interested-in-Pro banner */}
      <AnimatePresence>
        {userInterestedInPro && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="rounded-xl border border-violet-200 dark:border-violet-800 bg-violet-50 dark:bg-violet-950/30 p-4 mb-6"
          >
            <div className="flex items-start gap-3">
              <div className="h-8 w-8 rounded-lg bg-violet-600 dark:bg-violet-500 flex items-center justify-center shrink-0">
                <Crown className="h-4 w-4 text-white" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-violet-900 dark:text-violet-100">
                  You&apos;re interested in Pro
                </p>
                <p className="text-xs text-violet-800 dark:text-violet-200 mt-0.5">
                  Finish onboarding on Free — your bot will work right away. We&apos;ll
                  show the upgrade banner on the dashboard so you can switch anytime.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Plans */}
      <h2 className="font-semibold mb-3 text-sm">Plans</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {PLAN_LIST.map((plan) => {
          const Icon = plan.icon;
          const proHighlight = plan.key === 'pro' && userInterestedInPro;
          return (
            <motion.div
              key={plan.key}
              animate={
                proHighlight
                  ? { boxShadow: ['0 0 0 0 rgba(139,92,246,0.3)', '0 0 0 8px rgba(139,92,246,0)', '0 0 0 0 rgba(139,92,246,0.3)'] }
                  : {}
              }
              transition={{ duration: 1.8, repeat: proHighlight ? Infinity : 0 }}
              className={cn(
                'rounded-xl border p-4 relative',
                proHighlight
                  ? 'border-violet-400 dark:border-violet-600 bg-violet-50 dark:bg-violet-950/20'
                  : 'border-border bg-card',
              )}
            >
              {plan.popular && (
                <div className="absolute -top-2.5 left-4 rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white">
                  POPULAR
                </div>
              )}
              <div className="flex items-center gap-2 mb-1">
                <Icon className={cn('h-4 w-4', plan.accentClass)} />
                <span className="font-semibold text-sm">{plan.label}</span>
                <span className="ml-auto font-bold text-sm">
                  {plan.priceLabel}<span className="text-xs font-normal text-muted-foreground">/mo</span>
                </span>
              </div>
              <ul className="space-y-1 mt-2">
                {plan.featureList.map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Check className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                    {f}
                  </li>
                ))}
              </ul>
            </motion.div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground mt-4">
        {userOnFreePlan
          ? <>You&apos;ll be created on the <strong>Free</strong> plan. An admin can upgrade you to Pro from the admin panel during this preview.</>
          : <>You&apos;re already on <strong>Pro</strong> — all features are unlocked.</>}
      </p>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-medium truncate text-right">{value}</span>
    </div>
  );
}

// ── Finish ────────────────────────────────────────────────────────────────────

// One-shot confetti: colored paper pieces rain down once when this mounts.
// Dependency-free — just motion + random props. pointer-events-none so it
// never blocks the buttons underneath.
const CONFETTI_COLORS = [
  '#6B46C1', '#0EA5E9', '#10B981', '#F59E0B',
  '#EF4444', '#EC4899', '#8B5CF6', '#FBBF24',
];

function Confetti({ count = 110 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        width: 6 + Math.random() * 7,
        height: 9 + Math.random() * 9,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        delay: Math.random() * 0.5,
        duration: 2.4 + Math.random() * 2,
        drift: (Math.random() - 0.5) * 160,
        startRotate: Math.random() * 360,
        spin: 240 + Math.random() * 360,
        round: Math.random() > 0.55,
      })),
    [count],
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden" aria-hidden>
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          initial={{ y: '-12vh', x: 0, rotate: p.startRotate, opacity: 1 }}
          animate={{ y: '112vh', x: p.drift, rotate: p.startRotate + p.spin, opacity: [1, 1, 0.9, 0] }}
          transition={{ duration: p.duration, delay: p.delay, ease: 'easeIn' }}
          style={{
            position: 'absolute',
            top: 0,
            left: `${p.left}vw`,
            width: p.width,
            height: p.height,
            background: p.color,
            borderRadius: p.round ? '9999px' : '2px',
          }}
        />
      ))}
    </div>
  );
}

function FinishStep({
  userInterestedInPro,
  userOnFreePlan,
}: {
  userInterestedInPro: boolean;
  userOnFreePlan: boolean;
}) {
  return (
    <div className="py-10 text-center">
      <Confetti />
      <motion.div
        initial={{ scale: 0.4, rotate: -20, opacity: 0 }}
        animate={{ scale: 1, rotate: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 220, damping: 14 }}
        className="inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-green-400 to-emerald-600 shadow-lg shadow-green-500/20 mb-6"
      >
        <Check className="h-10 w-10 text-white" strokeWidth={3} />
      </motion.div>
      <h1 className="text-3xl font-bold tracking-tight">You&apos;re all set!</h1>
      <p className="text-muted-foreground mt-3 max-w-md mx-auto text-sm">
        Click below to create your bot and head to the dashboard. From there
        you can train it, customize the widget, and grab the embed snippet.
      </p>

      {userOnFreePlan && userInterestedInPro && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-6 inline-flex items-center gap-2 rounded-full bg-violet-100 dark:bg-violet-950/40 px-3 py-1.5 text-xs text-violet-800 dark:text-violet-200"
        >
          <Crown className="h-3.5 w-3.5" />
          We&apos;ll keep the Pro banner visible on your dashboard
        </motion.div>
      )}
    </div>
  );
}
