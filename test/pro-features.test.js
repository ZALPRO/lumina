// test/pro-features.test.js — تست قابلیت‌های حرفه‌ایِ افزوده‌شده
// COW واقعی، تاریخچهٔ یکپارچه (سند + پیکسل)، TIFF، و مشخصات متن.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Paint } from '../src/document/paint.js';
import { Layer } from '../src/document/layer.js';
import { Document } from '../src/document/document.js';
import { LayeredHistory, captureDoc, restoreDoc } from '../src/document/history.js';
import { decodeTIFF, encodeTIFF, isTIFF } from '../src/formats/tiff.js';
import { detectFormat, formatFromName, decodeImage } from '../src/formats/imageio.js';
import { defaultTextSpec, clampTextSpec, canvasFont, layoutLines } from '../src/text/spec.js';

/* ─────────────── COW واقعی ─────────────── */
test('COW: clone() کپی عمیق است — ویرایش کپی، اصل را تغییر نمی‌دهد', () => {
  const a = new Paint(64, 64);
  a.setPixel(10, 10, 255, 0, 0, 255);
  const b = a.clone();
  b.setPixel(10, 10, 0, 255, 0, 255);
  const pa = new Array(4), pb = new Array(4);
  a.getPixel(10, 10, pa); b.getPixel(10, 10, pb);
  assert.deepEqual(pa.slice(0, 3), [255, 0, 0], 'اصل باید قرمز بماند');
  assert.deepEqual(pb.slice(0, 3), [0, 255, 0], 'کپی باید سبز شود');
});

test('COW: cloneCoW بافر را تا اولین نوشتن به اشتراک می‌گذارد و سپس detach می‌کند', () => {
  const a = new Paint(300, 300);           // چند کاشی
  a.setPixel(5, 5, 10, 20, 30, 255);
  const t0 = a.getTile(0, 0);
  const b = a.cloneCoW();
  const bt0 = b.getTile(0, 0);
  assert.equal(bt0.data, t0.data, 'قبل از نوشتن: همان بافر مشترک');
  assert.equal(bt0._cowShared, true, 'پرچم اشتراک باید ست باشد');
  b.setPixel(5, 5, 200, 200, 200, 255);    // اولین نوشتن → detach
  assert.notEqual(b.getTile(0, 0).data, t0.data, 'بعد از نوشتن: بافر جدا شود');
  const pa = new Array(4), pb = new Array(4);
  a.getPixel(5, 5, pa); b.getPixel(5, 5, pb);
  assert.notDeepEqual(pa, pb, 'دو لایه نباید به هم بچسبند');
  assert.deepEqual(pa, [10, 20, 30, 255], 'اصل دست‌نخورده بماند');
});

test('COW: کاشی‌های دیگر پس از detach همچنان مشترک می‌مانند (حافظهٔ کم)', () => {
  const a = new Paint(600, 300);
  a.setPixel(5, 5, 1, 2, 3, 255);          // کاشی (0,0)
  a.setPixel(300, 5, 9, 9, 9, 255);        // کاشی (1,0)
  const b = a.cloneCoW();
  b.setPixel(5, 5, 255, 255, 255, 255);    // فقط کاشی اول detach می‌شود
  assert.notEqual(b.getTile(0, 0).data, a.getTile(0, 0).data);
  assert.equal(b.getTile(1, 0).data, a.getTile(1, 0).data, 'کاشی دست‌نخورده مشترک بماند');
});

/* ─────────────── تاریخچهٔ سند ─────────────── */
function mkDoc() {
  const doc = new Document({ width: 64, height: 64, name: 'T' });
  const p = new Paint(64, 64);
  p.setPixel(1, 1, 255, 0, 0, 255);
  doc.addLayer(new Layer({ name: 'Base', paint: p }));
  return doc;
}

test('LayeredHistory: افزودن لایه undo/redo می‌شود', () => {
  const doc = mkDoc();
  const h = new LayeredHistory();
  assert.equal(doc.layers.length, 1);
  h.recordDoc(doc, 'Add Layer');
  doc.addLayer(new Layer({ name: 'L2', paint: new Paint(64, 64) }));
  assert.equal(doc.layers.length, 2);
  assert.equal(h.undo(), true);
  assert.equal(doc.layers.length, 1, 'undo باید لایه را بردارد');
  assert.equal(h.redo(), true);
  assert.equal(doc.layers.length, 2, 'redo باید لایه را برگرداند');
});

test('LayeredHistory: حذف لایه قابل بازگشت است (با همان ارجاع لایه)', () => {
  const doc = mkDoc();
  const h = new LayeredHistory();
  const extra = new Layer({ name: 'Extra', paint: new Paint(64, 64) });
  doc.addLayer(extra);
  h.recordDoc(doc, 'Delete Layer');
  doc.removeLayer(extra);
  assert.equal(doc.layers.length, 1);
  h.undo();
  assert.equal(doc.layers.length, 2);
  assert.equal(doc.layers[1], extra, 'همان لایهٔ اصلی برگردد (نه کپی)');
});

test('LayeredHistory: تغییر opacity و blend undo می‌شود', () => {
  const doc = mkDoc();
  const h = new LayeredHistory();
  const l = doc.layers[0];
  h.recordDoc(doc, 'Layer Opacity');
  l.opacity = 0.3;
  h.recordDoc(doc, 'Blend Mode');
  l.blendMode = 'multiply';
  h.undo();
  assert.equal(l.blendMode, 'normal', 'blend برگردد');
  h.undo();
  assert.equal(l.opacity, 1, 'opacity برگردد');
});

test('LayeredHistory: ترتیب لایه‌ها undo می‌شود', () => {
  const doc = mkDoc();
  const h = new LayeredHistory();
  const a = doc.layers[0], b = new Layer({ name: 'B', paint: new Paint(64, 64) });
  doc.addLayer(b);
  h.recordDoc(doc, 'Move Layer Down');
  doc.layers.splice(1, 1); doc.layers.splice(0, 0, b);   // B به پایین
  assert.equal(doc.layers[0], b);
  h.undo();
  assert.equal(doc.layers[0], a, 'ترتیب اصلی برگردد');
});

test('LayeredHistory: jumpToDepth چند گام عقب/جلو می‌برد', () => {
  const doc = mkDoc();
  const h = new LayeredHistory();
  for (let i = 0; i < 3; i++) {
    h.recordDoc(doc, 'Add Layer');
    doc.addLayer(new Layer({ name: 'L' + i, paint: new Paint(64, 64) }));
  }
  assert.equal(doc.layers.length, 4);
  h.jumpToDepth(1, 'Open');
  assert.equal(doc.layers.length, 2, 'پرش به حالت ۱');
  h.jumpToDepth(3, 'Open');
  assert.equal(doc.layers.length, 4, 'پرش به حالت ۳');
});

test('LayeredHistory: labels فهرست درست می‌دهد', () => {
  const doc = mkDoc();
  const h = new LayeredHistory();
  h.recordDoc(doc, 'Add Layer');
  h.recordDoc(doc, 'Filter');
  assert.deepEqual(h.labels('Open'), ['Open', 'Add Layer', 'Filter']);
  h.undo();
  assert.deepEqual(h.labels('Open'), ['Open', 'Add Layer'], 'پس از undo یک حالت کم می‌شود');
});

test('captureDoc/restoreDoc: خواص لایه را بازمی‌گرداند', () => {
  const doc = mkDoc();
  const l = doc.layers[0];
  l.name = 'X'; l.opacity = 0.5; l.blendMode = 'screen';
  const snap = captureDoc(doc);
  l.name = 'Y'; l.opacity = 1; l.blendMode = 'normal';
  restoreDoc(doc, snap);
  assert.equal(l.name, 'X');
  assert.equal(l.opacity, 0.5);
  assert.equal(l.blendMode, 'screen');
});

/* ─────────────── TIFF ─────────────── */
test('TIFF: امضا درست شناسایی می‌شود و پسوند → tiff', () => {
  const t = encodeTIFF({ width: 2, height: 2, data: new Uint8ClampedArray(16) });
  assert.equal(isTIFF(t), true);
  assert.equal(detectFormat(t), 'tiff');
  assert.equal(formatFromName('photo.TIF'), 'tiff');
  assert.equal(formatFromName('scan.tiff'), 'tiff');
});

test('TIFF: round-trip encode → decode (RGBA) بدون افت', async () => {
  const w = 7, h = 5;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = (i * 37) & 255;
    data[i * 4 + 1] = (i * 91) & 255;
    data[i * 4 + 2] = (255 - i * 13) & 255;
    data[i * 4 + 3] = 255;
  }
  const t = encodeTIFF({ width: w, height: h, data });
  const out = await decodeTIFF(t);
  assert.equal(out.width, w);
  assert.equal(out.height, h);
  for (let i = 0; i < w * h; i++) {
    assert.equal(out.data[i * 4], data[i * 4], `R@${i}`);
    assert.equal(out.data[i * 4 + 1], data[i * 4 + 1], `G@${i}`);
    assert.equal(out.data[i * 4 + 2], data[i * 4 + 2], `B@${i}`);
  }
});

test('TIFF: decodeImage از مسیر عمومی هم کار می‌کند', async () => {
  const w = 4, h = 4;
  const data = new Uint8ClampedArray(w * h * 4).fill(200);
  const t = encodeTIFF({ width: w, height: h, data });
  const out = await decodeImage(t);
  assert.equal(out.width, 4);
  assert.equal(out.data[0], 200);
});

test('TIFF: ساختار هدر استاندارد است (تگ‌های اصلی موجودند)', () => {
  const t = encodeTIFF({ width: 3, height: 2, data: new Uint8ClampedArray(24) });
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  assert.equal(dv.getUint16(0, true), 0x4949, 'II');
  assert.equal(dv.getUint16(2, true), 42, 'magic 42');
  const ifd = dv.getUint32(4, true);
  const count = dv.getUint16(ifd, true);
  assert.equal(count >= 12, true, 'IFD باید حداقل ۱۲ تگ داشته باشد');
  const tags = new Set();
  for (let i = 0; i < count; i++) tags.add(dv.getUint16(ifd + 2 + i * 12, true));
  for (const t2 of [256, 257, 258, 259, 262, 273, 277, 278, 279]) {
    assert.equal(tags.has(t2), true, `تگ ${t2} باید باشد`);
  }
});

test('TIFF: حالت بدون آلفا ۳ کاناله نوشته می‌شود', () => {
  const t = encodeTIFF({ width: 2, height: 2, data: new Uint8ClampedArray(16) }, { alpha: false });
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const ifd = dv.getUint32(4, true);
  const count = dv.getUint16(ifd, true);
  let samples = 0;
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (dv.getUint16(e, true) === 277) samples = dv.getUint16(e + 8, true);
  }
  assert.equal(samples, 3);
});

/* ─────────────── متن ─────────────── */
test('Text: مشخصات پیش‌فرض کامل است', () => {
  const s = defaultTextSpec();
  for (const k of ['content', 'font', 'size', 'color', 'align', 'lineHeight', 'x', 'y']) {
    assert.equal(k in s, true, `کلید ${k}`);
  }
  assert.equal(s.size, 64);
});

test('Text: clamp مقادیر نامعتبر را اصلاح می‌کند', () => {
  const s = clampTextSpec({ ...defaultTextSpec(), size: -5, align: 'weird', strokeWidth: -3, lineHeight: 99 }, { width: 100, height: 100 });
  assert.equal(s.size, 4, 'سایز منفی → حداقل ۴');
  assert.equal(s.align, 'left', 'تراز نامعتبر → left');
  assert.equal(s.strokeWidth, 0);
  assert.equal(s.lineHeight, 4);
});

test('Text: clamp موقعیت را داخل بوم نگه می‌دارد', () => {
  const s = clampTextSpec({ ...defaultTextSpec(), x: 9999, y: -50 }, { width: 800, height: 600 });
  assert.equal(s.x, 800);
  assert.equal(s.y, 0);
});

test('Text: canvasFont وزن/ایتالیک/سایز را درست می‌سازد', () => {
  const f = canvasFont({ font: 'Vazirmatn', size: 48, bold: true, italic: true });
  assert.equal(f.includes('italic'), true);
  assert.equal(f.includes('700'), true);
  assert.equal(f.includes('48px'), true);
  assert.equal(f.includes('Vazirmatn'), true);
});

test('Text: layoutLines خطوط را با عرض حداکثر می‌شکند', () => {
  const fakeG = { measureText: (s) => ({ width: s.length * 10 }) };
  const lines = layoutLines(fakeG, 'aaa bbb ccc ddd', 70);
  assert.equal(lines.length >= 2, true, 'باید به چند خط بشکند');
  assert.equal(lines.join(' ').replace(/\s+/g, ' ').trim(), 'aaa bbb ccc ddd', 'متن باید حفظ شود');
});

test('Text: layoutLines احترام به \\n', () => {
  const fakeG = { measureText: (s) => ({ width: s.length * 10 }) };
  const lines = layoutLines(fakeG, 'one\ntwo\nthree', 0);
  assert.deepEqual(lines, ['one', 'two', 'three']);
});

/* ─────────────── بُعد جدید: سرصفحهٔ فرمت‌ها ─────────────── */
test('imageio: فرمت‌های WEBP/GIF/TIFF از magic bytes شناسایی می‌شوند', () => {
  const webp = new Uint8Array(16);
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50], 0);
  assert.equal(detectFormat(webp), 'webp');
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]);
  assert.equal(detectFormat(gif), 'gif');
});

/* ─────────────── ICC (مدیریت رنگ) ─────────────── */
test('ICC: پروفایل sRGB ساخته می‌شود و ساختار لازم را دارد', async () => {
  const { srgbProfile, isICC, describeICC } = await import('../src/formats/icc.js');
  const p = srgbProfile();
  assert.equal(isICC(p), true, 'امضای acsp');
  assert.equal(p.length >= 128, true, 'هدر ۱۲۸ بایتی');
  assert.equal((p[0] << 24 | p[1] << 16 | p[2] << 8 | p[3]) >>> 0, p.length, 'اندازه در هدر = اندازه واقعی');
  assert.equal(describeICC(p), 'Lumina sRGB IEC61966-2.1');
});

test('ICC: جدول تگ‌ها همهٔ تگ‌های الزامی RGB را دارد', async () => {
  const { srgbProfile } = await import('../src/formats/icc.js');
  const p = srgbProfile();
  const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
  const n = dv.getUint32(128, false);
  const names = [];
  for (let i = 0; i < n; i++) {
    const e = 132 + i * 12;
    names.push(String.fromCharCode(p[e], p[e + 1], p[e + 2], p[e + 3]));
  }
  for (const t of ['desc', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC', 'cprt']) {
    assert.equal(names.includes(t), true, `تگ ${t}`);
  }
});

test('ICC: PNG خروجی بلوک iCCP دارد و پروفایل درست است', async () => {
  const { encodePng, decodePng } = await import('../src/formats/png.js');
  const { srgbProfile } = await import('../src/formats/icc.js');
  const w = 4, h = 4;
  const data = new Uint8ClampedArray(w * h * 4).fill(100);
  const png = await encodePng({ width: w, height: h, data }, { icc: srgbProfile() });
  const s = Buffer.from(png).toString('latin1');
  assert.equal(s.includes('iCCP'), true, 'بلوک iCCP');
  assert.equal(s.includes('gAMA'), true, 'بلوک gAMA');
  // دیکودر خودمان باید همچنان فایل را بخواند
  const back = await decodePng(png);
  assert.equal(back.width, w);
});

test('ICC: JPEG خروجی سگمنت APP2 با هدر ICC_PROFILE دارد', async () => {
  const { encodeJPEG } = await import('../src/formats/jpeg.js');
  const { srgbProfile } = await import('../src/formats/icc.js');
  const w = 8, h = 8;
  const data = new Uint8ClampedArray(w * h * 4).fill(150);
  const jpg = encodeJPEG({ width: w, height: h, data }, 90, { icc: srgbProfile() });
  const s = Buffer.from(jpg).toString('latin1');
  assert.equal(s.includes('ICC_PROFILE'), true, 'سگمنت APP2');
  assert.equal(jpg[0], 0xFF); assert.equal(jpg[1], 0xD8);
});

test('ICC: TIFF تگ 34675 را می‌نویسد', () => {
  const w = 4, h = 4;
  const stubs = new Uint8ClampedArray(w * h * 4).fill(90);
  const t = encodeTIFF({ width: w, height: h, data: stubs }, { icc: new Uint8Array(300).fill(7) });
  const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
  const ifd = dv.getUint32(4, true);
  const n = dv.getUint16(ifd, true);
  let found = null;
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (dv.getUint16(e, true) === 34675) found = dv.getUint32(e + 8, true);
  }
  assert.notEqual(found, null, 'تگ ICCProfile باید باشد');
  assert.equal(t[found], 7, 'محتوای پروفایل درست نوشته شده');
});

test('ICC: encodeImage پیش‌فرض پروفایل را جاسازی می‌کند و با embedICC=false نه', async () => {
  const { encodeImage } = await import('../src/formats/imageio.js');
  const w = 4, h = 4;
  const data = new Uint8ClampedArray(w * h * 4).fill(80);
  const withICC = await encodeImage({ width: w, height: h, data }, 'png');
  const without = await encodeImage({ width: w, height: h, data }, 'png', { embedICC: false });
  assert.equal(Buffer.from(withICC).toString('latin1').includes('iCCP'), true);
  assert.equal(Buffer.from(without).toString('latin1').includes('iCCP'), false);
  assert.equal(withICC.length > without.length, true, 'پروفایل حجم اضافه می‌کند');
});

/* ─────────────── DNG/RAW ─────────────── */
test('DNG: فایل TIFF معمولی dng تشخیص داده نمی‌شود', () => {
  const t = encodeTIFF({ width: 2, height: 2, data: new Uint8ClampedArray(16) });
  assert.equal(detectFormat(t), 'tiff');
});

test('DNG: فایل با تگ DNGVersion به‌عنوان dng شناسایی می‌شود', async () => {
  const { isDNG } = await import('../src/formats/tiff.js');
  // ساخت TIFF دستی با یک تگ DNGVersion
  const entries = 1;
  const ifdOff = 8;
  const size = ifdOff + 2 + entries * 12 + 4 + 4;
  const buf = new Uint8Array(size);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x49; buf[1] = 0x49; dv.setUint16(2, 42, true); dv.setUint32(4, ifdOff, true);
  dv.setUint16(ifdOff, entries, true);
  const e = ifdOff + 2;
  dv.setUint16(e, 50706, true);      // DNGVersion
  dv.setUint16(e + 2, 1, true);      // BYTE
  dv.setUint32(e + 4, 4, true);      // count
  dv.setUint32(e + 8, ifdOff + 2 + entries * 12 + 4, true);
  buf[ifdOff + 2 + entries * 12 + 4] = 1; buf[ifdOff + 2 + entries * 12 + 5] = 4;
  assert.equal(isDNG(buf), true, 'DNGVersion → DNG');
});

/* ─────────────── PSD چندلایه (تبادل با فتوشاپ) ─────────────── */
async function mkDocWithLayers() {
  const { Document } = await import('../src/document/document.js');
  const { Paint } = await import('../src/document/paint.js');
  const { Layer } = await import('../src/document/layer.js');
  const W = 48, H = 32;
  const doc = new Document({ width: W, height: H, name: 'T' });
  const p1 = new Paint(W, H);
  p1.clearRect({ x: 0, y: 0, w: W, h: H }, 200, 30, 30, 255);
  doc.addLayer(new Layer({ name: 'Base', paint: p1 }));
  const p2 = new Paint(W, H);
  p2.clearRect({ x: 4, y: 4, w: 20, h: 20 }, 20, 20, 220, 180);
  doc.addLayer(new Layer({ name: 'Box', paint: p2, opacity: 0.6, blendMode: 'screen' }));
  doc.addLayer(new Layer({ name: 'Grp', isGroup: true }));
  const p3 = new Paint(W, H);
  p3.clearRect({ x: 26, y: 10, w: 16, h: 14 }, 30, 200, 60, 255);
  doc.addLayer(new Layer({ name: 'Inner', paint: p3 }));
  doc.addLayer(new Layer({ name: '</Layer group>', isGroupEnd: true }));
  doc.addLayer(new Layer({ name: 'Inv', adjustment: { type: 'invert', label: 'Invert' } }));
  doc.addLayer(new Layer({ name: 'Hidden', paint: p3, visible: false }));
  return doc;
}

test('PSD: نویسندهٔ چندلایه فایل معتبر می‌سازد (هدر + بخش‌ها)', async () => {
  const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
  const doc = await mkDocWithLayers();
  const buf = await encodeLayeredPSD(doc, { composite: doc.toRGBA() });
  assert.equal(String.fromCharCode(buf[0], buf[1], buf[2], buf[3]), '8BPS');
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  assert.equal(dv.getUint16(4, false), 1, 'نسخهٔ PSD');
  assert.equal(dv.getUint16(12, false), 4, 'کانال‌ها = RGB+A');
  assert.equal(dv.getUint32(14, false), 32, 'ارتفاع');
  assert.equal(dv.getUint32(18, false), 48, 'عرض');
  assert.equal(dv.getUint16(22, false), 8, 'عمق ۸ بیت');
  assert.equal(dv.getUint16(24, false), 3, 'state رنگی RGB');
});

test('PSD: خوانندهٔ چندلایه ساختار لایه‌ها را بازمی‌گرداند', async () => {
  const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD, psdHasLayers } = await import('../src/formats/psd-read.js');
  const doc = await mkDocWithLayers();
  const buf = await encodeLayeredPSD(doc, { composite: doc.toRGBA() });
  assert.equal(psdHasLayers(buf), true, 'تشخیص وجود لایه');
  const out = await decodeLayeredPSD(buf);
  assert.equal(out.width, 48);
  assert.equal(out.height, 32);
  const names = out.layers.map((l) => l.name);
  assert.equal(names.includes('Base'), true);
  assert.equal(names.includes('Box'), true);
  assert.equal(names.includes('Inner'), true);
  assert.equal(names.includes('Hidden'), true);
  assert.equal(names.includes('Inv'), true);
});

test('PSD: blend mode، opacity، visibility و clipping حفظ می‌شوند', async () => {
  const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const doc = await mkDocWithLayers();
  const buf = await encodeLayeredPSD(doc, { composite: doc.toRGBA() });
  const out = await decodeLayeredPSD(buf);
  const box = out.layers.find((l) => l.name === 'Box');
  assert.equal(box.blendMode, 'screen');
  assert.equal(Math.abs(box.opacity - 0.6) < 0.01, true, 'opacity ≈ 0.6');
  const hidden = out.layers.find((l) => l.name === 'Hidden');
  assert.equal(hidden.visible, false, 'لایهٔ پنهان پنهان بماند');
});

test('PSD: ساختار گروه (شروع/پایان) درست بازسازی می‌شود', async () => {
  const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const doc = await mkDocWithLayers();
  const buf = await encodeLayeredPSD(doc, { composite: doc.toRGBA() });
  const out = await decodeLayeredPSD(buf);
  const start = out.layers.findIndex((l) => l.isGroup);
  const end = out.layers.findIndex((l) => l.isGroupEnd);
  assert.equal(start >= 0, true, 'شروع گروه');
  assert.equal(end > start, true, 'پایان گروه باید بالای شروع باشد (قرارداد لومیما)');
  const inner = out.layers.findIndex((l) => l.name === 'Inner');
  assert.equal(inner > start && inner < end, true, 'عضو داخل محدودهٔ گروه');
});

test('PSD: لایهٔ تنظیم بومی (invert) حفظ می‌شود', async () => {
  const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const doc = await mkDocWithLayers();
  const buf = await encodeLayeredPSD(doc, { composite: doc.toRGBA() });
  const out = await decodeLayeredPSD(buf);
  const inv = out.layers.find((l) => l.name === 'Inv');
  assert.notEqual(inv.adjustment, undefined);
  assert.equal(inv.adjustment.type, 'invert');
});

test('PSD: پیکسل لایه‌ها بدون افت منتقل می‌شوند', async () => {
  const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const doc = await mkDocWithLayers();
  const buf = await encodeLayeredPSD(doc, { composite: doc.toRGBA() });
  const out = await decodeLayeredPSD(buf);
  const base = out.layers.find((l) => l.name === 'Base');
  const px = new Array(4);
  base.paint.getPixel(2, 2, px);
  assert.deepEqual(px, [200, 30, 30, 255], 'پیکسل پایه');
  const inner = out.layers.find((l) => l.name === 'Inner');
  inner.paint.getPixel(30, 12, px);
  assert.deepEqual(px, [30, 200, 60, 255], 'پیکسل عضو گروه');
  inner.paint.getPixel(1, 1, px);
  assert.equal(px[3], 0, 'بیرون از محتوا شفاف است');
});

test('PSD: تصویر ادغام‌شده هم در فایل هست و با کامپوزیت سند یکی است', async () => {
  const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const doc = await mkDocWithLayers();
  const flat = doc.toRGBA();
  const buf = await encodeLayeredPSD(doc, { composite: flat });
  const out = await decodeLayeredPSD(buf);
  assert.notEqual(out.merged, null, 'بخش تصویر ادغام‌شده');
  const a = new Array(4), b = new Array(4);
  out.merged.getPixel(2, 2, a);
  assert.deepEqual(a, [flat[(2 * 48 + 2) * 4], flat[(2 * 48 + 2) * 4 + 1], flat[(2 * 48 + 2) * 4 + 2], flat[(2 * 48 + 2) * 4 + 3]]);
});

test('PSD: پروفایل ICC در منابع تصویر نوشته می‌شود (1041)', async () => {
  const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const { srgbProfile } = await import('../src/formats/icc.js');
  const doc = await mkDocWithLayers();
  const buf = await encodeLayeredPSD(doc, { composite: doc.toRGBA(), icc: srgbProfile() });
  const out = await decodeLayeredPSD(buf);
  assert.notEqual(out.icc, null, 'پروفایل ICC قابل بازیابی');
  assert.equal(out.icc.length, srgbProfile().length);
});

test('PSD: جدول blend mode کامل است (همهٔ ۲۷ حالت)', async () => {
  const { blendKey } = await import('../src/formats/psd-layers.js');
  const modes = ['normal', 'dissolve', 'darken', 'multiply', 'colorBurn', 'linearBurn', 'darkerColor',
    'lighten', 'screen', 'colorDodge', 'linearDodge', 'lighterColor', 'overlay', 'softLight',
    'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix', 'difference', 'exclusion',
    'subtract', 'divide', 'hue', 'saturation', 'color', 'luminosity'];
  for (const m of modes) {
    const k = blendKey(m);
    assert.equal(k.length, 4, `${m} → کلید ۴ حرفی`);
    if (m !== 'normal') assert.notEqual(k, 'norm', `${m} باید کلید ویژه داشته باشد`);
  }
  assert.equal(blendKey('unknownmode'), 'norm', 'ناشناخته → normal');
});

test('PSD: PackBits round-trip (فشرده‌سازی کانال)', async () => {
  const { packBitsRow } = await import('../src/formats/psd-layers.js');
  const { packBitsDecode } = await import('../src/formats/psd.js');
  const src = new Uint8Array(64);
  for (let i = 0; i < 64; i++) src[i] = i < 30 ? 100 : (i % 7) * 30;
  const enc = packBitsRow(src, 0, 64);
  const dec = packBitsDecode(new Uint8Array(enc), 64);
  for (let i = 0; i < 64; i++) assert.equal(dec[i], src[i], `بایت ${i}`);
});


/* ═══════════ قابلیت‌های کامل‌شدهٔ PSD: ZIP، عمق ۱۶، CMYK، Curves، افکت، ماسک برداری ═══════════ */

async function mkRichDoc() {
  const { Document } = await import('../src/document/document.js');
  const { Paint } = await import('../src/document/paint.js');
  const { Layer } = await import('../src/document/layer.js');
  const W = 120, H = 80;
  const doc = new Document({ width: W, height: H });
  const base = new Paint(W, H);
  base.clearRect({ x: 0, y: 0, w: W, h: H }, 18, 100, 200, 255);
  doc.addLayer(new Layer({ name: 'Base', paint: base }));
  const card = new Paint(W, H);
  card.clearRect({ x: 20, y: 15, w: 60, h: 40 }, 240, 200, 40, 255);
  doc.addLayer(new Layer({
    name: 'Card', paint: card, opacity: 0.85, blendMode: 'screen',
    style: { dropShadow: { dx: 5, dy: 7, blur: 9, color: [0, 0, 0], opacity: 0.5 },
             stroke: { size: 3, color: [255, 255, 255], position: 'outside' },
             colorOverlay: { color: [255, 0, 0], opacity: 0.25 } },
  }));
  const vm = new Uint8Array(W * H);
  for (let y = 20; y < 60; y++) for (let x = 30; x < 90; x++) vm[y * W + x] = 1;
  doc.addLayer(new Layer({ name: 'Vec', vectorMask: { mask: vm, w: W, h: H } }));
  doc.addLayer(new Layer({ name: 'Curved', adjustment: { type: 'curves', label: 'Curves', points: [[0, 12], [64, 90], [128, 160], [255, 240]] } }));
  return doc;
}

test('PSD: فشرده‌سازی ZIP کانال‌های لایه (کاملاً کوچک‌تر و بدون افت)', async () => {
  const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const doc = await mkRichDoc();
  const composite = doc.toRGBA();
  const rle = await encodeLayeredPSD(doc, { composite, compression: 'rle' });
  const zip = await encodeLayeredPSD(doc, { composite, compression: 'zip' });
  assert.equal(zip.length < rle.length, true, `ZIP باید کوچک‌تر باشد (${zip.length} < ${rle.length})`);
  const back = await decodeLayeredPSD(zip);
  const card = back.layers.find((l) => l.name === 'Card');
  const px = [];
  card.paint.getPixel(25, 20, px);
  assert.deepEqual(px, [240, 200, 40, 255], 'پیکسل لایه پس از ZIP');
});

test('PSD: ZIP + Prediction و عمق ۱۶ بیت هر دو خوانده می‌شوند', async () => {
  const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const doc = await mkRichDoc();
  const composite = doc.toRGBA();
  for (const opts of [{ compression: 'zipPred' }, { compression: 'zip', depth: 16 }, { compression: 'zipPred', depth: 16 }]) {
    const buf = await encodeLayeredPSD(doc, { composite, ...opts });
    const back = await decodeLayeredPSD(buf);
    assert.equal(back.width, 120, 'ابعاد سند');
    const card = back.layers.find((l) => l.name === 'Card');
    const px = [];
    card.paint.getPixel(25, 20, px);
    assert.deepEqual(px, [240, 200, 40, 255], 'پیکسل با ' + JSON.stringify(opts));
  }
});

test('PSD: حالت CMYK نوشته و بی‌افت خوانده می‌شود (رفت‌وبرگشت دقیق رنگ)', async () => {
  const { encodeLayeredPSD, rgbToCmykPlanes } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  // تبدیل دوطرفه بدون خطا
  const R = Uint8Array.from([255, 10, 0, 128, 220]), G = Uint8Array.from([255, 20, 0, 60, 60]), B = Uint8Array.from([255, 30, 0, 40, 40]);
  const [C, M, Y, K] = rgbToCmykPlanes({ R, G, B }, 5);
  for (let i = 0; i < 5; i++) {
    const k = 255 - K[i];
    assert.equal(Math.round((255 - C[i]) * k / 255), R[i], 'کانال R');
    assert.equal(Math.round((255 - M[i]) * k / 255), G[i], 'کانال G');
    assert.equal(Math.round((255 - Y[i]) * k / 255), B[i], 'کانال B');
  }
  const doc = await mkRichDoc();
  const buf = await encodeLayeredPSD(doc, { composite: doc.toRGBA(), compression: 'zip', colorMode: 'cmyk' });
  // هدر: حالت رنگی ۴ = CMYK و ۴ کانال
  const dv = new DataView(buf.buffer, buf.byteOffset);
  assert.equal(dv.getUint16(24, false), 4, 'colorMode = CMYK');
  assert.equal(dv.getUint16(12, false), 4, 'channels = 4');
  const back = await decodeLayeredPSD(buf);
  const base = back.layers.find((l) => l.name === 'Base');
  const px = [];
  base.paint.getPixel(3, 3, px);
  assert.deepEqual(px, [18, 100, 200, 255], 'پیکسل CMYK پس از بازگشت');
});

test('PSD: بلوک Curves بومی فتوشاپ نوشته و خوانده می‌شود', async () => {
  const { encodeLayeredPSD, adjustmentKeys } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const keys = adjustmentKeys({ type: 'curves', points: [[0, 12], [128, 160], [255, 240]] });
  assert.equal(keys[0].key, 'curv', 'کلید curv');
  assert.equal(keys[0].data[0], 0, 'is_map = 0 (نقطه‌ای)');
  const doc = await mkRichDoc();
  const back = await decodeLayeredPSD(await encodeLayeredPSD(doc, { composite: doc.toRGBA() }));
  const adj = back.layers.find((l) => l.adjustment && l.adjustment.type === 'curves');
  assert.notEqual(adj, undefined, 'لایهٔ Curves');
  assert.deepEqual(adj.adjustment.points, [[0, 12], [64, 90], [128, 160], [255, 240]], 'نقاط منحنی');
});

test('PSD: استایل لایه (lfx2) با سایه/خط دور/رنگ‌روی حفظ می‌شود', async () => {
  const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const doc = await mkRichDoc();
  const buf = await encodeLayeredPSD(doc, { composite: doc.toRGBA() });
  const str = Buffer.from(buf).toString('latin1');
  assert.equal(str.includes('lfx2'), true, 'بلوک lfx2 در فایل');
  assert.equal(str.includes('DrSh'), true, 'اثر DropShadow');
  assert.equal(str.includes('FrFX'), true, 'اثر Stroke');
  assert.equal(str.includes('SoFi'), true, 'اثر ColorOverlay');
  assert.equal(str.includes('masterFXSwitch'), true, 'کلید بلند masterFXSwitch (طول‌دار)');
  const back = await decodeLayeredPSD(buf);
  const card = back.layers.find((l) => l.name === 'Card');
  assert.notEqual(card.style, null, 'استایل خوانده شد');
  assert.notEqual(card.style.dropShadow, undefined, 'سایه');
  assert.equal(Math.round(card.style.dropShadow.blur), 9, 'شعاع سایه');
  assert.notEqual(card.style.stroke, undefined, 'خط دور');
});

test('PSD: ماسک برداری (vmsk) با مختصات نرمال‌شده ذخیره و بازیابی می‌شود', async () => {
  const { encodeLayeredPSD, buildVectorMaskPath, applyPredictorDecode, applyPredictorEncode } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const path = buildVectorMaskPath({ left: 30, top: 20, right: 90, bottom: 60 }, { width: 120, height: 80 });
  assert.equal(path.length % 4, 0, 'هم‌ترازی ۴ بایتی');
  assert.equal(new DataView(path.buffer, path.byteOffset).getUint32(0, false), 3, 'نسخهٔ ۳ ماسک برداری');
  const doc = await mkRichDoc();
  const back = await decodeLayeredPSD(await encodeLayeredPSD(doc, { composite: doc.toRGBA() }));
  const vec = back.layers.find((l) => l.name === 'Vec');
  assert.notEqual(vec.vectorMask, null, 'ماسک برداری بازیابی شد');
  const on = vec.vectorMask.mask.reduce((a, v) => a + (v ? 1 : 0), 0);
  assert.equal(on, 60 * 40, 'مساحت کادر ماسک برداری');
  // پیش‌بینی ZIP رفت‌وبرگشت دقیق دارد
  const src = Uint8Array.from([10, 12, 40, 9, 200, 3, 7, 7]);
  const dec = applyPredictorDecode(applyPredictorEncode(src, 4, 2), 4, 2);
  assert.deepEqual(Array.from(dec), Array.from(src), 'Predictor رفت‌وبرگشت');
});

test('PSD: بلوک قدیمی lrFX هم در صورت درخواست نوشته می‌شود', async () => {
  const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const doc = await mkRichDoc();
  const buf = await encodeLayeredPSD(doc, { composite: doc.toRGBA(), legacyEffects: true });
  const str = Buffer.from(buf).toString('latin1');
  assert.equal(str.includes('lrFX'), true, 'بلوک lrFX');
  const back = await decodeLayeredPSD(buf);
  const card = back.layers.find((l) => l.name === 'Card');
  assert.notEqual(card.style, null, 'استایل از lfx2/lrFX خوانده شد');
});


/* ═══════════ رگرسیون باگ‌های واقعی که با بازرسی فایل‌های فتوشاپ پیدا شدند ═══════════ */

test('رگرسیون: پروفایل sRGB داخلی با سفید D50 و منحنی para استاندارد ساخته می‌شود', async () => {
  const { srgbProfile } = await import('../src/formats/icc.js');
  const p = srgbProfile();
  // هدر: 'acsp' در آفست ۳۶
  assert.equal(String.fromCharCode(p[36], p[37], p[38], p[39]), 'acsp', 'امضای acsp');
  const { Reader } = await import('../src/formats/psd-descriptor.js');
  const r = new Reader(p, 128);
  const n = r.u32();
  const tags = {};
  for (let i = 0; i < n; i++) {
    const sig = String.fromCharCode(p[r.p], p[r.p + 1], p[r.p + 2], p[r.p + 3]); r.p += 4;
    const off = r.u32(); const size = r.u32();
    tags[sig] = { off, size, type: String.fromCharCode(p[off], p[off + 1], p[off + 2], p[off + 3]) };
  }
  // نقطهٔ سفید باید D50 باشد (PCS استاندارد ICC) — باگ قبلی: D65 بود ⇒ خطای ۹ سطح رنگ
  const wt = tags.wtpt;
  const s15 = (o) => new DataView(p.buffer, p.byteOffset + o, 4).getInt32(0, false) / 65536;
  const W = [s15(wt.off + 8), s15(wt.off + 12), s15(wt.off + 16)];
  assert.equal(Math.abs(W[0] - 0.9642) < 0.002, true, 'X سفید ≈ 0.9642 (D50)');
  assert.equal(Math.abs(W[1] - 1.0) < 0.0001, true, 'Y سفید = 1');
  assert.equal(Math.abs(W[2] - 0.8249) < 0.002, true, 'Z سفید ≈ 0.8249 (D50)');
  // منحنی تُن باید parametric نوع ۳ باشد (نه گامای سادهٔ ۲.۲)
  assert.equal(tags.rTRC.type, 'para', 'نوع منحنی: para (استاندارد sRGB)');
  const dv = new DataView(p.buffer, p.byteOffset);
  assert.equal(dv.getUint16(tags.rTRC.off + 8, false), 3, 'function type = 3');
  const g = dv.getInt32(tags.rTRC.off + 12, false) / 65536;
  assert.equal(Math.abs(g - 2.4) < 0.001, true, 'گامای ۲.۴');
  // تگ‌های chad و chrm هم باید باشند
  assert.notEqual(tags.chad, undefined, 'تگ chad (تطبیق کروماتیک D65→D50)');
  assert.notEqual(tags.chrm, undefined, 'تگ chrm (مختصات رنگ‌های اصلی)');
});

test('رگرسیون: CMYK در PSD «معکوس» ذخیره می‌شود — قرارداد واقعی فتوشاپ', async () => {
  const { encodeLayeredPSD, rgbToCmykPlanes, invertPlanes } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const { Document } = await import('../src/document/document.js');
  const { Paint } = await import('../src/document/paint.js');
  const { Layer } = await import('../src/document/layer.js');
  const W = 8, H = 8;
  const doc = new Document({ width: W, height: H });
  const p = new Paint(W, H);
  p.setPixel(0, 0, 255, 255, 255, 255);       // سفید: مرکب صفر
  p.setPixel(1, 0, 0, 0, 0, 255);             // سیاه: K = 255
  doc.addLayer(new Layer({ name: 'Flat', paint: p }));
  const buf = await encodeLayeredPSD(doc, { composite: doc.toRGBA(), icc: null, colorMode: 'cmyk', compression: 'rle' });
  // مقادیر خام کانال‌های لایه باید معکوسِ «میزان مرکب» باشند
  const ink = rgbToCmykPlanes({ R: Uint8Array.from([255]), G: Uint8Array.from([255]), B: Uint8Array.from([255]) }, 1);
  const stored = invertPlanes(ink);
  assert.deepEqual(Array.from(stored[3]), [255], 'سفید → بایت ذخیره‌شده K=255 (یعنی مرکب ۰)');
  const inkBlack = rgbToCmykPlanes({ R: Uint8Array.from([0]), G: Uint8Array.from([0]), B: Uint8Array.from([0]) }, 1);
  assert.deepEqual(Array.from(invertPlanes(inkBlack)[3]), [0], 'سیاه → بایت ذخیره‌شده K=0 (یعنی مرکب ۱۰۰٪)');
  // و خواندن باید دوباره برگرداند
  const back = await decodeLayeredPSD(buf);
  const px = [];
  back.layers[0].paint.getPixel(0, 0, px);
  assert.deepEqual(px, [255, 255, 255, 255], 'سفید سالم برگشت');
  back.layers[0].paint.getPixel(1, 0, px);
  assert.deepEqual(px, [0, 0, 0, 255], 'سیاه سالم برگشت');
});

test('رگرسیون: فایل تخت (بدون بخش لایه) کرش نمی‌کند و از مرز بافر بیرون نمی‌زند', async () => {
  const { Document } = await import('../src/document/document.js');
  const { Paint } = await import('../src/document/paint.js');
  const { Layer } = await import('../src/document/layer.js');
  const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const W = 16, H = 9;
  const doc = new Document({ width: W, height: H });
  const p = new Paint(W, H);
  p.clearRect({ x: 0, y: 0, w: W, h: H }, 20, 40, 60, 255);
  doc.addLayer(new Layer({ name: 'Only', paint: p }));
  const layered = await encodeLayeredPSD(doc, { composite: doc.toRGBA() });
  // فایل تخت بسازیم: بخش Layer&Mask خالی شود (مثل cmyk-spot.psd واقعی فتوشاپ)
  const dv = new DataView(layered.buffer, layered.byteOffset);
  let p2 = 26;
  p2 += 4 + dv.getUint32(p2, false);          // Color mode data
  p2 += 4 + dv.getUint32(p2, false);          // Image resources
  const lmLenOff = p2;
  const lmLen = dv.getUint32(p2, false);
  const flat = new Uint8Array(layered.length - lmLen);
  flat.set(layered.subarray(0, lmLenOff));
  new DataView(flat.buffer).setUint32(lmLenOff, 0, false);
  flat.set(layered.subarray(lmLenOff + 4 + lmLen), lmLenOff + 4);
  const out = await decodeLayeredPSD(flat);
  assert.equal(out.width, W, 'عرض درست');
  assert.equal(out.layers.length, 0, 'بدون لایه');
  assert.notEqual(out.merged, null, 'تصویر ادغام‌شده خوانده شد');
  const px = [];
  out.merged.getPixel(W - 1, H - 1, px);
  assert.deepEqual(px, [20, 40, 60, 255], 'پیکسل گوشه درست');
});


test('رگرسیون: دادهٔ تصویر ادغام‌شده از انتهای «کل» بخش Layer & Mask خوانده می‌شود', async () => {
  const { Document } = await import('../src/document/document.js');
  const { Paint } = await import('../src/document/paint.js');
  const { Layer } = await import('../src/document/layer.js');
  const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
  const { decodeLayeredPSD } = await import('../src/formats/psd-read.js');
  const W = 12, H = 8;
  const doc = new Document({ width: W, height: H });
  const p = new Paint(W, H);
  p.clearRect({ x: 0, y: 0, w: W, h: H }, 90, 40, 10, 255);
  doc.addLayer(new Layer({ name: 'A', paint: p }));
  const buf = await encodeLayeredPSD(doc, { composite: doc.toRGBA(), compression: 'rle' });
  // دادهٔ اضافی بین «اطلاعات لایه» و پایان بخش تزریق می‌کنیم (مثل ماسک سراسری
  // فتوشاپ) — باگ قبلی: خواننده از liEnd شروع می‌کرد و ردیف‌های آخر خراب می‌شد.
  const dv = new DataView(buf.buffer, buf.byteOffset);
  let q = 26;
  q += 4 + dv.getUint32(q, false);          // color mode data
  q += 4 + dv.getUint32(q, false);          // image resources
  const lmLenOff = q;
  const lmLen = dv.getUint32(q, false);
  const liLen = dv.getUint32(q + 4, false);
  const extra = 24;
  const padded = new Uint8Array(buf.length + extra);
  padded.set(buf.subarray(0, lmLenOff + 4 + liLen));               // تا انتهای اطلاعات لایه
  padded.fill(0, lmLenOff + 4 + liLen, lmLenOff + 4 + liLen + extra);  // دادهٔ اضافی
  padded.set(buf.subarray(lmLenOff + 4 + liLen), lmLenOff + 4 + liLen + extra);
  const ndv = new DataView(padded.buffer);
  ndv.setUint32(lmLenOff, lmLen + extra, false);                   // طول بخش را بزرگ کن
  const out = await decodeLayeredPSD(padded);
  const px = [];
  out.merged.getPixel(W - 1, H - 1, px);                            // ردیف آخر: جایی که باگ اثر داشت
  assert.deepEqual(px, [90, 40, 10, 255], 'پیکسل ردیف آخر سالم است');
});

test('رگرسیون: PSD عمق ۳۲ بیت (float32) خوانده می‌شود', async () => {
  const { decodeLayeredPSD, unshuffle32 } = await import('../src/formats/psd-read.js');
  // یک PSD تخت ۳۲ بیتی واقعی می‌سازیم: هدر + بخش‌های خالی + دادهٔ float32 خام
  const W = 4, H = 2;
  const head = new Uint8Array(26);
  const hv = new DataView(head.buffer);
  head.set([0x38, 0x42, 0x50, 0x53], 0);        // '8BPS'
  hv.setUint16(4, 1, false);                    // version
  hv.setUint16(12, 3, false);                   // 3 channels (RGB)
  hv.setUint32(14, H, false);
  hv.setUint32(18, W, false);
  hv.setUint16(22, 32, false);                  // depth = 32
  hv.setUint16(24, 3, false);                   // RGB
  const body = new Uint8Array(4 + 4 + 4 + 2 + W * H * 3 * 4);
  const bv = new DataView(body.buffer);
  bv.setUint32(0, 0, false);                    // color mode data length
  bv.setUint32(4, 0, false);                    // image resources length
  bv.setUint32(8, 0, false);                    // layer & mask length = 0 (فایل تخت)
  bv.setUint16(12, 0, false);                   // compression = RAW
  const vals = [1.0, 0.5, 0.25, 0.0, 0.75, 1.0, 0.1, 0.9];
  let o = 14;
  for (let c = 0; c < 3; c++) {
    for (let i = 0; i < W * H; i++) { bv.setFloat32(o, vals[(i + c) % vals.length], false); o += 4; }
  }
  const file = new Uint8Array(head.length + body.length);
  file.set(head, 0); file.set(body, head.length);
  const out = await decodeLayeredPSD(file);
  assert.equal(out.width, W, 'عرض');
  assert.equal(out.layers.length, 0, 'بدون لایه');
  const px = [];
  out.merged.getPixel(0, 0, px);
  assert.deepEqual(px, [255, 128, 64, 255], 'تبدیل float32 → ۸ بیت (1.0 → 255، 0.5 → 128، 0.25 → 64)');
  out.merged.getPixel(3, 1, px);
  assert.equal(px[3], 255, 'آلفا پیش‌فرض ۲۵۵ برای RGB بدون کانال آلفا');
  // بازچینش بایتی (byte shuffle) عمق ۳۲ برای ZIP: آزمون رفت‌وبرگشت
  const count = 4;
  const original = new Uint8Array(count * 4);
  const dv2 = new DataView(original.buffer);
  [1.0, 0.5, 0.25, 0.125].forEach((v, i) => dv2.setFloat32(i * 4, v, false));
  const shuffler = (src, n) => {                 // معکوسِ unshuffle32 (مثل نوشتن فتوشاپ)
    const out = new Uint8Array(n * 4);
    for (let b = 0; b < 4; b++) for (let i = 0; i < n; i++) out[b * n + i] = src[i * 4 + b];
    return out;
  };
  const back = unshuffle32(shuffler(original, count), count);
  assert.deepEqual(Array.from(back), Array.from(original), 'بازچینش بایتی رفت‌وبرگشت دقیق');
  const fv = new DataView(back.buffer);
  assert.equal(fv.getFloat32(0, false), 1.0, 'نمونهٔ اول بعد از رفت‌وبرگشت');
  assert.equal(fv.getFloat32(12, false), 0.125, 'نمونهٔ چهارم بعد از رفت‌وبرگشت');
});


test('رگرسیون: PSD تخت ساختار استاندارد دارد (بدون فیلد طول اضافی) + ICC', async () => {
  const { encodeImage, decodeImage } = await import('../src/formats/imageio.js');
  const W = 8, H = 4;
  const d = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    d[i * 4] = (i * 7) & 255; d[i * 4 + 1] = 200; d[i * 4 + 2] = 30; d[i * 4 + 3] = i % 2 ? 255 : 128;
  }
  const psd = await encodeImage({ width: W, height: H, data: d }, 'psd');
  const dv = new DataView(psd.buffer, psd.byteOffset, psd.length);
  let q = 26;
  const cmLen = dv.getUint32(q, false); q += 4 + cmLen;
  const resLen = dv.getUint32(q, false); q += 4 + resLen;
  const lmLen = dv.getUint32(q, false); q += 4 + lmLen;
  // ساختار: پس از طول Layer & Mask مستقیماً بایت فشرده‌سازی می‌آید
  assert.equal(dv.getUint16(q, false), 1, 'compression = RLE و هیچ فیلد طولی اضافه‌ای نیست');
  assert.ok(resLen > 600, 'پروفایل ICC در منابع تصویر نوشته شده (' + resLen + ' بایت)');
  assert.equal(lmLen, 0, 'سند تخت: بخش Layer & Mask خالی');
  const back = await decodeImage(psd);
  let diff = 0;
  for (let i = 0; i < d.length; i++) diff = Math.max(diff, Math.abs(d[i] - back.data[i]));
  assert.equal(diff, 0, 'دور رفت‌وبرگشت بدون اختلاف');
  // استخراج ICC از منابع (بررسی ساختار بلوک 8BIM/1039)
  const resStart = 26 + 4 + cmLen + 4;
  const sig = dv.getUint32(resStart, false);
  assert.equal(sig, 0x3842494d, 'امضای 8BIM درست');
  assert.equal(dv.getUint16(resStart + 4, false), 1039, 'شناسهٔ منبع 1039 = ICC');
  const iccLen = dv.getUint32(resStart + 8 + 4, false);
  assert.ok(iccLen > 600, 'طول پروفایل ICC خوانده شد (' + iccLen + ')');
});

test('رگرسیون: PSD تخت CMYK با تفسیر معکوس (۲۵۵−بایت) خوانده می‌شود', async () => {
  const { decodeImage } = await import('../src/formats/imageio.js');
  // فایل تخت CMYK ۲×۱. در فایل فتوشاپ هر بایت = ۲۵۵ − درصد مرکب:
  // پیکسل ۰ = سفید (مرکب ۰ → بایت ۲۵۵)، پیکسل ۱ = مشکی (K=۲۵۵ → بایت ۰)
  const W = 2, H = 1;
  const planes = [new Uint8Array([255, 0]), new Uint8Array([255, 0]), new Uint8Array([255, 0]), new Uint8Array([255, 0])];
  const imageLen = 2 + W * H * 4;
  const buf = new Uint8Array(26 + 4 + 4 + 4 + imageLen);
  const dv = new DataView(buf.buffer);
  buf.set([0x38, 0x42, 0x50, 0x53], 0);
  dv.setUint16(4, 1, false); dv.setUint16(12, 4, false);
  dv.setUint32(14, H, false); dv.setUint32(18, W, false);
  dv.setUint16(22, 8, false); dv.setUint16(24, 4, false);       // CMYK
  let o = 26 + 4 + 4 + 4;
  dv.setUint16(o, 0, false); o += 2;                             // RAW
  for (let c = 0; c < 4; c++) { buf.set(planes[c], o); o += W * H; }
  const out = await decodeImage(buf);
  assert.deepEqual(Array.from(out.data.slice(0, 4)), [255, 255, 255, 255], 'سفید CMYK → ۲۵۵');
  assert.deepEqual(Array.from(out.data.slice(4, 8)), [0, 0, 0, 255], 'مشکی CMYK → ۰');
});
