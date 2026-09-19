// formats/psd-read.js — خوانندهٔ PSD «چندلایه» (وارد کردن کارِ فتوشاپ به Lumina)
// چرا مهم: تبادل با فتوشاپ دوطرفه می‌شود؛ پیش از این فقط تصویر ادغام‌شده خوانده می‌شد و
// لایه‌ها از دست می‌رفتند. اینجا رکوردها، گروه‌ها، blend/opacity/visibility، ماسک،
// ماسک برداری، ماسک برشی و لایه‌های تنظیم بازسازی می‌شوند.
import { Paint } from '../document/paint.js';
import { Layer } from '../document/layer.js';
import { packBitsDecode } from './psd.js';
import { inflateZlib } from './deflate.js';
import { parseDescriptorBlock, numOf, enumOf, boolOf, colorOf } from './psd-descriptor.js';
import { applyPredictorDecode } from './psd-layers.js';

const BLEND_REV = {
  norm: 'normal', diss: 'dissolve', dark: 'darken', mul: 'multiply',
  idiv: 'colorBurn', lbrn: 'linearBurn', dkCl: 'darkerColor',
  lite: 'lighten', scrn: 'screen', div: 'colorDodge', lddg: 'linearDodge',
  lgCl: 'lighterColor', over: 'overlay', sLit: 'softLight', hLit: 'hardLight',
  vLit: 'vividLight', lLit: 'linearLight', pLit: 'pinLight', hMix: 'hardMix',
  diff: 'difference', smud: 'exclusion', fsub: 'subtract', fdiv: 'divide',
  hue: 'hue', sat: 'saturation', colr: 'color', lum: 'luminosity',
};

class R {
  constructor(u8) { this.b = u8; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.p = 0; }
  u8() { return this.b[this.p++]; }
  u16() { const v = this.dv.getUint16(this.p, false); this.p += 2; return v; }
  i16() { const v = this.dv.getInt16(this.p, false); this.p += 2; return v; }
  u32() { const v = this.dv.getUint32(this.p, false); this.p += 4; return v; }
  i32() { const v = this.dv.getInt32(this.p, false); this.p += 4; return v; }
  bytes(n) { const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
  ascii4() { const s = String.fromCharCode(this.b[this.p], this.b[this.p + 1], this.b[this.p + 2], this.b[this.p + 3]); this.p += 4; return s; }
  skip(n) { this.p += n; }
  // رشتهٔ Pascal: padding نسبت به «شروع همان فیلد» حساب می‌شود (نه آفست مطلق فایل)
  // — همین قرارداد در فایل‌های واقعی فتوشاپ هم برقرار است.
  pascal(padTo = 4) {
    const start = this.p;
    const n = this.u8();
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(this.u8());
    const used = this.p - start;                    // ۱ + تعداد کاراکترها
    this.p += (padTo - (used % padTo)) % padTo;
    return s;
  }
}

// بازگردانی byte-shuffle عمق ۳۲: در فایل، بایت‌های نمونه‌ها گروه‌بندی شده‌اند
// (همهٔ بایت‌های مرتبهٔ ۰، سپس ۱ و ...). این تابع ترتیب اصلی را برمی‌گرداند.
export function unshuffle32(src, count) {
  const out = new Uint8Array(count * 4);
  for (let b = 0; b < 4; b++) {
    for (let i = 0; i < count; i++) out[i * 4 + b] = src[b * count + i];
  }
  return out;
}

function popcount(n) { let c = 0; while (n) { c += n & 1; n >>>= 1; } return c; }

// CMYK → RGB: همان تبدیل استاندارد بدون پروفایل (R = (255−C)(255−K)/255)
// این فرمول دقیقاً همان چیزی است که کتابخانه‌های مرجع (PIL) هم استفاده می‌کنند.
function cmykToRgbPlanes(planes, n) {
  // دادهٔ CMYK در PSD «معکوس» ذخیره می‌شود (بایت = ۲۵۵ − مرکب) — مثل فتوشاپ و psd-tools
  const inv = (a) => {
    if (!a) return new Uint8Array(n);
    const o = new Uint8Array(n);
    for (let i = 0; i < n; i++) o[i] = 255 - a[i];
    return o;
  };
  const C = inv(planes[0]), M = inv(planes[1]), Y = inv(planes[2]), K = inv(planes[3]);
  const R = new Uint8Array(n), G = new Uint8Array(n), B = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const k = 255 - K[i];
    R[i] = Math.round((255 - C[i]) * k / 255);
    G[i] = Math.round((255 - M[i]) * k / 255);
    B[i] = Math.round((255 - Y[i]) * k / 255);
  }
  return [R, G, B, null];
}

// خواندن رکوردهای مسیر (vmsk) → کادر مسیر
function parsePathRecords(buf, off, len, docW, docH) {
  // ۸ بایت نخست: u32 version(=3) + u32 flags (بیت۰ = معکوس)
  let p = off + 8;
  const end = off + len;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  while (p + 26 <= end && buf.byteOffset + p + 26 <= buf.byteOffset + buf.length) {
    const sel = (buf[p] << 8) | buf[p + 1];
    if (buf.byteOffset + p + 26 > buf.byteOffset + buf.length) break;
    const dv2 = new DataView(buf.buffer, buf.byteOffset + p + 2, 24);
    if (sel === 1 || sel === 2 || sel === 4 || sel === 5) {
      // گره: سه جفت (y,x) ‌به‌صورت fixed 8.24
      for (let k = 0; k < 3; k++) {
        // مختصات نرمال‌شده (fixed 8.24 نسبت به ابعاد سند)
        const y = (dv2.getInt32(k * 8, false) / 16777216) * docH;
        const x = (dv2.getInt32(k * 8 + 4, false) / 16777216) * docW;
        if (x || y) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }
    p += 26;
  }
  if (!isFinite(minX)) return null;
  return {
    left: Math.floor(minX), top: Math.floor(minY),
    right: Math.ceil(maxX), bottom: Math.ceil(maxY),
  };
}

// خواندن دسکریپتور اثر (lfx2) — با پارسر واقعی دسکریپتور فتوشاپ
function parseEffectsDescriptor(buf, off, len) {
  try {
    const { descriptor } = parseDescriptorBlock(buf, off);
    const style = {};
    // هر افکت می‌تواند یک آبجکت یا لیستی از آبجکت‌ها باشد (lmfx چندگانه)
    const pick = (items, classId) => {
      const v = items ? items[classId] : undefined;
      if (!v) return [];
      if (Array.isArray(v)) return v.filter((x) => x && x.items);
      if (v.items) return [v];
      return [];
    };
    const items = descriptor.items || {};
    for (const ds of pick(items, 'DrSh').concat(pick(items, 'IrSh'))) {
      const distance = numOf(ds, 'Dstn', 0);
      const angle = numOf(ds, 'lagl', 0);
      const a = (angle * Math.PI) / 180;
      const color = colorOf(ds, 'Clr ') || [0, 0, 0];
      style.dropShadow = {
        dx: Math.cos(a) * distance, dy: Math.sin(a) * distance,
        distance, angle,
        blur: numOf(ds, 'blur', 0),
        spread: numOf(ds, 'Ckmt', 0),
        opacity: numOf(ds, 'Opct', 100) / 100,
        color,
        blendMode: blendFromEnum(enumOf(ds, 'Md  ', 'Mltp')),
        enabled: boolOf(ds, 'enab', true),
      };
    }
    for (const st of pick(items, 'FrFX')) {
      style.stroke = {
        size: numOf(st, 'Sz  ', 1),
        opacity: numOf(st, 'Opct', 100) / 100,
        color: colorOf(st, 'Clr ') || [0, 0, 0],
        position: enumOf(st, 'Styl', 'OutF') === 'InsF' ? 'inside'
          : enumOf(st, 'Styl', 'OutF') === 'CtrF' ? 'center' : 'outside',
        blendMode: blendFromEnum(enumOf(st, 'Md  ', 'Nrml')),
        enabled: boolOf(st, 'enab', true),
      };
    }
    for (const ov of pick(items, 'SoFi')) {
      style.colorOverlay = {
        color: colorOf(ov, 'Clr ') || [255, 0, 0],
        opacity: numOf(ov, 'Opct', 100) / 100,
        blendMode: blendFromEnum(enumOf(ov, 'Md  ', 'Nrml')),
        enabled: boolOf(ov, 'enab', true),
      };
    }
    return Object.keys(style).length ? style : null;
  } catch { return null; }
}

// نگاشت enum فتوشاپ → نام حالت ترکیب لومیما
function blendFromEnum(v) {
  const map = {
    Nrml: 'normal', Mltp: 'multiply', Scrn: 'screen', Ovrl: 'overlay', Drkn: 'darken',
    Lghn: 'lighten', CBrn: 'colorDodge', idiv: 'colorBurn', lddg: 'linearDodge',
    lbrn: 'linearBurn', SftL: 'softLight', HrdL: 'hardLight', Dfrn: 'difference',
    Xclu: 'exclusion', hue: 'hue', sat: 'saturation', colr: 'color', Lmns: 'luminosity',
  };
  return map[v] || 'normal';
}

// خواندن رکوردهای قدیمی lrFX (Photoshop 5/6) — 16.16 ثابت‌نقطه
function parseLegacyEffects(buf, off, len) {
  try {
    const view = (p) => ((buf[off + p] << 8) | buf[off + p + 1]);
    const u32 = (p) => ((buf[off + p] << 24) | (buf[off + p + 1] << 16) | (buf[off + p + 2] << 8) | buf[off + p + 3]) >>> 0;
    const f16 = (p) => u32(p) / 65536;
    const count = view(2);
    const style = {};
    let p = 4;
    for (let i = 0; i < count && p + 12 <= len; i++) {
      const key = String.fromCharCode(buf[off + p + 4], buf[off + p + 5], buf[off + p + 6], buf[off + p + 7]);
      const b = p + 12;                              // شروع بدنه
      if (key === 'dsdw' || key === 'isdw') {
        const blur = f16(b + 4), angle = f16(b + 12), distance = f16(b + 16);
        const color = readFxColor(buf, off + b + 20);
        const opacity = buf[off + b + 38] / 255;
        const a = (angle * Math.PI) / 180;
        style.dropShadow = {
          blur, distance, angle, color, opacity,
          dx: Math.cos(a) * distance, dy: Math.sin(a) * distance, spread: 0,
        };
        p = b + u32(p + 8);
      } else if (key === 'sofi') {
        // version(4) + blendMode(8) + color(10) + opacity(1) + enabled(1) + native(10)
        style.colorOverlay = {
          color: readFxColor(buf, off + b + 12),
          opacity: buf[off + b + 22] / 255,
        };
        p = b + u32(p + 8);
      } else {
        p = b + u32(p + 8);
      }
    }
    return Object.keys(style).length ? style : null;
  } catch { return null; }
}

// رنگ ۱۶ بیتی رکوردهای قدیمی: u16 فضا + ۴×u16 مؤلفه (۰..۶۵۵۳۵)
function readFxColor(buf, off) {
  return [Math.round(buf[off + 2] / 257), Math.round(buf[off + 4] / 257), Math.round(buf[off + 6] / 257)];
}

function latin1(u8) { let s = ''; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; }

// آلفای تصویر ادغام‌شده: کانال شفافیت بعد از کانال‌های پایهٔ حالت رنگی می‌آید
// (RGB: ۳+۱، Grayscale: ۱+۱، CMYK: ۴+۱). اگر نباشد، تصویر مات است.
// برابر‌سازی پلن خام با بایت‌ها:
//   Bitmap (۱ بیت): هر بایت ۸ پیکسل؛ بیت ۰ = سفید (روشن) و ۱ = سیاه، بر اساس
//   مستندات فتوشاپ: در حالت Bitmap، ۱ یعنی سیاه و ۰ یعنی سفید.
//   Indexed: بایت ایندکس پالت است → RGB از پالت ۷۶۸ بایتی.
function expandBitmapPlane(plane, width) {
  const H = Math.floor(plane.length / (Math.ceil(width / 8) || 1));
  const out = new Uint8Array(width * H);
  const rowBytes = Math.ceil(width / 8);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < width; x++) {
      const byte = plane[y * rowBytes + (x >> 3)] || 0;
      const bit = (byte >> (7 - (x & 7))) & 1;
      out[y * width + x] = bit ? 0 : 255;      // 1 = سیاه، 0 = سفید
    }
  }
  return out;
}

function indexedToRgbPlanes(plane, palette) {
  const n = plane.length;
  const R = new Uint8Array(n), G = new Uint8Array(n), B = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const idx = plane[i] * 3;
    R[i] = palette[idx] || 0; G[i] = palette[idx + 1] || 0; B[i] = palette[idx + 2] || 0;
  }
  return [R, G, B];
}

// Lab (حالت رنگی ۹ فتوشاپ) → sRGB.
// فایل ۸ بیتی: L = بایت×۱۰۰/۲۵۵ و a,b = بایت−۱۲۸ (برای ۱۶ بیتی همان بایت بالا).
// مسیر: Lab(D50) → XYZ(D50) → تطبیق برادفورد به D65 → sRGB خطی → گاما.
const LAB_D50 = [0.9642, 1.0, 0.8249];
const BRADFORD_D50_TO_D65 = [
  0.9555766, -0.0230393, 0.0631636,
  -0.0282895, 1.0099416, 0.0210077,
  0.0122982, -0.0204830, 1.3299098,
];
function srgbGamma(c) {
  const v = c <= 0 ? 0 : (c >= 1 ? 1 : c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
export function labToRgbPlanes(Lp, Ap, Bp, n) {
  const R = new Uint8Array(n), G = new Uint8Array(n), B = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const L = (Lp[i] * 100) / 255;
    const a = Ap[i] - 128;
    const b = Bp[i] - 128;
    const fy = (L + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - b / 200;
    const fx3 = fx * fx * fx, fz3 = fz * fz * fz;
    const xr = fx3 > 0.008856 ? fx3 : (116 * fx - 16) / 903.3;
    const yr = L > 8 ? fy * fy * fy : L / 903.3;
    const zr = fz3 > 0.008856 ? fz3 : (116 * fz - 16) / 903.3;
    // XYZ در D50
    const X50 = xr * LAB_D50[0], Y50 = yr * LAB_D50[1], Z50 = zr * LAB_D50[2];
    // تطبیق به D65
    const X = BRADFORD_D50_TO_D65[0] * X50 + BRADFORD_D50_TO_D65[1] * Y50 + BRADFORD_D50_TO_D65[2] * Z50;
    const Y = BRADFORD_D50_TO_D65[3] * X50 + BRADFORD_D50_TO_D65[4] * Y50 + BRADFORD_D50_TO_D65[5] * Z50;
    const Z = BRADFORD_D50_TO_D65[6] * X50 + BRADFORD_D50_TO_D65[7] * Y50 + BRADFORD_D50_TO_D65[8] * Z50;
    // XYZ(D65) → sRGB خطی
    const rl = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z;
    const gl = -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z;
    const bl = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z;
    R[i] = Math.round(srgbGamma(rl) * 255);
    G[i] = Math.round(srgbGamma(gl) * 255);
    B[i] = Math.round(srgbGamma(bl) * 255);
  }
  return [R, G, B];
}

function alphaPlaneFor(planes, channels, colorMode) {
  if (colorMode === 4) return channels >= 5 ? planes[4] : null;   // CMYK
  if (colorMode === 1 || colorMode === 0 || colorMode === 2 || colorMode === 8) {
    return channels >= 2 ? planes[1] : null;   // Grayscale / Bitmap / Indexed / Duotone
  }
  if (colorMode === 9) return channels >= 4 ? planes[3] : null;    // Lab: 3 کانال پایه
  return channels >= 4 ? planes[3] : null;                        // RGB
}

function planesToPaint(w, h, planes, alphaMode) {
  const paint = new Paint(w, h);
  const R2 = planes[0], G2 = planes[1], B2 = planes[2], A2 = planes[3];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = A2 ? A2[i] : 255;
      if (a === 0) continue;                    // کاشی شفاف ساخته نشود (حافظهٔ کمتر)
      paint.setPixel(x, y, R2 ? R2[i] : 0, G2 ? G2[i] : 0, B2 ? B2[i] : 0, a);
    }
  }
  return paint;
}

// خواندن کانال‌های یک لایه — از این نسخه ZIP (۲) و ZIP+Prediction (۳) هم پشتیبانی می‌شوند.
// طول دادهٔ هر کانال در رکورد لایه آمده و شامل ۲ بایت هدر compression است.
// نمونهٔ ۳۲ بیتی در PSD «float32 big-endian» است (محدودهٔ ۰..۱). برای ویرایش
// ۸ بیتی، هر نمونه به بایت تبدیل می‌شود: round(255 × clamp(v, 0, 1)).
function f32ToByte(u8, off) {
  const v = new DataView(u8.buffer, u8.byteOffset + off, 4).getFloat32(0, false);
  const c = v <= 0 ? 0 : (v >= 1 ? 1 : v);
  return Math.round(c * 255);
}

async function readChannels(r, rec, depth) {
  const w = rec.right - rec.left, h = rec.bottom - rec.top;
  const out = [];
  for (const ch of rec.channels) {
    const comp = r.u16();
    const isMask = (ch.id === -2 || ch.id === -3);
    const ww = isMask && rec.maskW ? rec.maskW : w;
    const hh = isMask && rec.maskH ? rec.maskH : h;
    const need = ww * hh;
    const bytesPer = depth === 32 ? 4 : (depth === 16 ? 2 : 1);
    const rawLen = need * bytesPer;
    const plane = new Uint8Array(need);
    const payloadLen = Math.max(0, (ch.len || 0) - 2);

    if (comp === 0) {
      const raw = r.bytes(Math.min(rawLen, Math.max(0, r.b.length - r.p)));
      if (depth === 32) for (let i = 0; i < need; i++) plane[i] = f32ToByte(raw, i * 4);
      else if (depth === 16) for (let i = 0; i < need; i++) plane[i] = raw[i * 2];
      else plane.set(raw.subarray(0, need));
    } else if (comp === 1) {
      const counts = [];
      for (let i = 0; i < hh; i++) counts.push(r.u16());
      for (let y = 0; y < hh; y++) {
        const n = counts[y];
        const enc = r.bytes(n);
        const dec = packBitsDecode(enc, ww * bytesPer);
        if (depth === 32) { for (let x = 0; x < ww; x++) plane[y * ww + x] = f32ToByte(dec, x * 4); }
        else if (depth === 16) { for (let x = 0; x < ww; x++) plane[y * ww + x] = dec[x * 2]; }
        else plane.set(dec.subarray(0, ww), y * ww);
      }
    } else if (comp === 2 || comp === 3) {
      const data = r.bytes(Math.min(payloadLen, Math.max(0, r.b.length - r.p)));
      let src = await inflateZlib(data);
      // عمق ۳۲: ابتدا باید «بازچینش بایتی» (byte shuffle) بازگردانی شود، بعد پیش‌بینی
      if (comp === 3 && depth === 32) src = unshuffle32(src, need);
      if (comp === 3) src = applyPredictorDecode(src, ww * (depth === 32 ? 1 : bytesPer), hh);
      if (depth === 32) {
        for (let i = 0; i < need; i++) plane[i] = f32ToByte(src, i * 4);
      } else if (bytesPer === 2) {
        for (let i = 0; i < need; i++) plane[i] = src[i * 2];
      } else {
        plane.set(src.subarray(0, need));
      }
    } else {
      throw new Error('PSD: فشرده‌سازی کانال ' + comp + ' پشتیبانی نمی‌شود');
    }
    out.push(plane);
  }
  return out;
}

export async function decodeLayeredPSD(buf) {
  const r = new R(buf);
  if (r.ascii4() !== '8BPS') throw new Error('PSD: امضای فایل درست نیست');
  const version = r.u16();
  r.skip(6);
  const channels = r.u16();
  const height = r.u32();
  const width = r.u32();
  const depth = r.u16();
  const colorMode = r.u16();
  const isCMYK = colorMode === 4;
  const isGray = colorMode === 1;
  const isBitmap = colorMode === 0;
  const isIndexed = colorMode === 2;
  const isDuotone = colorMode === 8;   // تک‌کاناله؛ به‌صورت خاکستری خوانده می‌شود
  const isLab = colorMode === 9;
  if (!isCMYK && !isGray && !isBitmap && !isIndexed && !isDuotone && !isLab && colorMode !== 3) {
    throw new Error('PSD: حالت رنگی ' + colorMode + ' پشتیبانی نمی‌شود');
  }
  // Bitmap = ۱ بیت در هر نمونه؛ در فشرده‌سازی RAW با بایت بالا (چپ‌چین) پر می‌شود.
  if (isBitmap && depth !== 1) throw new Error('PSD: عمق ' + depth + ' بیت برای حالت Bitmap پشتیبانی نمی‌شود');
  if (!isBitmap && depth !== 8 && depth !== 16 && depth !== 32) throw new Error('PSD: عمق ' + depth + ' بیت پشتیبانی نمی‌شود');

  // Color mode data — برای حالت Indexed این ۷۶۸ بایت پالت RGB است
  const cmdLen = r.u32();
  const cmdStart = r.p;
  const palette = (colorMode === 2 && cmdLen >= 768) ? r.b.slice(cmdStart, cmdStart + 768) : null;
  r.p = cmdStart + cmdLen;

  // Image resources → ICC
  let icc = null;
  const resLen = r.u32();
  const resEnd = r.p + resLen;
  while (r.p + 12 <= resEnd) {
    const sig = r.ascii4();
    const id = r.u16();
    const name = r.pascal(2);
    const len = r.u32();
    const dataStart = r.p;
    if (sig === '8BIM' && (id === 1039 || id === 1041) && len > 128) icc = r.b.slice(dataStart, dataStart + len);
    r.p = dataStart + len + (len % 2);
  }
  r.p = resEnd;

  // Layer & Mask info
  const lmLen = r.u32();
  const lmEnd = r.p + lmLen;
  // فایل «تخت» (بدون بخش لایه): طول این بخش صفر است. باید مستقیم به تصویر
  // ادغام‌شده برویم، وگرنه از مرز بافر بیرون می‌زنیم. (باگ واقعی روی فایل‌های
  // CMYK با کانال‌های Spot — مثل cmyk-spot.psd — پیدا و اصلاح شد.)
  const hasLayerSection = lmLen > 0 && r.p + 4 <= r.b.length;
  const liLen = hasLayerSection ? r.u32() : 0;
  const liEnd = hasLayerSection ? Math.min(lmEnd, r.p + liLen) : r.p;
  const rawCount = hasLayerSection && liLen > 0 ? r.i16() : 0;
  const count = Math.abs(rawCount);
  const records = [];
  for (let i = 0; i < count && r.p < liEnd; i++) {
    const top = r.i32(), left = r.i32(), bottom = r.i32(), right = r.i32();
    const nch = r.u16();
    const chans = [];
    for (let c = 0; c < nch; c++) chans.push({ id: r.i16(), len: r.u32() });
    const bsig = r.ascii4();
    const bkey = r.ascii4();
    const opacity = r.u8();
    const clipping = r.u8();
    const flags = r.u8();
    r.u8();                                   // filler
    const extraLen = r.u32();
    const extraEnd = r.p + extraLen;
    // mask data
    let maskRect = null;
    const maskLen = r.u32();
    if (maskLen > 0) {
      const mt = r.i32(), ml = r.i32(), mb = r.i32(), mr = r.i32();
      maskRect = { top: mt, left: ml, bottom: mb, right: mr };
      r.skip(maskLen - 16);
    }
    // blending ranges
    const brLen = r.u32(); r.skip(brLen);
    // name + tagged blocks
    let name = r.pascal(4);
    let lsct = null; let unicode = null; let styles = null; let vectorRect = null;
    const adjKeys = {};
    while (r.p + 12 <= extraEnd) {
      const s2 = r.ascii4();
      if (s2 !== '8BIM' && s2 !== '8B64') break;
      const key = r.ascii4();
      const klen = r.u32();
      const kEnd = r.p + klen;
      if (key === 'lsct') lsct = r.u32();
      else if (key === 'curv') {
        const isMap = r.u8();
        const ver = r.u16();
        const bitmap = r.u32();
        let count = ver === 1 ? popcount(bitmap) : bitmap;
        const curves = [];
        for (let ci = 0; ci < count; ci++) {
          if (isMap) { const lut = new Uint8Array(256); for (let k = 0; k < 256; k++) lut[k] = r.u8(); curves.push(lut); }
          else {
            const n = r.u16();
            const pts = [];
            for (let k = 0; k < n; k++) { const output = r.u16(); const input = r.u16(); pts.push([input, output]); }
            curves.push(pts);
          }
        }
        adjKeys.curv = { bitmap, curves };
      }
      else if (key === 'lfx2' || key === 'lmfx') {
        const parsed = parseEffectsDescriptor(r.b, r.p, klen);
        if (parsed) styles = parsed;
      }
      else if (key === 'lrFX') {
        const parsed = parseLegacyEffects(r.b, r.p, klen);
        if (parsed) styles = styles || parsed;
      }
      else if (key === 'vmsk' || key === 'vsms') {
        const path = parsePathRecords(r.b, r.p, klen, width, height);
        if (path) vectorRect = path;
      }
      else if (key === 'luni') {
        const n = r.u32();
        let str = '';
        for (let k = 0; k < n; k++) str += String.fromCharCode(r.u16());
        unicode = str;
      } else if (key === 'nvrt' || key === 'gryc') adjKeys[key] = {};
      else if (key === 'thrs') { r.u16(); adjKeys[key] = { t: r.u16() }; }
      else if (key === 'brit') adjKeys[key] = { brightness: r.i16(), contrast: r.i16() };
      else if (key === 'hue2') adjKeys[key] = { hue: r.i16(), sat: r.i16(), light: r.i16() };
      else if (key === 'levl') {
        const sh = r.u16(), hi = r.u16();
        for (let k = 0; k < 3; k++) { r.u16(); r.u16(); }
        const g = r.u16() / 100;
        adjKeys[key] = { shadows: sh, highlights: hi, gamma: g };
      } else if (key === 'expA') {
        const ev = r.i32() / 0x10000; adjKeys[key] = { ev };
      }
      r.p = kEnd + (klen % 2);
    }
    r.p = extraEnd;
    if (unicode) name = unicode;
    records.push({
      top, left, bottom, right, channels: chans, blend: BLEND_REV[bkey.trim()] || 'normal',
      opacity: opacity / 255, flags, clipping, name, lsct,
      maskRect, styles, vectorRect,
      maskW: maskRect ? maskRect.right - maskRect.left : 0,
      maskH: maskRect ? maskRect.bottom - maskRect.top : 0,
      adjKeys,
    });
  }
  // دادهٔ کانال‌ها (به همان ترتیب رکوردها)
  for (const rec of records) {
    try {
      rec.planes = await readChannels(r, rec, depth);
    } catch (e) {
      rec.planes = [];
      rec.channelError = e.message;
    }
  }
  // ⚠️ نکتهٔ حیاتی (باگ واقعی روی adjustment_backdrop_test.psd):
  // تصویر ادغام‌شده بعد از «کل» بخش Layer & Mask شروع می‌شود، نه بلافاصله بعد از
  // بلوک اطلاعات لایه. اگر بین این دو دادهٔ اضافی باشد (ماسک سراسری، اطلاعات
  // لایه‌های اضافی)، شروع از liEnd ردیف‌های آخر تصویر را خراب می‌کند.
  r.p = hasLayerSection ? Math.min(lmEnd, r.b.length) : r.p;

  // تصویر ادغام‌شده (برای پیش‌نمایش/مقایسه)
  r.p = lmEnd;
  let merged = null;
  if (r.p + 2 <= r.b.length) {
    const compression = r.u16();
    const planeLen = width * height;
    try {
      if (compression === 2 || compression === 3) {
        // ZIP: یک جریان واحد برای همهٔ کانال‌ها (به ترتیب پلن‌ها)
        const data = r.bytes(Math.max(0, r.b.length - r.p));
        let src = await inflateZlib(data);
        const bytesPer = depth === 32 ? 4 : (depth === 16 ? 2 : 1);
        const rowBytes = isBitmap ? Math.ceil(width / 8) : width * bytesPer;
        const planeBytes = isBitmap ? rowBytes * height : planeLen * bytesPer;
        if (compression === 3 && depth === 32) src = unshuffle32(src, planeLen * channels);
        if (compression === 3) src = applyPredictorDecode(src, isBitmap ? rowBytes : width * (depth === 32 ? 1 : bytesPer), height * channels);
        const planes = [];
        for (let c = 0; c < channels; c++) {
          const base = c * planeBytes;
          if (isBitmap) {
            planes.push(expandBitmapPlane(src.subarray(base, base + planeBytes), width));
          } else {
            const plane = new Uint8Array(planeLen);
            if (depth === 32) for (let i = 0; i < planeLen; i++) plane[i] = f32ToByte(src, base + i * 4);
            else if (bytesPer === 2) for (let i = 0; i < planeLen; i++) plane[i] = src[base + i * 2];
            else plane.set(src.subarray(base, base + planeLen));
            planes.push(plane);
          }
        }
        const alpha = alphaPlaneFor(planes, channels, colorMode);
        if (isCMYK) {
          const rgb = cmykToRgbPlanes(planes, planeLen);   // [R, G, B, null]
          merged = planesToPaint(width, height, [rgb[0], rgb[1], rgb[2], alpha], false);
        }
        else if (isIndexed) {
          const rgb = indexedToRgbPlanes(planes[0], palette || new Uint8Array(768));
          merged = planesToPaint(width, height, [rgb[0], rgb[1], rgb[2], alpha], true);
        }
        else if (isLab) {
          const rgb = labToRgbPlanes(planes[0], planes[1], planes[2], planeLen);
          merged = planesToPaint(width, height, [rgb[0], rgb[1], rgb[2], alpha], true);
        }
        else if (isGray || isBitmap || isDuotone) merged = planesToPaint(width, height, [planes[0], planes[0], planes[0], alpha], true);
        else merged = planesToPaint(width, height, [planes[0], planes[1], planes[2], alpha], true);
      } else if (compression === 0 || compression === 1) {
        const planes = [];
        const rowCounts = [];
        if (compression === 1) {
          for (let c = 0; c < channels; c++) {
            const counts = [];
            for (let y = 0; y < height; y++) counts.push(r.u16());
            rowCounts.push(counts);
          }
        }
        for (let c = 0; c < channels; c++) {
          if (isBitmap) {
            // ۱ بیت: هر ردیف ceil(width/8) بایت (RAW) یا همان طول پس از RLE
            const rwb = Math.ceil(width / 8);
            const packedPlane = new Uint8Array(rwb * height);
            if (compression === 0) {
              packedPlane.set(r.bytes(rwb * height));
            } else {
              for (let y = 0; y < height; y++) {
                const n = rowCounts[c][y];
                const dec = packBitsDecode(r.bytes(n), rwb);
                packedPlane.set(dec.subarray(0, rwb), y * rwb);
              }
            }
            planes.push(expandBitmapPlane(packedPlane, width));
            continue;
          }
          const plane = new Uint8Array(planeLen);
          const bpp = depth === 32 ? 4 : (depth === 16 ? 2 : 1);
          if (compression === 0) {
            const raw = r.bytes(planeLen * bpp);
            if (depth === 32) for (let i = 0; i < planeLen; i++) plane[i] = f32ToByte(raw, i * 4);
            else if (depth === 16) for (let i = 0; i < planeLen; i++) plane[i] = raw[i * 2];
            else plane.set(raw);
          } else {
            for (let y = 0; y < height; y++) {
              const n = rowCounts[c][y];
              const enc = r.bytes(n);
              const dec = packBitsDecode(enc, width * bpp);
              if (depth === 32) for (let x = 0; x < width; x++) plane[y * width + x] = f32ToByte(dec, x * 4);
              else if (depth === 16) for (let x = 0; x < width; x++) plane[y * width + x] = dec[x * 2];
              else plane.set(dec.subarray(0, width), y * width);
            }
          }
          planes.push(plane);
        }
        const alpha = alphaPlaneFor(planes, channels, colorMode);
        if (isCMYK) {
          const rgb = cmykToRgbPlanes(planes, planeLen);   // [R, G, B, null]
          merged = planesToPaint(width, height, [rgb[0], rgb[1], rgb[2], alpha], false);
        }
        else if (isIndexed) {
          const rgb = indexedToRgbPlanes(planes[0], palette || new Uint8Array(768));
          merged = planesToPaint(width, height, [rgb[0], rgb[1], rgb[2], alpha], true);
        }
        else if (isLab) {
          const rgb = labToRgbPlanes(planes[0], planes[1], planes[2], planeLen);
          merged = planesToPaint(width, height, [rgb[0], rgb[1], rgb[2], alpha], true);
        }
        else if (isGray || isBitmap || isDuotone) merged = planesToPaint(width, height, [planes[0], planes[0], planes[0], alpha], true);
        else merged = planesToPaint(width, height, [planes[0], planes[1], planes[2], alpha], true);
      }
    } catch { merged = null; }
  }

  // ── بازسازی لایه‌های Lumina (PSD: بالا→پایین ⇒ لومیما: پایین→بالا) ──
  const flat = [];                     // ترتیب پایین → بالا (قرارداد لومیما)
  const pendingGroups = [];            // گروه‌هایی که «بسته»شان زودتر دیده شده (نست LIFO)
  const psdOrder = records.slice().reverse();   // حالا پایین → بالا
  for (const rec of psdOrder) {
    // ── نشانگر تقسیم بخش (قرارداد استاندارد فتوشاپ) ──
    //   lsct 1 = رکورد پوشه (نام/opacity/blend گروه روی آن است) و در ترتیب پایین→بالا
    //            نخستین چیزِ گروه است ⇒ نشانگر «شروع» لومیما.
    //   lsct 3 = bounding section divider، در انتها ⇒ نشانگر «پایان» گروه.
    if (rec.lsct === 1) {
      flat.push(new Layer({
        name: rec.name || 'Group', isGroup: true,
        opacity: rec.opacity, blendMode: rec.blend, visible: (rec.flags & 2) === 0,
      }));
      continue;
    }
    if (rec.lsct === 3) {
      flat.push(new Layer({ name: '</Layer group>', isGroupEnd: true }));
      continue;
    }
    if (rec.lsct === 2) {   // پوشهٔ بسته (closed folder) = گروهی که اعضایش پنهان‌اند
      flat.push(new Layer({
        name: rec.name || 'Group', isGroup: true, visible: false,
        opacity: rec.opacity, blendMode: rec.blend,
      }));
      continue;
    }

    const l = new Layer({
      name: rec.name || 'Layer',
      opacity: rec.opacity,
      blendMode: rec.blend,
      visible: (rec.flags & 2) === 0,
      clipToBelow: rec.clipping === 1,
    });

    // ── لایهٔ تنظیم بومی ──
    const adj = rec.adjKeys || {};
    if ('nvrt' in adj) l.adjustment = { type: 'invert', label: 'Invert' };
    else if ('gryc' in adj) l.adjustment = { type: 'grayscale', label: 'Grayscale' };
    else if ('thrs' in adj) l.adjustment = { type: 'threshold', label: 'Threshold', t: adj.thrs.t };
    else if ('brit' in adj) l.adjustment = { type: 'brightness-contrast', label: 'Brightness/Contrast', brightness: adj.brit.brightness, contrast: adj.brit.contrast };
    else if ('hue2' in adj) l.adjustment = { type: 'hue-sat', label: 'Hue/Saturation', hue: adj.hue2.hue, sat: adj.hue2.sat, light: adj.hue2.light };
    else if ('levl' in adj) l.adjustment = { type: 'levels', label: 'Levels', shadows: adj.levl.shadows, highlights: adj.levl.highlights, gamma: adj.levl.gamma };
    else if ('expA' in adj) l.adjustment = { type: 'exposure', label: 'Exposure', ev: adj.expA.ev };
    else if ('vibr' in adj) l.adjustment = { type: 'vibrance', label: 'Vibrance', amount: (adj.vibr?.amount ?? 0) / 100 };
    else if ('curv' in adj && adj.curv.curves && adj.curv.curves.length) {
      // نقاط منحنی: اولین کانال (RGB ترکیبی). نقاط به‌صورت [input, output] هستند.
      const pts = Array.isArray(adj.curv.curves[0]) && Array.isArray(adj.curv.curves[0][0])
        ? adj.curv.curves[0] : [];
      l.adjustment = { type: 'curves', label: 'Curves', points: pts.length >= 2 ? pts : [[0, 0], [255, 255]] };
    }

    // ── استایل لایه (Layer Style) ──
    if (rec.styles) l.style = rec.styles;
    // ── ماسک برداری ──
    if (rec.vectorRect && rec.vectorRect.right > rec.vectorRect.left && rec.vectorRect.bottom > rec.vectorRect.top) {
      const vm = new Uint8Array(width * height);
      const { left, top, right, bottom } = rec.vectorRect;
      for (let y = Math.max(0, top); y < Math.min(height, bottom); y++) {
        for (let x = Math.max(0, left); x < Math.min(width, right); x++) vm[y * width + x] = 1;
      }
      l.vectorMask = { mask: vm, w: width, h: height };
    }

    // ── پیکسل‌ها (کانال -1 = آلفا، 0/1/2 = R/G/B، -2 = ماسک) ──
    const planes = rec.planes || [];
    const chanById = {};
    rec.channels.forEach((c, i) => { chanById[c.id] = planes[i]; });
    const lw = rec.right - rec.left, lh = rec.bottom - rec.top;
    if (isCMYK && lw > 0 && lh > 0 && (chanById[0] || chanById[1])) {
      const rgbPlanes = cmykToRgbPlanes([chanById[0], chanById[1], chanById[2], chanById[3]], lw * lh);
      const p = planesToPaint(lw, lh, rgbPlanes, false);
      l.paint = p;
    } else if (lw > 0 && lh > 0 && (chanById[0] || chanById[1] || chanById[2])) {
      const p = planesToPaint(lw, lh, [chanById[0], chanById[1], chanById[2], chanById[-1]], true);
      if (rec.left !== 0 || rec.top !== 0) {
        // انتقال به بوم کامل (مدل لومیما: لایه = اندازهٔ بوم)
        const canvasPaint = new Paint(width, height);
        const px = [0, 0, 0, 0];
        for (let y = 0; y < lh; y++) {
          for (let x = 0; x < lw; x++) {
            p.getPixel(x, y, px);
            if (!px[3]) continue;
            canvasPaint.setPixel(rec.left + x, rec.top + y, px[0], px[1], px[2], px[3]);
          }
        }
        l.paint = canvasPaint;
      } else {
        l.paint = p;
      }
    }
    // ── ماسک لایه ──
    if (chanById[-2] && rec.maskW > 0 && rec.maskH > 0) {
      const mp = new Paint(rec.maskW, rec.maskH);
      for (let y = 0; y < rec.maskH; y++) {
        for (let x = 0; x < rec.maskW; x++) {
          const v = chanById[-2][y * rec.maskW + x];
          mp.setPixel(x, y, 255, 255, 255, v);
        }
      }
      l.mask = mp;
      l.maskRect = rec.maskRect;
    }
    flat.push(l);
  }

  return { width, height, layers: flat, icc, merged, recordCount: records.length, version };
}

// آیا این PSD لایه دارد؟ (برای تصمیم‌گیری در UI)
export function psdHasLayers(buf) {
  try {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let off = 26;
    const cmdLen = dv.getUint32(off, false); off += 4 + cmdLen;
    const resLen = dv.getUint32(off, false); off += 4 + resLen;
    const lmLen = dv.getUint32(off, false);
    if (lmLen < 8) return false;
    const liLen = dv.getUint32(off + 4, false);
    if (liLen < 2) return false;
    const count = dv.getInt16(off + 8, false);
    return Math.abs(count) > 0;
  } catch { return false; }
}
