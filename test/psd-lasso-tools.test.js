import test from 'node:test';
import assert from 'node:assert/strict';
import { Paint } from '../src/document/paint.js';
import { Layer } from '../src/document/layer.js';
import { Document } from '../src/document/document.js';

// ── PSD round-trip ──
import { encodePngLikePSD, decodePSD, isPSD, packBitsEncode, packBitsDecode } from '../src/formats/psd.js';

test('packBits: round-trip', () => {
  const src = new Uint8Array([0, 0, 0, 1, 2, 3, 250, 250, 250, 250, 250]);
  const enc = packBitsEncode(src);
  const dec = packBitsDecode(enc, src.length);
  assert.deepEqual([...dec], [...src]);
});

test('PSD encode → decode round-trip (RGBA)', () => {
  const w = 8, h = 6;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = (i * 30) & 255;
    data[i * 4 + 1] = (i * 70) & 255;
    data[i * 4 + 2] = (i * 110) & 255;
    data[i * 4 + 3] = i % 3 === 0 ? 0 : 255;
  }
  const buf = encodePngLikePSD({ width: w, height: h, data });
  assert.ok(isPSD(buf));
  const dec = decodePSD(buf);
  assert.equal(dec.width, w);
  assert.equal(dec.height, h);
  for (let i = 0; i < data.length; i++) assert.equal(dec.data[i], data[i], `byte ${i}`);
});

// ── lasso selections ──
import { polygonMask, lassoMask, ellipseMask } from '../src/engine/lasso.js';

test('polygonMask: مربع داخل، بیرون صفر', () => {
  const { mask } = polygonMask(20, 20, [[4, 4], [10, 4], [10, 10], [4, 10]]);
  assert.equal(mask[7 * 20 + 7], 1);  // داخل
  assert.equal(mask[2 * 20 + 2], 0);  // خارج
  assert.equal(mask[15 * 20 + 15], 0);
});

test('ellipseMask: مرکز داخل، گوشه خارج', () => {
  const { mask } = ellipseMask(20, 20, 10, 10, 5, 5);
  assert.equal(mask[10 * 20 + 10], 1);
  assert.equal(mask[0], 0);
});

// ── clone / healing ──
import { cloneStamp, healingStamp } from '../src/tools/clone.js';

test('cloneStamp: کپی از منبع با آفست', () => {
  const src = new Paint(20, 20);
  src.setPixel(3, 3, 255, 0, 0, 255);
  const dst = new Paint(20, 20);
  cloneStamp(src, dst, 10, 10, 5, 1, -7, -7, 1); // offx=3-10, offy=3-10
  const c = [0, 0, 0, 0];
  dst.getPixel(10, 10, c);
  assert.deepEqual(c, [255, 0, 0, 255]);
});

test('healingStamp: بدون throw و خروجی مات روی ناحیه', () => {
  const src = new Paint(20, 20);
  src.clearRect({ x: 0, y: 0, w: 20, h: 20 }, 100, 150, 200, 255);
  const dst = new Paint(20, 20);
  dst.clearRect({ x: 0, y: 0, w: 20, h: 20 }, 200, 100, 50, 255);
  healingStamp(src, dst, 10, 10, 4, 0.5, 0, 0, 1);
  const c = [0, 0, 0, 0];
  dst.getPixel(10, 10, c);
  assert.equal(c[3], 255);
});

// ── paint tools ──
import { pencilStamp, dodgeBurnStamp, blurStamp, sharpenStamp, magicEraser, snapshotRect, smudgeStamp } from '../src/tools/paintools.js';

test('pencilStamp: پیکسل سخت', () => {
  const p = new Paint(20, 20);
  pencilStamp(p, 5, 5, 3, [0, 0, 0, 255], 1);
  const c = [0, 0, 0, 0];
  p.getPixel(5, 5, c);
  assert.deepEqual(c, [0, 0, 0, 255]);
  p.getPixel(5, 1, c); // distance 4 > radius 3
  assert.equal(c[3], 0);
});

test('dodgeBurnStamp: داج روشن‌تر، برن تیره‌تر', () => {
  const p1 = new Paint(10, 10);
  p1.clearRect({ x: 0, y: 0, w: 10, h: 10 }, 120, 120, 120, 255);
  dodgeBurnStamp(p1, 5, 5, 3, 1, 0.8, 'midtones');
  const c1 = [0, 0, 0, 0]; p1.getPixel(5, 5, c1); assert.ok(c1[0] > 120, `dodge ${c1[0]}`);

  const p2 = new Paint(10, 10);
  p2.clearRect({ x: 0, y: 0, w: 10, h: 10 }, 120, 120, 120, 255);
  dodgeBurnStamp(p2, 5, 5, 3, 1, -0.8, 'midtones');
  const c2 = [0, 0, 0, 0]; p2.getPixel(5, 5, c2); assert.ok(c2[0] < 120, `burn ${c2[0]}`);
});

test('blurStamp: واریانس محلی کم می‌شود', () => {
  const p = new Paint(12, 12);
  // نیمهٔ چپ سیاه، نیمهٔ راست سفید
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) p.setPixel(x, y, x < 6 ? 0 : 255, x < 6 ? 0 : 255, x < 6 ? 0 : 255, 255);
  const c0 = [0, 0, 0, 0]; p.getPixel(6, 6, c0); assert.equal(c0[0], 255); // ابتدا لبه تیز
  blurStamp(p, 12, 12, 6, 6, 3, 0.6, 2);
  const c1 = [0, 0, 0, 0]; p.getPixel(6, 6, c1);
  assert.ok(c1[0] > 0 && c1[0] < 255, `blurred edge ${c1[0]}`);
});

test('sharpenStamp: بدون throw', () => {
  const p = new Paint(10, 10);
  p.clearRect({ x: 0, y: 0, w: 10, h: 10 }, 128, 128, 128, 255);
  sharpenStamp(p, 10, 10, 5, 5, 3, 0.5, 0.6);
  const c = [0, 0, 0, 0]; p.getPixel(5, 5, c); assert.equal(c[3], 255);
});

test('magicEraser: ناحیه هم‌رنگ شفاف', () => {
  const p = new Paint(10, 10);
  p.clearRect({ x: 0, y: 0, w: 10, h: 10 }, 50, 60, 70, 255);
  // یک ناحیه‌ی جدای دیگر
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) p.setPixel(x, y, 250, 250, 250, 255);
  magicEraser(p, 10, 10, 1, 1, 8, true);
  const c = [0, 0, 0, 0]; p.getPixel(1, 1, c); assert.equal(c[3], 0, 'ناحیه پاک شد');
  const c2 = [0, 0, 0, 0]; p.getPixel(5, 5, c2); assert.equal(c2[3], 255, 'خارج ناحیه دست نخورد');
});

test('snapshotRect + smudgeStamp: لکه‌کشی رنگ را جابه‌جا می‌کند', () => {
  const p = new Paint(12, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) p.setPixel(x, y, x < 2 ? 255 : 10, 10, 10, 255);
  const { snap, ox, oy } = snapshotRect(p, 6, 6, 6);
  assert.ok(snap.w >= 1 && snap.h >= 1);
  // کشیدن راست: لکه از x=1 (قرمز) به x=2 می‌ریزد
  smudgeStamp(snap, p, ox + 2, oy + 6, 2, 0.8, 1, 0, 0.6);
  const c = [0, 0, 0, 0]; p.getPixel(ox + 2, oy + 6, c);
  assert.ok(c[0] > 60, `smudged near ${c[0]}`);
});

// ── bitmap depth utils ──
import { u8ToU16, u16ToU8, u8ToF32, f32ToU8, maxDiff8 } from '../src/engine/bitmap.js';

test('u8→u16→u8 round-trip دقیق', () => {
  const src = new Uint8ClampedArray([10, 20, 30, 255, 128, 64, 32, 100]);
  const u16 = u8ToU16(src);
  const back = u16ToU8(u16);
  assert.equal(maxDiff8(src, back), 0);
});

test('u8→f32→u8 round-trip (خطای گرد ≤ 1)', () => {
  const src = new Uint8ClampedArray(400);
  for (let i = 0; i < 100; i++) { src[i * 4] = (i * 2) & 255; src[i * 4 + 1] = (i * 3) & 255; src[i * 4 + 2] = (i * 5) & 255; src[i * 4 + 3] = 255; }
  const f32 = u8ToF32(src);
  const back = f32ToU8(f32);
  assert.ok(maxDiff8(src, back) <= 1, `diff=${maxDiff8(src, back)}`);
});

// ── groups / clipping / vector mask in compositor ──
test('group opacity: اعضا کمرنگ‌تر می‌شوند', () => {
  const doc = new Document({ width: 40, height: 40 });
  const bg = new Layer({ name: 'bg', paint: new Paint(40, 40) });
  bg.paint.clearRect({ x: 0, y: 0, w: 40, h: 40 }, 255, 255, 255, 255);
  doc.addLayer(bg);
  const grp = new Layer({ name: 'G', isGroup: true, opacity: 0.5 });
  const red = new Layer({ name: 'r', paint: new Paint(40, 40), opacity: 1 });
  red.paint.clearRect({ x: 0, y: 0, w: 20, h: 40 }, 255, 0, 0, 255);
  const end = new Layer({ name: 'EG', isGroupEnd: true });
  doc.addLayer(grp); doc.addLayer(red); doc.addLayer(end);
  const flat = doc.flatten();
  const c = [0, 0, 0, 0];
  flat.getPixel(5, 20, c);
  // قرمز با opacity گروه 0.5 روی سفید؛ کامپوزیت در فضای خطی → 187 (معادل فتوشاپ)
  assert.equal(c[0], 255);
  assert.ok(Math.abs(c[1] - 187) <= 2, `green=${c[1]}`);
  assert.ok(Math.abs(c[2] - 187) <= 2, `blue=${c[2]}`);
});

test('clipping mask: لایهٔ بالا فقط داخل آلفای زیرین', () => {
  const doc = new Document({ width: 40, height: 40 });
  const base = new Layer({ name: 'base', paint: new Paint(40, 40) });
  base.paint.clearRect({ x: 5, y: 5, w: 10, h: 10 }, 255, 255, 255, 255); // مربع سفید
  const clip = new Layer({ name: 'clip', paint: new Paint(40, 40), clipToBelow: true });
  clip.paint.clearRect({ x: 0, y: 0, w: 40, h: 40 }, 0, 0, 255, 255); // آبی سراسری
  doc.addLayer(base); doc.addLayer(clip);
  const flat = doc.flatten();
  const cIn = [0, 0, 0, 0]; flat.getPixel(8, 8, cIn);
  assert.deepEqual(cIn, [0, 0, 255, 255], 'داخل مربع آبی');
  const cOut = [0, 0, 0, 0]; flat.getPixel(2, 2, cOut);
  assert.equal(cOut[3], 0, 'خارج مربع شفاف');
});

test('vector mask: فقط ناحیهٔ ماسک دیده می‌شود', () => {
  const doc = new Document({ width: 40, height: 40 });
  const l = new Layer({ name: 'v', paint: new Paint(40, 40) });
  l.paint.clearRect({ x: 0, y: 0, w: 40, h: 40 }, 0, 200, 0, 255);
  const m = new Uint8Array(40 * 40);
  // نیمهٔ چپ
  for (let y = 0; y < 40; y++) for (let x = 0; x < 20; x++) m[y * 40 + x] = 1;
  l.vectorMask = { mask: m, w: 40, h: 40 };
  doc.addLayer(l);
  const flat = doc.flatten();
  const cL = [0, 0, 0, 0]; flat.getPixel(5, 20, cL); assert.equal(cL[1], 200, 'چپ سبز');
  const cR = [0, 0, 0, 0]; flat.getPixel(30, 20, cR); assert.equal(cR[3], 0, 'راست شفاف');
});

// ── layer style: drop shadow ──
import { renderDropShadow } from '../src/engine/layerstyle.js';

test('renderDropShadow: سایه زیر شیء', () => {
  const paint = new Paint(30, 30);
  paint.clearRect({ x: 10, y: 10, w: 10, h: 10 }, 255, 255, 255, 255);
  const shadow = renderDropShadow(paint, 30, 30, { dx: 4, dy: 5, blur: 4, color: [0, 0, 0, 255], opacity: 0.6 });
  const c = [0, 0, 0, 0];
  shadow.getPixel(16, 7, c); // بالای شیء؟ باید شفاف
  assert.equal(c[3], 0, 'بالا شفاف');
  shadow.getPixel(10 + 10 + 3, 10 + 10 + 3, c); // پایین-راست شیء: سایهٔ محو
  assert.ok(c[3] > 0, 'سایه زیر شیء وجود دارد');
  shadow.getPixel(12, 12, c); // داخل شیء: شفاف (سایه پشت شیء)
  assert.equal(c[3], 0, 'داخل شیء شفاف');
});
