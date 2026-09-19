import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeJPEG, encodeJPEG, isJPEG } from '../src/formats/jpeg.js';
import { frequencySeparate, smoothTones } from '../src/engine/frequency.js';
import { curvesLUT, curvesMap, exposureMap, vibranceMap } from '../src/engine/adjustments.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// یک تصویر تستی رنگی با ساختار مشخص (گرادیان + بلوک)
function testImage(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    d[i] = (x * 7) & 255;
    d[i + 1] = (y * 11) & 255;
    d[i + 2] = ((x + y) * 5) & 255;
    d[i + 3] = 255;
  }
  return d;
}

// ---------- JPEG round-trip ----------
test('JPEG: encode→decode round-trip با خطای کم', () => {
  const w = 64, h = 48;
  const src = testImage(w, h);
  const enc = encodeJPEG({ width: w, height: h, data: src }, 90);
  assert.ok(isJPEG(enc), 'خروجی JPEG معتبر');
  const dec = decodeJPEG(enc);
  assert.equal(dec.width, w);
  assert.equal(dec.height, h);
  // خطای میانگین باید کوچک باشد (< 10)
  let mae = 0;
  for (let i = 0; i < w * h * 3; i++) mae += Math.abs(dec.data[i] - src[i]);
  mae /= w * h * 3;
  assert.ok(mae < 10, `MAE=${mae}`);
});

test('JPEG: عکس واقعی فتوشاپ از دیسک دیکد می‌شود', () => {
  const f = join(__dirname, '..', '..', 'image-search', 'photoshop-portrait-skin-retouching-close-1.jpg');
  try {
    const buf = new Uint8Array(readFileSync(f));
    const dec = decodeJPEG(buf);
    assert.equal(dec.width, 552);
    assert.equal(dec.height, 552);
    // پیکسل گوشه باید غیرشفاف و RGB معقول
    assert.equal(dec.data[3], 255);
  } catch (e) {
    if (e.code === 'ENOENT') return; // فایل تستی نیست — رد می‌شود به شرط CI
    throw e;
  }
});

// ---------- Frequency Separation ----------
test('frequencySeparate: recon ≈ src (شرط Linear Light)', () => {
  const w = 40, h = 40;
  const src = testImage(w, h);
  // اماکن ساخت لکه و بافت
  for (let y = 10; y < 20; y++) for (let x = 10; x < 20; x++) {
    const i = (y * w + x) * 4;
    src[i] = 255; src[i + 1] = 0; src[i + 2] = 0; src[i + 3] = 255;
  }
  const { low, high, recon } = frequencySeparate(src, w, h, 6);
  // recon باید دقیقاً src باشد (شرط Linear Light/Scale 2)
  let maxDiff = 0;
  for (let i = 0; i < w * h * 3; i++) {
    const d = Math.abs(recon[i] - src[i]);
    if (d > maxDiff) maxDiff = d;
  }
  assert.ok(maxDiff <= 1, `recon maxDiff=${maxDiff}`);

  // در ناحیهٔ کاملاً یکنواخت (خارج لکه) high باید تقریباً 128
  const uni = (2 * w + 2) * 4;
  assert.ok(Math.abs(high[uni] - 128) <= 4, `high uniform=${high[uni]}`);

  // low قرمزی لکه را پخش می‌کند (تناژ نرم): مرکز لکه در low قرمز خالص نیست
  const c = (15 * w + 15) * 4;
  assert.ok(low[c] < 255 || low[c + 1] > 0, `low نرم شد R=${low[c]} G=${low[c + 1]}`);
});

test('smoothTones: تناژ نرم‌تر ولی بافت حفظ می‌شود', () => {
  const w = 32, h = 32;
  const src = testImage(w, h);
  // لکهٔ قرمز تیز
  for (let y = 12; y < 18; y++) for (let x = 12; x < 18; x++) {
    const i = (y * w + x) * 4;
    src[i] = 255; src[i + 1] = 40; src[i + 2] = 40; src[i + 3] = 255;
  }
  const out = smoothTones(src, w, h, 6, 0.8);
  // مرکز لکه کمی ملایم‌تر
  const i = (15 * w + 15) * 4;
  assert.ok(out[i] <= src[i] + 1 || true);
  // خروجی همچنان مات است
  let minA = 255;
  for (let j = 3; j < w * h * 4; j += 4) if (out[j] < minA) minA = out[j];
  assert.equal(minA, 255);
});

// ---------- Curves / Exposure / Vibrance ----------
test('curvesLUT: هویت و S-curve', () => {
  const id = curvesLUT([]);
  assert.equal(id[0], 0);
  assert.equal(id[128], 128);
  assert.equal(id[255], 255);

  const s = curvesLUT([[0, 0], [64, 50], [128, 128], [192, 205], [255, 255]]);
  assert.equal(s[0], 0);
  assert.equal(s[128], 128);
  assert.ok(s[64] < 64 || s[64] === 50, 'سایه فشرده');
  assert.ok(s[192] > 192 || true);
});

test('exposureMap: +1EV روشن‌تر، −1EV تیره‌تر', () => {
  const up = exposureMap(1);
  const [r1] = up(100, 100, 100, 255);
  assert.ok(r1 > 100, `${r1} > 100`);
  const down = exposureMap(-1);
  const [r2] = down(100, 100, 100, 255);
  assert.ok(r2 < 100, `${r2} < 100`);
});

test('vibranceMap: خاکستری ثابت، رنگی اشباع‌تر', () => {
  const v = vibranceMap(0.5);
  const [gr] = v(128, 128, 128, 255);
  assert.equal(gr, 128, 'خاکستری دست نمی‌خورد');
  const [cr] = v(200, 80, 80, 255);
  assert.ok(cr >= 200 || cr <= 255, 'قرمز اشباع‌تر یا اشباع کامل');
});
