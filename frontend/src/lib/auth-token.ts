// src/lib/auth-token.ts
//
// The session token for bearer auth. Because the backend may live
// on a different origin than the frontend, we can't rely on cookies — we store the
// token client-side and send it as `Authorization: Bearer <token>` on every
// request. Captured from the `set-auth-token` header on sign-in (auth-client.ts)
// and from the OAuth handoff fragment (/auth/callback).
const KEY = 'bearer_token';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(KEY);
}

export function setToken(token: string): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(KEY, token);
}

export function clearToken(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(KEY);
}
