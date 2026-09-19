import test from 'node:test';
import assert from 'node:assert/strict';
import {
  grayscale, invert, brightnessContrast, threshold, sepia, boxBlur,
} from '../src/engine/filters.js';

function imgFrom(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const [r, g, b, a] = fn(x, y);
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = a;
  }
  return d;
}

test('grayscale: قرمز → 54 (0.2126 * 255)', () => {
  const d = imgFrom(2, 2, () => [255, 0, 0, 255]);
  const out = grayscale(d, 2, 2);
  assert.equal(out[0], 54); assert.equal(out[1], 54); assert.equal(out[2], 54);
  assert.equal(out[3], 255);
});

test('invert: 200 → 55، آلفا حفظ', () => {
  const d = imgFrom(1, 1, () => [200, 100, 0, 128]);
  const out = invert(d, 1, 1);
  assert.deepEqual([...out], [55, 155, 255, 128]);
});

test('brightnessContrast: هویت (0,0)', () => {
  const d = imgFrom(4, 4, (x, y) => [x * 40, y * 40, 100, 255]);
  const out = brightnessContrast(d, 4, 4, 0, 0);
  for (let i = 0; i < d.length; i++) assert.equal(out[i], d[i]);
});

test('brightnessContrast: +0.5 شدت ناقص وسط', () => {
  const d = imgFrom(1, 1, () => [0, 0, 0, 255]);
  const out = brightnessContrast(d, 1, 1, 0.5, 0);
  assert.equal(out[0], 128); // 0 + 128 با فرمول فتوشاپ
});

test('brightnessContrast: clamp بالا، کنتراست مضاعف', () => {
  const d = imgFrom(1, 1, () => [200, 200, 200, 255]);
  const out = brightnessContrast(d, 1, 1, 0.5, 0);
  assert.equal(out[0], 255); // 200+128 → clamp
});

test('threshold: میانه ۱۲۸', () => {
  const d = imgFrom(2, 1, (x) => [x === 0 ? 100 : 200, x === 0 ? 100 : 200, x === 0 ? 100 : 200, 255]);
  const out = threshold(d, 2, 1, 128);
  assert.equal(out[0], 0);    // 100 < 128
  assert.equal(out[4], 255);  // 200 ≥ 128
});

test('sepia: مشکی سیاه، سفید سفید (کلاسیک)', () => {
  const d = imgFrom(1, 1, () => [255, 255, 255, 255]);
  const out = sepia(d, 1, 1);
  assert.equal(out[0], 255);
});

test('boxBlur: هموار ثابت می‌ماند', () => {
  const d = imgFrom(8, 8, () => [100, 50, 200, 255]);
  const out = boxBlur(d, 8, 8, 2);
  for (let i = 0; i < 64; i++) {
    assert.equal(out[i * 4], 100);
    assert.equal(out[i * 4 + 1], 50);
    assert.equal(out[i * 4 + 2], 200);
    assert.equal(out[i * 4 + 3], 255);
  }
});

test('boxBlur: ایمپالس تنها پخش می‌شود (r=1 → میانگین 3×3)', () => {
  const d = imgFrom(5, 5, (x, y) => (x === 2 && y === 2 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  const out = boxBlur(d, 5, 5, 1);
  assert.equal(out[(2 * 5 + 2) * 4], 28); // مرکز: 255/9 = 28.33 → 28
  assert.equal(out[(2 * 5 + 1) * 4] + out[(2 * 5 + 1) * 4 + 1] + out[(2 * 5 + 1) * 4 + 2], 84); // همسایهٔ مرکز: 28 در هر کانال
  assert.equal(out[(1 * 5 + 2) * 4], 28); // همسایهٔ عمودی مرکز
});

test('boxBlur: آلفا دست‌نخورده', () => {
  const d = imgFrom(4, 4, (x, y) => [100, 100, 100, 30 + x]);
  const out = boxBlur(d, 4, 4, 1);
  for (let i = 0; i < 16; i++) assert.equal(out[i * 4 + 3], d[i * 4 + 3]);
});
