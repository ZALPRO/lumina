import test from 'node:test';
import assert from 'node:assert/strict';
import { sampleGradient, linearGradient, radialGradient, curvesLUT, applyCurves, exposureAdjust, vibranceAdjust } from '../src/engine/gradient.js';
import { fillRectShape, strokeRectShape, fillEllipse, strokeEllipse, drawLine } from '../src/engine/shape.js';
import { Paint } from '../src/document/paint.js';

test('sampleGradient: نقطهٔ میانی دو توقف', () => {
  const stops = [[0, [0, 0, 0, 255]], [1, [100, 200, 50, 255]]];
  assert.deepEqual(sampleGradient(stops, 0.5), [50, 100, 25, 255]);
  assert.deepEqual(sampleGradient(stops, 0), [0, 0, 0, 255]);
  assert.deepEqual(sampleGradient(stops, 1), [100, 200, 50, 255]);
});

test('linearGradient: گرادیان افقی چپ→راست', () => {
  const p = new Paint(10, 2);
  linearGradient(p, 10, 2, 0, 0, 9, 0, [[0, [0, 0, 0, 255]], [1, [255, 255, 255, 255]]]);
  const c = [0, 0, 0, 0];
  p.getPixel(0, 0, c); assert.equal(c[0], 0);
  p.getPixel(9, 0, c); assert.equal(c[0], 255);
  p.getPixel(4, 0, c); assert.ok(c[0] > 100 && c[0] < 160, `mid=${c[0]}`);
});

test('radialGradient: مرکز روشن‌تر', () => {
  const p = new Paint(9, 9);
  radialGradient(p, 9, 9, 4, 4, 4, [[0, [255, 255, 255, 255]], [1, [0, 0, 0, 255]]]);
  const c = [0, 0, 0, 0];
  p.getPixel(4, 4, c); assert.equal(c[0], 255);
  p.getPixel(0, 0, c); assert.equal(c[0], 0);
});

test('curvesLUT + applyCurves: هویت و وارون', () => {
  const identity = curvesLUT([]);
  assert.equal(identity[0], 0);
  assert.equal(identity[128], 128);
  assert.equal(identity[255], 255);
  const src = new Uint8ClampedArray(4 * 4).fill(0);
  src[0] = src[1] = src[2] = 200; src[3] = 255;
  const lutInv = curvesLUT([[0, 255], [255, 0]]);
  const out = applyCurves(src, 4, 1, lutInv, lutInv, lutInv);
  assert.equal(out[0], 55);
});

test('exposureAdjust: +1 EV دو برابر', () => {
  const src = new Uint8ClampedArray([100, 50, 0, 255]);
  const out = exposureAdjust(src, 1, 1, 1);
  assert.equal(out[0], 200);
  assert.equal(out[1], 100);
});

test('vibranceAdjust: اشباع میانهٔ خاکستری ثابت', () => {
  const src = new Uint8ClampedArray([128, 128, 128, 255]);
  const out = vibranceAdjust(src, 1, 1, 1);
  assert.equal(out[0], 128); // خاکستری تغییر نمی‌کند
});

test('fillRectShape + strokeRectShape', () => {
  const p = new Paint(10, 10);
  fillRectShape(p, 1, 1, 3, 3, [255, 0, 0, 255]);
  const c = [0, 0, 0, 0];
  p.getPixel(2, 2, c); assert.equal(c[0], 255);
  p.getPixel(5, 5, c); assert.equal(c[0], 0);
  const p2 = new Paint(10, 10);
  strokeRectShape(p2, 1, 1, 4, 4, [0, 255, 0, 255], 1);
  p2.getPixel(1, 3, c); assert.equal(c[1], 255); // لبه
  p2.getPixel(2, 2, c); assert.equal(c[1], 0);  // داخل خالی
});

test('fillEllipse + strokeEllipse', () => {
  const p = new Paint(11, 11);
  fillEllipse(p, 5, 5, 4, 4, [0, 0, 255, 255]);
  const c = [0, 0, 0, 0];
  p.getPixel(5, 5, c); assert.equal(c[2], 255);
  p.getPixel(0, 0, c); assert.equal(c[2], 0);
  const p2 = new Paint(11, 11);
  strokeEllipse(p2, 5, 5, 4, 4, [255, 255, 0, 255], 1);
  p2.getPixel(5, 1, c); assert.equal(c[0], 255); // لبهٔ بالا
  p2.getPixel(5, 5, c); assert.equal(c[0], 0);   // داخل خالی
});

test('drawLine: خط افقی', () => {
  const p = new Paint(10, 4);
  drawLine(p, 0, 2, 9, 2, [10, 20, 30, 255], 1);
  const c = [0, 0, 0, 0];
  p.getPixel(0, 2, c); assert.deepEqual(c, [10, 20, 30, 255]);
  p.getPixel(9, 2, c); assert.deepEqual(c, [10, 20, 30, 255]);
  p.getPixel(5, 0, c); assert.deepEqual(c, [0, 0, 0, 0]);
});
