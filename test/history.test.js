import test from 'node:test';
import assert from 'node:assert/strict';
import { Paint } from '../src/document/paint.js';
import { TileHistory, capturePaint, restorePaint } from '../src/document/history.js';

function pixel(p, x, y) { const o = [0, 0, 0, 0]; p.getPixel(x, y, o); return o; }

test('TileHistory: undo/redo تغییرات را برمی‌گرداند', () => {
  const p = new Paint(64, 64);
  const h = new TileHistory();

  h.record(p, 'اول');                       // اسنپ قبل از اولین تغییر
  p.setPixel(10, 10, 100, 0, 0, 255);
  h.record(p, 'دوم');                       // اسنپ قبل از دومین تغییر
  p.setPixel(10, 10, 0, 200, 0, 255);

  assert.deepEqual(pixel(p, 10, 10), [0, 200, 0, 255]);
  assert.equal(h.undo(), true);
  assert.deepEqual(pixel(p, 10, 10), [100, 0, 0, 255], 'بعد از undo');
  assert.equal(h.undo(), true);
  assert.deepEqual(pixel(p, 10, 10), [0, 0, 0, 0], 'بعد از undo دوم (شفاف)');
  assert.equal(h.undo(), false, 'پشته خالی');
  assert.equal(h.redo(), true);
  assert.deepEqual(pixel(p, 10, 10), [100, 0, 0, 255]);
});

test('TileHistory: اسنپ‌شات فقط کاشی‌های لمس‌شده را کپی می‌کند (حافظهٔ کم)', () => {
  const p = new Paint(4096, 4096); // 256 کاشی ممکن
  p.setPixel(5, 5, 1, 2, 3, 255);   // فقط یک کاشی
  const snap = capturePaint(p);
  assert.equal(snap.size, 1, 'فقط یک کاشی اسنپ‌شات شد');
  // حافظه: یک کاشی کامل نباید کل بافر را بگیرد
  const bytes = [...snap.values()].reduce((s, d) => s + d.length, 0);
  assert.equal(bytes, 256 * 256 * 4);
});

test('TileHistory: حد پشته (limit) رعایت می‌شود', () => {
  const p = new Paint(64, 64);
  const h = new TileHistory(3);
  for (let i = 0; i < 5; i++) { p.setPixel(i, 0, i, 0, 0, 255); h.record(p, `e${i}`); }
  assert.equal(h.undoStack.length <= 3, true);
  assert.equal(h.depth, 3);
});

test('restorePaint: کاشی‌های حذف‌شده آزاد می‌شوند', () => {
  const p = new Paint(512, 512);
  p.setPixel(0, 0, 1, 1, 1, 255);
  assert.equal(p.allocatedTiles(), 1);
  restorePaint(p, new Map());
  assert.equal(p.allocatedTiles(), 0);
});
