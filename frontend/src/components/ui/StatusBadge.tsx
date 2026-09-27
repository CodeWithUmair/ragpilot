import { cn } from '../../lib/utils';

type Tone = 'success' | 'warning' | 'info' | 'neutral' | 'pro';

const TONES: Record<Tone, string> = {
  // Higher-contrast light-theme variants: darker text on slightly tinted bg.
  success: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  warning: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  info: 'bg-sky-100 text-sky-800 dark:bg-sky-950/40 dark:text-sky-300',
  neutral: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
  pro: 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-200',
};

interface StatusBadgeProps {
  tone: Tone;
  children: React.ReactNode;
  className?: string;
}

export function StatusBadge({ tone, children, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
