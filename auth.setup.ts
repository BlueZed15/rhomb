import { test as setup, expect } from '@playwright/test';
import { authenticator } from 'otplib';
import 'dotenv/config';
import { existsSync } from 'node:fs';

// Logs in once with a dedicated Rhombus test account (email + password from .env) and saves the session
// for the api and ui projects. Social logins (GitHub/Google) refuse automated browsers, so they're not used.
const STATE = '.auth/state.json';

setup('log in with the test account', async ({ page, playwright }) => {
  // Reuse a saved session while it's still valid, so reruns don't ask for the login again.
  if (existsSync(STATE)) {
    const ctx = await playwright.request.newContext({ storageState: STATE });
    const res = await ctx.get(`${process.env.RHOMBUS_BASE_URL || 'https://rhombusai.com'}/api/auth/session`);
    const saved = res.ok() ? await res.json() : {};
    // The session endpoint can still hand out a token the backend has stopped accepting, so try it once.
    const works = saved.accessToken
      ? (await ctx.get('https://api.rhombusai.com/api/dataset/projects/all', { headers: { Authorization: `Bearer ${saved.accessToken}` } })).ok()
      : false;
    await ctx.dispose();
    if (works) return;
  }

  const email = process.env.RHOMBUS_EMAIL;
  const password = process.env.RHOMBUS_PASSWORD;
  // Fail rather than skip: a skipped login would let the other projects run without a session.
  expect(email && password, 'No test account: run `npm run test:api` and enter it at the prompt.').toBeTruthy();

  // A logged-out visit redirects straight to Rhombus's hosted (Auth0) login page.
  await page.goto(`${process.env.RHOMBUS_BASE_URL || 'https://rhombusai.com'}/get-started`);
  const emailBox = page.getByRole('textbox', { name: 'Email address' });
  await expect(emailBox).toBeVisible({ timeout: 30_000 });

  await emailBox.fill(email!);
  await page.getByRole('textbox', { name: 'Password' }).fill(password!);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();

  // Wrong password: fail fast with Auth0's own message instead of a timeout.
  const loginError = page.getByText(/wrong email or password|invalid|incorrect|blocked/i);
  const left = page.waitForURL((u) => u.hostname === 'rhombusai.com', { timeout: 30_000 }).then(() => 'in');
  const err = loginError.first().waitFor({ timeout: 30_000 }).then(() => 'error');
  if ((await Promise.race([left, err]).catch(() => 'timeout')) === 'error') {
    throw new Error(`Login rejected: ${await loginError.first().innerText()}`);
  }

  // MFA: with an authenticator secret (CI), answer it here; otherwise the person running the tests types
  // the code into the (headed) login window, and we wait for them.
  if (new URL(page.url()).hostname !== 'rhombusai.com') {
    const otp = page.getByRole('textbox', { name: /code/i });
    if (process.env.RHOMBUS_TOTP_SECRET && (await otp.isVisible().catch(() => false))) {
      await otp.fill(authenticator.generate(process.env.RHOMBUS_TOTP_SECRET));
      await page.getByRole('button', { name: 'Continue', exact: true }).click();
    } else {
      console.log('Waiting for the MFA code to be entered in the login window (up to 3 minutes)...');
    }
    await page.waitForURL((u) => u.hostname === 'rhombusai.com', { timeout: 3 * 60_000 });
  }

  await expect(page).toHaveURL(/rhombusai\.com\/(?!get-started)/, { timeout: 30_000 });
  const session = await page.request
    .get(`${process.env.RHOMBUS_BASE_URL || 'https://rhombusai.com'}/api/auth/session`)
    .then((r) => r.json());
  expect(session.accessToken, 'logged in but no session token').toBeTruthy();
  await page.context().storageState({ path: STATE });
});
