// src/app/auth/[[...path]]/page.tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { signIn, signUp, sendVerificationEmail, useSession } from '../../../lib/auth-client';
import toast from 'react-hot-toast';
import { Zap, Eye, EyeOff, MailCheck, MailWarning, CheckCircle2, XCircle } from 'lucide-react';
import { config } from '@/lib/config';
import { ThemeToggle } from '@/components/dashboard/ThemeToggle';
import { Button } from '@/components/ui/button';

type Mode = 'signin' | 'signup';

// Where the emailed verification link drops the user after the backend
// confirms the token. Rendered by this same catch-all route (see below).
const VERIFIED_CALLBACK = () => `${config.appUrl}/auth/verified`;

export default function AuthPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { data: session, isPending: sessionPending } = useSession();
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Email-verification UX state:
  //   checkInboxFor  — we just signed this email up; show the "check your inbox" screen
  //   unverifiedEmail — sign-in was blocked because the email isn't verified yet
  const [checkInboxFor, setCheckInboxFor] = useState<string | null>(null);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [resending, setResending] = useState(false);

  // /auth/verified — landing page for the emailed link. The backend redirects
  // here after consuming the token (with ?error=... if it was invalid/expired).
  const isVerifiedLanding = pathname === '/auth/verified';
  const [verifyError, setVerifyError] = useState<string | null>(null);
  useEffect(() => {
    if (!isVerifiedLanding) return;
    const err = new URLSearchParams(window.location.search).get('error');
    if (err) setVerifyError(err);
  }, [isVerifiedLanding]);

  // Already signed in? Don't show the auth screens — bounce them into the app.
  // (Also covers the verified-landing case when autoSignInAfterVerification
  // managed to establish a session.)
  useEffect(() => {
    if (!sessionPending && session) {
      router.replace('/dashboard');
    }
  }, [session, sessionPending, router]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  function handleGoogleLogin() {
    setGoogleLoading(true);
    // Top-level navigation to the backend so the OAuth state cookie is
    // first-party — works in every browser, including ones that block
    // third-party cookies (Brave/Safari). The backend completes the flow and
    // redirects to /auth/callback with the session token.
    window.location.href = `${config.apiUrl}/api/login/google`;
  }

  async function resendVerification(targetEmail: string) {
    if (resendCooldown > 0 || resending) return;
    setResending(true);
    try {
      const { error } = await sendVerificationEmail({
        email: targetEmail,
        callbackURL: VERIFIED_CALLBACK(),
      });
      if (error) {
        toast.error(error.message ?? 'Could not send the email, try again.');
        return;
      }
      toast.success('Verification email sent. Check your inbox.');
      setResendCooldown(30);
    } finally {
      setResending(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);

    try {
      if (mode === 'signup') {
        const { data, error } = await signUp.email({
          email, password, name,
          callbackURL: VERIFIED_CALLBACK(),
        });
        if (error) { toast.error(error.message ?? 'Signup failed'); return; }
        // When the server requires email verification it creates the account
        // but returns no session token — show the "check your inbox" screen.
        if (!data?.token) {
          setCheckInboxFor(email);
          setResendCooldown(30);
          return;
        }
        router.replace('/dashboard');
      } else {
        const { error } = await signIn.email({
          email, password,
          callbackURL: '/dashboard',
        });
        if (error) {
          // 403 = account exists but the email was never verified. The backend
          // auto-sends a fresh link on this attempt; tell the user to look.
          if (error.status === 403) {
            setUnverifiedEmail(email);
            setResendCooldown(30);
            return;
          }
          toast.error(error.message ?? 'Login failed');
          return;
        }
        router.replace('/dashboard');
      }
    } finally {
      setLoading(false);
    }
  }

  // While the session resolves — or when one already exists and we're about to
  // redirect — hold the auth UI back so the login form never flashes for a
  // user who's already logged in.
  if (sessionPending || session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-6 w-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // ── /auth/verified — result of clicking the emailed link ────────────────────
  if (isVerifiedLanding) {
    return (
      <AuthShell>
        <div className="rounded-xl border border-border bg-card p-8 text-center space-y-4" data-testid="verified-landing">
          {verifyError ? (
            <>
              <XCircle className="h-12 w-12 text-destructive mx-auto" />
              <h2 className="text-lg font-semibold">Verification link is invalid or expired</h2>
              <p className="text-sm text-muted-foreground">
                Sign in below and we&apos;ll email you a fresh verification link automatically.
              </p>
              <Button size="md" className="w-full" onClick={() => { setVerifyError(null); router.replace('/auth'); }}>
                Go to sign in
              </Button>
            </>
          ) : (
            <>
              <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto" />
              <h2 className="text-lg font-semibold">Email verified!</h2>
              <p className="text-sm text-muted-foreground">
                Your account is active. Sign in to start building your chatbot.
              </p>
              <Button size="md" className="w-full" onClick={() => router.replace('/auth')}>
                Continue to sign in
              </Button>
            </>
          )}
        </div>
      </AuthShell>
    );
  }

  // ── "Check your inbox" screen right after signup ───────────────────────────
  if (checkInboxFor) {
    return (
      <AuthShell>
        <div className="rounded-xl border border-border bg-card p-8 text-center space-y-4" data-testid="check-inbox">
          <MailCheck className="h-12 w-12 text-primary mx-auto" />
          <h2 className="text-lg font-semibold">Check your inbox</h2>
          <p className="text-sm text-muted-foreground">
            We sent a verification link to{' '}
            <span className="font-medium text-foreground">{checkInboxFor}</span>.
            Click it to activate your account, then sign in.
          </p>
          <Button
            size="md"
            variant="outline"
            className="w-full"
            loading={resending}
            disabled={resendCooldown > 0}
            onClick={() => resendVerification(checkInboxFor)}
          >
            {resendCooldown > 0 ? `Resend email (${resendCooldown}s)` : 'Resend email'}
          </Button>
          <button
            onClick={() => { setCheckInboxFor(null); setMode('signin'); }}
            className="text-sm text-primary hover:underline font-medium"
          >
            Back to sign in
          </button>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="flex flex-col items-center mb-8 -mt-2">
        <p className="text-muted-foreground text-sm">
          {mode === 'signin' ? 'Sign in to your account' : 'Create your account'}
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        {unverifiedEmail && (
          <div
            className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3"
            data-testid="unverified-banner"
          >
            <MailWarning className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="text-xs leading-relaxed">
              <p className="font-medium text-foreground">Verify your email to continue</p>
              <p className="text-muted-foreground">
                We sent a fresh link to <span className="font-medium">{unverifiedEmail}</span>.
                Click it, then sign in again.
              </p>
              <button
                type="button"
                disabled={resendCooldown > 0 || resending}
                onClick={() => resendVerification(unverifiedEmail)}
                className="mt-1 text-primary hover:underline font-medium disabled:opacity-50 disabled:no-underline"
              >
                {resendCooldown > 0 ? `Resend email (${resendCooldown}s)` : 'Resend email'}
              </button>
            </div>
          </div>
        )}

        <Button
          variant="outline"
          size="md"
          onClick={handleGoogleLogin}
          loading={googleLoading}
          disabled={loading}
          className="w-full"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
          </svg>
          Continue with Google
        </Button>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">or</span>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'signup' && (
            <div>
              <label className="block text-sm font-medium mb-1.5">Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                required
                className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5">Password</label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={8}
                className="w-full rounded-lg border border-input bg-background pl-3 pr-10 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                tabIndex={-1}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <Button
            type="submit"
            size="md"
            loading={loading}
            disabled={googleLoading}
            className="w-full"
          >
            {mode === 'signin' ? 'Sign In' : 'Sign Up'}
          </Button>
        </form>

        <p className="text-center text-sm text-muted-foreground">
          {mode === 'signin' ? "Don't have an account? " : 'Already have an account? '}
          <button
            onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setUnverifiedEmail(null); }}
            className="text-primary hover:underline font-medium"
          >
            {mode === 'signin' ? 'Sign Up' : 'Sign In'}
          </button>
        </p>
      </div>
    </AuthShell>
  );
}

/** Shared centered layout: logo header + theme toggle around any auth view. */
function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary mb-3">
            <Zap className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">RagPilot</h1>
        </div>
        {children}
      </div>
    </div>
  );
}
