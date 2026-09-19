// tools/paintools.js — ابزارهای رتوش موضعی که فتوشاپ دارد:
//   pencil (مداد سخت بدون آنتی‌الیاس)، dodge/burn (روشنگر/تیره‌گر)،
//   blur/sharpen (محو/تیز موضعی)، smudge (لکه‌کشی)، magicEraser (پاک‌کن جادویی)
import { srgbToLinear, linearToSrgb } from '../engine/color.js';
import { regionGrow } from './floodfill.js';
import { compositePixelU8 } from '../engine/blend.js';

function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

// پوشش برس مشترک: cov در [0..1] بر اساس فاصلهٔ نسبی d
function coverage(d, hardness, aa) {
  if (hardness >= 1) return clamp01(1 - (d - (1 - aa)) / aa);
  if (hardness <= 0) return Math.pow(1 - d, 1.6);
  const hard = clamp01(1 - (d - (1 - aa)) / aa);
  return hard * hardness + Math.pow(1 - d, 1.6) * (1 - hardness);
}

function loopBrush(cx, cy, radius, fn) {
  const r = Math.max(1, radius);
  const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1), y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = Math.hypot(x - cx, y - cy) / r;
    if (d <= 1) fn(x, y, d);
  }
}

// مداد: قلم سختِ «دندانه‌دار» — بدون آنتی‌الیاس (پیکسل یا هست یا نیست)
export function pencilStamp(paint, cx, cy, radius, color, alphaMul = 1) {
  const r = Math.max(1, radius);
  const srcAlpha = clamp01(color[3] / 255) * clamp01(alphaMul);
  loopBrush(cx, cy, radius, (x, y) => {
    if (srcAlpha < 1) { // اگر شفاف، فقط «شانس» دندانه‌ای — برای سادگی همیشه ۱
    }
    const o = compositePixelU8(pickOr0(paint, x, y), [color[0], color[1], color[2], Math.round(srcAlpha * 255)], 'normal', 1);
    paint.setPixel(x, y, o[0], o[1], o[2], o[3]);
  });
}

function pickOr0(paint, x, y) { const c = [0, 0, 0, 0]; paint.getPixel(x, y, c); return c; }

// dodge/burn: exposure مثبت = روشن (screen به‌سمت سفید)، منفی = تیره (multiply به‌سمت سیاه)
// range: 'shadows'|'midtones'|'highlights' — وزن‌بندی بر اساس لومینانس (مثل فتوشاپ)
function rangeWeight(l, range) {
  if (range === 'shadows') return 1 - l;      // محدودهٔ تیره‌تر وزن بیشتر
  if (range === 'highlights') return l;        // محدودهٔ روشن‌تر وزن بیشتر
  const m = 1 - Math.abs(l - 0.5) * 2;         // میان‌تاری: قله در 0.5
  return clamp01(m * 1.4);
}

export function dodgeBurnStamp(paint, cx, cy, radius, hardness, exposure, range = 'midtones') {
  const aa = Math.min(1, 1 / Math.max(1, radius));
  const c = [0, 0, 0, 0];
  loopBrush(cx, cy, radius, (x, y, d) => {
    const cov = coverage(d, hardness, aa) * Math.min(1, Math.abs(exposure));
    if (cov <= 0) return;
    paint.getPixel(x, y, c);
    if (c[3] === 0) return;
    const l = srgbToLinear(c[0] / 255), g = srgbToLinear(c[1] / 255), b = srgbToLinear(c[2] / 255);
    const lum = 0.2126 * l + 0.7152 * g + 0.0722 * b;
    const w = rangeWeight(lum, range) * cov;
    let L, G, B;
    if (exposure >= 0) { // داج: به‌سمت سفید (screen)
      L = 1 - (1 - l) * (1 - w);
      G = 1 - (1 - g) * (1 - w);
      B = 1 - (1 - b) * (1 - w);
    } else {            // برن: به‌سمت سیاه (multiply)
      L = l * (1 - w);
      G = g * (1 - w);
      B = b * (1 - w);
    }
    c[0] = Math.round(linearToSrgb(clamp01(L)) * 255);
    c[1] = Math.round(linearToSrgb(clamp01(G)) * 255);
    c[2] = Math.round(linearToSrgb(clamp01(B)) * 255);
    paint.setPixel(x, y, c[0], c[1], c[2], c[3]);
  });
}

// نمونه‌ی ۳×۳ جعبه‌ای (با آلفا) — برای blur/sharpen؛ خارج محدوده = پیکسل خودش (لبه‌ها گارد)
function sample3(paint, w, h, x, y, out) {
  let r = 0, g = 0, b = 0, a = 0, n = 0;
  const c = [0, 0, 0, 0];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const xx = x + dx, yy = y + dy;
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
    paint.getPixel(xx, yy, c);
    if (c[3] === 0) continue;
    r += c[0]; g += c[1]; b += c[2]; a += c[3]; n++;
  }
  if (n === 0) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; return out; }
  out[0] = r / n; out[1] = g / n; out[2] = b / n; out[3] = a / n;
  return out;
}

// blur موضعی: هر پیکسل برس = میانگین ۳×۳ (تکرار strength بار)
export function blurStamp(paint, w, h, cx, cy, radius, hardness, strength = 1) {
  const aa = Math.min(1, 1 / Math.max(1, radius));
  const blur3 = sample3; const c = [0, 0, 0, 0]; const b3 = [0, 0, 0, 0];
  const rep = Math.max(1, Math.round(strength));
  loopBrush(cx, cy, radius, (x, y, d) => {
    const cov = coverage(d, hardness, aa);
    if (cov <= 0) return;
    paint.getPixel(x, y, c);
    if (c[3] === 0) return;
    let r = c[0], g = c[1], b = c[2];
    for (let i = 0; i < rep; i++) {
      // میانگین همسایه‌ها از paint «زنده» → نشر تدریجی
      let sr = 0, sg = 0, sb = 0, n = 0;
      // به‌جای تابع، درجا (برای کارایی و وابستگی به پیکسل‌های تازه)
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        paint.getPixel(xx, yy, b3);
        if (b3[3] === 0) continue;
        sr += b3[0]; sg += b3[1]; sb += b3[2]; n++;
      }
      if (n > 0) { r = sr / n; g = sg / n; b = sb / n; }
    }
    const k = cov;
    c[0] = Math.round(c[0] + (r - c[0]) * k);
    c[1] = Math.round(c[1] + (g - c[1]) * k);
    c[2] = Math.round(c[2] + (b - c[2]) * k);
    paint.setPixel(x, y, c[0], c[1], c[2], c[3]);
  });
}

// sharpen موضعی: center + (center - blur) * amount
export function sharpenStamp(paint, w, h, cx, cy, radius, hardness, amount = 0.5) {
  const aa = Math.min(1, 1 / Math.max(1, radius));
  const c = [0, 0, 0, 0]; const b3 = [0, 0, 0, 0];
  loopBrush(cx, cy, radius, (x, y, d) => {
    const cov = coverage(d, hardness, aa);
    if (cov <= 0) return;
    paint.getPixel(x, y, c);
    if (c[3] === 0) return;
    sample3(paint, w, h, x, y, b3);
    const k = cov * amount;
    const rr = c[0] + (c[0] - b3[0]) * k;
    const gg = c[1] + (c[1] - b3[1]) * k;
    const bb = c[2] + (c[2] - b3[2]) * k;
    c[0] = rr < 0 ? 0 : (rr > 255 ? 255 : Math.round(rr));
    c[1] = gg < 0 ? 0 : (gg > 255 ? 255 : Math.round(gg));
    c[2] = bb < 0 ? 0 : (bb > 255 ? 255 : Math.round(bb));
    paint.setPixel(x, y, c[0], c[1], c[2], c[3]);
  });
}

// smudge: کشیدن پیکسل از جهت مخالف «بُرد» (pull) رویِ اسنپ‌شات؛ حافظهٔ لکه فقط local
// برای قابلیت تست، کل محدودهٔ affected را قبل از اعمال به temp paint (اسنپ‌شات) می‌کشیم.
export function smudgeStamp(snap, paint, cx, cy, radius, hardness, pullX, pullY, strength = 0.6) {
  const aa = Math.min(1, 1 / Math.max(1, radius));
  const c = [0, 0, 0, 0]; const s = [0, 0, 0, 0];
  loopBrush(cx, cy, radius, (x, y, d) => {
    const cov = coverage(d, hardness, aa);
    if (cov <= 0) return;
    const k = Math.min(0.95, cov * strength);
    const srcX = x - pullX, srcY = y - pullY;
    snap.getPixel(srcX, srcY, s);
    paint.getPixel(x, y, c);
    if (s[3] === 0 || c[3] === 0) { if (s[3] > 0) paint.setPixel(x, y, s[0], s[1], s[2], 255); return; }
    const r = c[0] + (s[0] - c[0]) * k;
    const g = c[1] + (s[1] - c[1]) * k;
    const b = c[2] + (s[2] - c[2]) * k;
    paint.setPixel(x, y, Math.round(r), Math.round(g), Math.round(b), c[3]);
  });
}

// ساخت اسنپ‌شات прямоугольной ناحیه вокруг مرکز برای smudge / clone
export function snapshotRect(paint, cx, cy, radius) {
  const r = Math.ceil(radius) + 2;
  const x0 = Math.max(0, Math.floor(cx - r)), y0 = Math.max(0, Math.floor(cy - r));
  const w = Math.min(paint.w, Math.ceil(cx + r)) - x0;
  const h = Math.min(paint.h, Math.ceil(cy + r)) - y0;
  const snap = new paint.constructor(Math.max(1, w), Math.max(1, h));
  const c = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    paint.getPixel(x0 + x, y0 + y, c);
    if (c[3] > 0) snap.setPixel(x, y, c[0], c[1], c[2], c[3]);
  }
  return { snap, ox: x0, oy: y0 };
}

// پاک‌کن جادویی: ناحیهٔ هم‌رنگ را شفاف می‌کند (مثل پاک‌کن + عصا). خروجی rect تغییر.
export function magicEraser(paint, w, h, sx, sy, tol, contiguous = true) {
  const { mask, rect, count } = regionGrow(paint, w, h, sx, sy, tol, true, contiguous);
  if (count === 0) return rect;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (mask[y * w + x] > 0) paint.setPixel(x, y, 0, 0, 0, 0);
    }
  }
  return rect;
}
