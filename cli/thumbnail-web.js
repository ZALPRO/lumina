// cli/thumbnail-web.js — رندر thumbnail حرفه‌ای یوتیوب با فونت واقعی + دو سوژه
// استفاده:
//   node cli/thumbnail-web.js <bg> <subject> <food> <out.png> <"عنوان"> <"زیرنویس"> <"برند">
// خروجی: PNG 1280×720
import puppeteer from 'puppeteer';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, '..');
const toDataUrl = (p) => 'data:image/png;base64,' + fs.readFileSync(p).toString('base64');

async function main() {
  const bgFile = process.argv[2];
  const subjFile = process.argv[3];
  const foodFile = process.argv[4];
  const outName = process.argv[5] || 'out/thumbnail-web.png';
  const title = process.argv[6] || 'بهترین فست فود ایران';
  const sub = process.argv[7] || '';
  const brand = process.argv[8] || '';

  const titleFa = /[\u0600-\u06FF]/.test(title); // تشخیص فارسی

  const browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });
  const htmlPath = 'file://' + join(appRoot, 'ui', 'render-thumb.html');
  await page.goto(htmlPath, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);

  const dataUrl = await page.evaluate(async ({ bg, subj, food, title, sub: subb, titleFa, brand }) => {
    return await window.renderThumb({
      bgUrl: bg, subjUrl: subj, foodUrl: food,
      title, sub: subb, titleFa, brand
    });
  }, {
    bg: toDataUrl(bgFile),
    subj: toDataUrl(subjFile),
    food: foodFile ? toDataUrl(foodFile) : null,
    title, sub, titleFa, brand
  });

  const base64 = dataUrl.split(',')[1];
  const outPath = join(appRoot, outName);
  fs.writeFileSync(outPath, Buffer.from(base64, 'base64'));
  console.log(`thumbnail → ${outName} (${fs.statSync(outPath).size} bytes, 1280×720)`);
  await browser.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
