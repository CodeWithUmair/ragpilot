// E2E: the full email-verification signup flow.
//
// signup → "check your inbox" → sign-in blocked (unverified banner) →
// read the captured verification email from the dev-only test inbox →
// click the link → verified landing → sign in successfully.
//
// Uses the backend's e2e inbox (GET /api/__test/emails) — the email service
// captures every send in non-production and never relays mail for the
// ragpilot.dev fixture domain, so no real mailbox is involved.
import { test, expect } from '@playwright/test';

const API = 'http://localhost:4000';
const VERIFY_USER = {
  email: 'e2e-verify@ragpilot.dev',
  password: 'verify-pass-12345',
  name: 'Verify Flow User',
};

test.describe.configure({ mode: 'serial' });

async function deleteVerifyUser() {
  await fetch(`${API}/api/__test/seed-user`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: VERIFY_USER.email }),
  }).catch(() => {});
}

test.beforeAll(deleteVerifyUser);
test.afterAll(deleteVerifyUser);

test('1. signup shows the "check your inbox" screen instead of signing in', async ({ page }) => {
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Sign Up' }).click();
  await page.getByPlaceholder('Your name').fill(VERIFY_USER.name);
  await page.getByPlaceholder('you@example.com').fill(VERIFY_USER.email);
  await page.getByPlaceholder('••••••••').fill(VERIFY_USER.password);
  await page.getByRole('button', { name: /^Sign Up$/ }).click();

  await expect(page.getByTestId('check-inbox')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('check-inbox')).toContainText(VERIFY_USER.email);
});

test('2. sign-in is blocked with an unverified banner before verification', async ({ page }) => {
  await page.goto('/auth');
  await page.getByPlaceholder('you@example.com').fill(VERIFY_USER.email);
  await page.getByPlaceholder('••••••••').fill(VERIFY_USER.password);
  await page.getByRole('button', { name: /^Sign In$/ }).click();

  await expect(page.getByTestId('unverified-banner')).toBeVisible({ timeout: 20_000 });
});

test('3. the emailed link verifies the account and sign-in then succeeds', async ({ page }) => {
  // Pull the newest captured verification email for this address.
  const res = await fetch(`${API}/api/__test/emails?to=${encodeURIComponent(VERIFY_USER.email)}`);
  expect(res.ok).toBeTruthy();
  const { emails } = (await res.json()) as { emails: { subject: string; html: string }[] };
  expect(emails.length).toBeGreaterThan(0);

  const verifyEmail = emails.find((e) => /verify/i.test(e.subject)) ?? emails[0];
  const match = verifyEmail.html.match(/href="([^"]*verify-email[^"]*)"/);
  expect(match, 'verification email must contain a verify-email link').toBeTruthy();
  const verifyUrl = match![1].replace(/&amp;/g, '&');

  await page.goto(verifyUrl);
  // autoSignInAfterVerification sets a same-site cookie in local dev, so the
  // verified landing usually bounces straight into the app (/dashboard →
  // /onboarding for a fresh account). Give that a moment; if no session was
  // established, we stay on the verified card and sign in by hand.
  let inApp = true;
  try {
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 20_000 });
  } catch {
    inApp = false;
  }

  if (!inApp) {
    await expect(page.getByText('Email verified!')).toBeVisible();
    await page.getByRole('button', { name: 'Continue to sign in' }).click();
    await page.waitForURL(/\/auth/);
    await page.getByPlaceholder('you@example.com').fill(VERIFY_USER.email);
    await page.getByPlaceholder('••••••••').fill(VERIFY_USER.password);
    await page.getByRole('button', { name: /^Sign In$/ }).click();
    await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });
  }

  // Fresh account, onboarding not completed → the app routes to /onboarding
  // (or briefly /dashboard while the flag loads). Either proves the login.
  expect(page.url()).toMatch(/\/(dashboard|onboarding)/);
});
