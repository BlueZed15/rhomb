// Runs the Playwright tests, asking for the Rhombus test account at the prompt.
// Nothing is written to disk: the email and password only live in this process's environment.
// Usage: node scripts/run-tests.mjs [api|ui|all] [--login] [--fresh] [--record] [extra playwright args]
// If RHOMBUS_EMAIL / RHOMBUS_PASSWORD are already set (e.g. in CI), it doesn't ask.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { existsSync, unlinkSync } from 'node:fs';

// Reads one line from the keyboard, character by character. `hidden` echoes nothing (for the password).
// Re-asks on an empty answer, which also absorbs the stray \n some terminals send after \r.
function ask(label, hidden = false) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    let answer = '';
    process.stdout.write(label);
    stdin.setRawMode?.(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === '\u0003') process.exit(130); // Ctrl-C
        if (ch === '\r' || ch === '\n') {
          if (!answer.trim()) continue; // ignore empty Enters
          stdin.off('data', onData);
          stdin.setRawMode?.(false);
          stdin.pause();
          process.stdout.write('\n');
          return resolve(answer.trim());
        }
        if (ch === '\u007f' || ch === '\b') {
          if (answer) {
            answer = answer.slice(0, -1);
            if (!hidden) process.stdout.write('\b \b');
          }
          continue;
        }
        answer += ch;
        if (!hidden) process.stdout.write(ch);
      }
    };
    stdin.on('data', onData);
  });
}

const [suite = 'all', ...rest] = process.argv.slice(2);
const env = { ...process.env };
// A saved session (.auth/state.json) is reused by the setup step; pass --login to force a fresh one.
const forceLogin = rest.includes('--login');
if (rest.includes('--fresh')) env.JOURNEY_FRESH = '1'; // UI journey: redo every step instead of resuming
if (rest.includes('--record')) env.DEMO_VIDEO = '1'; // keep every test's video, for scripts/make-demo-video.mjs
const passthrough = rest.filter((a) => !['--login', '--fresh', '--record'].includes(a));
const hasSession = existsSync(fileURLToPath(new URL('../.auth/state.json', import.meta.url)));
if (forceLogin && hasSession) unlinkSync(fileURLToPath(new URL('../.auth/state.json', import.meta.url)));
if ((forceLogin || !hasSession) && (!env.RHOMBUS_EMAIL || !env.RHOMBUS_PASSWORD)) {
  console.log('Log in with a Rhombus TEST account (email + password sign-up, not GitHub/Google).');
  if (!env.RHOMBUS_EMAIL) env.RHOMBUS_EMAIL = await ask('Rhombus test account email: ');
  if (!env.RHOMBUS_PASSWORD) env.RHOMBUS_PASSWORD = await ask('Password (hidden, just type and press Enter): ', true);
  console.log('A browser window opens for the login. If it asks for an MFA code, type it there.');
}

// Run Playwright's CLI with this same node binary: no shell, so nothing is re-parsed.
const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
const args = ['test', ...(suite === 'all' ? [] : [`--project=${suite}`]), ...passthrough];
const child = spawn(process.execPath, [cli, ...args], { env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 1));
