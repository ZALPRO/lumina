import test from 'node:test';
import assert from 'node:assert/strict';
import { quantize, quantizeImageFrame } from '../src/utils/quantize.js';

test('quantize: آستانه ۱۲۷/۱۲۸', () => {
  assert.equal(quantize(0), 0);
  assert.equal(quantize(127), 0);
  assert.equal(quantize(128), 255);
  assert.equal(quantize(255), 255);
});

test('quantizeImageFrame: خروجی فقط ۰/۲۵۵ و میانگین ≈ ۲۰۰', () => {
  const w = 16, h = 16;
  const src = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    src[i * 4] = 200; src[i * 4 + 1] = 200; src[i * 4 + 2] = 200; src[i * 4 + 3] = 255;
  }
  const out = quantizeImageFrame(src, w, h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) {
    const v = out[i * 4];
    assert.ok(v === 0 || v === 255, `pixel ${i} = ${v}`);
    sum += v;
    assert.equal(out[i * 4 + 3], 255); // آلفا دست‌نخورده
  }
  const mean = sum / (w * h);
  assert.ok(Math.abs(mean - 200) <= 12, `mean=${mean}`);
});

test('quantizeImageFrame: آلفا هرگز عوض نمی‌شود', () => {
  const w = 4, h = 4;
  const src = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { src[i * 4 + 3] = (i * 17) % 256; }
  const out = quantizeImageFrame(src, w, h);
  for (let i = 0; i < w * h; i++) assert.equal(out[i * 4 + 3], (i * 17) % 256);
});

test('quantizeImageFrame: میانگین مکانی حفظ می‌شود (خاصیت دither)', () => {
  // نیمه خاکستری ۱۲۸ → نیمی سفید نیمی سیاه در هر خط تقریباً
  const w = 64, h = 64;
  const src = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { src[i * 4] = 128; src[i * 4 + 1] = 128; src[i * 4 + 2] = 128; src[i * 4 + 3] = 255; }
  const out = quantizeImageFrame(src, w, h);
  let dark = 0;
  for (let i = 0; i < w * h; i++) if (out[i * 4] === 0) dark++;
  const ratio = dark / (w * h);
  assert.ok(ratio > 0.4 && ratio < 0.6, `ratio=${ratio}`);
});
