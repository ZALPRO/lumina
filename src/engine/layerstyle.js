// engine/layerstyle.js — Layer Styles (استایل لایه — فتوشاپ-مانند)
// dropShadow: فقط برای لایهٔ رستر با آلفا. سایه از سیلوئت آلفا ساخته می‌شود.
// افست/بلور/رنگ/opacity دقیق، محاسبهٔ ساده اما درست.
import { TILE_SIZE } from './tile.js';

// ساخت سایهٔ Soft (box blur تکراری) از ماسک آلفای paint
function alphaSilhouette(paint, w, h) {
  const a = new Uint8ClampedArray(w * h);
  const c = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    paint.getPixel(x, y, c);
    a[y * w + x] = c[3];
  }
  return a;
}

// box blur مکرر (تعداد تکرار = radius) روی آلفای تک‌کاناله
function boxBlurAlpha(a, w, h, radius) {
  if (radius <= 0) return a;
  let src = a, dst = new Uint8ClampedArray(w * h);
  for (let pass = 0; pass < Math.min(3, radius); pass++) {
    const r = 1; // تکرار با شعاع ۱ سه‌بار ≈ گاوسی شعاع ~2
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let sum = 0, n = 0;
        for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          sum += src[yy * w + xx]; n++;
        }
        dst[y * w + x] = sum / n;
      }
    }
    const tmp = src; src = dst; dst = tmp;
  }
  return src;
}

// سایه: paint پایه + آفست (dx,dy) + blur + رنگ + opacity — خروجی Paint جدید (برای لایهٔ سایه)
export function renderDropShadow(paint, w, h, { dx = 6, dy = 8, blur = 8, color = [0, 0, 0, 255], opacity = 0.55 } = {}) {
  const sil = alphaSilhouette(paint, w, h);
  // آفست: سیلوئت جابه‌جا شده (سایه زیر و راستِ شیء)
  const offsetSil = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x - Math.round(dx), sy = y - Math.round(dy);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      offsetSil[y * w + x] = sil[sy * w + sx];
    }
  }
  const soft = boxBlurAlpha(offsetSil, w, h, Math.max(0, Math.round(blur / 2)));

  const out = new paint.constructor(w, h);
  const op = Math.max(0, Math.min(1, opacity));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = soft[y * w + x] * op;
      if (a <= 0) continue;
      out.setPixel(x, y, color[0], color[1], color[2], Math.round(Math.min(255, a)));
    }
  }
  // حذف سایه از جایی که خودِ شیء مات است (سایه پشت شیء مخفی است)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (sil[y * w + x] > 0) {
      const c = [0, 0, 0, 0];
      out.getPixel(x, y, c);
      if (c[3] > 0) out.setPixel(x, y, c[0], c[1], c[2], 0);
    }
  }
  return out;
}

// آیا لایه سبک سایه دارد؟
export function hasLayerShadow(layer) {
  return !!(layer && layer.style && layer.style.dropShadow);
}
