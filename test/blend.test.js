import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blendChannel, blendColor, compositeOver, compositePixelU8, BLEND_MODES, hash2,
} from '../src/engine/blend.js';
import { u8ToLinear } from '../src/engine/color.js';

// ثابت مرجع: srgbToLinear(0.5) = 0.21404114048223255
const C = 0.21404114048223255;

test('BLEND_MODES: هر ۲۷ مد لیست شده', () => {
  assert.equal(BLEND_MODES.length, 27);
  assert.equal(new Set(BLEND_MODES).size, 27, 'بدون تکرار');
});

test('blendChannel normal = خود منبع', () => {
  assert.equal(blendChannel('normal', 0.3, 0.7), 0.7);
});

test('multiply: cb*cs', () => {
  assert.ok(Math.abs(blendChannel('multiply', 0.5, 0.5) - 0.25) < 1e-12);
});

test('screen: 0.5 روی 0.5 = 0.75', () => {
  assert.ok(Math.abs(blendChannel('screen', 0.5, 0.5) - 0.75) < 1e-12);
});

test('overlay: زیر ۰.۵ → multiply*2 ، بالای ۰.۵ → screen', () => {
  assert.ok(Math.abs(blendChannel('overlay', 0.25, 0.5) - 0.25) < 1e-12);  // 2*0.25*0.5
  assert.ok(Math.abs(blendChannel('overlay', 0.75, 0.5) - 0.75) < 1e-12);  // screen
});

test('darken / lighten', () => {
  assert.equal(blendChannel('darken', 0.6, 0.4), 0.4);
  assert.equal(blendChannel('lighten', 0.6, 0.4), 0.6);
});

test('colorDodge: cb / (1-cs)', () => {
  assert.ok(Math.abs(blendChannel('colorDodge', 0.5, 0.5) - 1) < 1e-12); // 0.5/0.5
  assert.ok(Math.abs(blendChannel('colorDodge', 0.25, 0.5) - 0.5) < 1e-12);
});

test('colorBurn: 1 - (1-cb)/cs', () => {
  assert.ok(Math.abs(blendChannel('colorBurn', 0.5, 0.5) - 0) < 1e-12);  // 1 - 0.5/0.5
  assert.ok(Math.abs(blendChannel('colorBurn', 0.25, 0.5) - (0.25 - 0.25)) < 1e-12); // نمایش مرزی، فقط بدون NaN
});

test('linearDodge = جمع، linearBurn = جمع-1', () => {
  assert.ok(Math.abs(blendChannel('linearDodge', 0.4, 0.4) - 0.8) < 1e-12);
  assert.ok(Math.abs(blendChannel('linearBurn', 0.4, 0.8) - 0.2) < 1e-12);
});

test('difference = |cb-cs| ، exclusion = cb+cs-2cbcs', () => {
  assert.ok(Math.abs(blendChannel('difference', 0.7, 0.2) - 0.5) < 1e-12);
  assert.ok(Math.abs(blendChannel('exclusion', 0.5, 0.5) - 0.5) < 1e-12);
});

test('divide: cb/cs ؛ منبع سیاه → سفید طبق مشخصات W3C', () => {
  assert.ok(Math.abs(blendChannel('divide', 0.5, 0.5) - 1) < 1e-12);
  assert.equal(blendChannel('divide', 0.3, 0), 1);   // تقسیم بر صفر → ۱ (white)
  assert.equal(blendChannel('divide', 0, 0.3), 0);   // زمینه سیاه → ۰
  assert.equal(blendChannel('divide', 0.3, 0), 1);   // ثابت‌ماندن رفتار صفر/صفر
});

test('hardMix آستانه‌ای', () => {
  assert.equal(blendChannel('hardMix', 0.6, 0.6), 1);
  assert.equal(blendChannel('hardMix', 0.2, 0.2), 0);
});

test('softLight: نقطع مرجع cs=0.5 (ساخته‌شده میانه)', () => {
  const v = blendChannel('softLight', 0.6, 0.5);
  assert.ok(v > 0 && v < 1, `softlight=${v}`);
});

test('subtract: منفی نمی‌شود', () => {
  assert.equal(blendChannel('subtract', 0.2, 0.5), 0);
  assert.ok(Math.abs(blendChannel('subtract', 0.8, 0.5) - 0.3) < 1e-12);
});

// ---------- compositeOver: مقادیر مرجع محاسبه‌شده‌ی دستی ----------

test('compositeOver: منبع کاملاً مات روی زمینه مات (normal) = منبع', () => {
  const r = compositeOver([0.1, 0.2, 0.3], 1, [0.7, 0.8, 0.9], 1, 'normal', 1);
  assert.deepEqual(round4(r), [0.7, 0.8, 0.9, 1]);
});

test('compositeOver: منبع نیمه‌شفاف ۰.۵ روی پس‌زمینه مات ۰.۵ (normal) = ۱:۱', () => {
  // bs=0.5, bb=0.5, هر دو مستقیم؛ Cs=0.5, Cb=0.5
  const r = compositeOver([0.5, 0.5, 0.5], 1, [0.5, 0.5, 0.5], 0.5, 'normal', 1);
  // as=0.5, ab=1 → co = 0.5*(1-1)*0.5 + 0.5*1*0.5 + (1-0.5)*1*0.5 = 0 + 0.25 + 0.25 = 0.5
  // ao = 0.5 + 1*0.5 = 1 → مستقیماً 0.5
  assert.deepEqual(round4(r), [0.5, 0.5, 0.5, 1]);
});

test('compositeOver: نیمه روی هیچ (آلفای زمینه ۰) = منبع با آلفای خودش', () => {
  const r = compositeOver([0, 0, 0], 0, [0.4, 0.6, 0.8], 0.5, 'normal', 1);
  assert.deepEqual(round4(r), [0.4, 0.6, 0.8, 0.5]);
});

test('compositeOver: multiply فقط در ناحیه‌ی همپوشانی α', () => {
  // زمینه مات 0.5، منبع مات 0.4 → αo=1, B=0.2، مشارکت‌ها: (1-αs)=0 → فقط αs*αb*B=0.2
  const r = compositeOver([0.5, 0.5, 0.5], 1, [0.4, 0.4, 0.4], 1, 'multiply', 1);
  assert.deepEqual(round4(r), [0.2, 0.2, 0.2, 1]);
});

test('compositeOver: opacity 0.5 یعنی آلفای مؤثر نصف → نیمه روی زمینه مات = LERP ۵۰٪', () => {
  const r = compositeOver([0.2, 0.2, 0.2], 1, [0.6, 0.6, 0.6], 1, 'normal', 0.5);
  // as=0.5, ab=1 → co = 0.5*(0)*cs + 0.5*1*cs + 0.5*1*cb = 0.5*0.6 + 0.5*0.2 = 0.4
  assert.deepEqual(round4(r), [0.4, 0.4, 0.4, 1]);
});

// ---------- سطح u8: cross-check با تبدیل دستی ----------

test('compositePixelU8: نیمه شفاف قرمز روی سفید (middle gray به معنی sRGB)', () => {
  // top=rgba(255,0,0,128) bottom=rgba(255,255,255,255) normal
  // در فضای خطی: قرمز خطی 1، آلفای منبع ≈ 128/255 = 0.5020
  // co_linear_r = as*cs_r + (1-as)*cb_r = 0.5020*1 + 0.498*1 = 1 → خروجی قرمز 255
  // g: as*0 + (1-as)*1 = 0.498 → linearToSrgb(0.498) ≈ ؟ باید محاسبه شود، اما انتظار ~186
  const res = compositePixelU8([255, 255, 255, 255], [255, 0, 0, 128], 'normal', 1);
  const lc = u8ToLinear(res[0], res[1], res[2], res[3]);
  // αo باید 2*awhite حفظ شود: گرد ۱۲۸+۱۲۷≈۲۵۵
  assert.equal(res[3], 255, `alpha=${res[3]}`);
  assert.equal(res[0], 255, `red=${res[0]}`);
  assert.ok(res[1] >= 186 && res[1] <= 187, `green=${res[1]}`);
});

test('compositePixelU8: multiply مشکی روی سفید = سیاه', () => {
  const r = compositePixelU8([255, 255, 255, 255], [0, 0, 0, 255], 'multiply', 1);
  assert.deepEqual(r, [0, 0, 0, 255]);
});

test('compositePixelU8: منبع کاملاً شفاف → بدون تغییر', () => {
  const r = compositePixelU8([10, 20, 30, 40], [200, 200, 200, 0], 'multiply', 1);
  assert.deepEqual(r, [10, 20, 30, 40]);
});

test('hash2: قطعی و در بازه [0,1)', () => {
  const a = hash2(3, 7), b = hash2(3, 7), c = hash2(4, 7);
  assert.equal(a, b);
  assert.ok(a >= 0 && a < 1);
  assert.ok(c !== a);
});

function round4(a) { return a.map((v) => Math.round(v * 10000) / 10000); }
