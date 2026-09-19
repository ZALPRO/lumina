import test from 'node:test';
import assert from 'node:assert/strict';
import { Document } from '../src/document/document.js';
import { Paint } from '../src/document/paint.js';
import { Layer } from '../src/document/layer.js';

// ابزار ساخت سند رنگی یکدست
function solidDoc(w, h, [r, g, b, a]) {
  const doc = new Document({ width: w, height: h });
  const paint = new Paint(w, h);
  paint.clearRect({ x: 0, y: 0, w, h }, r, g, b, a);
  doc.addLayer(new Layer({ name: 'bg', paint }));
  return doc;
}

function px(doc, x, y) {
  const flat = doc.flatten();
  const out = [0, 0, 0, 0];
  flat.getPixel(x, y, out);
  return out;
}

test('flatten: تک‌لایهٔ مات = خودش', () => {
  const doc = solidDoc(64, 64, [10, 20, 30, 255]);
  assert.deepEqual(px(doc, 5, 5), [10, 20, 30, 255]);
});

test('flatten: سند کاملاً خالی = شفاف', () => {
  const doc = new Document({ width: 64, height: 64 });
  assert.deepEqual(px(doc, 5, 5), [0, 0, 0, 0]);
});

test('composite: قرمز نیمه‌شفاف روی سفید (مقدار مرجع دستی)', () => {
  const doc = solidDoc(64, 64, [255, 255, 255, 255]);
  const top = new Paint(64, 64);
  top.clearRect({ x: 0, y: 0, w: 64, h: 64 }, 255, 0, 0, 128);
  doc.addLayer(new Layer({ name: 'top', paint: top }));
  const [r, g, b, a] = px(doc, 30, 30);
  assert.equal(r, 255, 'r');
  assert.equal(a, 255, 'a');
  assert.ok(g >= 186 && g <= 187, `g=${g}`);
  assert.equal(b, g, 'b=g');
});

test('composite: multiply مشکی روی سفید = مشکی', () => {
  const doc = solidDoc(64, 64, [255, 255, 255, 255]);
  const top = new Paint(64, 64);
  top.clearRect({ x: 0, y: 0, w: 64, h: 64 }, 0, 0, 0, 255);
  doc.addLayer(new Layer({ name: 'top', paint: top, blendMode: 'multiply' }));
  assert.deepEqual(px(doc, 30, 30), [0, 0, 0, 255]);
});

test('composite: screen سیاه = بی‌اثر', () => {
  const doc = solidDoc(64, 64, [200, 200, 200, 255]);
  const top = new Paint(64, 64);
  top.clearRect({ x: 0, y: 0, w: 64, h: 64 }, 0, 0, 0, 255);
  doc.addLayer(new Layer({ name: 'top', paint: top, blendMode: 'screen' }));
  assert.deepEqual(px(doc, 30, 30), [200, 200, 200, 255]);
});

test('composite: لایهٔ مخفی نادیده گرفته می‌شود', () => {
  const doc = solidDoc(64, 64, [255, 255, 255, 255]);
  const top = new Paint(64, 64);
  top.clearRect({ x: 0, y: 0, w: 64, h: 64 }, 0, 0, 0, 255);
  doc.addLayer(new Layer({ name: 'top', paint: top, visible: false }));
  assert.deepEqual(px(doc, 30, 30), [255, 255, 255, 255]);
});

test('composite: opacity صفر = بی‌اثر', () => {
  const doc = solidDoc(64, 64, [255, 255, 255, 255]);
  const top = new Paint(64, 64);
  top.clearRect({ x: 0, y: 0, w: 64, h: 64 }, 0, 0, 0, 255);
  doc.addLayer(new Layer({ name: 'top', paint: top, opacity: 0 }));
  assert.deepEqual(px(doc, 30, 30), [255, 255, 255, 255]);
});

test('composite: ترتیب لایه‌ها (بالا روی پایین)', () => {
  const doc = solidDoc(64, 64, [255, 0, 0, 255]);          // قرمز پایین
  const top = new Paint(64, 64);
  top.clearRect({ x: 0, y: 0, w: 64, h: 64 }, 0, 0, 255, 255); // آبی بالا (مات)
  doc.addLayer(new Layer({ name: 'top', paint: top }));
  assert.deepEqual(px(doc, 30, 30), [0, 0, 255, 255]);
});

test('toRGBA: roundtrip رنگ و آلفا', () => {
  const w = 8, h = 8;
  const frame = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    frame[i * 4] = [0, 255, 128, 64, 200][i % 5];
    frame[i * 4 + 1] = [0, 255, 10, 33, 90][i % 5];
    frame[i * 4 + 2] = [0, 255, 42, 7, 250][i % 5];
    frame[i * 4 + 3] = [0, 255, 128, 200, 33][i % 5];
  }
  const doc = Document.fromRGBA(frame, w, h);
  const out = doc.toRGBA();
  for (let i = 0; i < w * h * 4; i++) {
    assert.ok(Math.abs(out[i] - frame[i]) <= 1, `i=${i} out=${out[i]} frame=${frame[i]}`);
  }
});

test('memoryEstimate: تخمین سند', () => {
  const doc = solidDoc(512, 512, [1, 2, 3, 255]);
  // لایهٔ پس‌زمینه (4 کاشی) + بافر خروجی (4 کاشی) = 8 کاشی
  const bytes = 8 * 256 * 256 * 4;
  assert.equal(doc.memoryEstimate(), bytes);
});
