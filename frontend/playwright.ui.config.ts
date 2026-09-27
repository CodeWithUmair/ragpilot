import { defineConfig, devices } from '@playwright/test';

// Lightweight, backend-free config for visual checks of the embed widget.
// All API calls are mocked via page.route, so only the Next dev server is
// needed (no DB, no Express). Kept separate from playwright.config.ts so it
// skips that config's globalSetup/teardown (which seed the database).
export default defineConfig({
  testDir: './e2e-ui',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    viewport: { width: 900, height: 800 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'pnpm dev',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
