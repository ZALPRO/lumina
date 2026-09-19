// engine/fx.js — موتور افکت‌های حرفه‌ای (قدرتمندتر از فتوشاپ در برخی موارد)
// همهٔ توابع: (src:Uint8ClampedArray, w, h, params?) → Uint8ClampedArray خروجی
// بدون وابستگی به DOM. سمپلینگ لبه به ۵ حالت: clamp / wrap / mirror / reflect / extend
//
// نکات برتری:
//  - Gaussian Blur جداپذیر (O(n·r)) نه O(n·r²) — سریع‌ترین ممکن
//  - تمام افکت‌ها در RGBA کامل (آلفا حفظ می‌شود، بلندینگ در فضای خطی آنجا که لازم)
//  - Kuwahara با پنجرهٔ رنگی (نویزکاهی حفظ‌کنندهٔ لبه — در فتوشاپ نیست)
//  - Bloom ، Thermal ، Kaleidoscope «سرد» نیستند: هر بار متفاوت پارامتری هستند

import { srgbToLinear, linearToSrgb } from './color.js';

// ---------- utility ----------
function clamp255(v) { return v < 0 ? 0 : (v > 255 ? 255 : v | 0); }
function idx(x, y, w) { return (y * w + x) * 4; }

// درون‌یابی پیکسل بیرون از مرز بر اساس حالت
export function edgeMode(mode) {
  return (x, y, w, h) => {
    switch (mode) {
      case 'wrap':    return [((x % w) + w) % w, ((y % h) + h) % h];
      case 'mirror':  return [((x % (2 * w)) + 2 * w) % (2 * w), ((y % (2 * h)) + 2 * h) % (2 * h)].map((v, i) => v >= (i ? h : w) ? 2 * (i ? h : w) - 1 - v : v);
      case 'reflect': return [reflect(x, w), reflect(y, h)];
      case 'extend':  return [reflect(x - 1, w - 2) + 1, reflect(y - 1, h - 2) + 1];
      default:        return [x < 0 ? 0 : (x >= w ? w - 1 : x), y < 0 ? 0 : (y >= h ? h - 1 : y)]; // clamp
    }
  };
}
function reflect(v, n) { v = Math.abs(v) % (2 * n); return v >= n ? 2 * n - 1 - v : v; }

function sample(src, w, h, x, y, mode) {
  const [sx, sy] = mode(x, y, w, h);
  const i = (sy * w + sx) * 4;
  return [src[i], src[i + 1], src[i + 2], src[i + 3]];
}

// ---------- هستهٔ کانوولوشن عمومی ----------
export function convolve(src, w, h, kernel, ksize, edge = 'clamp', gain = 1, bias = 0) {
  const out = new Uint8ClampedArray(src.length);
  const half = (ksize / 2) | 0;
  const em = edgeMode(edge);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let ky = 0; ky < ksize; ky++) {
        for (let kx = 0; kx < ksize; kx++) {
          const s = sample(src, w, h, x + kx - half, y + ky - half, em);
          const k = kernel[ky * ksize + kx];
          r += s[0] * k; g += s[1] * k; b += s[2] * k;
        }
      }
      const i = idx(x, y, w);
      out[i]     = clamp255(r * gain + bias);
      out[i + 1] = clamp255(g * gain + bias);
      out[i + 2] = clamp255(b * gain + bias);
      out[i + 3] = src[i + 3];
    }
  }
  return out;
}

// ---------- Gaussian Blur (جداپذیر، دو پاس افقی/عمودی) ----------
export function gaussianBlur(src, w, h, radius = 4) {
  const rad = Math.max(1, radius | 0);
  const sigma = rad / 3 * 1.75 + 0.35;
  const n = rad * 2 + 1;
  const ker = new Float32Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = i - rad;
    ker[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += ker[i];
  }
  for (let i = 0; i < n; i++) ker[i] /= sum;

  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);
  const clampY = (v) => (v < 0 ? 0 : (v >= h ? h - 1 : v));
  const clampX = (v) => (v < 0 ? 0 : (v >= w ? w - 1 : v));

  // پاس افقی
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rr = 0, gg = 0, bb = 0, aa = 0;
      for (let i = 0; i < n; i++) {
        const sx = clampX(x + i - rad);
        const j = idx(sx, y, w);
        const k = ker[i];
        rr += src[j] * k; gg += src[j + 1] * k; bb += src[j + 2] * k; aa += src[j + 3] * k;
      }
      const o = idx(x, y, w);
      tmp[o] = rr; tmp[o + 1] = gg; tmp[o + 2] = bb; tmp[o + 3] = aa;
    }
  }
  // پاس عمودی
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rr = 0, gg = 0, bb = 0, aa = 0;
      for (let i = 0; i < n; i++) {
        const sy = clampY(y + i - rad);
        const j = idx(x, sy, w);
        const k = ker[i];
        rr += tmp[j] * k; gg += tmp[j + 1] * k; bb += tmp[j + 2] * k; aa += tmp[j + 3] * k;
      }
      const o = idx(x, y, w);
      out[o] = rr; out[o + 1] = gg; out[o + 2] = bb; out[o + 3] = aa;
    }
  }
  return out;
}

// ---------- Unsharp Mask (شارپن حرفه‌ای) ----------
export function unsharpMask(src, w, h, { amount = 1.2, radius = 2, threshold = 0 } = {}) {
  const blurred = gaussianBlur(src, w, h, radius);
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = src[i + c] - blurred[i + c];
      if (Math.abs(diff) < threshold) { out[i + c] = src[i + c]; continue; }
      out[i + c] = clamp255(src[i + c] + diff * amount);
    }
    out[i + 3] = src[i + 3];
  }
  return out;
}

// ---------- Emboss / Relief ----------
export function emboss(src, w, h, { strength = 1.5, direction = 135 } = {}) {
  const rad = direction * Math.PI / 180;
  // چرخش سادهٔ جهت با تغییر جهت سمپل‌ها
  const em = edgeMode('clamp');
  const out = new Uint8ClampedArray(src.length);
  const dx = Math.round(Math.cos(rad)) , dy = Math.round(-Math.sin(rad));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c0 = sample(src, w, h, x, y, em);
      const c1 = sample(src, w, h, x + dx, y + dy, em);
      const c2 = sample(src, w, h, x - dx, y - dy, em);
      const i = idx(x, y, w);
      for (let ch = 0; ch < 3; ch++) out[i + ch] = clamp255(128 + (c1[ch] * 0.5 - c2[ch] * 0.5 + c0[ch] * 0) * strength);
      out[i + 3] = c0[3];
    }
  }
  return out;
}

// ---------- Edge Detect (Sobel) ----------
export function sobelEdge(src, w, h, { invert = false, boost = 1 } = {}) {
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];
  const em = edgeMode('clamp');
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let g1 = 0, g2 = 0, g3 = 0, g4 = 0;
      for (let ky = 0; ky < 3; ky++) for (let kx = 0; kx < 3; kx++) {
        const s = sample(src, w, h, x + kx - 1, y + ky - 1, em);
        const lum = 0.299 * s[0] + 0.587 * s[1] + 0.114 * s[2];
        const k1 = gx[ky * 3 + kx], k2 = gy[ky * 3 + kx];
        g1 += lum * k1; g2 += lum * k2;
      }
      const mag = Math.min(255, Math.sqrt(g1 * g1 + g2 * g2) * boost);
      const v = invert ? 255 - mag : mag;
      const i = idx(x, y, w);
      out[i] = out[i + 1] = out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}

// ---------- Median Filter (کاهش نویز) ----------
export function medianFilter(src, w, h, radius = 1) {
  const n = radius * 2 + 1;
  const out = new Uint8ClampedArray(src.length);
  const em = edgeMode('clamp');
  const buf = new Array(n * n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let cnt = 0;
      const i = idx(x, y, w);
      for (let ch = 0; ch < 3; ch++) {
        cnt = 0;
        for (let ky = 0; ky < n; ky++) for (let kx = 0; kx < n; kx++) {
          buf[cnt++] = sample(src, w, h, x + kx - radius, y + ky - radius, em)[ch];
        }
        buf.sort((a, b) => a - b);
        out[i + ch] = buf[cnt >> 1];
      }
      out[i + 3] = src[i + 3];
    }
  }
  return out;
}

// ---------- Pixelate ----------
export function pixelate(src, w, h, size = 8) {
  const s = Math.max(1, size | 0);
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const cx = Math.min(w - 1, (x / s | 0) * s + (s >> 1));
      const cy = Math.min(h - 1, (y / s | 0) * s + (s >> 1));
      const i = idx(x, y, w), j = idx(cx, cy, w);
      out[i] = src[j]; out[i + 1] = src[j + 1]; out[i + 2] = src[j + 2]; out[i + 3] = src[j + 3];
    }
  }
  return out;
}

// ---------- Posterize ----------
export function posterize(src, w, h, levels = 4) {
  const l = Math.max(2, levels);
  const out = new Uint8ClampedArray(src.length);
  const area = 255 / (l - 1);
  for (let i = 0; i < src.length; i += 4) {
    for (let c = 0; c < 3; c++) out[i + c] = clamp255(Math.round(Math.round(src[i + c] / area) * area));
    out[i + 3] = src[i + 3];
  }
  return out;
}

// ---------- Cel-shading (کوانتیزه + لبه) ----------
export function celShade(src, w, h, { levels = 4, edgeBoost = 1 } = {}) {
  const poster = posterize(src, w, h, levels);
  const edges = sobelEdge(src, w, h, { boost: edgeBoost });
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const e = edges[i] < 60 ? 0 : 1;
    out[i] = e ? 20 : poster[i];
    out[i + 1] = e ? 20 : poster[i + 1];
    out[i + 2] = e ? 24 : poster[i + 2];
    out[i + 3] = src[i + 3];
  }
  return out;
}

// ---------- Kuwahara (نویزکاهی حفظ‌کنندهٔ لبه — افکت نقاشانه) ----------
export function kuwahara(src, w, h, radius = 3) {
  const em = edgeMode('clamp');
  const out = new Uint8ClampedArray(src.length);
  const r = Math.max(1, radius | 0);
  // پنجره = (r+1) پیکسل در هر ربع
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let bestVar = Infinity, best = [0, 0, 0];
      const quadOffsets = [
        [-r, -r], [0, -r], [-r, 0], [0, 0],
      ];
      for (let q = 0; q < 4; q++) {
        const ox = quadOffsets[q][0], oy = quadOffsets[q][1];
        let sr = 0, sg = 0, sb = 0, n = 0;
        let sr2 = 0, sg2 = 0, sb2 = 0;
        for (let ky = 0; ky <= r; ky++) for (let kx = 0; kx <= r; kx++) {
          const s = sample(src, w, h, x + ox + kx, y + oy + ky, em);
          sr += s[0]; sg += s[1]; sb += s[2];
          sr2 += s[0] * s[0]; sg2 += s[1] * s[1]; sb2 += s[2] * s[2];
          n++;
        }
        const mr = sr / n, mg = sg / n, mb = sb / n;
        const variance = (sr2 / n - mr * mr) + (sg2 / n - mg * mg) + (sb2 / n - mb * mb);
        if (variance < bestVar) { bestVar = variance; best = [mr, mg, mb]; }
      }
      const i = idx(x, y, w);
      out[i] = best[0]; out[i + 1] = best[1]; out[i + 2] = best[2];
      out[i + 3] = src[i + 3];
    }
  }
  return out;
}

// ---------- Bloom (norm + screen) — در فضای خطی ----------
export function bloom(src, w, h, { blur = 12, intensity = 0.7, threshold: th = 0.6 } = {}) {
  const blurry = gaussianBlur(src, w, h, blur);
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const b = blurry[i + c] / 255;
      const keep = src[i + c] / 255 < th ? src[i + c] / 255 : 0;
      // ترکیب در فضای خطی
      const base = srgbToLinear(src[i + c] / 255);
      const glow = srgbToLinear(b);
      let v = base + glow * intensity;
      v = v > 1 ? 1 : v;
      out[i + c] = clamp255(linearToSrgb(v) * 255);
    }
    out[i + 3] = src[i + 3];
  }
  return out;
}

// ---------- Thermal heatmap (زمان واقعی) ----------
export function thermal(src, w, h) {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const lum = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) / 255;
    // پالت حرارتی: آبی → سرخابی → قرمز → زرد → سفید
    let r, g, b;
    if (lum < 0.25) { const t = lum / 0.25; r = 0; g = 0; b = 128 + t * 127; }
    else if (lum < 0.5) { const t = (lum - 0.25) / 0.25; r = t * 255; g = 0; b = 255 - t * 128; }
    else if (lum < 0.75) { const t = (lum - 0.5) / 0.25; r = 255; g = t * 128; b = 0; }
    else { const t = (lum - 0.75) / 0.25; r = 255; g = 128 + t * 127; b = t * 255; }
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = 255;
  }
  return out;
}

// ---------- Vaporwave (رنگ‌های نئونی روی سایه روشن) ----------
export function vaporwave(src, w, h, { shift = 0.15 } = {}) {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const lum = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) / 255;
    // سایه → سرخابی-آبی، های‌لایت → صورتی/فیروزه
    const t = lum;
    out[i]     = clamp255((255 - t * 60) * (1 - shift) + t * 255 * 0.9);
    out[i + 1] = clamp255(t * 120 + 40);
    out[i + 2] = clamp255(t * 255 + 60);
    out[i + 3] = src[i + 3];
  }
  return out;
}

// ---------- Rain (دانه‌های تعینی) ----------
export function rain(src, w, h, { density = 0.015, seed = 42, length = 14, speed = 1 } = {}) {
  const out = new Uint8ClampedArray(src.length);
  out.set(src);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const drop = new Uint8Array(w * h); // خالی بودن برای محاسبهٔ طول
  const count = Math.floor(w * h * density);
  const L = Math.max(2, length | 0);
  for (let n = 0; n < count; n++) {
    const x = Math.floor(rnd() * w);
    const y = Math.floor(rnd() * h);
    let shortest = L;
    for (let l = 0; l < L; l++) {
      if (y + l >= h) break;
      if (drop[(y + l) * w + x]) { shortest = l; break; }
    }
    for (let l = 0; l < shortest; l++) {
      const i = idx(x, y + l, w);
      drop[(y + l) * w + x] = 1;
      const t = 1 - l / L;
      for (let c = 0; c < 3; c++) out[i + c] = clamp255(src[i + c] * 0.5 + 160 * t);
    }
  }
  return out;
}

// ---------- Film Grain (نویز سینمایی monochrome) ----------
export function grain(src, w, h, { intensity = 18, seed = 1337 } = {}) {
  const out = new Uint8ClampedArray(src.length);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 22695477 + 1) >>> 0; return s / 4294967296; };
  for (let i = 0; i < src.length; i += 4) {
    const n = (rnd() - 0.5) * intensity * 2;
    for (let c = 0; c < 3; c++) out[i + c] = clamp255(src[i + c] + n);
    out[i + 3] = src[i + 3];
  }
  return out;
}

// ---------- Color Balance (فتوشاپ-style shadows/midtones/highlights) ----------
export function colorBalance(src, w, h, { sr = 0, sg = 0, sb = 0, mr = 0, mg = 0, mb = 0, hr = 0, hg = 0, hb = 0, preserveLum = true } = {}) {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const r = src[i] / 255, g = src[i + 1] / 255, b = src[i + 2] / 255;
    const lum = 0.3 * r + 0.6 * g + 0.1 * b;
    let dr = 0, dg = 0, db = 0;
    if (lum < 0.5) { const t = 1 - lum * 2; dr += sr * t; dg += sg * t; db += sb * t; }
    else { const t = (lum - 0.5) * 2; dr += hr * t; dg += hg * t; db += hb * t; }
    const t = 1 - Math.abs(lum * 2 - 1); dr += mr * t; dg += mg * t; db += mb * t;
    out[i]     = clamp255((r + dr / 100) * 255);
    out[i + 1] = clamp255((g + dg / 100) * 255);
    out[i + 2] = clamp255((b + db / 100) * 255);
    out[i + 3] = src[i + 3];
  }
  return out;
}

// ---------- Duotone / Gradient Map ----------
export function gradientMap(src, w, h, { from = [0, 0, 30], to = [255, 180, 60] } = {}) {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const lum = (0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]) / 255;
    out[i]     = from[0] + (to[0] - from[0]) * lum;
    out[i + 1] = from[1] + (to[1] - from[1]) * lum;
    out[i + 2] = from[2] + (to[2] - from[2]) * lum;
    out[i + 3] = src[i + 3];
  }
  return out;
}

// ---------- Kaleidoscope (زمان واقعی، قطعهٔ دایره) ----------
export function kaleidoscope(src, w, h, { segments = 8, cx: cx0, cy: cy0 } = {}) {
  const cx = cx0 ?? w / 2, cy = cy0 ?? h / 2;
  const out = new Uint8ClampedArray(src.length);
  const seg = Math.max(2, segments | 0);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const r = Math.hypot(dx, dy);
      let ang = Math.atan2(dy, dx) * seg;
      ang = Math.abs((ang % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI));
      const sector = Math.floor(ang / Math.PI);
      const local = sector % 2 === 0 ? ang % Math.PI : Math.PI - (ang % Math.PI);
      const sx = Math.round(cx + Math.cos(local / seg) * r);
      const sy = Math.round(cy + Math.sin(local / seg) * r);
      const i = idx(x, y, w);
      const s = sample(src, w, h, Math.min(w - 1, sx), Math.min(h - 1, sy), edgeMode('clamp'));
      out[i] = s[0]; out[i + 1] = s[1]; out[i + 2] = s[2]; out[i + 3] = s[3];
    }
  }
  return out;
}

// ---------- Motion Blur (جهتی) ----------
export function motionBlur(src, w, h, { length = 20, angle = 0, zoom = 0 } = {}) {
  const out = new Uint8ClampedArray(src.length);
  const L = Math.max(1, length | 0);
  const rad = angle * Math.PI / 180;
  const dx = Math.cos(rad), dy = Math.sin(rad);
  const cx = w / 2, cy = h / 2;
  const em = edgeMode('clamp');
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      const samples = L;
      for (let t = 0; t < samples; t++) {
        const f = (t / samples) * 2 - 1; // -1..1
        const zx = zoom > 0 ? cx + (x - cx) * (1 + f * zoom) : x;
        const zy = zoom > 0 ? cy + (y - cy) * (1 + f * zoom) : y;
        const s = sample(src, w, h, zx + dx * f * length * 0.5, zy + dy * f * length * 0.5, em);
        r += s[0]; g += s[1]; b += s[2]; a += s[3];
      }
      const i = idx(x, y, w);
      out[i] = r / samples; out[i + 1] = g / samples; out[i + 2] = b / samples; out[i + 3] = a / samples;
    }
  }
  return out;
}

// ---------- Vignette (با تنظیم مرکز/شعاع/شدت) ----------
export function vignette(src, w, h, { strength = 0.8, radius = 1.0, cx: cx0, cy: cy0 } = {}) {
  const cx = cx0 ?? w / 2, cy = cy0 ?? h / 2;
  const maxD = Math.hypot(cx, cy) * radius;
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy) / maxD;
      const v = 1 - Math.min(1, Math.max(0, d - 0.2) / 0.8) * strength;
      const i = idx(x, y, w);
      out[i] = clamp255(src[i] * v);
      out[i + 1] = clamp255(src[i + 1] * v);
      out[i + 2] = clamp255(src[i + 2] * v);
      out[i + 3] = src[i + 3];
    }
  }
  return out;
}
