import { test, expect, type Page } from '@playwright/test';
import { TEST_USER } from './fixtures';

// Regression test for the bug where the Conversations view showed
// "No messages recorded" even though the message was saved. Root cause was
// CORS: the dashboard's axios client sends every request with credentials, but
// the public /chat/history endpoint replied without
// `Access-Control-Allow-Credentials: true`, so the browser discarded the
// (otherwise correct) response. localhost:3000 → localhost:4000 is a real
// cross-origin pair, so this reproduces the production failure locally.

const API_BASE = 'http://localhost:4000';

let seeded: { namespace: string; sessionId: string; question: string; answer: string; chatbotName: string };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const res = await fetch(`${API_BASE}/api/__test/seed-conversation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_USER.email }),
  });
  if (!res.ok) {
    throw new Error(`seed-conversation failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  seeded = await res.json();
});

async function signIn(page: Page) {
  await page.goto('/auth');
  await page.getByPlaceholder('you@example.com').fill(TEST_USER.email);
  await page.getByPlaceholder('••••••••').fill(TEST_USER.password);
  await page.getByRole('button', { name: /^Sign In$/ }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });
}

test('1. Conversations view renders the recorded message (not "No messages recorded")', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/conversations');

  // Pick the seeded chatbot so its sessions load.
  await page.locator('select').selectOption({ label: seeded.chatbotName });

  // The session shows up in the left list keyed by its first question.
  const sessionItem = page.getByText(seeded.question).first();
  await expect(sessionItem).toBeVisible({ timeout: 15_000 });
  await sessionItem.click();

  // The right pane must show the saved answer — proving /chat/history loaded.
  await expect(page.getByText(seeded.answer)).toBeVisible({ timeout: 15_000 });
  // And the empty-state must NOT be on screen.
  await expect(page.getByText('No messages recorded')).toHaveCount(0);
});

test('2. credentialed cross-origin GET /chat/history is readable by the browser (CORS)', async ({ page }) => {
  await signIn(page);
  // Run the exact request the dashboard makes — from the frontend origin, with
  // credentials. If CORS is misconfigured the browser rejects fetch entirely.
  const result = await page.evaluate(
    async ({ apiBase, sid }) => {
      try {
        const r = await fetch(`${apiBase}/api/chat/history/${sid}`, {
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
        });
        const json = await r.json();
        return { ok: r.ok, count: json.messages?.length ?? 0, error: null as string | null };
      } catch (e) {
        return { ok: false, count: 0, error: (e as Error).message };
      }
    },
    { apiBase: API_BASE, sid: seeded.sessionId },
  );

  expect(result.error).toBeNull();
  expect(result.ok).toBe(true);
  expect(result.count).toBeGreaterThan(0);
});
