// src/app/auth/callback/page.tsx
//
// Lands here after backend-driven Google OAuth. The backend redirects with the
// session token in the URL fragment (#token=...) — we store it for bearer auth
// and head to the dashboard. A static route, so it wins over the auth/[[...path]]
// catch-all for this exact path.
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { setToken } from '@/lib/auth-token';
import toast from 'react-hot-toast';

export default function OAuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const token = params.get('token'); // URLSearchParams decodes the value for us
    const error = params.get('error');

    if (token) {
      setToken(token);
      // Strip the token out of the URL/history before moving on.
      window.history.replaceState(null, '', '/auth/callback');
      router.replace('/dashboard');
    } else {
      toast.error(
        error === 'no_session'
          ? 'Sign-in could not be completed. Please try again.'
          : 'Google sign-in failed. Please try again.',
      );
      router.replace('/auth');
    }
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </div>
  );
}
