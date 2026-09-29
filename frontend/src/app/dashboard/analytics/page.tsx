// src/app/dashboard/analytics/page.tsx
//
// Detailed analytics: filterable by chatbot + date range. Metric cards with
// period-over-period deltas, daily conversation/message/lead trends, hourly
// activity, lead status breakdown, top pages and top questions.
'use client';

import { useMemo, useState } from 'react';
import {
  BarChart3, MessagesSquare, MessageSquare, Users, TrendingUp, TrendingDown,
  Target, CalendarRange,
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts';
import { format, parseISO, subDays } from 'date-fns';
import { useAnalytics, useChatbots, type Analytics } from '../../../hooks/useApi';
import { cn } from '../../../lib/utils';

const PRESETS = [
  { key: '7d', label: 'Last 7 days', days: 7 },
  { key: '30d', label: 'Last 30 days', days: 30 },
  { key: '90d', label: 'Last 90 days', days: 90 },
] as const;
type PresetKey = (typeof PRESETS)[number]['key'] | 'custom';

const CHART = {
  conversations: 'var(--color-primary)',
  messages: '#22c55e',
  leads: '#f59e0b',
  grid: 'var(--color-border)',
  tick: 'var(--color-muted-foreground)',
};
const STATUS_COLORS: Record<string, string> = {
  NEW: '#6B46C1',
  CONTACTED: '#22c55e',
  ARCHIVED: '#9ca3af',
};

function toDateInput(d: Date): string {
  return format(d, 'yyyy-MM-dd');
}

export default function AnalyticsPage() {
  const { data: chatbots } = useChatbots();
  const [chatbotId, setChatbotId] = useState('all');
  const [preset, setPreset] = useState<PresetKey>('30d');
  const [customFrom, setCustomFrom] = useState(toDateInput(subDays(new Date(), 29)));
  const [customTo, setCustomTo] = useState(toDateInput(new Date()));

  const { from, to } = useMemo(() => {
    if (preset === 'custom') return { from: customFrom, to: customTo };
    const p = PRESETS.find((x) => x.key === preset) ?? PRESETS[1];
    return { from: toDateInput(subDays(new Date(), p.days - 1)), to: toDateInput(new Date()) };
  }, [preset, customFrom, customTo]);

  const { data, isLoading } = useAnalytics({ chatbotId, from, to });

  const hasData =
    !!data && (data.totals.conversations > 0 || data.totals.messages > 0 || data.totals.leads > 0);

  return (
    <div className="p-6 space-y-6">
      {/* Header + filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Analytics
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            How your chatbots performed between {format(parseISO(from), 'MMM d, yyyy')} and{' '}
            {format(parseISO(to), 'MMM d, yyyy')}.
          </p>
        </div>

        <select
          value={chatbotId}
          onChange={(e) => setChatbotId(e.target.value)}
          data-testid="analytics-bot-filter"
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All chatbots</option>
          {(chatbots ?? []).map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>

        <div className="flex items-center rounded-lg border border-border p-0.5 bg-card">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPreset(p.key)}
              data-testid={`analytics-range-${p.key}`}
              className={cn(
                'px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
                preset === p.key
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => setPreset('custom')}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex items-center gap-1',
              preset === 'custom'
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <CalendarRange className="h-3.5 w-3.5" />
            Custom
          </button>
        </div>

        {preset === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={customFrom}
              max={customTo}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              type="date"
              value={customTo}
              min={customFrom}
              max={toDateInput(new Date())}
              onChange={(e) => setCustomTo(e.target.value)}
              className="rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
        )}
      </div>

      {isLoading && !data ? (
        <div className="flex items-center justify-center min-h-64">
          <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data ? null : (
        <>
          {/* Metric cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4" data-testid="analytics-cards">
            <StatCard
              icon={MessagesSquare}
              label="Conversations"
              value={data.totals.conversations}
              prev={data.previous.conversations}
            />
            <StatCard
              icon={MessageSquare}
              label="Messages"
              value={data.totals.messages}
              prev={data.previous.messages}
            />
            <StatCard
              icon={Users}
              label="Leads captured"
              value={data.totals.leads}
              prev={data.previous.leads}
            />
            <StatCard
              icon={Target}
              label="Lead conversion"
              value={`${(data.totals.conversionRate * 100).toFixed(1)}%`}
              hint={`${data.totals.visitors} unique visitor${data.totals.visitors === 1 ? '' : 's'}`}
            />
          </div>

          {!hasData ? (
            <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
              <BarChart3 className="h-10 w-10 text-muted-foreground/50 mx-auto mb-3" />
              <h3 className="font-medium">No activity in this period</h3>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
                Once visitors start chatting with your bot, conversations, messages, and captured
                leads will show up here. Try a wider date range or embed your bot on your site.
              </p>
            </div>
          ) : (
            <>
              {/* Trends */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <ChartCard title="Conversations & messages over time" className="xl:col-span-2">
                  <ResponsiveContainer width="100%" height={280}>
                    <AreaChart data={data.series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <defs>
                        <linearGradient id="gradConv" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CHART.conversations} stopOpacity={0.35} />
                          <stop offset="100%" stopColor={CHART.conversations} stopOpacity={0.02} />
                        </linearGradient>
                        <linearGradient id="gradMsg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CHART.messages} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={CHART.messages} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: CHART.tick, fontSize: 11 }}
                        tickFormatter={(d: string) => format(parseISO(d), 'MMM d')}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={24}
                      />
                      <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip content={<SeriesTooltip />} />
                      <Legend formatter={(v) => <span className="text-xs text-muted-foreground capitalize">{v}</span>} />
                      <Area type="monotone" dataKey="messages" stroke={CHART.messages} fill="url(#gradMsg)" strokeWidth={2} />
                      <Area type="monotone" dataKey="conversations" stroke={CHART.conversations} fill="url(#gradConv)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Leads per day">
                  <ResponsiveContainer width="100%" height={280}>
                    <BarChart data={data.series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="date"
                        tick={{ fill: CHART.tick, fontSize: 11 }}
                        tickFormatter={(d: string) => format(parseISO(d), 'MMM d')}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={24}
                      />
                      <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip content={<SeriesTooltip />} />
                      <Bar dataKey="leads" fill={CHART.leads} radius={[4, 4, 0, 0]} maxBarSize={28} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              {/* Hourly + lead status + per-bot */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <ChartCard title="Activity by hour (UTC)" className="xl:col-span-2">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.hourly} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                      <CartesianGrid stroke={CHART.grid} strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="hour"
                        tick={{ fill: CHART.tick, fontSize: 11 }}
                        tickFormatter={(h: number) => `${h}:00`}
                        tickLine={false}
                        axisLine={false}
                        minTickGap={16}
                      />
                      <YAxis tick={{ fill: CHART.tick, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip content={<HourTooltip />} />
                      <Bar dataKey="messages" fill={CHART.conversations} radius={[4, 4, 0, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Lead status">
                  {data.leadStatus.length === 0 ? (
                    <EmptyNote>No leads in this period yet.</EmptyNote>
                  ) : (
                    <div className="flex items-center gap-4">
                      <ResponsiveContainer width="55%" height={200}>
                        <PieChart>
                          <Pie
                            data={data.leadStatus}
                            dataKey="count"
                            nameKey="status"
                            innerRadius={48}
                            outerRadius={78}
                            paddingAngle={3}
                            strokeWidth={0}
                          >
                            {data.leadStatus.map((s) => (
                              <Cell key={s.status} fill={STATUS_COLORS[s.status] ?? '#8884d8'} />
                            ))}
                          </Pie>
                          <Tooltip content={<PieTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="space-y-2">
                        {data.leadStatus.map((s) => (
                          <div key={s.status} className="flex items-center gap-2 text-sm">
                            <span
                              className="h-2.5 w-2.5 rounded-full shrink-0"
                              style={{ background: STATUS_COLORS[s.status] ?? '#8884d8' }}
                            />
                            <span className="capitalize text-muted-foreground">{s.status.toLowerCase()}</span>
                            <span className="font-semibold ml-auto">{s.count}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </ChartCard>
              </div>

              {/* Lists */}
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <ChartCard title="Top questions">
                  {data.topQuestions.length === 0 ? (
                    <EmptyNote>No conversations yet.</EmptyNote>
                  ) : (
                    <RankedList
                      items={data.topQuestions.map((q) => ({ label: q.question, count: q.count }))}
                    />
                  )}
                </ChartCard>
                <ChartCard title="Top pages where chats start">
                  {data.topPages.length === 0 ? (
                    <EmptyNote>No page data yet. Page URLs are recorded when the widget is embedded on your site.</EmptyNote>
                  ) : (
                    <RankedList
                      items={data.topPages.map((p) => ({ label: p.page, count: p.count, mono: true }))}
                    />
                  )}
                </ChartCard>
                <ChartCard title="By chatbot" testId="bots-card">
                  {data.bots.length === 0 ? (
                    <EmptyNote>No chatbots yet.</EmptyNote>
                  ) : (
                    <div className="space-y-1">
                      <div className="grid grid-cols-[1fr_auto_auto] gap-3 px-2 pb-1 text-[11px] uppercase tracking-wide text-muted-foreground">
                        <span>Chatbot</span><span>Convos</span><span>Leads</span>
                      </div>
                      {data.bots.map((b) => (
                        <div
                          key={b.id}
                          className="grid grid-cols-[1fr_auto_auto] gap-3 items-center rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                        >
                          <span className="truncate">{b.name}</span>
                          <span className="font-semibold tabular-nums">{b.conversations}</span>
                          <span className="font-semibold tabular-nums text-amber-500">{b.leads}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </ChartCard>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

// ─── Pieces ───────────────────────────────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  prev,
  hint,
}: {
  icon: typeof BarChart3;
  label: string;
  value: number | string;
  prev?: number;
  hint?: string;
}) {
  // Period-over-period delta. prev === 0 with activity now → "new" (no %).
  let delta: { pct: number; up: boolean } | 'new' | null = null;
  if (typeof value === 'number' && typeof prev === 'number') {
    if (prev > 0) {
      const pct = ((value - prev) / prev) * 100;
      delta = { pct: Math.abs(pct), up: pct >= 0 };
    } else if (value > 0) {
      delta = 'new';
    }
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4" data-testid={`stat-${label}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-2 flex items-end gap-2">
        <span className="text-2xl font-bold tabular-nums" data-testid="stat-value">{value}</span>
        {delta === 'new' ? (
          <span className="text-xs font-medium text-green-500 mb-1">new</span>
        ) : delta ? (
          <span
            className={cn(
              'flex items-center gap-0.5 text-xs font-medium mb-1',
              delta.up ? 'text-green-500' : 'text-red-500',
            )}
          >
            {delta.up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {delta.pct.toFixed(0)}%
          </span>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground mt-1">
        {hint ?? 'vs. previous period'}
      </p>
    </div>
  );
}

function ChartCard({
  title,
  children,
  className,
  testId,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div className={cn('rounded-xl border border-border bg-card p-4', className)} data-testid={testId}>
      <h3 className="text-sm font-medium mb-3">{title}</h3>
      {children}
    </div>
  );
}

function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground py-8 text-center">{children}</p>;
}

function RankedList({ items }: { items: { label: string; count: number; mono?: boolean }[] }) {
  const max = Math.max(...items.map((i) => i.count), 1);
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="relative rounded-lg overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-primary/10"
            style={{ width: `${(item.count / max) * 100}%` }}
          />
          <div className="relative flex items-center gap-2 px-2.5 py-1.5 text-sm">
            <span className={cn('truncate flex-1', item.mono && 'font-mono text-xs')} title={item.label}>
              {item.label}
            </span>
            <span className="font-semibold tabular-nums text-xs">{item.count}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// Recharts tooltips rendered with app theme classes (so dark mode just works).
function TooltipFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      {children}
    </div>
  );
}

function SeriesTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <TooltipFrame>
      <p className="font-medium mb-1">{format(parseISO(label), 'EEE, MMM d')}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="capitalize text-muted-foreground">{p.dataKey}:</span>
          <span className="font-semibold">{p.value}</span>
        </p>
      ))}
    </TooltipFrame>
  );
}

function HourTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <TooltipFrame>
      <p className="font-medium">{label}:00-{label}:59 UTC</p>
      <p className="text-muted-foreground">
        Messages: <span className="font-semibold text-foreground">{payload[0].value}</span>
      </p>
    </TooltipFrame>
  );
}

function PieTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <TooltipFrame>
      <p className="capitalize">
        {String(item.name).toLowerCase()}: <span className="font-semibold">{item.value}</span>
      </p>
    </TooltipFrame>
  );
}
