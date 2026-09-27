import { test, expect, Page } from '@playwright/test';

// Visual + layout checks for the Fin-style embed widget, with all backend
// calls mocked so it runs without a database or a trained bot.

const BOT = {
  id: 'bot_demo',
  name: 'Acme Support',
  welcomeMessage: "Hi! I'm Acme Support. How can I help?",
  primaryColor: '#6B46C1',
  themeColor: '#6B46C1',
  showPoweredBy: true,
  leadConfig: { enabled: true, fields: ['name', 'email', 'phone'], required: ['email'], heading: 'Want our team to follow up? Leave your details:', successMessage: 'Thanks!' },
};

function sse(parts: { event: string; data: unknown }[]): string {
  return parts.map((p) => `event: ${p.event}\ndata: ${JSON.stringify(p.data)}\n\n`).join('');
}

async function mock(page: Page, opts: { conversations?: unknown[]; emitLead?: boolean } = {}) {
  await page.route('**/api/chatbots/public/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ chatbot: BOT }) }),
  );
  await page.route('**/api/chat/conversations**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ conversations: opts.conversations ?? [] }) }),
  );
  await page.route('**/api/chat/history/**', (r) =>
    r.fulfill({ contentType: 'application/json', body: JSON.stringify({ messages: [] }) }),
  );
  await page.route(/\/api\/chat(\?|$)/, (r) => {
    const events = [
      { event: 'sources', data: { sources: [] } },
      { event: 'delta', data: { content: 'Absolutely! We build custom AI agents. What area are you looking to improve?' } },
      ...(opts.emitLead ? [{ event: 'lead', data: BOT.leadConfig }] : []),
      { event: 'done', data: { sessionId: 's1', namespace: 'demo' } },
    ];
    r.fulfill({ contentType: 'text/event-stream', body: sse(events) });
  });
}

async function openWidget(page: Page) {
  await page.goto('/embed?token=demo');
  await page.getByRole('button', { name: 'Open chat' }).click();
}

// The whole widget panel is the fixed 400px container.
async function panel(page: Page) {
  return page.locator('div').filter({ hasText: 'Hello there.' }).last();
}

test('home view renders without overflow', async ({ page }) => {
  await mock(page);
  await openWidget(page);

  await expect(page.getByText('Hello there.')).toBeVisible();
  await expect(page.getByText('How can we help?')).toBeVisible();
  await expect(page.getByText('Send us a message')).toBeVisible();

  // Nothing should overflow the 400px-wide widget horizontally.
  const overflow = await page.evaluate(() => {
    const fixed = [...document.querySelectorAll('div')].find(
      (d) => getComputedStyle(d).position === 'fixed' && d.getBoundingClientRect().width > 360 && d.getBoundingClientRect().width < 420,
    );
    if (!fixed) return { found: false, overflow: 0 };
    const box = fixed.getBoundingClientRect();
    let maxRight = 0;
    fixed.querySelectorAll('*').forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      if (r.width > 0) maxRight = Math.max(maxRight, r.right);
    });
    return { found: true, overflow: Math.round(maxRight - box.right) };
  });
  console.log('home overflow px:', JSON.stringify(overflow));
  await page.screenshot({ path: 'test-results/widget-home.png' });
  expect(overflow.found).toBeTruthy();
  // Allow a couple px of sub-pixel rounding, but a clipped button is ~20px+.
  expect(overflow.overflow).toBeLessThan(6);
});

test('first message does NOT show the lead form (qualify first)', async ({ page }) => {
  await mock(page, { emitLead: false });
  await openWidget(page);
  await page.locator('button:has-text("Send us a message")').click();
  await page.getByPlaceholder('Ask a question...').fill("I'm interested in the AI service");
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Absolutely!', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'test-results/widget-chat-firstmsg.png' });
  // The form heading must NOT appear on the first turn.
  await expect(page.getByText('Leave your details', { exact: false })).toHaveCount(0);
  await expect(page.getByText('Want our team to follow up', { exact: false })).toHaveCount(0);
});

test('messages tab lists conversations', async ({ page }) => {
  await mock(page, {
    conversations: [
      { sessionId: 's1', title: 'Property Recommendations', preview: 'Hi there, this is Luis…', messageCount: 3, startedAt: new Date(0).toISOString(), lastActivityAt: new Date(0).toISOString() },
    ],
  });
  await openWidget(page);
  await page.getByRole('button', { name: 'Messages' }).click();
  await expect(page.getByText('Property Recommendations')).toBeVisible();
  await page.screenshot({ path: 'test-results/widget-messages.png' });
});
