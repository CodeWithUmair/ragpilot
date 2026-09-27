'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from '../../lib/auth-client';
import { useMe } from '../../hooks/useApi';

export default function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { data: session, isPending: sessionPending } = useSession();
  const { data: user, isLoading: meLoading } = useMe();

  useEffect(() => {
    if (!sessionPending && !session) {
      router.replace('/auth');
    }
  }, [session, sessionPending, router]);

  // If they've already finished onboarding, send them to the dashboard.
  useEffect(() => {
    if (!meLoading && user?.onboardingCompleted) {
      router.replace('/dashboard');
    }
  }, [user, meLoading, router]);

  if (sessionPending || meLoading || !session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {children}
    </div>
  );
}
