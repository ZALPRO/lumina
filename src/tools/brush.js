// tools/brush.js — موتور قلم: stamp دایره‌ای (سخت/نرم) + فاصله‌گذاری stroke + آمادهٔ فشار قلم
// ترکیب رنگ با compositeOver در فضای خطی (همان موتور بلندینگ) → کیفیت فتوشاپی
import { compositePixelU8 } from '../engine/blend.js';

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

// یک «مُهر» قلم روی paint. color = [r,g,b,a(0..255)]، hardness در [0..1]،
// alphaMul = ضریب فشار/جریان (0..1).
export function brushStamp(paint, cx, cy, radius, hardness, color, alphaMul = 1) {
  const r = Math.max(1, radius);
  const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1), y1 = Math.ceil(cy + r + 1);
  const aa = Math.min(1, 1 / r);   // پهنای لبهٔ آنتی‌الیاس ~۱ پیکسل در هر شعاع
  const out = [0, 0, 0, 0];
  const srcAlpha = clamp01(color[3] / 255) * clamp01(alphaMul);

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      let cov;
      if (hardness >= 1) {
        cov = clamp01(1 - (d - (1 - aa)) / aa);      // لبهٔ تیز با آنتی‌الیاس
      } else if (hardness <= 0) {
        cov = Math.pow(1 - d, 1.6);                   // قلم نرم (منحنی نرم)
      } else {
        const hard = clamp01(1 - (d - (1 - aa)) / aa);
        const soft = Math.pow(1 - d, 1.6);
        cov = hard * hardness + soft * (1 - hardness);
      }
      const a = Math.round(cov * srcAlpha * 255);
      if (a <= 0) continue;
      // paint را با «منبع روی زمینه» ترکیب کن (دقت خطی)
      paint.getPixel(x, y, out);
      const o = compositePixelU8(out, [color[0], color[1], color[2], a], 'normal', 1);
      paint.setPixel(x, y, o[0], o[1], o[2], o[3]);
    }
  }
}

// نقطه‌های مُهر برای یک مسیر (پلی‌لاین) با فاصله‌ی spacing
export function strokePoints(points, spacing) {
  if (!points || points.length === 0) return [];
  if (points.length === 1) return [[points[0][0], points[0][1]]];
  const segs = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    if (l === 0) continue;
    segs.push({ i, l, start: total });
    total += l;
  }
  const out = [];
  for (let s = 0; s <= total + 1e-6; s += spacing) {
    out.push(pointAtLength(points, segs, s));
  }
  return out;
}

function pointAtLength(points, segs, L) {
  if (L <= 0) return [points[0][0], points[0][1]];
  for (const s of segs) {
    if (L <= s.start + s.l + 1e-9) {
      const t = (L - s.start) / s.l;
      const a = points[s.i - 1], b = points[s.i];
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
  }
  return [points[points.length - 1][0], points[points.length - 1][1]];
}

// «مُهر» مربعی (square stamp) — برای پاک‌کن/قلم مربعی که فتوشاپ ندارد و کاربران زیاد خواسته‌اند
export function squareStamp(paint, cx, cy, size, hardness, color, alphaMul = 1) {
  const half = Math.max(1, size / 2);
  const x0 = Math.floor(cx - half), x1 = Math.ceil(cx + half);
  const y0 = Math.floor(cy - half), y1 = Math.ceil(cy + half);
  const aa = Math.min(1, 1 / half);
  const srcAlpha = clamp01(color[3] / 255) * clamp01(alphaMul);
  const out = [0, 0, 0, 0];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      // فاصلهٔ chebyshev از مرکز (مربع)
      const dc = Math.max(Math.abs(x - cx), Math.abs(y - cy)) / half;
      if (dc > 1) continue;
      let cov;
      if (hardness >= 1) {
        cov = clamp01(1 - (dc - (1 - aa)) / aa);
      } else if (hardness <= 0) {
        cov = Math.pow(1 - dc, 1.6);
      } else {
        const hard = clamp01(1 - (dc - (1 - aa)) / aa);
        const soft = Math.pow(1 - dc, 1.6);
        cov = hard * hardness + soft * (1 - hardness);
      }
      const a = Math.round(cov * srcAlpha * 255);
      if (a <= 0) continue;
      paint.getPixel(x, y, out);
      const o = compositePixelU8(out, [color[0], color[1], color[2], a], 'normal', 1);
      paint.setPixel(x, y, o[0], o[1], o[2], o[3]);
    }
  }
}

// کشیدن یک stroke کامل: همه‌ی مُهرها را می‌زند. خروجی: rect تغییرات (برای invalidate)
export function brushStroke(paint, points, { radius = 8, hardness = 0.8, color = [0, 0, 0, 255], spacing, alphaMul = 1 } = {}) {
  const sp = spacing == null ? Math.max(1, radius * 0.25) : spacing;
  const stamps = strokePoints(points, sp);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of stamps) {
    brushStamp(paint, x, y, radius, hardness, color, alphaMul);
    minX = Math.min(minX, x - radius); maxX = Math.max(maxX, x + radius);
    minY = Math.min(minY, y - radius); maxY = Math.max(maxY, y + radius);
  }
  return { x: Math.max(0, minX | 0), y: Math.max(0, minY | 0), w: Math.ceil(maxX - minX), h: Math.ceil(maxY - minY) };
}
