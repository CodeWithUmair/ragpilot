import { test, expect, type Page } from '@playwright/test';
import { TEST_USER } from './fixtures';

// One serial suite — tests share state (plan changes persist between them).
test.describe.configure({ mode: 'serial' });

async function signIn(page: Page) {
  await page.goto('/auth');
  await page.getByPlaceholder('you@example.com').fill(TEST_USER.email);
  await page.getByPlaceholder('••••••••').fill(TEST_USER.password);
  await page.getByRole('button', { name: /^Sign In$/ }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });
}

test('1. signs in with seeded user and lands on the dashboard', async ({ page }) => {
  await signIn(page);
  expect(page.url()).toMatch(/\/(dashboard|onboarding)/);
});

test('2. /dashboard/settings shows current plan = Free', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await expect(page.getByText('Current:', { exact: false })).toContainText('Free');
});

test('3. clicks Upgrade to Pro and plan flips to Pro', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/settings');
  await page.getByTestId('plan-switch-pro').click();
  await expect(page.getByText('Upgraded to Pro').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Current:').first()).toContainText('Pro', { timeout: 10_000 });
});

test('4. switching back to Free downgrades', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/settings');
  // After test 3, plan is Pro — Free card now shows the switch button.
  await page.getByTestId('plan-switch-free').click();
  await expect(page.getByText('Switched to Free').first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Current:').first()).toContainText('Free', { timeout: 10_000 });
});
