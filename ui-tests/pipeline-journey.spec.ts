import { test, expect, Page } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { API, bearer, getToken } from '../api-tests/helpers';

// The Part 1 journey on a throwaway project: S3 source → AI-built pipeline → GCS destination → schedule.
// No fixed sleeps: every wait is on something observable (a URL, a node count from the API, a log line).
//
// Two things are deliberately done by hand, the same as I did manually (docs/decisions.md D9, observations):
// - The S3 connector is blocked for this bucket, so the source is a presigned S3 link through "From Web URL".
// - The AI builder can't set a destination id, so the test picks the GCS destination in the output panel.

// Always the archived baseline, not the live input (which holds whichever drift case ran last).
// `python scripts/upload_dataset.py baseline` puts it there.
const SOURCE_KEY = process.env.UI_SOURCE_KEY || 'input/archive/fuelcheck_baseline.xlsx';
const DESTINATION = process.env.GCS_DESTINATION_NAME || process.env.GCS_OUTPUT_BUCKET;
const PROJECT_NAME = `qa-journey-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
// Reruns resume: steps already done in the journey project are verified, not redone. FRESH=1 (`--fresh`) redoes all.
const FRESH = !!process.env.JOURNEY_FRESH;

const CLEANING_PROMPT =
  'Build a cleaning pipeline for the dataset in the Data Input node. One node per rule, in order. ' +
  '1) Whitespace only: trim and collapse repeated spaces in text columns; do not change punctuation (261.9 stays 261.9). ' +
  '2) Drop rows where Price or FuelCode is empty. ' +
  '3) Map fuel names to codes (Ethanol 94->E10, Unleaded 91->U91, Premium 95->P95, Premium 98->P98, Diesel->DL), upper-case, keep only those codes. ' +
  '4) ALL CAPS brands -> the normal-case spelling if one exists. 5) Suburb to Title Case. ' +
  '6) Postcode: strip a trailing ".0", keep only 4-digit postcodes. 7) Price: strip a trailing "c", numeric, keep 100-400. ' +
  '8) PriceUpdatedDate as DD/MM/YYYY HH:MM:SS. 9) Remove exact duplicate rows. ' +
  `Then add a Data Output node at the end exporting CSV to the Google Cloud Storage destination ${DESTINATION}.`;

async function presignedSourceUrl(): Promise<string> {
  const s3 = new S3Client({ region: process.env.AWS_REGION });
  const cmd = new GetObjectCommand({ Bucket: process.env.S3_SOURCE_BUCKET, Key: SOURCE_KEY });
  return getSignedUrl(s3, cmd, { expiresIn: 3600 }); // 1 hour is plenty for one import
}

async function nodes(page: Page, projectId: number) {
  const token = await getToken(page.request);
  const res = await page.request.get(`${API}/dataset/analyzer/v2/projects/${projectId}/nodes`, { headers: bearer(token) });
  return Object.values(await res.json()) as Array<{ name: string; transformer_type: string; params: Record<string, unknown> }>;
}

// The canvas only renders nodes inside the viewport, so the output node of a long pipeline often isn't in the DOM.
// Node names in the AI builder's replies are buttons that open the node's panel, so click the output node's name
// (looked up through the API). Fallback: Ctrl+wheel zooms the canvas out until the node is drawn.
async function openOutputNode(page: Page) {
  const destinationPanel = page.getByText('Select Destination', { exact: true });
  await page.getByRole('tab', { name: 'AI Builder' }).click();
  // The chat shows the builder's own label for the node (e.g. data_output, gcs_export), not the API's
  // internal name (output_node_1), so match the label.
  const chatButton = page.getByRole('button', { name: /^[\w-]*(output|export)[\w-]*$/i }).last();
  if (await chatButton.isVisible().catch(() => false)) {
    await chatButton.click();
  } else {
    await page.getByRole('tab', { name: 'Canvas' }).click();
    const node = page.locator('.react-flow__node').filter({ hasText: 'Data Output' }).first();
    const canvas = page.locator('.react-flow').first();
    await expect(async () => {
      if (!(await node.isVisible())) {
        const box = (await canvas.boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.keyboard.down('Control');
        await page.mouse.wheel(0, 400); // Ctrl+wheel zooms; a plain wheel pans this canvas
        await page.keyboard.up('Control');
      }
      await node.click({ timeout: 1_000 });
    }).toPass({ timeout: 30_000 });
  }
  await expect(destinationPanel).toBeVisible();
}

test.describe.configure({ mode: 'serial' });

test.describe('Part 1 journey', () => {
  let projectId: number;

  // Fail in seconds, not halfway through, when the runner hasn't filled in their own AWS/GCS settings.
  test.beforeAll(() => {
    const needed = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'S3_SOURCE_BUCKET', 'RHOMBUS_GCS_KEY_FILE', 'GCS_OUTPUT_BUCKET'];
    const missing = needed.filter((k) => !process.env[k]);
    if (missing.length) throw new Error(`Set ${missing.join(', ')} in .env (your own accounts; see docs/setup/01-aws-s3.md and 02-gcp-gcs.md).`);
    if (!existsSync(process.env.RHOMBUS_GCS_KEY_FILE!)) throw new Error(`RHOMBUS_GCS_KEY_FILE not found: ${process.env.RHOMBUS_GCS_KEY_FILE}`);
  });

  // Rhombus shows an "Ad Blocker Detected" modal in automated Chromium (its trackers don't load). It can pop up
  // at any point and swallow clicks, so dismiss it whenever it appears rather than at a fixed step.
  test.beforeEach(async ({ page }) => {
    await page.addLocatorHandler(
      page.getByText('Ad Blocker Detected'),
      async () => {
        // The modal animates in and re-renders; force the click and never let the handler fail the test.
        await page.getByRole('button', { name: 'Continue Anyway' }).click({ force: true, timeout: 3_000 }).catch(() => {});
      },
      { noWaitAfter: true }, // it can pop up again straight away; don't block waiting for it to vanish
    );
  });

  test('create a throwaway project', async ({ page }) => {
    // The Free plan allows 3 projects, so reuse a journey project left by an earlier run: any one when resuming,
    // only an empty one with FRESH.
    const token = await getToken(page.request);
    const { items } = await (await page.request.get(`${API}/dataset/projects/all`, { headers: bearer(token) })).json();
    for (const p of items.filter((p: { name: string }) => p.name.startsWith('qa-journey-'))) {
      if (!FRESH || (await nodes(page, p.id)).length === 0) {
        projectId = p.id;
        test.info().annotations.push({ type: 'note', description: `reused project ${p.name} (${p.id})` });
        return;
      }
    }

    await page.goto('/');
    await page.getByRole('button', { name: 'New Project' }).click();
    const dialog = page.getByRole('dialog', { name: /Create New Project/ });
    // The Free plan caps projects at 3; Rhombus shows a "Free Plan Limit Reached" dialog instead of the form.
    const limit = page.getByText('Free Plan Limit Reached');
    await expect(dialog.or(limit)).toBeVisible();
    if (await limit.isVisible()) {
      throw new Error('Rhombus project limit reached (Free plan: 3). Delete an old qa-journey-… project, then rerun.');
    }
    await dialog.getByRole('textbox').fill(PROJECT_NAME);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/workflow\/\d+/);
    projectId = Number(page.url().match(/workflow\/(\d+)/)![1]);
  });

  test('S3 source: import the baseline through a presigned link', async ({ page }) => {
    const input = (await nodes(page, projectId)).find((n) => n.transformer_type === 'input');
    if (!FRESH && input?.params.dataset_id) {
      test.info().annotations.push({ type: 'note', description: `resumed: input already holds dataset ${input.params.dataset_id}` });
      return;
    }
    await page.goto(`/workflow/${projectId}`);
    // Add a Data Input from the canvas palette. Open-and-pick is retried as one unit: if the ad-blocker
    // modal pops up in between, dismissing it closes the palette too, so the whole thing has to restart.
    const fromWebUrl = page.getByRole('button', { name: 'From Web URL' });
    await expect(async () => {
      if (await fromWebUrl.isVisible()) return;
      const existing = page.locator('.react-flow__node').filter({ hasText: 'Data Input' });
      if (await existing.count()) {
        await existing.first().click({ timeout: 5_000 }); // reused project: open its input instead of adding another
      } else {
        await page.locator('.react-flow').getByRole('button').filter({ has: page.locator('svg.lucide-plus') }).first().click({ timeout: 5_000 });
        await page.getByText('Data Input', { exact: true }).last().click({ timeout: 5_000 });
      }
      await expect(fromWebUrl).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 90_000 });

    await fromWebUrl.click();
    const dialog = page.getByRole('dialog', { name: /Import from Web/ });
    await dialog.getByPlaceholder(/example\.com/).fill(await presignedSourceUrl());
    await dialog.getByRole('button', { name: 'Fetch Page' }).click();
    // Fetch Page → "Scraping Web Page" → Review Tables → Import. The dialog retitles itself as it goes, so the
    // buttons are found on the page. Scraping takes a while: wait for the button to appear, not a timer.
    await page.getByRole('button', { name: /Review Tables/i }).click({ timeout: 180_000 });
    await page.getByRole('button', { name: /^Import \d+ tables?$/i }).click(); // e.g. "Import 1 tables"
    await expect(page.getByText(/table imported successfully/i)).toBeVisible({ timeout: 120_000 });

    // The first table a project imports is selected and applied automatically (Apply stays disabled);
    // a later import needs selecting and applying by hand.
    const apply = page.getByRole('button', { name: 'Apply' });
    if (!(await page.locator('.react-flow__node').filter({ hasText: 'Table 1.csv' }).isVisible())) {
      await page.getByText('Table 1.csv', { exact: true }).click();
      if (await apply.isEnabled()) await apply.click();
    }
    await expect(page.locator('.react-flow__node').filter({ hasText: 'Table 1.csv' })).toBeVisible();
  });

  test('AI builder: one Pipeline prompt builds the cleaning nodes', async ({ page }) => {
    if (!FRESH && (await nodes(page, projectId)).length >= 10) {
      test.info().annotations.push({ type: 'note', description: 'resumed: pipeline already built' });
      return;
    }
    await page.goto(`/workflow/${projectId}`);
    await page.getByRole('tab', { name: 'AI Builder' }).click();
    const box = page.locator('textarea');
    await box.click();
    await box.pressSequentially('/pi');
    await box.press('Tab'); // turns into the "Pipeline" chip
    await expect(page.getByText('Pipeline', { exact: true }).first()).toBeVisible();
    await box.fill(CLEANING_PROMPT);
    await page.locator('button:has(svg.lucide-arrow-up)').click();

    // Done when the API shows input + cleaning nodes + output. The builder takes 1–3 minutes.
    await expect
      .poll(async () => (await nodes(page, projectId)).length, { timeout: 6 * 60_000, intervals: [10_000] })
      .toBeGreaterThanOrEqual(10);
  });

  test('GCS destination: set it up in the output panel and run', async ({ page }) => {
    await page.goto(`/workflow/${projectId}`);
    await openOutputNode(page);

    // Destinations belong to a project, so a fresh one has none: add GCS with the writer service account.
    // (Check for the destination's row, not the bare text: the builder's chat reply mentions the bucket name too.)
    // Named "Google Cloud Storage <bucket>" (icon alt + label); ending in the name skips "Delete <bucket> destination".
    const destinationRow = page.getByRole('button', { name: new RegExp(String.raw`Google Cloud Storage\s*` + DESTINATION + '$') });
    if (!(await destinationRow.isVisible())) {
      const keyFile = process.env.RHOMBUS_GCS_KEY_FILE!; // checked in beforeAll
      await page.getByText('Add New Destination', { exact: true }).click();
      await page.getByRole('dialog').getByText('Google Cloud Storage', { exact: true }).click();
      const dialog = page.getByRole('dialog', { name: /Add New Destination/ });
      await dialog.locator('textarea[name="service_account_json"]').fill(readFileSync(keyFile!, 'utf8'));
      await dialog.locator('input[name="bucket"]').fill(process.env.GCS_OUTPUT_BUCKET!);
      await dialog.getByRole('button', { name: 'Create Destination' }).click();
      await expect(dialog).toBeHidden({ timeout: 30_000 });
    }
    // The row is a button ("Google Cloud Storage <bucket>") with the radio dot inside; clicking the bare text
    // doesn't always select it.
    await destinationRow.click();
    // Apply saves and starts a run. If nothing changed (a resumed rerun), Apply is disabled: run with ▶ instead.
    const apply = page.getByRole('button', { name: 'Apply' });
    if (await apply.isEnabled()) await apply.click();
    else await page.locator('button:has(svg.lucide-play)').click();

    await expect
      .poll(async () => (await nodes(page, projectId)).find((n) => n.transformer_type === 'output')?.params.destination_id)
      .toEqual(expect.any(Number));

    await page.getByRole('button', { name: /^Logs/ }).click();
    // Logs are newest-first: the run Apply started must end in success, not a failure.
    // Wait for whichever comes first, then fail straight away on a failure instead of waiting out the timeout.
    const outcome = page.getByText(/^(Pipeline completed successfully|Pipeline failed.*)$/).first();
    await expect(outcome).toBeVisible({ timeout: 8 * 60_000 });
    expect(await outcome.innerText()).toBe('Pipeline completed successfully');
  });

  test('schedule: create a daily schedule', async ({ page }) => {
    await page.goto(`/workflow/${projectId}`);
    await page.getByRole('tab', { name: 'Schedule' }).click();
    await page.getByRole('button', { name: 'Add Schedule' }).click();
    const dialog = page.getByRole('dialog', { name: /Create Schedule/ });
    await expect(dialog.getByRole('combobox')).toHaveText(/Daily/); // default frequency
    await dialog.getByRole('button', { name: 'Create' }).click();
    // The very first "Create" once failed with "Network Error" during setup; a single failure shows up here.
    await expect(dialog).toBeHidden();
    await expect(page.getByText('No schedules found')).toHaveCount(0);
    // The card reads "Schedule for <project> · Active · Daily · Next run: …".
    await expect(page.getByText(/^Schedule for /).first()).toBeVisible();
    await expect(page.getByText('Active', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/^Next run:/).first()).toBeVisible();
  });

  // Cleanup is manual on purpose: deleting the project is permanent, so a test shouldn't do it unattended.
  test.afterAll(() => {
    console.log(`Journey project id ${projectId}: pause/delete its schedule and the project when done.`);
  });
});
