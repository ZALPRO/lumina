import test from 'node:test';
import assert from 'node:assert/strict';
import { Paint } from '../src/document/paint.js';
import { TILE_SIZE } from '../src/engine/tile.js';

test('Paint: تخصیص تنبل — بدون نوشتن هیچ کاشی ساخته نمی‌شود', () => {
  const p = new Paint(1000, 1000);
  assert.equal(p.allocatedTiles(), 0);
  assert.equal(p.allocatedBytes(), 0);
});

test('Paint: writeFromRGBA آلفای صفر را نمی‌نویسد (Hole skipping)', () => {
  const p = new Paint(512, 512);
  const frame = new Uint8ClampedArray(512 * 512 * 4); // همه شفاف
  p.writeFromRGBA(frame, 512, 512);
  assert.equal(p.allocatedTiles(), 0);
});

test('Paint: setPixel تخصیص می‌دهد و getPixel برمی‌گرداند', () => {
  const p = new Paint(512, 512);
  p.setPixel(10, 10, 200, 100, 50, 255);
  const out = [0, 0, 0, 0];
  p.getPixel(10, 10, out);
  assert.deepEqual(out, [200, 100, 50, 255]);
  assert.equal(p.allocatedTiles(), 1);
});

test('Paint: getPixel خارج از مرز → شفاف', () => {
  const p = new Paint(300, 300);
  const out = [9, 9, 9, 9];
  p.getPixel(-1, 0, out);
  assert.deepEqual(out, [0, 0, 0, 0]);
  p.getPixel(999, 999, out);
  assert.deepEqual(out, [0, 0, 0, 0]);
});

test('Paint: writeFromRGBA کل فریم = یک ۲۵۶×۲۵۶ یک کاشی', () => {
  const w = 256, h = 256;
  const frame = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    frame[i * 4] = i & 255; frame[i * 4 + 1] = 128; frame[i * 4 + 2] = 7; frame[i * 4 + 3] = 255;
  }
  const p = new Paint(w, h);
  p.writeFromRGBA(frame, w, h);
  assert.equal(p.allocatedTiles(), 1);
  const out = [0, 0, 0, 0];
  p.getPixel(255, 255, out);
  assert.equal(out[1], 128);
  assert.equal(out[2], 7);
});

test('Paint: clearRect وسط یک ناحیه را پاک می‌کند', () => {
  const p = new Paint(256, 256);
  p.clearRect({ x: 0, y: 0, w: 256, h: 256 }, 50, 60, 70, 255);
  const out = [0, 0, 0, 0];
  p.getPixel(128, 128, out);
  assert.deepEqual(out, [50, 60, 70, 255]);
});

test('Paint: clear() همه را آزاد می‌کند', () => {
  const p = new Paint(512, 512);
  p.setPixel(0, 0, 1, 2, 3, 4);
  p.clear();
  assert.equal(p.allocatedTiles(), 0);
});

test('Paint: iteração forEachTile فقط تخصیص داده‌شده‌ها', () => {
  const p = new Paint(768, 256); // 3 کاشی افقی
  p.setPixel(0, 0, 1, 1, 1, 255);     // کاشی ۰
  p.setPixel(256 * 2 + 5, 5, 1, 1, 1, 255); // کاشی ۲
  const seen = [];
  p.forEachTile((t) => seen.push(t.tx));
  assert.deepEqual(seen.sort(), [0, 2]);
});

test('Paint: اندازه کاشی دقیق', () => {
  assert.equal(TILE_SIZE, 256);
});
