// engine/bitmap.js — عمق بیت ۱۶/۳۲ (قوی‌تر از فتوشاپ ۸ بیتی)
// تبدیل‌های بدون داده‌سوزی بین:
//   u8  (0..255)           → آنچه برس/فیلترهای فعلی مصرف می‌کنند
//   u16 (0..65535)         → PNG16 / TIFF16
//   f32 (خطی، 0..1)        → محاسبات دقیق (هیستوگرام، بلور، عمق بالا)
//
// قاعدهٔ Lumina: «دقتِ ۱۶ بیت جایی ساخته می‌شود که فیلتر داشته باشیم».
//  هنوز فیلترهای عمقی نداریم ولی زیرساخت دقیق اینجاست تا فاز بعد فقط فیلتر اضافه شود.
import { srgbToLinear, linearToSrgb, u8ToLinear, linearToU8 } from './color.js';
export { srgbToLinear, linearToSrgb, u8ToLinear, linearToU8 };

export function u8ToU16(u8) { const n = u8.length / 4; const out = new Uint16Array(n * 4); for (let i = 0, j = 0; i < n; i++, j += 4) { out[j] = u8[j] * 257; out[j + 1] = u8[j + 1] * 257; out[j + 2] = u8[j + 2] * 257; out[j + 3] = u8[j + 3] * 257; } return out; }
export function u16ToU8(u16) { const n = u16.length / 4; const out = new Uint8ClampedArray(n * 4); for (let i = 0, j = 0; i < n; i++, j += 4) { out[j] = u16[j] >> 8; out[j + 1] = u16[j + 1] >> 8; out[j + 2] = u16[j + 2] >> 8; out[j + 3] = u16[j + 3] >> 8; } return out; }

export function u16ToF32(u16) { const n = u16.length / 4; const out = new Float32Array(n * 4); for (let i = 0, j = 0; i < n; i++, j += 4) { out[j] = srgbToLinear(u16[j] / 65535); out[j + 1] = srgbToLinear(u16[j + 1] / 65535); out[j + 2] = srgbToLinear(u16[j + 2] / 65535); out[j + 3] = u16[j + 3] / 65535; } return out; }
export function f32ToU16(f32) { const n = f32.length / 4; const out = new Uint16Array(n * 4); for (let i = 0, j = 0; i < n; i++, j += 4) { out[j] = Math.round(linearToSrgb(clamp01(f32[j])) * 65535); out[j + 1] = Math.round(linearToSrgb(clamp01(f32[j + 1])) * 65535); out[j + 2] = Math.round(linearToSrgb(clamp01(f32[j + 2])) * 65535); out[j + 3] = Math.round(clamp01(f32[j + 3]) * 65535); } return out; }

export function u8ToF32(u8) { const n = u8.length / 4; const out = new Float32Array(n * 4); for (let i = 0, j = 0; i < n; i++, j += 4) { out[j] = srgbToLinear(u8[j] / 255); out[j + 1] = srgbToLinear(u8[j + 1] / 255); out[j + 2] = srgbToLinear(u8[j + 2] / 255); out[j + 3] = u8[j + 3] / 255; } return out; }
export function f32ToU8(f32) { const n = f32.length / 4; const out = new Uint8ClampedArray(n * 4); for (let i = 0, j = 0; i < n; i++, j += 4) { out[j] = Math.round(linearToSrgb(clamp01(f32[j])) * 255); out[j + 1] = Math.round(linearToSrgb(clamp01(f32[j + 1])) * 255); out[j + 2] = Math.round(linearToSrgb(clamp01(f32[j + 2])) * 255); out[j + 3] = Math.round(clamp01(f32[j + 3]) * 255); } return out; }

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

// عمق‌ها
export const DEPTH_8 = 8, DEPTH_16 = 16, DEPTH_32 = 32;

// تجمیع کانال از آرایهٔ RGBA (هر عمقی) — برای موتور عمق
export function rgbaFromDepth(data, depth) {
  if (depth === 16) return { data: data instanceof Uint16Array ? data : new Uint16Array(data.buffer, data.byteOffset, data.byteLength / 2), toU8: () => u16ToU8(data) };
  if (depth === 32) return { data: data instanceof Float32Array ? data : new Float32Array(data.buffer, data.byteOffset, data.byteLength / 4), toU8: () => f32ToU8(data) };
  return { data: data instanceof Uint8ClampedArray ? data : new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), toU8: () => data };
}

// آیا تصویر در هر دو عمق «همان» است؟ (تست)
export function maxDiff8(a, b) {
  if (a.length !== b.length) return Infinity;
  let m = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > m) m = d; }
  return m;
}
