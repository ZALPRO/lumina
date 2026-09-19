// scripts/screenshot.mjs — capture real screenshots of the running editor
//
// Usage:  node scripts/screenshot.mjs [image.png] [--outdir=docs/screenshots]
//
// The script starts the static server if it is not already running, opens the
// real UI in headless Chromium, loads an image through the actual "Open" file
// input, and writes PNG screenshots. Nothing is mocked: what you see in the
// images is what the application renders.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const URL = 'http://localhost:4173/';
const args = process.argv.slice(2);
const outArg = args.find((a) => a.startsWith('--outdir='));
const OUTDIR = path.resolve(ROOT, outArg ? outArg.slice('--outdir='.length) : 'docs/screenshots');
const imageArg = args.find((a) => !a.startsWith('--'));
const IMAGE = imageArg ? path.resolve(imageArg) : path.resolve(ROOT, '..', 'uploads', 'image-1.png');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function portOpen(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(600) });
    return true;
  } catch {
    return false;
  }
}

async function startServer() {
  if (await portOpen(URL)) return null;
  const proc = spawn(process.execPath, [path.join(ROOT, 'scripts', 'serve.js')], {
    stdio: 'ignore',
    detached: true,
  });
  for (let i = 0; i < 40 && !(await portOpen(URL)); i++) await sleep(250);
  return proc;
}

async function shoot(page, name) {
  fs.mkdirSync(OUTDIR, { recursive: true });
  const file = path.join(OUTDIR, `${name}.png`);
  await page.screenshot({ path: file });
  const kb = (fs.statSync(file).size / 1024).toFixed(0);
  console.log(`  ${path.relative(ROOT, file)}  (${kb} KB)`);
}

const server = await startServer();
const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-gpu'] });

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await sleep(800);
  await shoot(page, 'editor-empty');

  if (fs.existsSync(IMAGE)) {
    const input = await page.$('#file-input');
    await input.uploadFile(IMAGE);
    await sleep(1800);
    await shoot(page, 'editor-open');

    // switch to the text tool so the options bar is visible in the shot
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.rail-btn[data-tool]')]
        .find((b) => b.getAttribute('data-tool') === 'text');
      if (btn) btn.click();
    });
    await sleep(500);
    await shoot(page, 'editor-text-tool');

    // back to brush, then open the export menu for the format list
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('.rail-btn[data-tool]')]
        .find((b) => b.getAttribute('data-tool') === 'brush');
      if (btn) btn.click();
    });
    await sleep(400);

    // open the demo layered PSD to show the layers panel with real PSD layers
    const layered = path.join(ROOT, 'docs', 'screenshots', 'sample-layered.psd');
    if (fs.existsSync(layered)) {
      await page.evaluate(() => { document.querySelector('#file-input').value = ''; });
      const li = await page.$('#file-input');
      await li.uploadFile(layered);
      await sleep(2500);
      const info = await page.evaluate(() => {
        const d = window.__lumina?.doc;
        return d ? { layers: d.layers.map((l) => l.name), size: [d.width, d.height] } : null;
      });
      console.log('  opened layered PSD in UI:', JSON.stringify(info));
      await shoot(page, 'editor-psd-layers');
    }
    console.log(`screenshots written by Lumina ${new Date().toISOString().slice(0, 10)}`);
  } else {
    console.warn(`  input image not found: ${IMAGE}`);
  }
} finally {
  await browser.close();
  if (server) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch { /* already gone */ }
  }
}
