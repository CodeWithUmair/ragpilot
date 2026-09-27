// src/lib/auth-client.ts
import { createAuthClient } from 'better-auth/react';
import { config } from './config';
import { getToken, setToken } from './auth-token';

export const authClient = createAuthClient({
  baseURL: config.apiUrl,
  basePath: '/api/auth',
  fetchOptions: {
    // Send the stored session token on every request (cross-domain, no cookies).
    auth: {
      type: 'Bearer',
      token: () => getToken() ?? '',
    },
    // Capture the token the backend hands back on sign-in (email/password).
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get('set-auth-token');
      if (token) setToken(token);
    },
  },
});

export const {
  signIn,
  signOut,
  signUp,
  useSession,
  sendVerificationEmail,
} = authClient;