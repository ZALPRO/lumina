// formats/psd-layers.js — نویسندهٔ PSD «چندلایهٔ کامل» (سازگار با فتوشاپ)
//
// پوشش:
//   • لایهٔ رستری با نام، blend، opacity، visibility، clipping، ماسک لایه
//   • گروه‌بندی تو در تو (lsct: ۱ = پوشه، ۳ = نشانگر پایان)
//   • لایه‌های تنظیم بومی: nvrt/gryc/thrs/brit/hue2/levl/expA/vibr/curv
//   • ماسک برداری (vmsk)
//   • استایل لایه (lfx2 — همان Layer Style فتوشاپ؛ و اختیاری lrFX قدیمی)
//   • فشرده‌سازی کانال: RLE (پیش‌فرض) یا ZIP / ZIP+Prediction
//   • عمق ۸ یا ۱۶ بیت
//   • پروفایل ICC (منبع ۱۰۳۹) + ResolutionInfo
//   • تصویر ادغام‌شده در پایان فایل
import { srgbProfile } from './icc.js';
import { buildLfx2, buildLrFX } from './psd-layerstyles.js';
import { Writer as W } from './psd-descriptor.js';
import { deflateZlib } from './deflate.js';

const SIG8BIM = 0x3842494D;   // '8BIM'

// نوشتن یک بلاک tagged در extra لایه: '8BIM' + کلید + طول + داده (+ یک بایت پدینگ در صورت فرد بودن)
function tagged(w, key, data) {
  const need = data.length % 2 === 0 ? data.length : data.length + 1;
  w.u32(SIG8BIM); w.ascii4(key); w.u32(need); w.bytes(data);
  if (need !== data.length) w.u8(0);
}

// متدهای کمکی بومیِ PSD روی نویسندهٔ عمومی
W.prototype.pascal2 = function (str) {
  const n = Math.min(255, str.length);
  this.u8(n);
  for (let i = 0; i < n; i++) this.u8(str.charCodeAt(i) & 255);
  if ((n + 1) % 2) this.u8(0);
};
W.prototype.pascal4 = function (str) {
  let s = '';
  for (const ch of String(str)) { const c = ch.codePointAt(0); s += String.fromCharCode(c < 256 ? c : 63); }
  if (s.length > 255) s = s.slice(0, 255);
  this.u8(s.length);
  for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  while (this.len % 4 !== 0) this.u8(0);
};

// فشرده‌سازی ZIP از ماژول مشترک deflate استفاده می‌کند (Node ↔ مرورگر)، پس
// encodeLayeredPSD همیشه async است — همان‌طور که خواننده هم async شد.

const BLEND_KEYS = {
  normal: 'norm', dissolve: 'diss', darken: 'dark', multiply: 'mul ',
  colorBurn: 'idiv', linearBurn: 'lbrn', darkerColor: 'dkCl',
  lighten: 'lite', screen: 'scrn', colorDodge: 'div ', linearDodge: 'lddg',
  lighterColor: 'lgCl', overlay: 'over', softLight: 'sLit', hardLight: 'hLit',
  vividLight: 'vLit', linearLight: 'lLit', pinLight: 'pLit', hardMix: 'hMix',
  difference: 'diff', exclusion: 'smud', subtract: 'fsub', divide: 'fdiv',
  hue: 'hue ', saturation: 'sat ', color: 'colr', luminosity: 'lum ',
};
export function blendKey(mode) { return BLEND_KEYS[mode] || 'norm'; }


/* ─────────────── PackBits / RLE ─────────────── */
export function packBitsRow(src, start, len) {
  const out = [];
  let i = 0;
  while (i < len) {
    let run = 1;
    while (i + run < len && run < 128 && src[start + i + run] === src[start + i]) run++;
    if (run >= 3) {
      out.push(256 - (run - 1), src[start + i]);
      i += run;
    } else {
      let lit = 0;
      while (i + lit < len && lit < 128) {
        const a = src[start + i + lit];
        const b = i + lit + 1 < len ? src[start + i + lit + 1] : -1;
        const c = i + lit + 2 < len ? src[start + i + lit + 2] : -2;
        if (a === b && a === c) break;
        lit++;
      }
      if (lit === 0) lit = 1;
      out.push(lit - 1);
      for (let k = 0; k < lit; k++) out.push(src[start + i + k]);
      i += lit;
    }
  }
  return out;
}

/* ─────────────── پیش‌بینی (Predictor) برای ZIP ─────────────── */
// مطابق پیاده‌سازی مرجع: در هر ردیف از انتها به ابتدا اختلاف گرفته می‌شود.
export function applyPredictorEncode(plane, w, h) {
  const out = Uint8Array.from(plane);
  for (let y = h - 1; y >= 0; y--) {
    const off = y * w;
    for (let x = w - 2; x >= 0; x--) {
      out[off + x + 1] = (out[off + x + 1] - out[off + x]) & 0xFF;
    }
  }
  return out;
}

export function applyPredictorDecode(plane, w, h) {
  const out = Uint8Array.from(plane);
  for (let y = 0; y < h; y++) {
    const off = y * w;
    for (let x = 0; x < w - 1; x++) {
      out[off + x + 1] = (out[off + x + 1] + out[off + x]) & 0xFF;
    }
  }
  return out;
}

// کانال ۸ بیتی → بایت‌های آمادهٔ فشرده‌سازی (برای عمق ۱۶: هر نمونه دو بایت big-endian)
function planeToBytes(plane, depth) {
  if (depth === 8) return plane;
  const out = new Uint8Array(plane.length * 2);
  for (let i = 0; i < plane.length; i++) {
    const v = plane[i];
    out[i * 2] = v; out[i * 2 + 1] = v;      // ۸ بیت → ۱۶ بیت: v*257 = (v<<8)|v
  }
  return out;
}

// payload یک کانال (بدون هدر compression) + نوع فشرده‌سازی مؤثر
// توجه: دادهٔ کانال لایه = u16 compression + payload و طولِ رکورد شامل همان ۲ بایت است.
// RLE یک کانال/تصویر: ابتدا «همهٔ» شمارش ردیف‌ها و سپس دادهٔ ردیف‌ها.
// (برای تصویر ادغام‌شده، شمارش‌های همهٔ کانال‌ها پشت‌سرهم می‌آید — بند RLE_ROW_DATA)
function rleParts(plane, w, h, depth) {
  const raw = planeToBytes(plane, depth);
  const rowBytes = w * (depth === 8 ? 1 : 2);
  const counts = new Uint8Array(2 * h);
  const dv = new DataView(counts.buffer);
  const rows = [];
  for (let y = 0; y < h; y++) {
    const r = packBitsRow(raw, y * rowBytes, rowBytes);
    dv.setUint16(y * 2, r.length, false);
    rows.push(r);
  }
  return { counts, rows };
}

async function encodeChannelPayload(plane, w, h, depth, compression) {
  const rowBytes = w * (depth === 8 ? 1 : 2);
  if (compression === 'zip' || compression === 'zipPred') {
    const raw = planeToBytes(plane, depth);
    const source = compression === 'zipPred' ? applyPredictorEncode(raw, rowBytes, h) : raw;
    return { comp: compression === 'zipPred' ? 3 : 2, payload: await deflateZlib(source, 6) };
  }
  const { counts, rows } = rleParts(plane, w, h, depth);
  const total = rows.reduce((a, r) => a + r.length, 0);
  const payload = new Uint8Array(counts.length + total);
  payload.set(counts, 0);
  let p = counts.length;
  for (const r of rows) { payload.set(r, p); p += r.length; }
  return { comp: 1, payload };
}

// کانال کامل (هدر + payload) برای دادهٔ لایه
async function encodeChannel(plane, w, h, depth, compression) {
  const { comp, payload } = await encodeChannelPayload(plane, w, h, depth, compression);
  const out = new Uint8Array(2 + payload.length);
  out[0] = (comp >>> 8) & 255; out[1] = comp & 255;
  out.set(payload, 2);
  return out;
}

// مجموعهٔ کانال‌ها برای «تصویر ادغام‌شده»: یک هدر فشرده‌سازی برای همهٔ کانال‌ها.
// ZIP در این بخش یک جریان واحد است (نه یک جریان به‌ازای هر کانال) — مطابق مشخصات.
async function encodeComposite(planes, w, h, depth, compression) {
  const rowBytes = w * (depth === 8 ? 1 : 2);
  const chunks = planes.map((pl) => planeToBytes(pl, depth));
  if (compression === 'zip' || compression === 'zipPred') {
    const joined = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    let p = 0;
    for (const c of chunks) { joined.set(c, p); p += c.length; }
    const source = compression === 'zipPred' ? applyPredictorEncode(joined, rowBytes, h * planes.length) : joined;
    const comp = await deflateZlib(source, 6);
    const out = new Uint8Array(2 + comp.length);
    out[0] = 0; out[1] = compression === 'zipPred' ? 3 : 2;
    out.set(comp, 2);
    return out;
  }
  const parts = planes.map((pl) => rleParts(pl, w, h, depth));
  const countsLen = parts.reduce((a, x) => a + x.counts.length, 0);
  const rowsLen = parts.reduce((a, x) => a + x.rows.reduce((b, r) => b + r.length, 0), 0);
  const out = new Uint8Array(2 + countsLen + rowsLen);
  out[0] = 0; out[1] = 1;                      // RLE
  let p = 2;
  for (const x of parts) { out.set(x.counts, p); p += x.counts.length; }   // همهٔ شمارش‌ها
  for (const x of parts) for (const r of x.rows) { out.set(r, p); p += r.length; }  // سپس داده‌ها
  return out;
}

/* ─────────────── RGB → CMYK ─────────────── */
// تبدیل استاندارد (بدون پروفایل): K = 255 − max(R,G,B) و
// C = (255 − R − K) × 255 / (255 − K) ... که معکوسِ دقیق فرمول خواننده است.
// ⚠️ قرارداد مهم فتوشاپ (با فایل واقعی cmyk-gray-ramp.psd اثبات شد):
//   فتوشاپ مقادیر CMYK را «معکوس» ذخیره می‌کند؛ یعنی بایت ذخیره‌شده = ۲۵۵ − میزان مرکب.
//   پس هنگام نوشتن باید معکوس کنیم و هنگام خواندن دوباره معکوس.
export function invertPlanes(planes) {
  return planes.map((pl) => {
    const out = new Uint8Array(pl.length);
    for (let i = 0; i < pl.length; i++) out[i] = 255 - pl[i];
    return out;
  });
}

export function rgbToCmykPlanes({ R, G, B }, n) {
  const C = new Uint8Array(n), M = new Uint8Array(n), Y = new Uint8Array(n), K = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const r = R[i], g = G[i], b = B[i];
    const k = 255 - Math.max(r, g, b);
    K[i] = k;
    if (k === 255) { C[i] = 0; M[i] = 0; Y[i] = 0; continue; }
    const d = 255 - k;
    C[i] = Math.round(((d - R[i]) * 255) / d);
    M[i] = Math.round(((d - G[i]) * 255) / d);
    Y[i] = Math.round(((d - B[i]) * 255) / d);
  }
  return [C, M, Y, K];
}

/* ─────────────── استخراج پلن‌ها از Paint ─────────────── */
function planesFromPaint(paint, w, h) {
  const R = new Uint8Array(w * h), G = new Uint8Array(w * h), B = new Uint8Array(w * h), A = new Uint8Array(w * h);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      paint.getPixel(x, y, px);
      const i = y * w + x;
      R[i] = px[0]; G[i] = px[1]; B[i] = px[2]; A[i] = px[3];
    }
  }
  return { R, G, B, A };
}

// کادر ماسک برداری: اولویت = کادر صریحِ لایه، بعد جعبهٔ احاطه‌کنندهٔ پیکسل‌های روشن
function vectorMaskRect(layer, opts, w, h) {
  if (opts.vectorMaskRect) return opts.vectorMaskRect;
  const vm = layer.vectorMask;
  if (vm && vm.right > vm.left && vm.bottom > vm.top) return vm;
  if (vm && vm.mask) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const vw = vm.w || w, vh = vm.h || h;
    for (let y = 0; y < vh; y++) {
      for (let x = 0; x < vw; x++) {
        if (vm.mask[y * vw + x]) {
          if (x < minX) minX = x; if (x > maxX) maxX = x;
          if (y < minY) minY = y; if (y > maxY) maxY = y;
        }
      }
    }
    if (isFinite(minX)) return { left: minX, top: minY, right: maxX + 1, bottom: maxY + 1 };
  }
  return { top: 0, left: 0, bottom: h, right: w };
}

/* ─────────────── کلیدهای بومی لایه‌های تنظیم ─────────────── */
export function adjustmentKeys(adj) {
  if (!adj) return [];
  const list = [];
  switch (adj.type) {
    case 'invert': list.push({ key: 'nvrt', data: new Uint8Array(0) }); break;
    case 'grayscale': list.push({ key: 'gryc', data: new Uint8Array(0) }); break;
    case 'threshold': {
      const d = new W(); d.u16(1); d.u16(Math.max(1, Math.min(255, adj.t ?? 128)));
      list.push({ key: 'thrs', data: d.out() }); break;
    }
    case 'brightness-contrast': {
      const d = new W();
      d.i16(Math.round(adj.brightness ?? 0)); d.i16(Math.round(adj.contrast ?? 0));
      d.i16(0); d.i16(0);
      list.push({ key: 'brit', data: d.out() }); break;
    }
    case 'hue-sat': {
      const d = new W();
      d.i16(Math.round(adj.hue ?? 0)); d.i16(Math.round(adj.sat ?? 0));
      d.i16(Math.round(adj.light ?? 0)); d.i16(0);
      d.u8(0); d.u8(0); d.u8(0); d.u8(0);
      list.push({ key: 'hue2', data: d.out() }); break;
    }
    case 'levels': {
      const d = new W();
      const sh = Math.max(0, Math.min(255, adj.shadows ?? 0));
      const hi = Math.max(0, Math.min(255, adj.highlights ?? 255));
      d.u16(sh); d.u16(hi);
      for (let i = 0; i < 3; i++) { d.u16(sh); d.u16(hi); }
      d.u16(Math.round((adj.gamma ?? 1) * 100));
      d.u16(0); d.u16(0);
      list.push({ key: 'levl', data: d.out() }); break;
    }
    case 'exposure': {
      const d = new W();
      d.u32(Math.round((adj.ev ?? 0) * 0x10000)); d.u32(0); d.u8(0); d.u8(0); d.u8(0); d.u8(0);
      list.push({ key: 'expA', data: d.out() }); break;
    }
    case 'vibrance': {
      const d = new W();
      d.i16(Math.round((adj.amount ?? 0) * 100)); d.i16(0);
      list.push({ key: 'vibr', data: d.out() }); break;
    }
    case 'curves': {
      // Curves: u8 is_map + u16 version(=1) + u32 bitmap کانال‌ها + برای هر کانال:
      //   u16 تعداد نقاط + نقاط (u16 خروجی، u16 ورودی)
      const pts = (adj.points || [[0, 0], [128, 128], [255, 255]]).slice(0, 19);
      const clean = pts.map(([x, y]) => [Math.max(0, Math.min(255, y)), Math.max(0, Math.min(255, x))]);
      if (clean.length < 2) clean.push([255, 255]);
      const d = new W();
      d.u8(0);                       // is_map = 0
      d.u16(1);                      // version 1
      d.u32(0x01);                   // bitmap: فقط کانال RGB ترکیبی
      d.u16(clean.length);
      for (const [output, input] of clean) { d.u16(output); d.u16(input); }
      // نشانگر افزودنی 'Crv ' (نسخهٔ ۴، بدون آیتم) — همان چیزی که فتوشاپ می‌نویسد
      d.ascii4('Crv '); d.u16(4); d.u32(0);
      while (d.len % 4) d.u8(0);
      list.push({ key: 'curv', data: d.out() }); break;
    }
    default: break;
  }
  return list;
}

/* ─────────────── ماسک برداری (vmsk) ─────────────── */
// چیدمان مطابق psd_tools.psd.vector (تأییدشده روی فایل واقعی فتوشاپ؛ رکوردها
// پشت‌سرهم و با طول پیشوندی -- نه هم‌ترازی ۴ بایتی بین رکوردها):
//   u32 طول | u16 تعداد گره | i16 operation | u16 unknown1(=1) | u32 unknown2(=0)
//   u32 index(=0) | 10 بایت صفر | گره‌ها (۳ جفت y,x به‌صورت fixed 8.24)
// نکتهٔ مهم: مختصات گره‌های مسیر در PSD «نرمال‌شده» ذخیره می‌شوند (کسری از ابعاد
// سند) به‌صورت fixed 8.24؛ پس مسیرهای بزرگ هم بدون سرریز جا می‌شوند. این چیدمان
// با ag-psd (که روی فایل‌های واقعی فتوشاپ تست شده) تأیید شده است.
export function buildVectorMaskPath(rect, { version = 3, flags = 0, width = rect.right || 1, height = rect.bottom || 1 } = {}) {
  const x0 = rect.left, y0 = rect.top, x1 = rect.right, y1 = rect.bottom;
  const knots = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const FX = 16777216;                       // fixed 8.24 → مقدار × 2^24
  const fx = (v, size) => Math.round((v / (size || 1)) * FX);

  const path = new W();
  // رکورد قاعدهٔ پرکردن (selector = 6، ۲۴ بایت صفر)
  path.u16(6); path.zeros(24);
  // زیرمسیر بسته: u16 تعداد گره + i16 operation + u16 unknown1(=1) + u32 unknown2(=0)
  // + u32 index + ۱۰ بایت صفر، سپس گره‌ها (هر گره: u16 selector + ۳ جفت (y,x) ثابت)
  path.u16(0);                               // selector = Closed path
  path.u16(knots.length);
  path.i16(1);                               // operation = Or (union)
  path.u16(1); path.u32(0); path.u32(0); path.zeros(10);
  for (const [x, y] of knots) {
    path.u16(1);                             // selector = Closed knot (linked)
    path.i32(fx(y, height)); path.i32(fx(x, width));        // preceding
    path.i32(fx(y, height)); path.i32(fx(x, width));        // anchor
    path.i32(fx(y, height)); path.i32(fx(x, width));        // leaving
  }
  const body = path.out();
  const out = new W();
  out.u32(version);                          // ۳ = نسخهٔ استاندارد ماسک برداری
  out.u32(flags);                            // بیت۰ = معکوس، بیت۱ = جدا، بیت۲ = غیرفعال
  out.bytes(body);
  while (out.len % 4) out.u8(0);
  return out.out();
}

/* ─────────────── هستهٔ نویسنده ─────────────── */
export async function encodeLayeredPSD(doc, opts = {}) {
  const w = doc.width, h = doc.height;
  const depth = opts.depth === 16 ? 16 : 8;
  const compression = opts.compression || 'rle';         // 'rle' | 'zip' | 'zipPred'
  const colorMode = opts.colorMode === 'cmyk' ? 'cmyk' : 'rgb';
  // در حالت CMYK پروفایل sRGB نوشته نمی‌شود (پروفایل CMYK جدا لازم دارد)
  const icc = opts.icc === null ? null
    : (opts.icc || (opts.colorMode === 'cmyk' ? null : srgbProfile()));
  const srcLayers = doc.layers || [];
  const legacyEffects = !!opts.legacyEffects;            // نوشتن lrFX قدیمی هم

  // ۱) ترتیب PSD (بالا → پایین) + نگاشت گروه‌ها
  const groupOf = new Map();
  {
    const st = [];
    for (let i = 0; i < srcLayers.length; i++) {
      const l = srcLayers[i];
      if (l.isGroup) st.push(l);
      else if (l.isGroupEnd && st.length) groupOf.set(l, st.pop());
    }
  }
  const entries = [];
  for (let i = srcLayers.length - 1; i >= 0; i--) {
    const l = srcLayers[i];
    if (l.isGroupEnd) entries.push({ kind: 'divider' });
    else if (l.isGroup) entries.push({ kind: 'folder', layer: l });
    else entries.push({ kind: 'layer', layer: l });
  }

  // ۲) آماده‌سازی کانال‌ها
  const prepared = await Promise.all(entries.map(async (e) => {
    if (e.kind === 'divider') {
      return { kind: 'divider', name: '</Layer group>', blend: 'pass', opacity: 255, flags: 0, clipping: 0, lsct: 3, encoded: [], chanIds: [], hasMask: false };
    }
    const l = e.layer;
    const isFolder = e.kind === 'folder';
    const base = {
      kind: e.kind, layer: l, name: l.name || (isFolder ? 'Group' : 'Layer'),
      blend: isFolder ? 'pass' : blendKey(l.blendMode),
      opacity: Math.round(Math.max(0, Math.min(1, l.opacity)) * 255),
      flags: l.visible ? 0 : 2,
      clipping: l.clipToBelow ? 1 : 0,
      lsct: isFolder ? 1 : null,
      adjustment: l.isAdjustment ? l.adjustment : null,
      hasMask: false, hasVectorMask: false, chanIds: [], encoded: [],
    };
    if (isFolder || !l.paint) {
      if (l.vectorMask) {
        base.hasVectorMask = true;
        base.vectorRect = vectorMaskRect(l, opts, w, h);
      }
      if (l.mask) {
        const mp = planesFromPaint(l.mask, w, h);
        base.chanIds = [-2];
        base.encoded = [await encodeChannel(mp.A, w, h, depth, compression)];
        base.hasMask = true;
      }
      return base;
    }
    const pl = planesFromPaint(l.paint, w, h);
    if (colorMode === 'cmyk') {
      const [C, M, Y, K] = invertPlanes(rgbToCmykPlanes(pl, w * h));   // ذخیرهٔ معکوس (قرارداد فتوشاپ)
      base.chanIds = [0, 1, 2, 3];                // C,M,Y,K (حالت CMYK آلفا ندارد)
      base.encoded = await Promise.all([
        encodeChannel(C, w, h, depth, compression),
        encodeChannel(M, w, h, depth, compression),
        encodeChannel(Y, w, h, depth, compression),
        encodeChannel(K, w, h, depth, compression),
      ]);
    } else {
      base.chanIds = [-1, 0, 1, 2];               // آلفا اول، سپس R,G,B (مثل فتوشاپ)
      base.encoded = await Promise.all([
        encodeChannel(pl.A, w, h, depth, compression),
        encodeChannel(pl.R, w, h, depth, compression),
        encodeChannel(pl.G, w, h, depth, compression),
        encodeChannel(pl.B, w, h, depth, compression),
      ]);
    }
    if (l.mask) {
      const mp = planesFromPaint(l.mask, w, h);
      base.chanIds.push(-2);
      base.encoded.push(await encodeChannel(mp.A, w, h, depth, compression));
      base.hasMask = true;
    }
    if (l.vectorMask) {
      base.hasVectorMask = true;
      base.vectorRect = vectorMaskRect(l, opts, w, h);
    }
    return base;
  }));

  // ۳) رکوردها + دادهٔ کانال
  const records = new W();
  const body = new W();
  for (const p of prepared) {
    records.u32(0); records.u32(0); records.u32(h); records.u32(w);
    records.u16(p.chanIds.length);
    for (let c = 0; c < p.chanIds.length; c++) {
      records.i16(p.chanIds[c]);
      records.u32(p.encoded[c].length);
    }
    records.u32(SIG8BIM);
    records.ascii4(p.blend.padEnd(4, ' ').slice(0, 4));
    records.u8(p.opacity);
    records.u8(p.clipping ?? 0);
    records.u8(p.flags);
    records.u8(0);

    const ex = new W();
    if (p.hasMask) {
      const md = new W();
      md.u32(0); md.u32(0); md.u32(h); md.u32(w);
      md.u8(255); md.u8(0); md.u8(0); md.u8(0);
      const b = md.out();
      ex.u32(b.length); ex.bytes(b);
    } else {
      ex.u32(0);
    }
    ex.u32(0);                                  // blending ranges
    ex.pascal4(p.name);

    if (p.lsct !== null) {
      const sub = new W();
      sub.u32(p.lsct);
      sub.u32(SIG8BIM);
      sub.ascii4(p.kind === 'folder' ? 'norm' : 'pass');
      tagged(ex, 'lsct', sub.out());
    }
    // لایهٔ تنظیم بومی (شامل curv)
    for (const k of adjustmentKeys(p.adjustment)) {
      tagged(ex, k.key, k.data);
    }
    // استایل لایه: lfx2 (مدرن) — و اختیاری lrFX قدیمی
    if (p.layer && p.layer.style) {
      const lfx2 = buildLfx2(p.layer);
      if (lfx2) tagged(ex, 'lfx2', lfx2);
      if (legacyEffects) {
        const lr = buildLrFX(p.layer);
        if (lr) tagged(ex, 'lrFX', lr);
      }
    }
    // ماسک برداری
    if (p.hasVectorMask) {
      tagged(ex, 'vmsk', buildVectorMaskPath(p.vectorRect, { width: w, height: h }));
    }
    // نام یونیکد
    {
      const sub = new W();
      const cnt = Math.min(255, p.name.length);
      sub.u32(cnt);
      for (let i = 0; i < cnt; i++) sub.u16(p.name.charCodeAt(i));
      tagged(ex, 'luni', sub.out());
    }
    const exBytes = ex.out();
    records.u32(exBytes.length);
    records.bytes(exBytes);

    for (const e2 of p.encoded) body.bytes(e2);
  }

  const layerInfo = new W();
  layerInfo.i16(prepared.length);
  layerInfo.bytes(records.out());
  layerInfo.bytes(body.out());
  const liBytes = layerInfo.out();

  const layerMask = new W();
  layerMask.u32(liBytes.length);
  layerMask.bytes(liBytes);
  layerMask.u32(0);

  // ۴) تصویر ادغام‌شده
  const comp = opts.composite;
  const rgba = {
    R: new Uint8Array(w * h), G: new Uint8Array(w * h),
    B: new Uint8Array(w * h), A: new Uint8Array(w * h),
  };
  for (let i = 0; i < w * h; i++) {
    rgba.R[i] = comp[i * 4]; rgba.G[i] = comp[i * 4 + 1];
    rgba.B[i] = comp[i * 4 + 2]; rgba.A[i] = comp[i * 4 + 3];
  }
  const planes = colorMode === 'cmyk'
    ? invertPlanes(rgbToCmykPlanes(rgba, w * h))     // تصویر ادغام‌شده هم معکوس ذخیره می‌شود
    : [rgba.R, rgba.G, rgba.B, rgba.A];
  const compositeData = await encodeComposite(planes, w, h, depth, compression);

  // ۵) منابع تصویر (ICC + ResolutionInfo)
  const res = new W();
  if (icc && icc.length) {
    res.u32(SIG8BIM); res.u16(1039);            // 1039 = ICC Profile
    res.pascal2('');
    res.u32(icc.length);
    res.bytes(icc);
    if (icc.length % 2) res.u8(0);
  }
  {
    res.u32(SIG8BIM); res.u16(1005);            // ResolutionInfo
    res.pascal2('');
    const d = new W();
    d.u32(72 << 16); d.u16(1); d.u16(1);
    d.u32(72 << 16); d.u16(1); d.u16(1);
    const db = d.out();
    res.u32(db.length); res.bytes(db);
  }
  const resBytes = res.out();

  // ۶) سرهم‌کردن فایل
  const out = new W();
  out.ascii4('8BPS');
  out.u16(1);
  out.zeros(6);
  out.u16(colorMode === 'cmyk' ? 4 : 4);   // تعداد کانال‌ها (CMYK=۴، RGB+آلفا=۴)
  out.u32(h); out.u32(w);
  out.u16(depth);
  out.u16(colorMode === 'cmyk' ? 4 : 3);   // ۳ = RGB، ۴ = CMYK
  out.u32(0);
  out.u32(resBytes.length); out.bytes(resBytes);
  const lmBytes = layerMask.out();
  out.u32(lmBytes.length); out.bytes(lmBytes);
  // بخش Image Data فیلد طول ندارد (فقط compression + داده تا پایان فایل)
  out.bytes(compositeData);
  return out.out();
}

