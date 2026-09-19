import test from 'node:test';
import assert from 'node:assert/strict';
import {
  srgbToLinear, linearToSrgb, u8ToLinear, linearToU8,
  lum, sat, setLum, setSat, clamp01,
} from '../src/engine/color.js';

// --- مقادیر مرجع محاسبه‌شده‌ی دستی (نقاط شناخته‌شده‌ی منحنی sRGB) ---

test('srgbToLinear: نقاط لنگر استاندارد', () => {
  assert.equal(srgbToLinear(0), 0);
  assert.equal(srgbToLinear(1), 1);
  // آستانه‌ی 0.04045 → بخش خطی
  assert.ok(Math.abs(srgbToLinear(0.04045) - 0.04045 / 12.92) < 1e-9);
  // 0.5 → 0.21404114 (مقدار شناخته‌شده)
  assert.ok(Math.abs(srgbToLinear(0.5) - 0.21404114048223255) < 1e-12);
  // clamp
  assert.equal(srgbToLinear(-1), 0);
  assert.equal(srgbToLinear(2), 1);
});

test('linearToSrgb: معکوس دقیق', () => {
  assert.equal(linearToSrgb(0), 0);
  assert.equal(linearToSrgb(1), 1);
  assert.ok(Math.abs(linearToSrgb(0.21404114048223255) - 0.5) < 1e-12);
  // round-trip
  for (const v of [0.01, 0.1, 0.25, 0.5, 0.75, 0.9]) {
    assert.ok(Math.abs(linearToSrgb(srgbToLinear(v)) - v) < 1e-10, `roundtrip ${v}`);
  }
});

test('u8ToLinear -> linearToU8: دور کامل ۵۰٪ خاکستری (با گرد)', () => {
  assert.deepEqual(linearToU8(...u8ToLinear(128, 128, 128, 128)), [128, 128, 128, 128]);
});

test('linearToU8: سفید عادی (۲۵۵) از خطی ۱', () => {
  assert.deepEqual(linearToU8(1, 1, 1, 1), [255, 255, 255, 255]);
});

test('u8ToLinear: مشکی مات = خطی ۰', () => {
  assert.deepEqual(u8ToLinear(0, 0, 0, 255), [0, 0, 0, 1]);
});

test('lum: قرمز روشنایی ۰.۳', () => {
  assert.ok(Math.abs(lum(1, 0, 0) - 0.3) < 1e-12);
});

test('sat: خاکستری بدون اشباع = ۰، قرمز کامل = ۱', () => {
  assert.equal(sat(0.5, 0.5, 0.5), 0);
  assert.ok(Math.abs(sat(1, 0, 0) - 1) < 1e-12);
});

test('setSat: قرمز شفاف مثلاً رنگ → قرمزِ اشباع ۱', () => {
  const [r, , b] = setSat(0.8, 0.4, 0.2, 1);
  assert.ok(Math.abs(r - 1) < 1e-9 && Math.abs(b) < 1e-9, `r=${r}, b=${b}`);
});

test('setLum: هر رنگی -> روشنایی ۰.۵', () => {
  const [r, g, b] = setLum(0.9, 0.6, 0.3, 0.5);
  assert.ok(Math.abs(lum(r, g, b) - 0.5) < 1e-9, `L=${lum(r, g, b)}`);
});

test('clamp01', () => {
  assert.equal(clamp01(-0.2), 0);
  assert.equal(clamp01(1.3), 1);
  assert.equal(clamp01(0.5), 0.5);
});
