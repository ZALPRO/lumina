// scripts/run-tests.mjs — portable test entry point
//
// Why this exists: `node --test test/` accepted a directory argument in Node 20
// but not in newer releases (and never expanded globs on Windows), so CI failed
// on Node 22 / macOS / Windows. Enumerating the files here keeps `npm test`
// identical on every platform and Node version.
//
// Usage:
//   node scripts/run-tests.mjs            # every suite (unit + browser)
//   node scripts/run-tests.mjs --unit     # skip the headless-browser suite
//   node scripts/run-tests.mjs --browser  # only the headless-browser suite

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TEST_DIR = path.join(ROOT, 'test');

const args = process.argv.slice(2);
const onlyUnit = args.includes('--unit');
const onlyBrowser = args.includes('--browser');

const all = fs.readdirSync(TEST_DIR)
  .filter((f) => f.endsWith('.test.js') || f === 'browser.e2e.js')
  .sort();

const unit = all.filter((f) => f.endsWith('.test.js'));
const browser = all.filter((f) => f === 'browser.e2e.js');

let files = all;
if (onlyUnit) files = unit;
else if (onlyBrowser) files = browser;

if (!files.length) {
  console.error('no test files found in', TEST_DIR);
  process.exit(1);
}

const list = files.map((f) => path.join('test', f));
console.log(`running ${list.length} test file(s): ${list.join(', ')}\n`);

// --test-timeout: هیچ تستی نباید اجراکننده را برای همیشه معلق کند (پیش‌فرض: بی‌نهایت).
const child = spawn(process.execPath, ['--test', '--test-timeout=120000', ...list], {
  cwd: ROOT,
  stdio: 'inherit',
});
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
