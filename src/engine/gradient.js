// engine/gradient.js — ابزار گرادیان (فتوشاپ-مانند، قابل تست)
// گرادیان خطی/شعاعی روی Paint، با توقف‌های رنگ (stops)
// مختصات: (x0,y0)→(x1,y1) نرمال‌شده در ابعاد paint

export function sampleGradient(stops, t) {
  // stops: [[offset01, [r,g,b,a]], ...] مرتب‌شده
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0);
      return [
        Math.round(c0[0] + (c1[0] - c0[0]) * f),
        Math.round(c0[1] + (c1[1] - c0[1]) * f),
        Math.round(c0[2] + (c1[2] - c0[2]) * f),
        Math.round(c0[3] + (c1[3] - c0[3]) * f),
      ];
    }
  }
  return stops[stops.length - 1][1];
}

// گرادیان خطی در مستطیل bounding (محصور)
export function linearGradient(paint, w, h, x0, y0, x1, y1, stops) {
  const dx = x1 - x0, dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const minX = Math.min(x0, x1), maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1), maxY = Math.max(y0, y1);
  for (let y = Math.max(0, minY | 0); y < Math.min(h, maxY + 1); y++) {
    for (let x = Math.max(0, minX | 0); x < Math.min(w, maxX + 1); x++) {
      const t = len2 === 0 ? 0 : ((x - x0) * dx + (y - y0) * dy) / len2;
      const c = sampleGradient(stops, Math.max(0, Math.min(1, t)));
      if (c[3] > 0) paint.setPixel(x, y, c[0], c[1], c[2], c[3]);
    }
  }
}

// گرادیان شعاعی از مرکز تا شعاع r
export function radialGradient(paint, w, h, cx, cy, r, stops) {
  const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h, Math.ceil(cy + r));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const d = Math.hypot(x - cx, y - cy) / r;
      if (d > 1) continue;
      const c = sampleGradient(stops, d);
      if (c[3] > 0) paint.setPixel(x, y, c[0], c[1], c[2], c[3]);
    }
  }
}

// نگاشت منحنی (Curves) — نقاط کنترل، خروجی LUT 256
export function curvesLUT(points) {
  const lut = new Uint8Array(256);
  const pts = [[0, 0], ...points, [255, 255]].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < 256; i++) {
    // پیدا کردن بازه
    let j = 0;
    while (j < pts.length - 2 && i > pts[j + 1][0]) j++;
    const [x0, y0] = pts[j];
    const [x1, y1] = pts[j + 1];
    const f = x1 === x0 ? 0 : (i - x0) / (x1 - x0);
    lut[i] = Math.max(0, Math.min(255, Math.round(y0 + (y1 - y0) * f)));
  }
  return lut;
}

// اعمال LUT در هر کانال (با LUT جداگانه)
export function applyCurves(src, w, h, lutR, lutG, lutB) {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    out[i] = lutR[src[i]];
    out[i + 1] = lutG[src[i + 1]];
    out[i + 2] = lutB[src[i + 2]];
    out[i + 3] = src[i + 3];
  }
  return out;
}

// Exposure (توقف نوری): factor = 2^ev
export function exposureAdjust(src, w, h, ev = 0) {
  const out = new Uint8ClampedArray(src.length);
  const f = Math.pow(2, ev);
  for (let i = 0; i < src.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, src[i + c] * f));
    out[i + 3] = src[i + 3];
  }
  return out;
}

// Vibrance (اشباع انتخابی: کم‌اثر روی رنگ‌های پر)
export function vibranceAdjust(src, w, h, amount = 0) {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i] / 255, g = src[i + 1] / 255, b = src[i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const avg = (mx + mn) / 2;
    const s = mx === 0 ? 0 : (mx - mn) / mx;
    const scale = amount >= 0 ? 1 + amount * (1 - s) : 1 + amount;
    for (let c = 0; c < 3; c++) {
      const ch = [r, g, b][c];
      out[i + c] = Math.max(0, Math.min(255, Math.round((avg + (ch - avg) * scale) * 255)));
    }
    out[i + 3] = src[i + 3];
  }
  return out;
}
