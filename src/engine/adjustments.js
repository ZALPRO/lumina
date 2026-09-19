// engine/adjustments.js — لایه‌های تنظیم غیرمخرب (Brightness/Contrast · Levels · Hue/Sat · Grayscale · Invert)
// هر تنظیم یک «نگاشت پیکسل» خالص است: تابعی که یک پیکسل u8 را می‌گیرد و خروجی برمی‌گرداند.
// Advantage فتوشاپ: چون نگاشت‌ها لایهٔ پارامتری هستند، هرگز پیکسل مبدأ دست نمی‌خورد و
// در هر لحظه قابل بازبینی/حذف‌اند — بدون undo.
import { srgbToLinear, linearToSrgb } from './color.js';

export class Adjustment {
  constructor(props = {}) { Object.assign(this, props); }
  get label() { return this.type; }
}

// ---------- نگاشت‌های آماده ----------

// Brightness/Contrast (فرمول فتوشاپ)
export const brightnessContrast = (b = 0, c = 0) => (r, g, bl, a) => {
  const f = (v) => {
    let y = (v / 255 - 0.5) * (1 + c) + 0.5 + b;
    y = y < 0 ? 0 : (y > 1 ? 1 : y);
    return Math.round(y * 255);
  };
  return [f(r), f(g), f(bl), a];
};

// Invert
export const invertMap = () => (r, g, bl, a) => [255 - r, 255 - g, 255 - bl, a];

// Grayscale (وزن‌های Rec.709)
export const grayscaleMap = () => (r, g, bl, a) => {
  const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * bl);
  return [y, y, y, a];
};

// Hue/Saturation/Lightness (شبیه فتوشاپ، در فضای خطی برای دقت رنگ)
export function hueSatMap({ hue = 0, sat = 0, light = 0 } = {}) {
  // hue: -180..180 ، sat: -100..100 ، light: -100..100
  return (r, g, bl, a) => {
    let [lr, lg, lb] = [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(bl / 255)];
    const lum = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
    // دشباع (مخلوط با لاما)
    if (sat !== 0) {
      const s = 1 + sat / 100;
      lr = lum + (lr - lum) * s;
      lg = lum + (lg - lum) * s;
      lb = lum + (lb - lum) * s;
    }
    // چرخش hue (تخمین ماتریس سادهٔ درجه‌بندی — دقت بصری کافی)
    if (hue !== 0) {
      const th = (hue * Math.PI) / 180;
      const cosH = Math.cos(th), sinH = Math.sin(th);
      // ماتریس YIQ-چرخش
      const [rr, gg, bb] = [lr, lg, lb];
      const y = 0.299 * rr + 0.587 * gg + 0.114 * bb;
      const i = 0.596 * rr - 0.274 * gg - 0.322 * bb;
      const q = 0.211 * rr - 0.523 * gg + 0.312 * bb;
      const i2 = i * cosH - q * sinH;
      const q2 = i * sinH + q * cosH;
      lr = y + 0.956 * i2 + 0.621 * q2;
      lg = y - 0.272 * i2 - 0.647 * q2;
      lb = y - 1.106 * i2 + 1.702 * q2;
    }
    // روشنایی
    if (light !== 0) {
      const l2 = light / 100;
      lr = lr + l2; lg = lg + l2; lb = lb + l2;
    }
    const to = (v) => Math.round((v < 0 ? 0 : (v > 1 ? 1 : linearToSrgb(v))) * 255);
    return [to(lr), to(lg), to(lb), a];
  };
}

// Levels: shadows=0, highlights=255 → gamma (0.1..10)
export const levelsMap = (shadows = 0, highlights = 255, gamma = 1) => (r, g, bl, a) => {
  const f = (v) => {
    const x = v < shadows ? 0 : (v > highlights ? 1 : (v - shadows) / (highlights - shadows));
    return Math.round(Math.pow(x, 1 / gamma) * 255);
  };
  return [f(r), f(g), f(bl), a];
};

// Threshold
export const thresholdMap = (t = 128) => (r, g, bl, a) => {
  const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * bl);
  const v = y < t ? 0 : 255;
  return [v, v, v, a];
};

// Curves (monotonic spline از نقاط کنترل) — استاندارد صنعتی Catmull–Rom
// points: [[in0,out0],[in1,out1],...] هر دو در 0..255 (یا 0..1 به انتخاب مقیاس)
// خروجی: LUT uint8 (256) با درون‌یابی Catmull–Rom
export function curvesLUT(points = [], scale = 255) {
  if (!points || points.length === 0) {
    const id = new Uint8Array(256);
    for (let i = 0; i < 256; i++) id[i] = i;
    return id;
  }
  const pts = points.map(([x, y]) => [x / scale, y / scale]).sort((a, b) => a[0] - b[0]);
  const first = pts[0], last = pts[pts.length - 1];
  const segs = [];
  const all = [[first[0], first[1]], ...pts, [last[0], last[1]]];
  const n = all.length;
  if (n < 3) {
    const lut = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      const t = i / 255;
      const a = all[0], b = all[all.length - 1];
      const y = a[1] + (b[1] - a[1]) * (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
      lut[i] = clamp8(y * 255);
    }
    return lut;
  }
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    // پیدا کردن segment
    let k = 0;
    for (let s = 0; s < n - 1; s++) {
      if (t >= all[s][0] && t <= all[s + 1][0]) { k = s; break; }
      if (t > all[n - 1][0]) { k = n - 2; break; }
    }
    const p0 = all[Math.max(0, k - 1)], p1 = all[k], p2 = all[k + 1], p3 = all[Math.min(n - 1, k + 2)];
    const d = p2[0] - p1[0] || 1e-6;
    const u = (t - p1[0]) / d;
    const y = catmullRom(p0[1], p1[1], p2[1], p3[1], u);
    lut[i] = clamp8(y * 255);
  }
  return lut;
}

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t, t3 = t2 * t;
  return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
}

// اعمال LUT منحنی روی کل بافر RGBA (r/g/b و آلفا دست‌نخورده)
export const curvesMap = (lutR = null, lutG = null, lutB = null) => (r, g, bl, a) => [
  lutR ? lutR[r] : r,
  lutG ? lutG[g] : g,
  lutB ? lutB[bl] : bl,
  a,
];

// Exposure (EV>0 روشن، <0 تیره) — در فضای خطی (دقت عکاسی)
export const exposureMap = (ev = 0) => {
  const m = Math.pow(2, ev);
  return (r, g, bl, a) => [
    clamp8(linearToSrgb(srgbToLinear(r / 255) * m) * 255),
    clamp8(linearToSrgb(srgbToLinear(g / 255) * m) * 255),
    clamp8(linearToSrgb(srgbToLinear(bl / 255) * m) * 255),
    a,
  ];
};

// Vibrance — اشباع هوشمند (بیشتر روی رنگ‌های کم‌اشباع، کمتر روی پوست)
export const vibranceMap = (amount = 0.4) => {
  return (r, g, bl, a) => {
    const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl);
    const sat = (mx - mn) / 255;
    const s = amount * (1 - sat); // هرچه کم‌اشباع‌تر، اثر بیش‌تر (محافظ پوست)
    const lum = 0.213 * r + 0.715 * g + 0.072 * bl;
    const f = (v) => clamp8(lum + (v - lum) * (1 + s));
    return [f(r), f(g), f(bl), a];
  };
};

function clamp8(v) { v = Math.round(v); return v < 0 ? 0 : (v > 255 ? 255 : v); }
