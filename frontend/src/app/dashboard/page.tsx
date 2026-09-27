// src/app/dashboard/page.tsx
'use client';

import {
  Bot, MessageSquare, TrendingUp, Zap, Plus, BarChart3, Users,
  Sparkles, ArrowRight, ArrowUpRight,
} from 'lucide-react';
import { useChatbots, useMe } from '../../hooks/useApi';
import Link from 'next/link';
import { cn } from '../../lib/utils';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { StatCardSkeleton, RowSkeleton } from '../../components/ui/skeleton';

function StatCard({
  label, value, icon: Icon, sub, accent, progress,
}: {
  label: string;
  value: string | number;
  icon: React.ElementType;
  sub?: string;
  accent?: string;
  progress?: number;
}) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-border bg-card p-5 transition-all hover:shadow-lg hover:shadow-primary/5 hover:-translate-y-0.5">
      {/* corner glow */}
      <div className="pointer-events-none absolute -top-8 -right-8 h-24 w-24 rounded-full bg-primary/10 blur-2xl opacity-0 transition-opacity group-hover:opacity-100" />
      <div className="relative">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{label}</span>
          <div className={cn('flex h-9 w-9 items-center justify-center rounded-lg', accent ?? 'bg-primary/10')}>
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
        {typeof progress === 'number' && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-linear-to-r from-violet-500 to-fuchsia-500"
              style={{ width: `${Math.min(100, Math.max(2, progress))}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function QuickAction({ href, label, icon: Icon }: { href: string; label: string; icon: React.ElementType }) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 transition-all hover:border-primary/40 hover:shadow-sm"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <span className="flex-1 text-sm font-medium">{label}</span>
      <ArrowUpRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
    </Link>
  );
}

function BotInitial({ name }: { name: string }) {
  return (
    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-linear-to-br from-violet-500 to-fuchsia-600 text-sm font-bold text-white">
      {name?.[0]?.toUpperCase() ?? 'B'}
    </div>
  );
}

export default function DashboardPage() {
  const { data: user } = useMe();
  const { data: chatbots = [], isLoading } = useChatbots();

  const trainedCount = chatbots.filter((b) => b.isTrained).length;
  const usagePct = user?.messageLimit ? (user.messageUsage / user.messageLimit) * 100 : 0;

  return (
    <div className="mx-auto max-w-full p-6">
      {/* Hero header */}
      <div className="relative mb-6 overflow-hidden rounded-2xl bg-linear-to-br from-violet-600 via-violet-600 to-fuchsia-600 p-6 text-white shadow-lg shadow-violet-500/20 sm:p-7">
        <div className="pointer-events-none absolute -top-10 -right-6 h-40 w-40 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-24 w-24 rounded-full bg-fuchsia-300/20 blur-2xl" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" />
              Dashboard
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              Welcome back{user?.name ? `, ${user.name.split(' ')[0]}` : ''} 👋
            </h1>
            <p className="mt-1 text-sm text-white/80">
              Here's how your chatbots are doing today.
            </p>
          </div>
          <div className="flex gap-2">
            <Link
              href="/dashboard/chatbots/new"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-bold text-violet-700 transition-all hover:bg-white/95 active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" /> New Chatbot
            </Link>
            <Link
              href="/dashboard/analytics"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/15 px-4 py-2 text-sm font-semibold backdrop-blur transition-colors hover:bg-white/25"
            >
              <BarChart3 className="h-4 w-4" /> Analytics
            </Link>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading ? (
          <>
            <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard label="Total Chatbots" value={chatbots.length} icon={Bot} />
            <StatCard
              label="Trained" value={trainedCount} icon={Zap}
              sub={`${chatbots.length - trainedCount} not yet trained`}
            />
            <StatCard
              label="Messages Used" value={user?.messageUsage ?? 0} icon={MessageSquare}
              sub={`of ${user?.messageLimit ?? 0} this month`}
              progress={usagePct}
            />
            <StatCard
              label="Plan" value={user?.plan ?? 'free'} icon={TrendingUp}
              sub="Upgrade for more"
            />
          </>
        )}
      </div>

      {/* Quick actions */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <QuickAction href="/dashboard/chatbots/new" label="Create a chatbot" icon={Plus} />
        <QuickAction href="/dashboard/analytics" label="View analytics" icon={BarChart3} />
        <QuickAction href="/dashboard/leads" label="Review leads" icon={Users} />
      </div>

      {/* Chatbots list */}
      <div className="rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="font-semibold">Your Chatbots</h2>
          {chatbots.length > 5 && (
            <Link href="/dashboard/chatbots" className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
              View all <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>

        {isLoading ? (
          <div>{[0, 1, 2].map((i) => <RowSkeleton key={i} />)}</div>
        ) : chatbots.length === 0 ? (
          <div className="p-12 text-center">
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-linear-to-br from-violet-500/15 to-fuchsia-500/15">
              <Bot className="h-7 w-7 text-primary" />
            </div>
            <p className="font-medium">No chatbots yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Create your first chatbot to get started.</p>
            <Link
              href="/dashboard/chatbots/new"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Create Chatbot
            </Link>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {chatbots.slice(0, 5).map((bot) => (
              <Link
                key={bot.id}
                href={`/dashboard/chatbots/${bot.id}`}
                className="flex items-center gap-4 px-6 py-4 transition-colors hover:bg-accent/50"
              >
                <BotInitial name={bot.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{bot.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{bot.url}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <StatusBadge tone={bot.isTrained ? 'success' : 'warning'}>
                    {bot.isTrained ? 'Trained' : 'Untrained'}
                  </StatusBadge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
