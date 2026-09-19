import test from 'node:test';
import assert from 'node:assert/strict';
import { Paint } from '../src/document/paint.js';
import { regionGrow, floodFill, magicWand, rectSelectionMask } from '../src/tools/floodfill.js';

// تصویر دو نیمه: چپ قرمز، راست آبی
function twoTone(w, h) {
  const p = new Paint(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < w / 2) p.setPixel(x, y, 255, 0, 0, 255);
      else p.setPixel(x, y, 0, 0, 255, 255);
    }
  }
  return p;
}

test('regionGrow: نیمهٔ قرمز دقیقاً انتخاب می‌شود (تلورانس ۰)', () => {
  const w = 20, h = 10;
  const p = twoTone(w, h);
  const { mask, rect, count } = regionGrow(p, w, h, 0, 0, 0, false);
  assert.equal(count, (w / 2) * h);
  assert.equal(rect.x, 0);
  assert.equal(rect.w, w / 2);
  assert.equal(rect.h, h);
  // پیکسل آبی (گوشهٔ راست-پایین) عضو نیست
  assert.equal(mask[(h - 1) * w + (w - 1)], 0);
  // پیکسل شروع عضو است (مقدار >۰)
  assert.ok(mask[0] > 0);
});

test('regionGrow: نقطهٔ خارج مرز → ناحیهٔ خالی', () => {
  const p = twoTone(8, 8);
  const { count } = regionGrow(p, 8, 8, 99, 99, 0, false);
  assert.equal(count, 0);
});

test('floodFill: کل ناحیهٔ قرمز به سبز تبدیل می‌شود و آبی دست‌نخورده', () => {
  const w = 16, h = 12;
  const p = twoTone(w, h);
  const rect = floodFill(p, w, h, 0, 0, 0, [0, 255, 0, 255], false);
  const c = [0, 0, 0, 0];
  p.getPixel(0, 0, c); assert.deepEqual(c, [0, 255, 0, 255]);
  p.getPixel(w - 1, h - 1, c); assert.deepEqual(c, [0, 0, 255, 255]);
  assert.equal(rect.w, w / 2);
});

test('magicWand: آلفا در نظر گرفته نمی‌شود وقتی matchAlpha=false', () => {
  const w = 6, h = 6;
  const p = new Paint(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.setPixel(x, y, 10, 20, 30, x < 3 ? 100 : 200);
  const { count } = magicWand(p, w, h, 0, 0, 0, false);
  assert.equal(count, w * h); // همه هم‌رنگ RGB؛ آلفا نادیده
});

test('rectSelectionMask: مستطیل داخلی و برش مرز', () => {
  const w = 10, h = 10;
  const a = rectSelectionMask(w, h, 2, 2, 4, 4);
  assert.equal(a.mask[2 * 10 + 2], 1);
  assert.equal(a.mask[0], 0);
  assert.equal(a.mask[6 * 10 + 6], 0);
  const b = rectSelectionMask(w, h, -2, -2, 4, 4);
  assert.equal(b.rect.x, 0); assert.equal(b.rect.w, 2);
  assert.equal(b.rect.h, 2);
});

test('floodFill غیرپیوسته: دو لکهٔ هم‌رنگ جدا هر دو پر می‌شوند', () => {
  const w = 20, h = 10;
  const p = new Paint(w, h);
  p.clearRect({ x: 0, y: 0, w, h }, 255, 255, 255, 255); // پس‌زمینه سفید
  p.setPixel(2, 5, 255, 0, 0, 255);    // لکهٔ ۱ قرمز
  p.setPixel(17, 5, 255, 0, 0, 255);   // لکهٔ ۲ قرمز (جدا از ۱)
  floodFill(p, w, h, 2, 5, 0, [0, 255, 0, 255], false, false); // contiguous=false
  const c = [0, 0, 0, 0];
  p.getPixel(2, 5, c);  assert.deepEqual(c, [0, 255, 0, 255]);
  p.getPixel(17, 5, c); assert.deepEqual(c, [0, 255, 0, 255]);
  p.getPixel(4, 4, c);  assert.deepEqual(c, [255, 255, 255, 255]); // سفید دست‌نخورده
});

test('floodFill پیوسته: لکهٔ دور (غیرمجاور) دست نمی‌خورد', () => {
  const w = 20, h = 10;
  const p = new Paint(w, h);
  p.clearRect({ x: 0, y: 0, w, h }, 255, 255, 255, 255);
  p.setPixel(2, 5, 255, 0, 0, 255);
  p.setPixel(17, 5, 255, 0, 0, 255);
  floodFill(p, w, h, 2, 5, 0, [0, 255, 0, 255], false, true); // contiguous پیش‌فرض
  const c = [0, 0, 0, 0];
  p.getPixel(2, 5, c);  assert.deepEqual(c, [0, 255, 0, 255]);
  p.getPixel(17, 5, c); assert.deepEqual(c, [255, 0, 0, 255]); // هنوز قرمز
});
