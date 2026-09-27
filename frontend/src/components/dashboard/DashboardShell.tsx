// src/components/dashboard/DashboardShell.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bot, LayoutDashboard, MessageSquare, Settings, LogOut,
  Menu, X, Shield, Crown, Sparkles, Users, BarChart3,
} from 'lucide-react';
import { useSidebarStore } from '../../stores/ui.store';
import { useMe } from '../../hooks/useApi';
import { signOut, useSession } from '../../lib/auth-client';
import { clearToken } from '../../lib/auth-token';
import { cn } from '../../lib/utils';
import { ThemeToggle } from './ThemeToggle';

type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact?: boolean;
};

const baseNavItems: NavItem[] = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/dashboard/chatbots', label: 'Chatbots', icon: Bot },
  { href: '/dashboard/conversations', label: 'Conversations', icon: MessageSquare },
  { href: '/dashboard/leads', label: 'Leads', icon: Users },
  { href: '/dashboard/settings', label: 'Settings', icon: Settings },
];

const adminNavItem: NavItem = { href: '/dashboard/admin', label: 'Admin', icon: Shield };

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const { isOpen, toggle, close } = useSidebarStore();
  const pathname = usePathname();
  const { data: user, isLoading: meLoading } = useMe();
  const { data: session, isPending } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!isPending && !session) {
      router.replace('/auth');
    }
  }, [session, isPending, router]);

  // New users haven't been through onboarding yet — push them there first.
  useEffect(() => {
    if (user && !user.onboardingCompleted) {
      router.replace('/onboarding');
    }
  }, [user, router]);

  async function handleLogout() {
    await signOut();
    clearToken();
    router.replace('/auth');
  }

  // Hold render until we know:
  //   1. session is resolved (still pending → spinner)
  //   2. me/onboarding state is resolved (still loading → spinner)
  //   3. user has actually completed onboarding (else they bounce to /onboarding)
  // Without this, the dashboard briefly flashes before the redirect fires.
  const blockRender =
    isPending || !session || meLoading || (user && !user.onboardingCompleted);

  if (blockRender) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {isOpen && <div className="fixed inset-0 z-20 bg-black/50 lg:hidden" onClick={close} />}
      <aside className={cn(
        'fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-card border-r border-border transition-transform duration-200',
        'lg:static lg:translate-x-0',
        isOpen ? 'translate-x-0' : '-translate-x-full',
      )}>
        <div className="flex h-16 items-center gap-2.5 px-6 border-b border-border">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-linear-to-br from-violet-500 to-fuchsia-600 shadow-sm shadow-violet-500/30">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <span className="bg-linear-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-lg font-bold text-transparent">RagPilot</span>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {[...baseNavItems, ...(user?.isAdmin ? [adminNavItem] : [])].map((item) => {
            const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
            return (
              <Link key={item.href} href={item.href} className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}>
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Upgrade card — pinned to the bottom of the sidebar (just above user info). */}
        {user?.plan === 'free' && (
          <div className="px-3 pb-3">
            <UpgradeCard messageUsage={user.messageUsage} messageLimit={user.messageLimit} />
          </div>
        )}

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-3 rounded-lg px-3 py-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-semibold shrink-0">
              {user?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{user?.name ?? session?.user.name ?? 'User'}</p>
              <p className="text-xs text-muted-foreground truncate">{user?.email ?? session?.user.email}</p>
            </div>
          </div>
          <button onClick={handleLogout} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors">
            <LogOut className="h-4 w-4" />
            Sign out
          </button>
        </div>
      </aside>
      <div className="flex flex-1 flex-col min-w-0">
        <header className="flex h-16 items-center gap-4 border-b border-border px-6">
          <button onClick={toggle} className="lg:hidden p-1.5 rounded-md hover:bg-accent">
            {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          <div className="ml-auto flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>{user.messageUsage} / {user.messageLimit} messages</span>
                <div className="w-24 h-1.5 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full"
                    style={{ width: `${Math.min(100, (user.messageUsage / user.messageLimit) * 100)}%` }}
                  />
                </div>
              </div>
            )}
            <ThemeToggle />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
}

function UpgradeCard({
  messageUsage,
  messageLimit,
}: {
  messageUsage: number;
  messageLimit: number;
}) {
  const pct = Math.min(100, (messageUsage / Math.max(1, messageLimit)) * 100);
  const isOver = messageUsage >= messageLimit;

  return (
    <div className="rounded-xl bg-linear-to-br from-violet-500 via-violet-600 to-fuchsia-600 p-4 text-white shadow-lg shadow-violet-500/20 relative overflow-hidden">
      <div className="absolute -top-6 -right-6 h-20 w-20 rounded-full bg-white/10 blur-2xl" />
      <div className="relative">
        <div className="flex items-center gap-1.5 mb-1.5">
          <Crown className="h-4 w-4" />
          <span className="text-xs font-bold uppercase tracking-wide">Upgrade to Pro</span>
        </div>
        <p className="text-xs text-white/85 leading-snug mb-3">
          {isOver
            ? 'You hit your monthly limit. Upgrade for 2,000 msgs, lead capture, and more.'
            : '2,000 msgs/mo · lead capture · proactive CTA · remove branding'}
        </p>

        {/* Mini usage bar */}
        <div className="flex items-center justify-between text-[10px] text-white/80 mb-1.5">
          <span>{messageUsage} / {messageLimit} msgs used</span>
          <span>{Math.round(pct)}%</span>
        </div>
        <div className="h-1 bg-white/20 rounded-full overflow-hidden mb-3">
          <div className="h-full bg-white/80 rounded-full" style={{ width: `${pct}%` }} />
        </div>

        <Link
          href="/dashboard/settings"
          className="flex items-center justify-center gap-1.5 rounded-lg bg-white text-violet-700 hover:bg-white/95 active:scale-[0.98] px-3 py-2 text-xs font-bold transition-all"
        >
          <Sparkles className="h-3.5 w-3.5" />
          See Pro plans
        </Link>
      </div>
    </div>
  );
}
