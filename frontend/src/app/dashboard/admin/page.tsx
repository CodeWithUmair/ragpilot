'use client';

import { useState } from 'react';
import { Search, RotateCcw, Shield } from 'lucide-react';
import { useAdminUsers, useSetUserPlan, useResetUserUsage, useMe } from '@/hooks/useApi';
import { PLAN_LIST, PLANS, type PlanKey } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

export default function AdminPage() {
  const { data: me, isLoading: meLoading } = useMe();
  const [search, setSearch] = useState('');
  const { data, isLoading } = useAdminUsers(search);
  const setPlan = useSetUserPlan();
  const resetUsage = useResetUserUsage();

  if (meLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!me?.isAdmin) {
    return (
      <div className="p-6 max-w-md mx-auto mt-20 text-center space-y-3">
        <Shield className="h-10 w-10 text-muted-foreground mx-auto" />
        <h1 className="text-xl font-semibold">Admin only</h1>
        <p className="text-sm text-muted-foreground">
          This page is only accessible to the user listed in the{' '}
          <code className="bg-muted px-1 rounded">ADMIN_EMAIL</code> env var.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-full mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          Admin
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Manage user subscriptions and usage. Changes take effect immediately.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by email or name..."
          className="w-full rounded-lg border border-input bg-background pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      <div className="rounded-xl border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3 font-medium">User</th>
              <th className="text-left px-4 py-3 font-medium">Plan</th>
              <th className="text-left px-4 py-3 font-medium">Usage</th>
              <th className="text-left px-4 py-3 font-medium">Bots</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading && [0, 1, 2].map((i) => (
              <tr key={i}>
                <td className="px-4 py-3"><div className="space-y-1.5"><Skeleton className="h-3 w-32" /><Skeleton className="h-3 w-44" /></div></td>
                <td className="px-4 py-3"><Skeleton className="h-5 w-14 rounded-full" /></td>
                <td className="px-4 py-3"><div className="space-y-1.5"><Skeleton className="h-3 w-20" /><Skeleton className="h-1 w-24 rounded-full" /></div></td>
                <td className="px-4 py-3"><Skeleton className="h-3 w-4" /></td>
                <td className="px-4 py-3"><div className="flex justify-end gap-2"><Skeleton className="h-6 w-14" /><Skeleton className="h-6 w-14" /></div></td>
              </tr>
            ))}
            {!isLoading && data?.users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  No users found.
                </td>
              </tr>
            )}
            {data?.users.map((u) => {
              const isOver = u.messageUsage >= u.messageLimit;
              return (
                <tr key={u.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <div className="font-medium">{u.name ?? '—'}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge tone={u.plan === 'pro' ? 'pro' : 'neutral'}>
                      {PLANS[u.plan].label}
                    </StatusBadge>
                  </td>
                  <td className="px-4 py-3">
                    <div className={cn('text-xs', isOver && 'text-destructive font-medium')}>
                      {u.messageUsage} / {u.messageLimit}
                    </div>
                    <div className="mt-1 h-1 w-24 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn('h-full rounded-full', isOver ? 'bg-destructive' : 'bg-primary')}
                        style={{
                          width: `${Math.min(100, (u.messageUsage / Math.max(1, u.messageLimit)) * 100)}%`,
                        }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{u.chatbotCount}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {PLAN_LIST.map((p) => {
                        const isCurrent = u.plan === p.key;
                        const rowPlanLoading =
                          setPlan.isPending &&
                          setPlan.variables?.userId === u.id &&
                          setPlan.variables?.plan === p.key;
                        return (
                          <Button
                            key={p.key}
                            size="xs"
                            variant={isCurrent ? 'default' : 'outline'}
                            onClick={() => setPlan.mutate({ userId: u.id, plan: p.key as PlanKey })}
                            disabled={isCurrent}
                            loading={rowPlanLoading}
                            className={cn(
                              isCurrent && 'bg-primary/10 text-primary border-primary cursor-default',
                            )}
                          >
                            {p.label}
                          </Button>
                        );
                      })}
                      <Button
                        size="icon-xs"
                        variant="outline"
                        onClick={() => resetUsage.mutate(u.id)}
                        loading={resetUsage.isPending && resetUsage.variables === u.id}
                        title="Reset monthly usage to 0"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {data?.users.length ?? 0} of {data?.total ?? 0} user{(data?.total ?? 0) === 1 ? '' : 's'}.
      </p>
    </div>
  );
}
