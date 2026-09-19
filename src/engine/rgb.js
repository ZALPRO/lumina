// engine/rgb.js — تبدیل‌های فضای رنگ کاربر (hex، HSL، HSV) + lerp خطی
// فتوشاپ رنگ را در مدل HSB/HSL عرضه می‌کند؛ همین ابزارها پایه‌ی پنل رنگ و تنظیمات است.

export function hexToRgb(hex) {
  let s = String(hex).trim().replace(/^#/, '');
  if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r, g, b) {
  const h = (v) => v.toString(16).padStart(2, '0');
  return '#' + h(clampByte(r)) + h(clampByte(g)) + h(clampByte(b));
}

function clampByte(v) {
  v = Math.round(v);
  return v < 0 ? 0 : (v > 255 ? 255 : v);
}

// RGB u8 -> HSL (h: 0..360, s/l: 0..1)
export function rgbToHsl(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const L = (max + min) / 2;
  if (max === min) return [0, 0, L];
  const d = max - min;
  const S = L > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h * 60, S, L];
}

export function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; else if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

// RGB u8 -> HSV
export function rgbToHsv(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B);
  const V = max;
  const d = max - min;
  const S = max === 0 ? 0 : d / max;
  let h = 0;
  if (d !== 0) {
    if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
  }
  return [h, S, V];
}

// درون‌یابی در فضای خطی (کیفیت بالاتر از lerp ساده در sRGB)
import { srgbToLinear, linearToSrgb } from './color.js';
export function lerpColorU8(c1, c2, t) {
  const r = linearToSrgb(srgbToLinear(c1[0] / 255) + (srgbToLinear(c2[0] / 255) - srgbToLinear(c1[0] / 255)) * t);
  const g = linearToSrgb(srgbToLinear(c1[1] / 255) + (srgbToLinear(c2[1] / 255) - srgbToLinear(c1[1] / 255)) * t);
  const b = linearToSrgb(srgbToLinear(c1[2] / 255) + (srgbToLinear(c2[2] / 255) - srgbToLinear(c1[2] / 255)) * t);
  return [clampByte(r * 255), clampByte(g * 255), clampByte(b * 255)];
}
