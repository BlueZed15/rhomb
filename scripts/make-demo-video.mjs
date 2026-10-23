// Builds the demo video: a captioned walkthrough of the UI tests, API tests and data validation (setup, where
// credentials go, how to run each, what you see), played in a browser and recorded by Playwright. No voiceover.
// Everything shown comes from the repo; no real credential appears.
//
// Usage:  node scripts/make-demo-video.mjs            -> demo-video/rhombus-demo.webm
// Optional live footage: run the UI journey with `npm run test:ui -- --fresh --record` first. The clips of the
// steps that type no secrets (new project, AI builder, schedule) are then spliced in. The two steps that type a
// signed S3 link and the GCS key are never shown.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'demo-video');
const url = (p) => pathToFileURL(join(ROOT, p)).href;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- real data from the repo ---------------------------------------------------------------------------------
// .env.example as shown on screen: the lines you must fill in are highlighted, comments dimmed.
// (RHOMBUS_EMAIL/PASSWORD stay empty: they're typed at the prompt.)
const REQUIRED = /^(AWS_ACCESS_KEY_ID|AWS_SECRET_ACCESS_KEY|S3_SOURCE_BUCKET|RHOMBUS_GCS_KEY_FILE|GCS_OUTPUT_BUCKET)=/;
const envExample = readFileSync(join(ROOT, '.env.example'), 'utf8').trimEnd().split('\n')
  .filter((l) => !l.startsWith('# Copy to'))
  .map((l) => (l.startsWith('#') ? `<span class="dim">${esc(l)}</span>` : REQUIRED.test(l) ? `<span class="hl">${esc(l)}</span>` : esc(l)))
  .join('\n');

// Live clips from a `--record` run, if there is one (test-results/<test>/video.webm).
const clip = (needle) => {
  const dir = join(ROOT, 'test-results');
  if (!existsSync(dir)) return null;
  const hit = readdirSync(dir).find((d) => d.includes(needle) && existsSync(join(dir, d, 'video.webm')));
  return hit ? pathToFileURL(join(dir, hit, 'video.webm')).href : null;
};
const clips = [
  ['create-a-throwaway-project', 'Step 1 · create a new project'],
  ['one-Pipeline-prompt', 'Step 3 · one AI-builder prompt builds the cleaning steps (sped up)'],
  ['schedule-create-a-daily', 'Step 5 · create a daily schedule (sped up)'],
].map(([needle, caption]) => ({ src: clip(needle), caption })).filter((c) => c.src);

// ---- scene templates -----------------------------------------------------------------------------------------
const title = (big, small = '') => `<div class="center"><h1>${big}</h1><p class="sub">${small}</p></div>`;
const bullets = (head, items) => `<h2>${head}</h2><ul>${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;
const table = (head, rows, cols) =>
  `<h2>${head}</h2><table><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</table>`;
const terminal = (head, lines) => `<h2>${head}</h2><pre class="term">${lines.map((l) => esc(l)).join('\n')}</pre>`;
// The account email sits in the bottom-left corner of every Rhombus screen; .cover hides it.
const frame = (media) => `<span class="frame">${media}<span class="cover"></span></span>`;
const section = (n, name, what) => title(`${n} · ${name}`, what);

const scenes = [
  { secs: 5, html: title('Walkthrough', 'UI tests · API tests · data validation: set up, where credentials go, how to run, what you see') },
  {
    secs: 11,
    caption: 'The API tests need only the Rhombus account',
    html: table('What you need', [
      ['Node.js 20+ and Python 3.9+', 'all'],
      ['A Rhombus <b>test</b> account (email + password sign-up, not GitHub/Google)', 'API + UI tests'],
      ['An S3 bucket, and an IAM user that can read/write its <code>input/</code> folder', 'UI test + data scripts'],
      ['A GCS bucket, and the service-account key Rhombus writes with', 'UI test'],
    ], ['', 'Used by']),
  },
  {
    secs: 10,
    caption: 'Once, from the repo root · on Windows PowerShell use npm.cmd',
    html: terminal('One-time setup', [
      '$ npm ci                           # Playwright + the AWS SDK',
      '$ npx playwright install chromium',
      '$ pip install -r requirements.txt  # pandas, boto3, openpyxl',
      '$ cp .env.example .env             # then fill it in (next)',
      '$ python scripts/upload_dataset.py baseline   # puts the baseline in your bucket',
    ]),
  },
  {
    secs: 14,
    caption: 'Your Rhombus password is never in a file: you type it at the prompt',
    html: table('Where each credential goes', [
      ['Rhombus email + password', 'Typed at the prompt when a test run starts', 'Never stored'],
      ['MFA code (if Rhombus asks)', 'Typed into the browser window that opens', ''],
      ['Rhombus session', 'Saved to <code>.auth/state.json</code> and reused', 'Gitignored · <code>--login</code> to redo'],
      ['AWS access key', '<code>.env</code>', 'Gitignored'],
      ['GCS service-account key', 'A file outside the repo; its path goes in <code>.env</code>', 'Never enters the repo'],
    ], ['Credential', 'Where it goes', '']),
  },
  {
    secs: 14,
    caption: 'Fill in the yellow lines · RHOMBUS_EMAIL and RHOMBUS_PASSWORD stay empty: you type them at the prompt',
    html: `<h2>.env</h2><pre class="term small">${envExample}</pre>`,
  },
  {
    secs: 11,
    caption: 'First run only: after this the saved session is reused and nothing is asked',
    html: terminal('First run: the login prompt', [
      '$ npm run test:api',
      '',
      'Log in with a Rhombus TEST account (email + password sign-up, not GitHub/Google).',
      'Rhombus test account email: you@example.com',
      'Password (hidden, just type and press Enter):',
      'A browser window opens for the login. If it asks for an MFA code, type it there.',
    ]),
  },

  { secs: 4, html: section(1, 'API tests', 'api-tests/rhombus.api.spec.ts') },
  {
    secs: 14,
    caption: "All GET requests to Rhombus's own backend, so they're safe on a real account",
    html: table('What they check', [
      ['Usual', 'Project list keeps its fields; /context agrees', '<code>/dataset/projects/all</code>, <code>/{id}/context</code>'],
      ['Usual', 'A saved pipeline is wired correctly', '<code>/analyzer/v2/projects/{id}/nodes</code>'],
      ['Edge', '7 missing, forged or tampered tokens → 401', '<code>/dataset/projects/all</code>'],
      ['Edge', "Other customers' projects + 8 odd IDs → clean 4xx", 'all three project endpoints'],
      ['Known bug', 'Expected to fail until Rhombus fixes it (2 tests)', '<code>/datasets</code>, lowercase <code>bearer</code>'],
    ], ['Type', 'Test', 'Endpoint']),
  },
  {
    secs: 12,
    caption: '6 and 7 are known Rhombus bugs, written as tests that are expected to fail, so "ok" means the bug is still there',
    html: terminal('Run: npm run test:api   (about 15 s)', [
      '  ok 1 [setup] log in with the test account (1.6s)',
      '  ok 2 usual: the project list keeps its contract (292ms)',
      '  ok 3 usual: a saved pipeline is structurally sound (2.4s)',
      '  ok 4 edge: bad or forged credentials are rejected with 401 (260ms)',
      "  ok 5 edge: other customers' projects stay hidden, and odd ids fail safely (2.0s)",
      '  ok 6 known issues (expected to fail) › imported datasets keep the presigned S3 link, signature and all',
      '  ok 7 known issues (expected to fail) › a lowercase "bearer" scheme behaves like "Bearer"',
      '',
      '  7 passed (15.1s)',
      '',
      '$ npx playwright show-report      # every step of every test, in the browser',
    ]),
  },

  { secs: 4, html: section(2, 'UI test', 'ui-tests/pipeline-journey.spec.ts') },
  {
    secs: 12,
    caption: 'The test checks the AWS and GCS settings first, and stops in seconds if one is missing',
    html: bullets('Before you run it', [
      'The baseline is in your bucket (<code>python scripts/upload_dataset.py baseline</code>)',
      '<code>.env</code> has your AWS key and bucket, <code>RHOMBUS_GCS_KEY_FILE</code> and <code>GCS_OUTPUT_BUCKET</code>',
      'Your test account has a <b>free project slot</b> (the Free plan allows 3)',
      'It creates a project and leaves a daily schedule: <b>pause or delete them afterwards</b>',
    ]),
  },
  {
    secs: 14,
    caption: 'No fixed sleeps: every wait is on the API, a log line or a button appearing',
    html: table('What it does, and what it asserts', [
      ['1', 'Create a project', 'URL becomes /workflow/&lt;id&gt;'],
      ['2', 'Sign a 1-hour S3 link with your IAM key, import it (From Web URL)', '"table imported successfully"'],
      ['3', 'One AI-builder prompt with the 9 cleaning rules', 'API shows at least 10 steps'],
      ['4', 'Add the GCS destination from your key file, then run', 'Newest log line: "Pipeline completed successfully"'],
      ['5', 'Add a daily schedule', 'Card shows "Active" and "Next run"'],
    ], ['#', 'Step', 'Asserts']),
  },
  ...clips.map((c) => ({ clip: c.src, caption: c.caption, html: `<div class="shot">${frame('<video muted></video>')}</div>` })),
  ...(clips.length ? [{ secs: 5, caption: "Steps 2 and 4 type a signed link and a private key, so they aren't shown", html: title('Steps 2 and 4 not shown', 'They type credentials into Rhombus') }] : []),
  {
    secs: 14,
    caption: 'Tests 3 and 4 here reused an earlier run of the same test · --fresh redoes every step',
    html: terminal('Run: npm run test:ui   (3 to 10 min)', [
      '$ npm run test:ui                     # resumes a half-finished journey',
      '$ npm run test:ui -- --fresh          # redo every step',
      '$ npm run test:ui -- --fresh --record # also keep a video of each step',
      '',
      '  ok 1 [setup] log in with the test account (3.3s)',
      '  ok 2 create a throwaway project (5.0s)',
      '  ok 3 S3 source: import the baseline through a presigned link (5.0s)',
      '  ok 4 AI builder: one Pipeline prompt builds the cleaning nodes (4.7s)',
      '  ok 5 GCS destination: set it up in the output panel and run (2.0m)',
      '  ok 6 schedule: create a daily schedule (32.5s)',
      '  6 passed (3.0m)',
    ]),
  },

  { secs: 4, html: section(3, 'Data validation', 'data-validation/validate.py') },
  {
    secs: 18,
    caption: '"expected" is my 9 cleaning rules applied to the input · same row, but 8 September came out as 9 August',
    html: terminal('Run it: the input file and the output file', [
      '$ python data-validation/validate.py datasets/baseline.csv output_baseline.csv',
      '',
      '  input     2613 rows, 8 columns',
      '  expected  2401 rows',
      "  output    2363 rows, content sha256 d86f4143d7f92633 (rows sorted, so order doesn't matter)",
      '  rows      1630 match, 771 missing or different, 733 unexpected',
      '     missing    7-Eleven Albion Park Rail | … | U91 | 08/09/2026 10:54:15 | 213.9',
      '     unexpected 7-Eleven Albion Park Rail | … | U91 | 09/08/2026 10:54:15 | 213.9',
      "  semantic  {'dates_outside_source_month': 733, 'fuel_order_violations': 2}",
      '',
      '  FAIL',
      '   - 2363 rows out, 2401 expected',
      '   - 771 expected rows are missing or different',
      "   - 733 output rows aren't in the expected output",
      '   - semantic check dates outside source month: 733',
      '   - semantic check fuel order violations: 2',
    ]),
  },
  {
    secs: 15,
    caption: 'Prices sent in dollars: Rhombus reported success · the validator fails it (0 rows, 38 expected)',
    html: `<h2>What it checks</h2><div class="split">
      <ul class="small">
        <li>Schema: missing or extra columns</li>
        <li>Row counts, and which rows match</li>
        <li>Examples of the rows that differ</li>
        <li>sha256 of the output (repeatability)</li>
        <li>Prices in each fuel's normal range; dates in the right month and format</li>
        <li>No output at all? Use <code>--no-output</code></li>
      </ul>
      <pre class="term">$ python data-validation/validate.py \
    datasets/semantic-drift1-cents-to-dollars.csv output_semantic-drift1-cents-to-dollars.csv

  expected  38 rows
  output    0 rows

  FAIL
   - the output has 0 rows
   - 0 rows out, 38 expected
   - 38 expected rows are missing or different</pre></div>`,
  },
  {
    secs: 9,
    html: table('More detail', [
      ['Setting up AWS, GCS and Rhombus', '<code>docs/setup/</code>'],
      ['Each test, and why it was chosen', '<code>api-tests/README.md</code> · <code>ui-tests/README.md</code>'],
      ['Validation checks and every run\'s result', '<code>data-validation/README.md</code> · <code>results/</code>'],
      ['What I found', '<code>README.md</code> · <code>observations/</code>'],
    ], ['', 'Where']),
  },
];

// ---- stage ---------------------------------------------------------------------------------------------------
const css = `
  * { box-sizing: border-box } body { margin: 0; background: #0f1419; color: #e6e9ee; font: 22px/1.45 "Segoe UI", system-ui, sans-serif }
  #stage { position: absolute; inset: 0 0 72px 0; padding: 40px 64px; overflow: hidden }
  #cap { position: absolute; left: 0; right: 0; bottom: 0; height: 72px; background: #1b2430; border-top: 2px solid #2bb8c9;
         display: flex; align-items: center; padding: 0 64px; font-size: 22px; color: #fff }
  #cap:empty { display: none }
  h1 { font-size: 64px; margin: 0 0 12px } h2 { font-size: 34px; margin: 0 0 22px; color: #6fd6e3 }
  .center { height: 100%; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center }
  .sub { font-size: 26px; color: #9fb0c0; margin: 0 }
  ul { margin: 0; padding-left: 28px } li { margin: 14px 0 }
  table { border-collapse: collapse; width: 100%; font-size: 18px } th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #2a3542 }
  th { color: #9fb0c0; font-weight: 600 } .crit { color: #ff7a7a }
  code { background: #1b2430; padding: 1px 6px; border-radius: 4px }
  pre.term.small { font-size: 14px; line-height: 1.35; padding: 14px 20px } ul.small { font-size: 18px } .hl { color: #ffd166 } .dim { color: #6b7a89 }
  pre.term { background: #05080b; border: 1px solid #2a3542; border-radius: 8px; padding: 20px 24px; font: 18px/1.5 Consolas, monospace; color: #c9f2c7; margin: 0; white-space: pre-wrap }
  .shot { display: flex; justify-content: center; align-items: flex-start }
  .frame { position: relative; display: inline-block; line-height: 0; border: 1px solid #2a3542; border-radius: 6px; overflow: hidden }
  .frame img { max-width: 100%; max-height: 470px; display: block } .frame video { height: 470px; width: auto; display: block }
  .cover { position: absolute; left: 0; bottom: 0; width: 24%; height: 10%; background: #0f1419 }
  .split { display: grid; grid-template-columns: 1.3fr 1fr; gap: 28px; align-items: start } .split .frame img { max-height: 430px }`;
mkdirSync(OUT, { recursive: true });
const stagePath = join(OUT, 'stage.html');
writeFileSync(stagePath, `<!doctype html><meta charset="utf-8"><style>${css}</style><div id="stage"></div><div id="cap"></div>`);

const rawDir = join(OUT, 'raw');
rmSync(rawDir, { recursive: true, force: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: rawDir, size: { width: 1280, height: 720 } } });
const page = await context.newPage();
await page.goto(pathToFileURL(stagePath).href);

for (const [i, s] of scenes.entries()) {
  await page.evaluate(([html, cap]) => {
    document.getElementById('stage').innerHTML = html;
    document.getElementById('cap').textContent = cap || '';
  }, [s.html, s.caption]);
  if (s.clip) {
    // Live footage: play the recorded test clip, sped up, and move on when it ends.
    await page.evaluate(
      (src) =>
        new Promise((done) => {
          const v = document.querySelector('video');
          v.addEventListener('loadedmetadata', () => { v.playbackRate = v.duration > 40 ? 6 : 2; v.play(); });
          v.addEventListener('ended', done);
          v.addEventListener('error', done);
          setTimeout(done, 70_000); // cap any one clip
          v.src = src;
        }),
      s.clip,
    );
  } else {
    await page.waitForTimeout(s.secs * 1000); // a video, so fixed timing is the point here
  }
  console.log(`scene ${i + 1}/${scenes.length}`);
}

const video = page.video();
await context.close();
await browser.close();
const final = join(OUT, 'rhombus-demo.webm');
renameSync(await video.path(), final);
rmSync(rawDir, { recursive: true, force: true });
console.log(`\nSaved ${final}${clips.length ? ` (with ${clips.length} live clips)` : ' (no live clips: run the UI test with --record to add them)'}`);
