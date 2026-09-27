// Playwright globalSetup: seeds a verified test user in the backend before
// any spec runs. We hit the dev-only /api/__test/seed-user endpoint so the
// frontend test code stays decoupled from Prisma.
import type { FullConfig } from '@playwright/test';
import { TEST_USER } from './fixtures';

async function waitForBackend(url: string, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 401 || r.status === 404) return; // any response means it's up
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Backend did not come up at ${url} in ${attempts}s`);
}

export default async function globalSetup(_config: FullConfig) {
  await waitForBackend('http://localhost:4000/health');

  const res = await fetch('http://localhost:4000/api/__test/seed-user', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(TEST_USER),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`seed-user failed: ${res.status} ${body}`);
  }
  console.log(`[e2e] Seeded test user: ${TEST_USER.email}`);
}
