import test from 'node:test';
import assert from 'node:assert/strict';
import { chromaKeyRemove, glowFromAlpha, flatGradient, drawArrow, drawStar } from '../src/engine/chroma.js';

test('chromaKeyRemove: سبز خالص → شفاف، سوژهٔ رنگی → مات', () => {
  const w = 8, h = 8;
  const src = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    src[p] = 0; src[p + 1] = 255; src[p + 2] = 0; src[p + 3] = 255; // سبز خالص
  }
  // بلوک قرمز 4×4 وسط-بالا (داخل آن باید مات باشد، چند پیکسل دور از لبه)
  for (let y = 1; y < 5; y++) for (let x = 1; x < 5; x++) {
    const p = (y * w + x) * 4;
    src[p] = 255; src[p + 1] = 0; src[p + 2] = 0;
  }
  const out = chromaKeyRemove(src, w, h, { r: 0, g: 255, b: 0 }, 90);
  const inside = (3 * w + 3) * 4; // وسط بلوک قرمز
  assert.ok(out[inside + 3] > 200, `قرمز داخل بلوک مات باشد α=${out[inside + 3]}`);
  const green = (0 * w + 6) * 4; // سبز خالص دور
  assert.ok(out[green + 3] < 60, `سبز شفاف باشد α=${out[green + 3]}`);
});

test('chromaKeyRemove: کل ابعاد حفظ', () => {
  const w = 8, h = 6;
  const src = new Uint8ClampedArray(w * h * 4).fill(0);
  const out = chromaKeyRemove(src, w, h);
  assert.equal(out.length, w * h * 4);
});

test('glowFromAlpha: رنگ هاله درست + شفافیت بیرون', () => {
  const w = 16, h = 16;
  const rgba = new Uint8ClampedArray(w * h * 4);
  // یک نقطهٔ مات در مرکز
  const c = (8 * w + 8) * 4;
  rgba[c + 3] = 255;
  rgba[c] = 255; rgba[c + 1] = 255; rgba[c + 2] = 255;
  const glow = glowFromAlpha(rgba, w, h, [255, 210, 0], 4);
  assert.equal(glow[c], 255);
  assert.equal(glow[c + 1], 210);
  // نزدیک مرکز باید هاله داشته باشد
  const near = (7 * w + 8) * 4;
  assert.ok(glow[near + 3] > 0, 'هالهٔ اطراف باید >0');
});

test('flatGradient: رنگ‌های انتهایی دقیق', () => {
  const w = 10, h = 10;
  const g = flatGradient(w, h, [255, 70, 40], [255, 160, 0], 0);
  assert.equal(g[0], 255); assert.equal(g[1], 70); assert.equal(g[2], 40); // بالا چپ
  const bottom = ((h - 1) * w + 0) * 4;
  assert.equal(Math.round(g[bottom]), 255);
  assert.equal(Math.round(g[bottom + 1]), 160);
  assert.equal(Math.round(g[bottom + 2]), 0);
});

test('drawArrow / drawStar: بافر معتبر + پیکسل نقاشی‌شده', () => {
  const w = 60, h = 40;
  const canvas = new Uint8ClampedArray(w * h * 4); // شفاف
  const withArrow = drawArrow(canvas, w, h, { x1: 10, y1: 30, x2: 50, y2: 10 });
  assert.equal(withArrow.length, canvas.length);
  // انتهای پیکان باید رنگی باشد
  const mid = (25 * w + 20) * 4;
  assert.ok(withArrow[mid + 3] > 0, 'خط پیکان رنگی باشد');

  const withStar = drawStar(canvas, w, h, { cx: 30, cy: 20, radius: 14 });
  const center = (20 * w + 30) * 4;
  assert.equal(withStar[center + 3], 255, 'مرکز ستاره پر شود');
  assert.equal(withStar[center], 255); // زرد R
  assert.equal(withStar[center + 1], 210);
});
