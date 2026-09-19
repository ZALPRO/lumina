// color.js — انتقال sRGB↔خطی، ابزارهای روشنایی/اشباع برای مدهای بلندینگ غیرجداشدنی
// همه‌ی محاسبات ترکیب در «فضای خطی» انجام می‌شود (مثل موتورهای حرفه‌ای)،
// نه در فضای گامای sRGB — این یکی از دلایل «کیفیت بالاتر از فتوشاپ ۸ بیتی» است.

export function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

// تابع انتقال sRGB (استاندارد IEC 61966-2-1)
export function srgbToLinear(v) {
  v = clamp01(v);
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
export function linearToSrgb(v) {
  if (v >= 1) return 1;
  if (v <= 0) return 0;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

// تبدیل [u8] → [float خطی مستقیم]
export function u8ToLinear(r, g, b, a) {
  return [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255), a / 255];
}

// تبدیل [float خطی مستقیم] → [u8]
export function linearToU8(lr, lg, lb, la) {
  return [
    Math.round(clamp01(linearToSrgb(lr)) * 255),
    Math.round(clamp01(linearToSrgb(lg)) * 255),
    Math.round(clamp01(linearToSrgb(lb)) * 255),
    Math.round(clamp01(la) * 255),
  ];
}

// ---------- ابزارهای مد بلندینگ (طبق مشخصات W3C Compositing and Blending) ----------

export function lum(r, g, b) { return 0.3 * r + 0.59 * g + 0.11 * b; }
export function sat(r, g, b) { return Math.max(r, g, b) - Math.min(r, g, b); }

export function clipColor(r, g, b) {
  const L = lum(r, g, b);
  let n = Math.min(r, g, b);
  let x = Math.max(r, g, b);
  if (n < 0) {
    r = L + ((r - L) * L) / (L - n);
    g = L + ((g - L) * L) / (L - n);
    b = L + ((b - L) * L) / (L - n);
  }
  x = Math.max(r, g, b);
  if (x > 1) {
    r = L + ((r - L) * (1 - L)) / (x - L);
    g = L + ((g - L) * (1 - L)) / (x - L);
    b = L + ((b - L) * (1 - L)) / (x - L);
  }
  return [r, g, b];
}

export function setLum(r, g, b, l) {
  const d = l - lum(r, g, b);
  return clipColor(r + d, g + d, b + d);
}

export function setSat(r, g, b, s) {
  const vals = [r, g, b];
  let maxI = 0, minI = 0;
  for (let i = 1; i < 3; i++) {
    if (vals[i] > vals[maxI]) maxI = i;
    if (vals[i] < vals[minI]) minI = i;
  }
  const midI = 3 - maxI - minI;
  const Cmax = vals[maxI], Cmin = vals[minI], Cmid = vals[midI];
  const out = [0, 0, 0];
  if (Cmax > Cmin) {
    out[midI] = ((Cmid - Cmin) * s) / (Cmax - Cmin);
    out[maxI] = s;
  } else {
    out[midI] = 0;
    out[maxI] = 0;
  }
  out[minI] = 0;
  return out;
}
