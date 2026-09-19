// engine/filters.js — فیلترهای پایه (سطح فریم RGBA؛ ورودی/خروجی Uint8ClampedArray)
// پیاده‌سازی مرجع-محور: مقادیر با گرد ساده و clamp استاندارد.
export function grayscale(data, w, h) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const y = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) | 0;
    out[o] = y; out[o + 1] = y; out[o + 2] = y; out[o + 3] = data[o + 3];
  }
  return out;
}

export function invert(data, w, h) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    out[o] = 255 - data[o]; out[o + 1] = 255 - data[o + 1]; out[o + 2] = 255 - data[o + 2]; out[o + 3] = data[o + 3];
  }
  return out;
}

// فرمول فتوشاپ: v' = (v - 128) * contrast + 128 + (brightness * 255)
export function brightnessContrast(data, w, h, brightness = 0, contrast = 0) {
  const out = new Uint8ClampedArray(data.length);
  const bOff = brightness * 255;
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    for (let c = 0; c < 3; c++) {
      let v = (data[o + c] - 128) * (contrast + 1) + 128 + bOff;
      out[o + c] = v < 0 ? 0 : (v > 255 ? 255 : v);
    }
    out[o + 3] = data[o + 3];
  }
  return out;
}

export function threshold(data, w, h, t = 128) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const lum = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]);
    const v = lum < t ? 0 : 255;
    out[o] = v; out[o + 1] = v; out[o + 2] = v; out[o + 3] = data[o + 3];
  }
  return out;
}

// Sepia کلاسیک (ماتریس Microsoft)
export function sepia(data, w, h) {
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    const r = data[o], g = data[o + 1], b = data[o + 2];
    let nr = 0.393 * r + 0.769 * g + 0.189 * b;
    let ng = 0.349 * r + 0.686 * g + 0.168 * b;
    let nb = 0.272 * r + 0.534 * g + 0.131 * b;
    out[o] = nr > 255 ? 255 : nr;
    out[o + 1] = ng > 255 ? 255 : ng;
    out[o + 2] = nb > 255 ? 255 : nb;
    out[o + 3] = data[o + 3];
  }
  return out;
}

// بوکس‌بلور جداشدنی (دو گذر)؛ آلفا دست‌نخورده
export function boxBlur(data, w, h, radius) {
  const r = Math.max(1, radius | 0);
  const tmp = new Uint8ClampedArray(w * h);   // گذر افقی (یک کانال)
  const out = new Uint8ClampedArray(data.length);
  const win = 2 * r + 1;

  for (let c = 0; c < 3; c++) {
    // افقی: data -> tmp
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += data[(row + clampi(x, 0, w - 1)) * 4 + c];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = sum / win;
        const addX = clampi(x + r + 1, 0, w - 1);
        const remX = clampi(x - r, 0, w - 1);
        sum += data[(row + addX) * 4 + c] - data[(row + remX) * 4 + c];
      }
    }
    // عمودی: tmp -> out
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[clampi(y, 0, h - 1) * w + x];
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = sum / win;
        const addY = clampi(y + r + 1, 0, h - 1);
        const remY = clampi(y - r, 0, h - 1);
        sum += tmp[addY * w + x] - tmp[remY * w + x];
      }
    }
  }
  for (let i = 0; i < w * h; i++) out[i * 4 + 3] = data[i * 4 + 3];
  return out;
}

function clampi(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
