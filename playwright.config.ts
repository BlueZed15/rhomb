import { defineConfig } from '@playwright/test';
import 'dotenv/config';

// The setup project logs in once with a test account from .env and saves the session to .auth/state.json
// (gitignored). The api and ui projects reuse it, so nothing logs in twice.
const storageState = '.auth/state.json';

export default defineConfig({
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  retries: 0, // flakiness should show up, not get retried away
  projects: [
    {
      name: 'setup',
      testDir: '.',
      testMatch: 'auth.setup.ts',
      timeout: 5 * 60_000, // leaves time to type an MFA code by hand
      // Headed locally so a person can answer MFA; headless in CI, where RHOMBUS_TOTP_SECRET answers it.
      use: { headless: !!process.env.CI },
    },
    {
      name: 'api',
      testDir: 'api-tests',
      dependencies: ['setup'],
      use: { storageState },
    },
    {
      name: 'ui',
      testDir: 'ui-tests',
      dependencies: ['setup'],
      timeout: 15 * 60_000, // the AI builder and a full pipeline run take minutes
      use: {
        storageState,
        baseURL: process.env.RHOMBUS_BASE_URL || 'https://rhombusai.com',
        viewport: { width: 1440, height: 900 },
        // A blocked click should fail in seconds, not use up the whole 15-minute test budget.
        actionTimeout: 30_000,
        navigationTimeout: 60_000,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        // --record (DEMO_VIDEO=1) keeps every test's video for the demo; otherwise only failures are kept.
        video: process.env.DEMO_VIDEO ? 'on' : 'retain-on-failure',
      },
    },
  ],
});
