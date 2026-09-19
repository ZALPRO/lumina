import test from 'node:test';
import assert from 'node:assert/strict';
import { squareStamp } from '../src/tools/brush.js';
import { Paint } from '../src/document/paint.js';

test('squareStamp: مربع سخت پر می‌شود و گوشه‌ها عضو هستند', () => {
  const p = new Paint(20, 20);
  squareStamp(p, 10, 10, 6, 1, [255, 0, 0, 255], 1);
  const c = [0, 0, 0, 0];
  p.getPixel(10, 8, c); assert.equal(c[0], 255); // بالا-وسط
  p.getPixel(8, 10, c); assert.equal(c[0], 255); // چپ-وسط (مربع)
  p.getPixel(14, 10, c); assert.equal(c[3], 0); // خارج مربع
});
