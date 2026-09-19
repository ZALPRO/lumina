// engine/selection.js — عملیات انتخاب (ماسک) قابل تست و بدون DOM
// فتوشاپ-مانند: انتخاب مستطیلی، معکوس‌سازی، پاک‌کردن، پرکردن.
// ماسک انتخابی: Uint8Array به طول w*h — ۱ = پیکسل انتخاب‌شده، ۰ = خارج
import { Rect } from './rect.js';

export function normRect(x1, y1, x2, y2) {
  const x0 = Math.min(x1, x2), y0 = Math.min(y1, y2);
  return new Rect(x0, y0, Math.abs(x2 - x1) + 1, Math.abs(y2 - y1) + 1);
}

// ماسک مستطیلی داخل محدوده
export function rectMask(w, h, rect) {
  const mask = new Uint8Array(w * h);
  const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
  const x1 = Math.min(w, rect.x + rect.w), y1 = Math.min(h, rect.y + rect.h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1;
  return mask;
}

// معکوس ماسک مستطیلی: همه‌چیز «خارج» مستطیل
export function rectMaskInv(w, h, rect) {
  const mask = new Uint8Array(w * h).fill(1);
  const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
  const x1 = Math.min(w, rect.x + rect.w), y1 = Math.min(h, rect.y + rect.h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 0;
  return mask;
}

// پرکردن پیکسل‌های ماسک با رنگ (در paint)
export function fillSelection(paint, w, h, mask, [r, g, b, a]) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) paint.setPixel(x, y, r, g, b, a);
    }
  }
}

// حذف (شفاف‌کردن) پیکسل‌های ماسک
export function clearSelection(paint, w, h, mask) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) paint.setPixel(x, y, 0, 0, 0, 0);
    }
  }
}

// کراپ paint به مستطیل: خروجی Paint جدید (ابعاد rect)
export function cropPaint(paint, w, h, rect) {
  const out = new paint.constructor(rect.w, rect.h);
  const p = [0, 0, 0, 0];
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      paint.getPixel(rect.x + x, rect.y + y, p);
      if (p[3] > 0) out.setPixel(x, y, p[0], p[1], p[2], p[3]);
    }
  }
  return out;
}
