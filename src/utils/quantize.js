// utils/quantize.js — دیکوانتیزه‌ی سیاه‌وسفید با Floyd–Steinberg (سرپنتاین)
export function quantize(v) {
  return v <= 127 ? 0 : 255; // 128 به بالا => سفید (آستانه‌ی میانه)
}

// آرایه‌ی RGBA8 را به تصویر ۱ بیتی (فقط 0/255) dither شده تبدیل می‌کند.
// خروجی: Uint8ClampedArray جدید، آلفا دست‌نخورده می‌ماند (فقط RGB کوانتیزه می‌شود).
export function quantizeImageFrame(src, w, h) {
  const out = new Uint8ClampedArray(src.length);
  const err = new Float32Array(src.length); // خطا بر حسب کانال
  const dx = [7 / 16, 3 / 16, 5 / 16, 1 / 16];
  for (let y = 0; y < h; y++) {
    const leftToRight = (y % 2) === 0; // سرپنتاین
    for (let xi = 0; xi < w; xi++) {
      const x = leftToRight ? xi : (w - 1 - xi);
      const idx = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let v = src[idx + c] + err[idx + c];
        if (v < 0) v = 0; else if (v > 255) v = 255;
        const q = quantize(v);
        out[idx + c] = q;
        const e = (v - q) * dx[0];
        distribute(err, w, h, x + (leftToRight ? 1 : -1), y, c, e);
        distribute(err, w, h, x - (leftToRight ? 1 : -1), y + 1, c, (v - q) * dx[1]);
        distribute(err, w, h, x, y + 1, c, (v - q) * dx[2]);
        distribute(err, w, h, x + (leftToRight ? 1 : -1), y + 1, c, (v - q) * dx[3]);
      }
      // آلفا دست‌نخورده
      out[idx + 3] = src[idx + 3];
    }
  }
  return out;
}

function distribute(err, w, h, x, y, c, amount) {
  if (x < 0 || x >= w || y >= h || amount === 0) return;
  err[(y * w + x) * 4 + c] += amount;
}
