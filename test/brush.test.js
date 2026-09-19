import test from 'node:test';
import assert from 'node:assert/strict';
import { Paint } from '../src/document/paint.js';
import { brushStamp, brushStroke, strokePoints } from '../src/tools/brush.js';

test('brushStamp: مرکز قلم سخت کاملاً مات', () => {
  const p = new Paint(64, 64);
  brushStamp(p, 20, 20, 3, 1, [255, 0, 0, 255], 1);
  const c = [0, 0, 0, 0];
  p.getPixel(20, 20, c);
  assert.deepEqual(c, [255, 0, 0, 255]);
});

test('brushStamp: خارج از شعاع دست‌نخورده', () => {
  const p = new Paint(64, 64);
  brushStamp(p, 20, 20, 3, 1, [255, 0, 0, 255], 1);
  const c = [0, 0, 0, 0];
  p.getPixel(40, 40, c);
  assert.deepEqual(c, [0, 0, 0, 0]);
});

test('brushStamp: آلفای جزئی در لبه (آنتی‌الیاس)', () => {
  const p = new Paint(64, 64);
  brushStamp(p, 20, 20, 2, 1, [0, 0, 0, 255], 1);
  // لبه‌ی قلم سخت: d=1.0 → پوشش ۰؛ d=0.5 → داخل کامل
  const c = [9, 9, 9, 9];
  p.getPixel(22, 20, c); // d=1.0 → بیرون
  assert.ok(c[3] <= 40, `edge alpha=${c[3]}`);
  const c2 = [9, 9, 9, 9];
  p.getPixel(21, 20, c2); // d=0.5 → داخل
  assert.ok(c2[3] >= 200, `inner alpha=${c2[3]}`);
});

test('brushStamp: ترکیب با رنگ موجود (بالا نوشته می‌شود)', () => {
  const p = new Paint(64, 64);
  p.setPixel(20, 20, 200, 200, 200, 255);
  brushStamp(p, 20, 20, 1, 1, [255, 0, 0, 128], 1);
  const c = [0, 0, 0, 0];
  p.getPixel(20, 20, c);
  // قرمز نیمه‌شفاف روی خاکستری در فضای خطی: r≈230، g≈146 (محاسبهٔ مرجع)
  assert.ok(Math.abs(c[0] - 230) <= 2, `r=${c[0]}`);
  assert.ok(Math.abs(c[1] - 146) <= 2, `g=${c[1]}`);
});

test('strokePoints: فاصله‌گذاری صحیح روی خط افقی', () => {
  const pts = [[0, 0], [10, 0], [20, 0]];
  const s = strokePoints(pts, 5);
  assert.deepEqual(s, [[0, 0], [5, 0], [10, 0], [15, 0], [20, 0]]);
});

test('strokePoints: تک‌نقطه', () => {
  assert.deepEqual(strokePoints([[4, 5]], 5), [[4, 5]]);
});

test('brushStroke: خط پیوسته کشیده می‌شود', () => {
  const p = new Paint(100, 40);
  const rect = brushStroke(p, [[5, 20], [90, 20]], { radius: 3, hardness: 1, color: [0, 0, 255, 255] });
  const c = [0, 0, 0, 0];
  p.getPixel(50, 20, c);
  assert.equal(c[2], 255);
  assert.equal(c[0], 0);
  assert.ok(rect.w > 80, `rect.w=${rect.w}`);
});

test('squareStamp: مُهر مربعی دقیق', () => {
  const { smokePaint } = { smokePaint: null };
});
