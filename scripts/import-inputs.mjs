// Imports the baseline and every drift file into one Rhombus project, through "From Web URL" with a short-lived
// presigned S3 link each (the S3 connector is blocked: docs/decisions.md D9). Run it once, before the drift cases.
// It writes data-validation/rhombus-datasets.json, which says which Rhombus dataset holds which file.
//
// Usage:  node scripts/import-inputs.mjs <project id>
// It uses your installed Chrome with its own saved profile (.auth/rhombus-chrome, gitignored). If that profile isn't
// logged in yet, a normal Chrome window opens first (not driven by the script, so Google sign-in works): log in to
// Rhombus there and close that window. The script then carries on by itself. Links are signed for 15 minutes.
import 'dotenv/config';
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const ROOT = resolve(import.meta.dirname, '..');
const APP = process.env.RHOMBUS_BASE_URL || 'https://rhombusai.com';
const API = 'https://api.rhombusai.com/api';
const PROJECT = Number(process.argv[2]);
if (!PROJECT) throw new Error('Usage: node scripts/import-inputs.mjs <project id>');
for (const k of ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_SOURCE_BUCKET']) {
  if (!process.env[k]) throw new Error(`Set ${k} in .env`);
}

// Baseline first, so it becomes "Table 1.csv"; then the drift cases in order. S3 copies come from upload_dataset.py.
const CASES = ['baseline', 'schema-drift1-drop-column', 'schema-drift2-rename-column', 'schema-drift3-change-type',
  'schema-drift4-add-column', 'schema-drift5-combined', 'semantic-drift1-cents-to-dollars', 'semantic-drift2-date-mmdd'];

const s3 = new S3Client({ region: process.env.AWS_REGION });
const sign = (c) => getSignedUrl(s3, new GetObjectCommand({ Bucket: process.env.S3_SOURCE_BUCKET, Key: `input/archive/fuelcheck_${c}.xlsx` }), { expiresIn: 900 });

// Google sign-in refuses a browser that something is driving ("This browser may not be secure"), so the login
// happens in a plain Chrome window on the same profile, and the script only drives Chrome once it's logged in.
const PROFILE = join(ROOT, '.auth', 'rhombus-chrome');
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const launch = () => chromium.launchPersistentContext(PROFILE, {
  channel: 'chrome', headless: false, viewport: { width: 1440, height: 900 },
  ignoreDefaultArgs: ['--enable-automation'], args: ['--disable-blink-features=AutomationControlled'],
});
let ctx = await launch();
let page = ctx.pages()[0] || (await ctx.newPage());
await page.goto(`${APP}/workflow/${PROJECT}`);
if (!page.url().includes(`/workflow/${PROJECT}`)) {
  await ctx.close();
  console.log('Log in to Rhombus in the Chrome window that opens, then CLOSE that window. The script carries on by itself.');
  await new Promise((done) => spawn(CHROME, [`--user-data-dir=${PROFILE}`, '--no-first-run', `${APP}/workflow/${PROJECT}`], { stdio: 'ignore' }).on('exit', done));
  ctx = await launch();
  page = ctx.pages()[0] || (await ctx.newPage());
}
page.setDefaultTimeout(30_000);
await page.addLocatorHandler(page.getByText('Ad Blocker Detected'), async () => {
  await page.getByRole('button', { name: 'Continue Anyway' }).click({ force: true, timeout: 3_000 }).catch(() => {});
}, { noWaitAfter: true });

await page.goto(`${APP}/workflow/${PROJECT}`);
if (!page.url().includes(`/workflow/${PROJECT}`)) throw new Error('Still not logged in to Rhombus. Run the script again and log in in the plain Chrome window first.');

const token = async () => (await (await page.request.get(`${APP}/api/auth/session`)).json()).accessToken;
const datasets = async () => {
  const res = await page.request.get(`${API}/dataset/analyzer/v2/projects/${PROJECT}/datasets`, { headers: { Authorization: `Bearer ${await token()}` } });
  const body = await res.json();
  return (body.datasets || body).map((d) => ({ id: d.id, title: d.title }));
};

const fromWebUrl = page.getByRole('button', { name: 'From Web URL' });
async function openImport() {
  for (let i = 0; i < 10 && !(await fromWebUrl.isVisible()); i++) {
    const existing = page.locator('.react-flow__node').filter({ hasText: 'Data Input' });
    if (await existing.count()) await existing.first().click({ timeout: 5_000 }).catch(() => {});
    else {
      await page.locator('.react-flow').getByRole('button').filter({ has: page.locator('svg.lucide-plus') }).first().click({ timeout: 5_000 }).catch(() => {});
      await page.getByText('Data Input', { exact: true }).last().click({ timeout: 5_000 }).catch(() => {});
    }
    await fromWebUrl.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  }
  await fromWebUrl.click();
}

const out = [];
for (const c of CASES) {
  const before = new Set((await datasets()).map((d) => d.id));
  await openImport();
  const dialog = page.getByRole('dialog', { name: /Import from Web/ });
  await dialog.getByPlaceholder(/example\.com/).fill(await sign(c));
  await dialog.getByRole('button', { name: 'Fetch Page' }).click();
  await page.getByRole('button', { name: /Review Tables/i }).click({ timeout: 180_000 });
  await page.getByRole('button', { name: /^Import \d+ tables?$/i }).click();
  await page.getByText(/table imported successfully/i).first().waitFor({ timeout: 120_000 });
  let added = [];
  for (let i = 0; i < 30 && !added.length; i++) {
    added = (await datasets()).filter((d) => !before.has(d.id));
    if (!added.length) await page.waitForTimeout(2_000); // polling the API for the new dataset
  }
  if (added.length !== 1) throw new Error(`${c}: expected 1 new dataset, got ${added.length}`);
  out.push({ case: c, dataset_id: added[0].id, table: added[0].title, s3_key: `input/archive/fuelcheck_${c}.xlsx`, imported_at: new Date().toISOString() });
  console.log(`${c} -> dataset ${added[0].id} (${added[0].title})`);
  await page.keyboard.press('Escape').catch(() => {});
}

writeFileSync(join(ROOT, 'data-validation', 'rhombus-datasets.json'), JSON.stringify({ project_id: PROJECT, datasets: out }, null, 2) + '\n');
console.log('\nDone. Wrote data-validation/rhombus-datasets.json. You can close the browser.');
await ctx.close();
