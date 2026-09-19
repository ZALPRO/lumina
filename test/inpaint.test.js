import test from 'node:test';
import assert from 'node:assert/strict';
import { inpaintTelea } from '../src/engine/inpaint.js';

test('inpaintTelea: ناحیهٔ سالم دست‌نخورده', () => {
  const w = 20, h = 20;
  const src = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    src[i] = x * 10; src[i + 1] = y * 10; src[i + 2] = 128; src[i + 3] = 255;
  }
  const mask = new Uint8Array(w * h); // همه سالم
  const out = inpaintTelea(src, w, h, mask, 3);
  for (let i = 0; i < w * h * 4; i++) assert.equal(out[i], src[i]);
});

test('inpaintTelea: حفرهٔ تک‌پیکسلی با میانگین همسایه پر می‌شود', () => {
  const w = 9, h = 9;
  const src = new Uint8ClampedArray(w * h * 4).fill(100);
  for (let i = 3; i < w * h * 4; i += 4) src[i] = 255;
  const mask = new Uint8Array(w * h);
  // سوراخ در مرکز (4,4) با رنگ‌های اطراف 200
  for (let y = 2; y <= 6; y++) for (let x = 2; x <= 6; x++) {
    const i = (y * w + x) * 4;
    src[i] = 200; src[i + 1] = 200; src[i + 2] = 200;
  }
  mask[4 * w + 4] = 1; // فقط مرکز سوراخ
  const out = inpaintTelea(src, w, h, mask, 2);
  const p = (4 * w + 4) * 4;
  // مرکز باید تقریباً 200 باشد (میانگین اطراف)
  assert.ok(Math.abs(out[p] - 200) <= 1, `R=${out[p]}`);
  assert.ok(Math.abs(out[p + 1] - 200) <= 1, `G=${out[p + 1]}`);
  // بقیه دست‌نخورده
  const corner = 0 * 4;
  assert.equal(out[corner], 100);
});

test('inpaintTelea: یک خط سیاه روی گرادیان، پس از inpaint بدون لبهٔ سخت', () => {
  const w = 12, h = 12;
  const src = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const v = 50 + x * 8;
    src[i] = v; src[i + 1] = v; src[i + 2] = v; src[i + 3] = 255;
  }
  const mask = new Uint8Array(w * h);
  // خط سیاه ستون 5..6
  for (let y = 0; y < h; y++) {
    const i = (y * w + 6) * 4;
    src[i] = 0; src[i + 1] = 0; src[i + 2] = 0;
    mask[y * w + 6] = 1;
  }
  const out = inpaintTelea(src, w, h, mask, 2);
  const p = (5 * w + 6) * 4;
  // نتیجه باید به گرادیان (50+8*6=98) نزدیک‌تر از 0 باشد
  assert.ok(out[p] > 40, `پس از inpaint R=${out[p]} باید به گرادیان نزدیک باشد نه 0`);
});
