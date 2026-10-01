'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import {
  queryKeys, useMe, useUpdateMe, useUpdateMyPlan, useStartCheckout, useOpenBillingPortal,
} from '@/hooks/useApi';
import { PLAN_LIST, getPlan } from '@/lib/plans';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

// Dev has no payment provider, so plan buttons flip the plan directly; production uses Lemon Squeezy.
const IS_PROD = process.env.NODE_ENV === 'production';

export default function SettingsPage() {
  const { data: user } = useMe();
  const updateMeMutation = useUpdateMe();
  const updatePlanMutation = useUpdateMyPlan();
  const checkout = useStartCheckout();
  const portal = useOpenBillingPortal();
  const queryClient = useQueryClient();
  // Back from checkout (?upgraded=1): the plan flips when Lemon Squeezy's webhook lands, a few seconds later.
  const [justPaid] = useState(() => typeof window !== 'undefined' && window.location.search.includes('upgraded=1'));
  const activating = justPaid && user?.plan !== 'pro';
  useEffect(() => {
    if (!activating) return;
    const id = setInterval(() => queryClient.invalidateQueries({ queryKey: queryKeys.me }), 2000);
    return () => clearInterval(id);
  }, [activating, queryClient]);
  const [name, setName] = useState(user?.name ?? '');

  const currentPlan = user ? getPlan(user.plan) : PLAN_LIST[0];
  const usagePct = user
    ? Math.min(100, (user.messageUsage / Math.max(1, user.messageLimit)) * 100)
    : 0;
  const isOver = user ? user.messageUsage >= user.messageLimit : false;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Manage your account and plan.</p>
      </div>

      {activating && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm">
          Payment received. Activating your Pro plan&hellip;
        </div>
      )}

      {/* Profile */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="font-semibold">Profile</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1.5">Display name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Email</label>
            <input
              value={user?.email ?? ''}
              disabled
              className="w-full rounded-lg border border-input bg-muted px-3 py-2.5 text-sm text-muted-foreground cursor-not-allowed"
            />
          </div>
          <Button
            size="md"
            onClick={() => updateMeMutation.mutate({ name })}
            loading={updateMeMutation.isPending}
          >
            Save changes
          </Button>
        </div>
      </section>

      {/* Usage */}
      <section className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">Usage this month</h2>
          <span className={cn('text-xs', isOver ? 'text-destructive font-medium' : 'text-muted-foreground')}>
            {user?.messageUsage ?? 0} / {user?.messageLimit ?? 0} messages
          </span>
        </div>
        <div className="h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', isOver ? 'bg-destructive' : 'bg-primary')}
            style={{ width: `${usagePct}%` }}
          />
        </div>
        {isOver && (
          <p className="text-xs text-destructive">
            You&apos;ve hit your monthly limit. New visitor messages will be paused until you upgrade or the
            quota resets.
          </p>
        )}
      </section>

      {/* Plan */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Plan</h2>
          <span className="text-xs text-muted-foreground">
            Current: <span className="font-medium text-foreground">{currentPlan.label}</span>
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PLAN_LIST.map((plan) => {
            const Icon = plan.icon;
            const isCurrent = user?.plan === plan.key;
            return (
              <div
                key={plan.key}
                className={cn(
                  'relative rounded-xl border p-5 transition-all',
                  isCurrent ? `${plan.borderClass} ${plan.bgClass}` : 'border-border bg-card',
                  plan.popular && !isCurrent && 'border-violet-300 dark:border-violet-700',
                )}
              >
                {plan.popular && (
                  <div className="absolute -top-2.5 left-4 rounded-full bg-violet-500 px-2.5 py-0.5 text-[10px] font-bold text-white">
                    POPULAR
                  </div>
                )}
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={cn('h-4 w-4', plan.accentClass)} />
                  <span className="font-semibold">{plan.label}</span>
                  <span className="ml-auto font-bold">
                    {plan.priceLabel}
                    <span className="text-xs font-normal text-muted-foreground">/mo</span>
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mb-4">{plan.description}</p>
                <ul className="space-y-1.5 mb-4">
                  {plan.featureList.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Check className="h-3 w-3 text-green-500 mt-0.5 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                {isCurrent ? (
                  <div
                    className={cn(
                      'w-full rounded-lg py-2 text-xs font-medium text-center',
                      `${plan.accentClass} bg-transparent border border-current`,
                    )}
                  >
                    ✓ Current plan
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant={plan.key === 'pro' ? 'default' : 'outline'}
                    className="w-full"
                    loading={updatePlanMutation.isPending || checkout.isPending || portal.isPending}
                    onClick={() => {
                      if (!IS_PROD) updatePlanMutation.mutate(plan.key);
                      else if (plan.key === 'pro') checkout.mutate();
                      else portal.mutate(); // cancelling happens in the billing portal
                    }}
                    data-testid={`plan-switch-${plan.key}`}
                  >
                    {plan.key === 'pro' ? 'Upgrade to Pro' : IS_PROD ? 'Manage subscription' : 'Switch to Free'}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          {IS_PROD
            ? 'Payments are processed securely by Lemon Squeezy. Cancel any time from Manage subscription.'
            : 'Dev mode: plan changes are instant and free. Production uses Lemon Squeezy checkout.'}
        </p>
      </section>
    </div>
  );
}
