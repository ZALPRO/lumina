import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { encodeQoi, decodeQoi } from '../src/formats/qoi.js';
import { encodePng, decodePng } from '../src/formats/png.js';
import { encodeBmp, decodeBmp } from '../src/formats/bmp.js';

const REF = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ref');
// دودویی مرجع QOI فقط روی لینوکس ساخته می‌شود (CI آن را کامپایل می‌کند)؛ روی
// سکوهای دیگر این دو تست interop رد می‌شوند و بقیهٔ تست‌ها اجرا می‌شوند.
const REF_CLI = path.join(REF, 'qoi_ref_cli');
const hasRefCli = existsSync(REF_CLI);

// ---------- تصویر تست قطعی (پوشش run/diff/luma/index/rgba/rgb) ----------
function makeTestImage(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // مخلوط: ناحیه‌های صاف (RUN) + گرادیان (DIFF/LUMA) + پیکسل تصادفی (RGB/RGBA)
      if (x < w / 3) {
        data[i] = 200; data[i + 1] = 40; data[i + 2] = 40; data[i + 3] = 255;   // صاف
      } else if (x < (2 * w) / 3) {
        data[i] = (x * 255 / w) | 0; data[i + 1] = (y * 255 / h) | 0; data[i + 2] = 100; data[i + 3] = 255; // گرادیان
      } else {
        data[i] = (rnd() * 255) | 0; data[i + 1] = (rnd() * 255) | 0; data[i + 2] = (rnd() * 255) | 0;
        data[i + 3] = (rnd() * 255) | 0; // آلفای متغیر → مسیر RGBA و آپدیت آلفا
      }
    }
  }
  return data;
}

function assertPixelsEqual(a, b, w, h, label) {
  for (let i = 0; i < w * h * 4; i++) {
    assert.equal(a[i], b[i], `${label}: پیکسل ${i >> 2} کانال ${i & 3}`);
  }
}

// ---------- QOI: interop با مرجع رسمی C ----------
test('QOI: encode من → decode مرجع C (دوطرفه)', { skip: hasRefCli ? false : 'qoi_ref_cli ساخته نشده (نیاز به cc روی لینوکس)' }, async () => {
  const w = 79, h = 57;
  const img = makeTestImage(w, h);
  const encoded = encodeQoi({ width: w, height: h, data: img });

  const qoiFile = path.join(REF, 'mine.qoi');
  const rawFile = path.join(REF, 'decoded_by_ref.raw');
  const fs = await import('node:fs');

  fs.writeFileSync(qoiFile, Buffer.from(encoded));
  execFileSync(REF_CLI, ['decode', qoiFile, rawFile]);

  const raw = fs.readFileSync(rawFile);
  const rw = raw.readUInt32BE(0), rh = raw.readUInt32BE(4);
  assert.equal(rw, w); assert.equal(rh, h);
  const refPixels = raw.subarray(12);
  assertPixelsEqual(img, refPixels, w, h, 'QOI enc→ref dec');
});

test('QOI: encode مرجع C → decode من', { skip: hasRefCli ? false : 'qoi_ref_cli ساخته نشده (نیاز به cc روی لینوکس)' }, async () => {
  const w = 80, h = 60;
  const img = makeTestImage(w, h);
  const fs = await import('node:fs');
  const pixFile = path.join(REF, 'in.pix');
  fs.writeFileSync(pixFile, Buffer.from(img));

  const qoiFile = path.join(REF, 'ref_encoded.qoi');
  execFileSync(REF_CLI, ['encode', pixFile, qoiFile, String(w), String(h), '4']);

  const encodedByRef = new Uint8Array(fs.readFileSync(qoiFile));
  const mine = decodeQoi(encodedByRef);
  assert.equal(mine.width, w); assert.equal(mine.height, h);
  assertPixelsEqual(img, mine.data, w, h, 'QOI ref enc→my dec');
});

test('QOI: roundtrip خودم (با آلفای متغیر)', () => {
  const w = 33, h = 26;
  const img = makeTestImage(w, h);
  const enc = encodeQoi({ width: w, height: h, data: img });
  const dec = decodeQoi(enc);
  assertPixelsEqual(img, dec.data, w, h, 'QOI roundtrip');
});

test('QOI: rejected امضای غلط', () => {
  assert.throws(() => decodeQoi(new Uint8Array([1, 2, 3, 4, 0, 0, 0, 4, 0, 0, 0, 2, 4, 0, 0, 0, 0, 0, 0, 0, 1])), /QOI/);
});

// ---------- PNG: interop با pngjs ----------
test('PNG: encode من → decode با pngjs', async () => {
  const w = 64, h = 48;
  const img = makeTestImage(w, h);
  const { PNG } = await import('pngjs');
  const enc = await encodePng({ width: w, height: h, data: img });
  const png = PNG.sync.read(Buffer.from(enc));
  assert.equal(png.width, w); assert.equal(png.height, h);
  assertPixelsEqual(img, png.data, w, h, 'PNG enc→pngjs dec');
});

test('PNG: decode من → encode شده با pngjs', async () => {
  const w = 60, h = 40;
  const img = makeTestImage(w, h);
  const { PNG } = await import('pngjs');
  const png = new PNG({ width: w, height: h });
  png.data.set(img);
  const buf = PNG.sync.write(png);
  const mine = await decodePng(new Uint8Array(buf));
  assert.equal(mine.width, w); assert.equal(mine.height, h);
  // پیکسل به‌پیکسل (با آلفا، چون pngjs آلفا را دقیق می‌نویسد)
  assertPixelsEqual(img, mine.data, w, h, 'PNG pngjs enc→my dec');
});

test('PNG: roundtrip خودم', async () => {
  const w = 50, h = 50;
  const img = makeTestImage(w, h);
  const enc = await encodePng({ width: w, height: h, data: img });
  const dec = await decodePng(enc);
  assertPixelsEqual(img, dec.data, w, h, 'PNG roundtrip');
});

test('PNG: امضای نامعتبر رد می‌شود', async () => {
  await assert.rejects(() => decodePng(new Uint8Array(20)), /PNG/);
});

// ---------- BMP ----------
test('BMP: roundtrip ۳۲ بیتی', () => {
  const w = 40, h = 30;
  const img = makeTestImage(w, h);
  const enc = encodeBmp({ width: w, height: h, data: img });
  const dec = decodeBmp(enc);
  assert.equal(dec.width, w); assert.equal(dec.height, h);
  assertPixelsEqual(img, dec.data, w, h, 'BMP roundtrip');
});

test('BMP: امضای غلط رد می‌شود', () => {
  assert.throws(() => decodeBmp(new Uint8Array(64)), /BMP/);
});
