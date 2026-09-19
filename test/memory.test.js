import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryEstimate, TILE_BYTES } from '../src/utils/memory.js';

test('TILE_BYTES = ۲۵۶×۲۵۶×۴', () => {
  assert.equal(TILE_BYTES, 256 * 256 * 4);
});

test('imageBytes', () => {
  assert.equal(MemoryEstimate.imageBytes(1000, 500), 1000 * 500 * 4);
  assert.equal(MemoryEstimate.imageBytes(1000, 500, 1), 1000 * 500);
});

test('tilesFor: دقیق و گرد به بالا', () => {
  assert.equal(MemoryEstimate.tilesFor(256, 256), 1);
  assert.equal(MemoryEstimate.tilesFor(257, 256), 2);
  assert.equal(MemoryEstimate.tilesFor(1000, 1000), 4 * 4);
});

test('layerBytes در برابر تخصیص واقعی', async () => {
  const { Paint } = await import('../src/document/paint.js');
  const p = new Paint(1000, 1000);       // 4×4 = 16 کاشی
  assert.equal(MemoryEstimate.layerBytes(1000, 1000), 16 * TILE_BYTES);
  assert.equal(p.allocatedBytes(), 0);    // تنبل: هنوز چیزی ساخته نشده
  p.setPixel(0, 0, 1, 2, 3, 255);         // یک کاشی تخصیص گرفت
  assert.equal(p.allocatedBytes(), TILE_BYTES);
});

test('fmt: واحدها', () => {
  assert.equal(MemoryEstimate.fmt(512), '512 B');
  assert.equal(MemoryEstimate.fmt(2048), '2.0 KB');
  assert.equal(MemoryEstimate.fmt(1024 * 1024 * 3), '3.0 MB');
});

test('totalAllocatedBytes: جمع لایهٔ رنگ و ماسک', () => {
  const est = new MemoryEstimate();
  est.snapshotTiles = 2;
  const total = est.totalAllocatedBytes([]);
  assert.equal(total, 2 * TILE_BYTES);
});
