import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Adjustment, brightnessContrast, invertMap, grayscaleMap, hueSatMap, levelsMap, thresholdMap,
} from '../src/engine/adjustments.js';
import { Document } from '../src/document/document.js';
import { Paint } from '../src/document/paint.js';
import { Layer } from '../src/document/layer.js';
import { identity, rotateRad, invertAffine, applyToPoint, compositeTransform } from '../src/engine/transform.js';

// ---------- ماتریس‌های خالص ----------
test('transform identity و applyToPoint', () => {
  assert.deepEqual(applyToPoint(identity(), 5, 7), [5, 7]);
});

test('rotateRad: ۹۰ درجه نقطهٔ (۱,۰) → (۰,۱)', () => {
  const m = rotateRad(Math.PI / 2);
  const [x, y] = applyToPoint(m, 1, 0);
  assert.ok(Math.abs(x) < 1e-9 && Math.abs(y - 1) < 1e-9, `(${x},${y})`);
});

test('scale + translate کامپوزیت', () => {
  const m = compositeTransform({ cx: 0, cy: 0, sx: 2, sy: 2, tx: 10, ty: 20 });
  const [x, y] = applyToPoint(m, 1, 1);
  assert.deepEqual([x, y], [12, 22]);
});

test('invertAffine: دور کامل', () => {
  const m = compositeTransform({ cx: 4, cy: 5, angle: 0.7, sx: 1.3, sy: 0.8, tx: 6, ty: -3 });
  const inv = invertAffine(m);
  const [x, y] = applyToPoint(m, 3.2, -1.1);
  const [x2, y2] = applyToPoint(inv, x, y);
  assert.ok(Math.abs(x2 - 3.2) < 1e-6 && Math.abs(y2 + 1.1) < 1e-6);
});

// ---------- نگاشت‌های رنگی ----------
test('invertMap: ۳۰ → ۲۲۵ ، آلفا حفظ', () => {
  assert.deepEqual(invertMap()(30, 100, 200, 128), [225, 155, 55, 128]);
});

test('grayscaleMap: قرمز → وزن R (54)', () => {
  const [r] = grayscaleMap()(255, 0, 0, 255);
  assert.equal(r, 54);
});

test('brightnessContrast: هویت', () => {
  assert.deepEqual(brightnessContrast(0, 0)(50, 120, 200, 255), [50, 120, 200, 255]);
});

test('levelsMap: فشرده‌سازی محدوده → نگاشت صحیح', () => {
  // shadows=0, highlights=255, gamma=1 → هویت
  assert.deepEqual(levelsMap(0, 255, 1)(10, 128, 250, 255), [10, 128, 250, 255]);
  // gamma=2 چه؟ x=64 → (64/255)^(1/2)*255 ≈ 127
  const [r] = levelsMap(0, 255, 2)(64, 64, 64, 255);
  assert.ok(Math.abs(r - 127) <= 2, `r=${r}`);
});

test('thresholdMap: آستانهٔ ۱۲۸ روی ترکیب', () => {
  const [r1] = thresholdMap(128)(255, 255, 255, 255);   // سفید → سفید
  const [r2] = thresholdMap(128)(0, 0, 0, 255);         // سیاه → سیاه
  assert.equal(r1, 255);
  assert.equal(r2, 0);
});

// ---------- لایهٔ تنظیم در سند ----------
test('سند: لایهٔ تنظیم invert همهٔ زیرین را وارون می‌کند', () => {
  const doc = new Document({ width: 8, height: 8 });
  const base = new Paint(8, 8);
  base.clearRect({ x: 0, y: 0, w: 8, h: 8 }, 255, 255, 255, 255);
  doc.addLayer(new Layer({ name: 'bg', paint: base }));

  const adj = new Layer({
    name: 'Invert',
    adjustment: { type: 'invert', apply: invertMap() },
  });
  doc.addLayer(adj);

  const flat = doc.flatten();
  const px = [0, 0, 0, 0];
  flat.getPixel(3, 3, px);
  assert.deepEqual(px, [0, 0, 0, 255], 'سفید → سیاه تحت invert');
});

test('سند: لایهٔ تنظیم Grayscale روی قرمز → ۵۴', () => {
  const doc = new Document({ width: 8, height: 8 });
  const base = new Paint(8, 8);
  base.clearRect({ x: 0, y: 0, w: 8, h: 8 }, 255, 0, 0, 255);
  doc.addLayer(new Layer({ name: 'bg', paint: base }));
  const adj = new Layer({ name: 'Grayscale', adjustment: { type: 'grayscale', apply: grayscaleMap() } });
  doc.addLayer(adj);
  const flat = doc.flatten();
  const px = [0, 0, 0, 0];
  flat.getPixel(3, 3, px);
  assert.equal(px[0], 54);
  assert.equal(px[1], 54);
});

test('سند: تنظیم روی لایهٔ بالا اثر نمی‌گذارد (فقط زیرین)', () => {
  const doc = new Document({ width: 8, height: 8 });
  const base = new Paint(8, 8);
  base.clearRect({ x: 0, y: 0, w: 8, h: 8 }, 200, 200, 200, 255);
  doc.addLayer(new Layer({ name: 'bg', paint: base }));

  const adj = new Layer({ name: 'Invert', adjustment: { type: 'invert', apply: invertMap() } });
  doc.addLayer(adj);

  const top = new Paint(8, 8);
  top.clearRect({ x: 0, y: 0, w: 8, h: 8 }, 255, 0, 0, 255);
  doc.addLayer(new Layer({ name: 'top', paint: top }));  // بالای تنظیم

  const flat = doc.flatten();
  const px = [0, 0, 0, 0];
  flat.getPixel(3, 3, px);
  assert.deepEqual(px, [255, 0, 0, 255], 'لایهٔ قرمز بالایی دست نمی‌خورد');
});
