// tools/clone.js — Clone Stamp (مهر کپی) + Healing Brush (برس ترمیم)
// رفتار فتوشاپ:
//   Alt+Click → نقطهٔ منبع. سپس حین کشیدن، از منبعِ ثابت (اسنپ‌شات لحظهٔ نمونه‌برداری)
//   کپی می‌شود — نه از بافرِ در حال تغییر (پس از نمونه‌گیری، منبع ثابت می‌ماند).
//   آفست = (نقطهٔ منبع) − (نقطهٔ مقصد هنگام نمونه‌گیری).
import { compositePixelU8, blendColor } from '../engine/blend.js';

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

// یک مُهر کپی: برای هر پیکسل برس، از src در (x+offx, y+offy) می‌خواند و روی dst می‌گذارد.
// hardness در [0..1]، alphaMul فشار 0..1.
export function cloneStamp(src, dst, cx, cy, radius, hardness, offx, offy, alphaMul = 1) {
  const r = Math.max(1, radius);
  const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1), y1 = Math.ceil(cy + r + 1);
  const aa = Math.min(1, 1 / r);
  const srcs = [0, 0, 0, 0];
  const dstd = [0, 0, 0, 0];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      let cov;
      if (hardness >= 1) cov = clamp01(1 - (d - (1 - aa)) / aa);
      else if (hardness <= 0) cov = Math.pow(1 - d, 1.6);
      else {
        const hard = clamp01(1 - (d - (1 - aa)) / aa);
        const soft = Math.pow(1 - d, 1.6);
        cov = hard * hardness + soft * (1 - hardness);
      }
      src.getPixel(x + offx, y + offy, srcs);
      if (srcs[3] <= 0) continue;
      const a = Math.round(cov * (srcs[3] / 255) * clamp01(alphaMul) * 255);
      if (a <= 0) continue;
      if (src === dst && (offx === 0 && offy === 0)) { // جلوگیری از حلقهٔ خودی (بدون تغییر)
        continue;
      }
      dst.getPixel(x, y, dstd);
      const o = compositePixelU8(dstd, [srcs[0], srcs[1], srcs[2], a], 'normal', 1);
      dst.setPixel(x, y, o[0], o[1], o[2], o[3]);
    }
  }
}

// لومینانس Rec.709
function lum(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

// Healing Brush (ترمیم): «بافت» (روشنایی مکان‌ی) از منبع + «رنگ» از مقصد.
// خروجی = رنگ مقصد با لومینانسِ منبع (لومینانس به‌سبک فتوشاپ).
function healColor(srcR, srcG, srcB, dstR, dstG, dstB) {
  // YIQ: نگه‌داشتن I,Q مقصد + Y منبع
  const sy = lum(srcR, srcG, srcB);
  const dy = lum(dstR, dstG, dstB);
  const di = 0.596 * dstR - 0.274 * dstG - 0.322 * dstB;
  const dq = 0.211 * dstR - 0.523 * dstG + 0.312 * dstB;
  const dy2 = dy === 0 ? 0 : dy;
  let r = sy + 0.956 * di + 0.621 * dq;
  let g = sy - 0.272 * di - 0.647 * dq;
  let b = sy - 1.106 * di + 1.702 * dq;
  // تطبیق روشنایی کلی به مقصد (برای طبیعی‌بودن در لبه‌ها)
  r = r < 0 ? 0 : (r > 255 ? 255 : r);
  g = g < 0 ? 0 : (g > 255 ? 255 : g);
  b = b < 0 ? 0 : (b > 255 ? 255 : b);
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(dy2)];
}

// مُهر ترمیم: نمونه از منبع، رنگ از مقصد
export function healingStamp(src, dst, cx, cy, radius, hardness, offx, offy, alphaMul = 1) {
  const r = Math.max(1, radius);
  const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1), y1 = Math.ceil(cy + r + 1);
  const aa = Math.min(1, 1 / r);
  const srcs = [0, 0, 0, 0], dstd = [0, 0, 0, 0];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      let cov;
      if (hardness >= 1) cov = clamp01(1 - (d - (1 - aa)) / aa);
      else if (hardness <= 0) cov = Math.pow(1 - d, 1.6);
      else {
        const hard = clamp01(1 - (d - (1 - aa)) / aa);
        const soft = Math.pow(1 - d, 1.6);
        cov = hard * hardness + soft * (1 - hardness);
      }
      src.getPixel(x + offx, y + offy, srcs);
      dst.getPixel(x, y, dstd);
      if (srcs[3] <= 0 || dstd[3] <= 0) continue;
      const h = healColor(srcs[0], srcs[1], srcs[2], dstd[0], dstd[1], dstd[2]);
      const a = Math.round(cov * clamp01(alphaMul) * 255);
      if (a <= 0) continue;
      const o = compositePixelU8(dstd, [h[0], h[1], h[2], a], 'normal', 1);
      dst.setPixel(x, y, o[0], o[1], o[2], o[3]);
    }
  }
}
