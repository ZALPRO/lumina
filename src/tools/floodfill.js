// tools/floodfill.js — رشد ناحیه (scanline/BFS) برای سطل رنگ و عصای جادویی
// بازگشت: ماسک Uint8Array (طول w*h؛ ۱ = عضو ناحیه) + کادر محدوده‌ی تغییر
import { Rect } from '../engine/rect.js';

function keyOf(x, y, w) { return y * w + x; }

// رنگ مرجع را در (sx,sy) می‌خواند و ناحیه‌ی هم‌رنگ (با تلورانس) را رشد می‌دهد.
// isMatch(paint, x, y, refR, refG, refB, refA) → bool برای خودی بودن پیکسل
// contiguous=false → همهٔ پیکسل‌های هم‌رنگ در کل تصویر (سطل «غیرپیوسته» مثل فتوشاپ)
// خروجی: { mask, rect } که rect مستطیل محیطی ناحیه است.
export function regionGrow(paint, w, h, sx, sy, tol, matchAlpha = true, contiguous = true) {
  const mask = new Uint8Array(w * h);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { mask, rect: new Rect(0, 0, 0, 0), count: 0 };

  const ref = [0, 0, 0, 0];
  paint.getPixel(sx, sy, ref);
  const maxD = tol * tol * (matchAlpha ? 4 : 3); // مربع فاصلهٔ اقلیدسی در فضای 0..255

  function match(x, y) {
    const c = [0, 0, 0, 0];
    paint.getPixel(x, y, c);
    const dr = c[0] - ref[0], dg = c[1] - ref[1], db = c[2] - ref[2];
    let d = dr * dr + dg * dg + db * db;
    if (matchAlpha) { const da = c[3] - ref[3]; d += da * da; }
    return d <= maxD;
  }

  // حالت غیرپیوسته: کل تصویر را می‌پیماییم
  if (!contiguous) {
    let count = 0;
    let minX = sx, minY = sy, maxX = sx, maxY = sy;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!match(x, y)) continue;
        mask[keyOf(x, y, w)] = 2;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    return { mask, rect: new Rect(minX, minY, maxX - minX + 1, maxY - minY + 1), count };
  }

  // BFS با پشته‌ی صریح (بدون بازگشت → بدون خطر stack overflow روی نواحی عظیم)
  let count = 0;
  let minX = sx, minY = sy, maxX = sx, maxY = sy;
  const stack = [keyOf(sx, sy, w)];
  mask[keyOf(sx, sy, w)] = 1;

  while (stack.length) {
    const k = stack.pop();
    const x = k % w, y = (k / w) | 0;
    count++;
    if (mask[k] === 2) continue; // (پردازش‌شده، فقط مارک جاری)
    mask[k] = 2;
    // همسایه‌های ۴-جهته
    const nb = [];
    if (x > 0) nb.push(x - 1, y);
    if (x < w - 1) nb.push(x + 1, y);
    if (y > 0) nb.push(x, y - 1);
    if (y < h - 1) nb.push(x, y + 1);
    for (let i = 0; i < nb.length; i += 2) {
      const nx = nb[i], ny = nb[i + 1];
      const nk = keyOf(nx, ny, w);
      if (mask[nk] === 0 && match(nx, ny)) {
        mask[nk] = 1;
        stack.push(nk);
        if (nx < minX) minX = nx;
        if (nx > maxX) maxX = nx;
        if (ny < minY) minY = ny;
        if (ny > maxY) maxY = ny;
      }
    }
  }

  return { mask, rect: new Rect(minX, minY, maxX - minX + 1, maxY - minY + 1), count };
}

// سطل رنگ: ناحیه را با رنگ مقصد پر می‌کند. خروجی: rect تغییر (برای invalidate)
// contiguous=false → تمام پیکسل‌های هم‌رنگ (نه فقط ناحیهٔ پیوسته)
export function floodFill(paint, w, h, sx, sy, tol, [r, g, b, a], matchAlpha = true, contiguous = true) {
  const { mask, rect, count } = regionGrow(paint, w, h, sx, sy, tol, matchAlpha, contiguous);
  if (count === 0) return rect;
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) {
      if (mask[keyOf(x, y, w)] > 0) paint.setPixel(x, y, r, g, b, a);
    }
  }
  return rect;
}

// عصای جادویی: ماسک انتخابی می‌سازد (بدون تغییر پیکسل)
export function magicWand(paint, w, h, sx, sy, tol, matchAlpha = false) {
  return regionGrow(paint, w, h, sx, sy, tol, matchAlpha);
}

// انتخاب مستطیلی: ماسک جدید از یک مستطیل مشخص (جایگزین)
export function rectSelectionMask(w, h, x, y, rw, rh) {
  const mask = new Uint8Array(w * h);
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  const x1 = Math.min(w, x + rw), y1 = Math.min(h, y + rh);
  for (let yy = y0; yy < y1; yy++) {
    for (let xx = x0; xx < x1; xx++) mask[keyOf(xx, yy, w)] = 1;
  }
  return { mask, rect: new Rect(x0, y0, x1 - x0, y1 - y0) };
}
