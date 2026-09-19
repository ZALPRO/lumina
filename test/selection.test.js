import test from 'node:test';
import assert from 'node:assert/strict';
import { normRect, rectMask, rectMaskInv, fillSelection, clearSelection, cropPaint } from '../src/engine/selection.js';
import { Rect } from '../src/engine/rect.js';
import { Paint } from '../src/document/paint.js';

test('normRect: مختصات معکوس → مستطیل نرمال', () => {
  const r = normRect(5, 9, 2, 3);
  assert.equal(r.x, 2);
  assert.equal(r.y, 3);
  assert.equal(r.w, 4);
  assert.equal(r.h, 7);
});

test('rectMask: محدودهٔ صحیح', () => {
  const m = rectMask(10, 10, new Rect(2, 3, 4, 2));
  assert.equal(m[3 * 10 + 2], 1);
  assert.equal(m[3 * 10 + 5], 1);
  assert.equal(m[2 * 10 + 2], 0); // بیرون
  assert.equal(m[5 * 10 + 2], 0); // بیرون
});

test('rectMaskInv: خارج مستطیل انتخاب است', () => {
  const m = rectMaskInv(10, 10, new Rect(0, 0, 10, 10));
  assert.equal(m[0], 0);
  // مستطیل کوچک وسط
  const m2 = rectMaskInv(10, 10, new Rect(4, 4, 2, 2));
  assert.equal(m2[0], 1);          // گوشه خارج → انتخاب شده
  assert.equal(m2[5 * 10 + 5], 0); // وسط داخل → غیرانتخاب
});

test('fillSelection + clearSelection', () => {
  const p = new Paint(8, 8);
  const m = rectMask(8, 8, new Rect(0, 0, 4, 4));
  fillSelection(p, 8, 8, m, [10, 20, 30, 255]);
  const c = [0, 0, 0, 0];
  p.getPixel(1, 1, c); assert.deepEqual(c, [10, 20, 30, 255]);
  p.getPixel(6, 6, c); assert.deepEqual(c, [0, 0, 0, 0]);
  clearSelection(p, 8, 8, m);
  p.getPixel(1, 1, c); assert.deepEqual(c, [0, 0, 0, 0]);
});

test('cropPaint: کراپ با حفظ آلفا', () => {
  const p = new Paint(10, 10);
  p.clearRect({ x: 0, y: 0, w: 10, h: 10 }, 255, 0, 0, 255);
  const out = cropPaint(p, 10, 10, new Rect(2, 2, 4, 3));
  assert.equal(out.w, 4);
  assert.equal(out.h, 3);
  const c = [0, 0, 0, 0];
  out.getPixel(0, 0, c);
  assert.deepEqual(c, [255, 0, 0, 255]);
});
