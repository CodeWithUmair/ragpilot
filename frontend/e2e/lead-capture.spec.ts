// E2E: the full lead-capture pipeline, driven through the real widget.
//
//   visitor asks a buying-intent question → backend streams an answer (real
//   OpenAI call) and emits the SSE `lead` event → widget shows the form →
//   submit → lead lands in the dashboard, gets forwarded (owner email is
//   captured by the e2e inbox), and the Google Sheet tutorial + test buttons
//   work in the bot's settings.
import { test, expect, type Page } from '@playwright/test';
import { TEST_USER } from './fixtures';

const API = 'http://localhost:4000';
const VISITOR_EMAIL = 'visitor-e2e@e2e.test';

let namespace = '';
let chatbotId = '';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const res = await fetch(`${API}/api/__test/seed-analytics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_USER.email }),
  });
  if (!res.ok) throw new Error(`seed-analytics failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  namespace = body.namespace;
  chatbotId = body.chatbotId;
});

async function signIn(page: Page) {
  await page.goto('/auth');
  await page.getByPlaceholder('you@example.com').fill(TEST_USER.email);
  await page.getByPlaceholder('••••••••').fill(TEST_USER.password);
  await page.getByRole('button', { name: /^Sign In$/ }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 30_000 });
}

test('1. buying-intent question surfaces the lead form; submit thanks the visitor', async ({ page }) => {
  test.setTimeout(150_000); // includes a real OpenAI streaming round-trip

  await page.goto(`/embed?token=${namespace}&parentUrl=https://e2e.test/page`);
  await page.getByRole('button', { name: 'Open chat' }).click();

  const input = page.getByPlaceholder('Ask a question...');
  await expect(input).toBeVisible();
  await input.fill('What is your pricing? I would like to get started.');
  await input.press('Enter');

  // The lead form appears after the streamed answer completes.
  await expect(page.getByText('Want our team to follow up?')).toBeVisible({ timeout: 90_000 });

  await page.getByPlaceholder('Your name').fill('Playwright Visitor');
  await page.getByPlaceholder('Email address').fill(VISITOR_EMAIL);
  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(page.getByText('Thanks! Our team will get back to you shortly.')).toBeVisible({
    timeout: 15_000,
  });
});

test('2. the lead appears in the dashboard with a Forwarded badge', async ({ page }) => {
  await signIn(page);
  await page.goto('/dashboard/leads');

  await page.locator('select').selectOption({ label: 'E2E Analytics Bot' });
  // Newest lead first — the one the widget just submitted.
  await expect(page.getByText(VISITOR_EMAIL).first()).toBeVisible({ timeout: 20_000 });
  await page.getByText('Playwright Visitor').first().click();

  await expect(page.getByRole('link', { name: VISITOR_EMAIL })).toBeVisible();
  // forwardLead ran after the submit (owner email captured) → syncedAt set.
  await expect(page.getByText('Forwarded')).toBeVisible({ timeout: 20_000 });
});

test('3. the owner was notified by email (captured in the e2e inbox)', async () => {
  const res = await fetch(`${API}/api/__test/emails?to=${encodeURIComponent(TEST_USER.email)}`);
  expect(res.ok).toBeTruthy();
  const { emails } = (await res.json()) as { emails: { subject: string }[] };
  const leadMail = emails.find((e) => e.subject.includes('New lead from E2E Analytics Bot'));
  expect(leadMail, 'owner should receive a "New lead" notification email').toBeTruthy();
});

test('4. Google Sheet tutorial + forwarding test buttons work in bot settings', async ({ page }) => {
  await signIn(page);
  await page.goto(`/dashboard/chatbots/${chatbotId}`);
  await page.getByRole('button', { name: /customize/i }).click();

  // Lead capture is enabled by the seed, so the forwarding section is visible.
  // Open the step-by-step Google Sheet guide.
  await page.getByTestId('sheet-guide-toggle').click();
  const guide = page.getByTestId('sheet-guide-body');
  await expect(guide).toBeVisible();
  await expect(guide.getByText('Create (or open) a Google Sheet')).toBeVisible();
  await expect(guide.getByText('Deploy it as a web app')).toBeVisible();
  await expect(guide.getByText('function doPost(e)')).toBeVisible();
  // No sheet URL configured → test row button disabled with a hint.
  await expect(page.getByTestId('sheet-test-button')).toBeDisabled();
  await expect(guide.getByText('Paste your /exec URL above first.')).toBeVisible();

  // Owner-email test fires for real and is captured by the e2e inbox.
  await page.getByTestId('test-forward-email').click();
  await expect(page.getByText('Sent!')).toBeVisible({ timeout: 15_000 });

  const res = await fetch(`${API}/api/__test/emails?to=${encodeURIComponent(TEST_USER.email)}`);
  const { emails } = (await res.json()) as { emails: { subject: string }[] };
  const testMail = emails.find((e) => e.subject.includes('[Test] New lead from E2E Analytics Bot'));
  expect(testMail, 'test-forward email should be captured').toBeTruthy();
});
