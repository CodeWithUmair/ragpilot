// E2E: the analytics dashboard renders seeded data and reacts to filters.
//
// seed-analytics creates "E2E Analytics Bot" with 8 sessions / 15 messages /
// 3 leads spread over the last ~12 days, so the 30-day view has exact totals
// and the 7-day view must show strictly fewer conversations.
import { test, expect, type Page } from '@playwright/test';
import { TEST_USER } from './fixtures';

const API = 'http://localhost:4000';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const res = await fetch(`${API}/api/__test/seed-analytics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_USER.email }),
  });
  if (!res.ok) throw new Error(`seed-analytics failed: ${res.status} ${await res.text()}`);
});

async function signIn(page: Page) {
  await page.goto('/auth');
  await page.getByPlaceholder('you@example.com').fill(TEST_USER.email);
  await page.getByPlaceholder('••••••••').fill(TEST_USER.password);
  await page.getByRole('button', { name: /^Sign In$/ }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });
}

test('1. analytics page shows seeded totals, charts, and top questions', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/analytics');

  await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible();

  // Exact totals from the seed (30-day default range covers all of it).
  await expect(page.getByTestId('stat-Conversations').getByTestId('stat-value')).toHaveText('8', { timeout: 20_000 });
  await expect(page.getByTestId('stat-Messages').getByTestId('stat-value')).toHaveText('15');
  await expect(page.getByTestId('stat-Leads captured').getByTestId('stat-value')).toHaveText('3');

  // Charts actually rendered (recharts mounts an svg.recharts-surface).
  await expect(page.locator('.recharts-surface').first()).toBeVisible();

  // Top questions list surfaces the most frequent seeded question.
  await expect(page.getByText('What services do you offer?').first()).toBeVisible();
});

test('2. date-range filter narrows the data', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/analytics');
  await expect(page.getByTestId('stat-Conversations').getByTestId('stat-value')).toHaveText('8', { timeout: 20_000 });

  await page.getByTestId('analytics-range-7d').click();
  // Sessions are spaced 1.5 days apart → only ~4 fall inside the last 7 days.
  await expect
    .poll(async () => Number(await page.getByTestId('stat-Conversations').getByTestId('stat-value').textContent()), {
      timeout: 20_000,
    })
    .toBeLessThan(8);
});

test('3. chatbot filter scopes the data to one bot', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/analytics');

  await page.getByTestId('analytics-bot-filter').selectOption({ label: 'E2E Analytics Bot' });
  await expect(page.getByTestId('stat-Conversations').getByTestId('stat-value')).toHaveText('8', { timeout: 20_000 });
  // Per-bot table lists the bot. (Scope to the table — bare getByText would
  // also match the hidden <option> inside the filter select.)
  await expect(page.getByTestId('bots-card')).toBeVisible();
  await expect(page.getByTestId('bots-card')).toContainText('E2E Analytics Bot');
});
