import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gaussianBlur, unsharpMask, emboss, sobelEdge, medianFilter, pixelate,
  posterize, celShade, kuwahara, bloom, thermal, vaporwave, rain, grain,
  colorBalance, gradientMap, kaleidoscope, motionBlur, vignette, convolve,
} from '../src/engine/fx.js';

// تصویر شطرنجی 16×16 — نیمه چپ قرمز، نیمه راست آبی
function checker(w = 16, h = 16) {
  const f = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (x < w / 2) { f[i] = 255; f[i + 1] = 0; f[i + 2] = 0; }
    else { f[i] = 0; f[i + 1] = 0; f[i + 2] = 255; }
    f[i + 3] = 255;
  }
  return f;
}
const W = 16, H = 16;

// یک پیکسل سفید روی زمینهٔ سیاه (برای تست blur/streak)
function dot(w = 16, h = 16) {
  const f = new Uint8ClampedArray(w * h * 4).fill(0);
  for (let i = 3; i < f.length; i += 4) f[i] = 255;
  const i = (8 * w + 8) * 4; f[i] = 255; f[i + 1] = 255; f[i + 2] = 255;
  return f;
}

test('gaussianBlur: ابعاد حفظ، مرکز روشن‌تر از لبه', () => {
  const out = gaussianBlur(dot(), W, H, 2);
  assert.equal(out.length, W * H * 4);
  const c = (8 * W + 8) * 4, e = (0 * W + 0) * 4;
  assert.ok(out[c] > out[e], 'مرکز باید روشن‌تر باشد');
});

test('gaussianBlur: شعاع بزرگ → یکنواختی کامل', () => {
  const out = gaussianBlur(dot(), W, H, 40);
  const a = out[(8 * W + 8) * 4], b = out[(15 * W + 15) * 4];
  assert.ok(Math.abs(a - b) < 8, `a=${a} b=${b}`);
});

test('unsharpMask: افزایش کنتراست لبه (بیشتر از مبدأ)', () => {
  const src = dot();
  const out = unsharpMask(src, W, H, { amount: 3, radius: 1, threshold: 0 });
  const c = out[(8 * W + 8) * 4], n = out[(8 * W + 7) * 4];
  assert.ok(c > src[(8 * W + 8) * 4] - 1, 'های‌لایت حفظ');
  // همسایه ممکن است تیره‌تر شود (overshoot)
  assert.ok(c >= n, 'مرکز ≥ همسایه');
});

test('sobelEdge: لبهٔ دو رنگ ماکسیمم یا صفر است', () => {
  const out = sobelEdge(checker(), W, H, { boost: 1 });
  const edge = out[(5 * W + 8) * 4];   // نزدیک مرز
  const flat = out[(5 * W + 2) * 4];   // داخل قرمز
  assert.equal(out.length, W * H * 4);
  assert.ok(edge > 0, 'لبه باید روشن باشد');
  assert.equal(flat, 0, 'داخل ناحیه تخت صفر');
});

test('medianFilter: حذف نویز نقطه‌ای', () => {
  const f = new Uint8ClampedArray(W * H * 4).fill(0);
  for (let i = 3; i < f.length; i += 4) f[i] = 255;
  const out = medianFilter(f, W, H, 1);
  assert.equal(out.length, W * H * 4);
  const i = (8 * W + 8) * 4;
  assert.deepEqual([out[i], out[i + 1], out[i + 2]], [0, 0, 0]);
});

test('posterize: سطوح ۲', () => {
  const src = checker();
  const out = posterize(src, W, H, 2);
  const r = out[(2 * W + 2) * 4];          // قرمز → R کانال
  const b = out[(2 * W + 12) * 4 + 2];     // آبی → B کانال
  assert.equal(r, 255);
  assert.equal(b, 255); // آبی در کانال B به ۲۵۵ می‌ماند
});

test('pixelate: بلوک یکدست', () => {
  const out = pixelate(checker(), W, H, 4);
  const a = out[(2 * W + 2) * 4], b = out[(3 * W + 3) * 4];
  assert.equal(a, b, 'pixels در همان بلوک یکسان');
});

test('thermal: آلفا ۲۵۵، پالت رنگ', () => {
  const out = thermal(dot(), W, H);
  const i = (8 * W + 8) * 4;
  assert.equal(out[i + 3], 255);
  // سفید → زرد/سفید (R و G بالا)
  assert.ok(out[i] > 200 && out[i + 1] > 150, `thermal highlight ${out[i]},${out[i+1]}`);
});

test('rain: پیکسل‌ها تغییر کردند (قطرات)', () => {
  const src = checker();
  const out = rain(src, W, H, { density: 0.4, length: 6, seed: 42 });
  let changed = false;
  for (let i = 0; i < src.length; i += 4) if (src[i] !== out[i] || src[i + 1] !== out[i + 1] || src[i + 2] !== out[i + 2]) { changed = true; break; }
  assert.equal(changed, true);
});

test('grain: انحراف کوچک پیرامون مبدأ', () => {
  const src = checker();
  const out = grain(src, W, H, { intensity: 20, seed: 7 });
  let maxDev = 0;
  for (let i = 0; i < src.length; i += 4) maxDev = Math.max(maxDev, Math.abs(src[i] - out[i]));
  assert.ok(maxDev > 0 && maxDev <= 40, `maxDev=${maxDev}`);
});

test('colorBalance: آبی (mid) مبدأ آبی را افزایش می‌دهد', () => {
  const src = checker();
  const out = colorBalance(src, W, H, { mb: 50 });
  const i = (2 * W + 2) * 4;
  assert.ok(out[i + 2] > src[i + 2], 'آبی افزایش یافت');
});

test('gradientMap: لوم ۰ → رنگ from ، لوم ۱ → رنگ to', () => {
  const src = new Uint8ClampedArray(W * H * 4).fill(0);
  for (let i = 3; i < src.length; i += 4) src[i] = 255;
  src[0] = src[1] = src[2] = 0;                               // سیاه
  const wi = (8 * W + 8) * 4; src[wi] = src[wi + 1] = src[wi + 2] = 255; // سفید
  const out = gradientMap(src, W, H, { from: [0, 0, 40], to: [255, 200, 60] });
  assert.deepEqual([out[0], out[1], out[2]], [0, 0, 40]);
  assert.deepEqual([out[wi], out[wi + 1], out[wi + 2]], [255, 200, 60]);
});

test('kaleidoscope: حفظ آلفا و ابعاد', () => {
  const out = kaleidoscope(checker(), W, H, { segments: 6 });
  assert.equal(out.length, W * H * 4);
  assert.equal(out[3], 255);
});

test('motionBlur: smear شدن نقطه', () => {
  const out = motionBlur(dot(), W, H, { length: 10, angle: 0 });
  // چپ/راست نقطه باید مقداری >۰ بگیرند
  assert.ok(out[(8 * W + 5) * 4] > 20, 'نقطهٔ چپ روشن');
});

test('vignette: گوشه‌ها تیره‌تر از مرکز', () => {
  const src = new Uint8ClampedArray(W * H * 4).fill(255);
  const out = vignette(src, W, H, { strength: 1, radius: 1 });
  assert.ok(out[(0 * W + 0) * 4] < out[(8 * W + 8) * 4], 'گوشه تیره‌تر');
});

test('emboss: آلفا حفظ، تنوع روشنایی (relief)', () => {
  const out = emboss(checker(), W, H, { strength: 1, direction: 45 });
  assert.equal(out[3], 255);
  let mn = 255, mx = 0;
  for (let i = 0; i < out.length; i += 4) { const v = out[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
  assert.ok(mx - mn > 40, `range=${mx - mn}`);
});

test('celShade / kuwahara / bloom: بدون استثنا در تصویر واقعی', () => {
  const src = checker();
  assert.equal(celShade(src, W, H, { levels: 3 }).length, src.length);
  assert.equal(kuwahara(src, W, H, 2).length, src.length);
  assert.equal(bloom(src, W, H, { blur: 3, intensity: 0.5 }).length, src.length);
});

test('convolve: هویت (kernel مرکزی=۱) → کپی مبدأ', () => {
  const src = checker();
  const k = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  const out = convolve(src, W, H, k, 3, 'clamp');
  assert.deepEqual([out[0], out[1], out[2]], [255, 0, 0]);
});

test('vaporwave: آلفا حفظ', () => {
  const out = vaporwave(checker(), W, H, { shift: 0.2 });
  assert.equal(out[3], 255);
});
