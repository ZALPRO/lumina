// blend.js — مدهای بلندینگ فتوشاپ + ترکیب آلفا (compositing) در فضای خطی
// فرمول ترکیب مطابق مدل Porter-Duff "source over" با بلندینگ W3C:
//   B(Cb, Cs)  = رنگ مخلوط در فضای غیرپیش‌ضرب
//   co = αs(1−αb)Cs + αs·αb·B(Cb,Cs) + (1−αs)αb·Cb
//   αo = αs + αb(1−αs)
import {
  srgbToLinear, linearToSrgb, linearToU8, u8ToLinear,
  lum, sat, setLum, setSat, clamp01,
} from './color.js';

export const BLEND_MODES = [
  'normal', 'dissolve',
  'darken', 'multiply', 'colorBurn', 'linearBurn', 'darkerColor',
  'lighten', 'screen', 'colorDodge', 'linearDodge', 'lighterColor',
  'overlay', 'softLight', 'hardLight', 'vividLight', 'linearLight', 'pinLight', 'hardMix',
  'difference', 'exclusion', 'subtract', 'divide',
  'hue', 'saturation', 'color', 'luminosity',
];

// بلندینگ جداشدنی: یک کانال (مقادیر خطی غیرپیش‌ضرب در بازه‌ی ۰..۱)
export function blendChannel(mode, cb, cs) {
  switch (mode) {
    case 'normal':      return cs;
    case 'multiply':    return cb * cs;
    case 'screen':      return cb + cs - cb * cs;
    case 'overlay':     return cb <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
    case 'darken':      return Math.min(cb, cs);
    case 'lighten':     return Math.max(cb, cs);
    case 'colorDodge':  return cs >= 1 ? 1 : Math.min(1, cb / (1 - cs));
    case 'colorBurn':   return cs <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / cs);
    case 'linearDodge': return Math.min(1, cb + cs);
    case 'linearBurn':  return Math.max(0, cb + cs - 1);
    case 'hardLight':   return cs <= 0.5 ? 2 * cb * cs : 1 - 2 * (1 - cb) * (1 - cs);
    case 'subtract':    return Math.max(0, cb - cs);
    case 'divide':      return cs <= 0 ? 1 : Math.min(1, cb / cs); // منبع سیاه → سفید (طبق W3C)
    case 'difference':  return Math.abs(cb - cs);
    case 'exclusion':   return cb + cs - 2 * cb * cs;
    case 'hardMix':     return (cb + cs) >= 1 ? 1 : 0;
    case 'softLight': {
      if (cs <= 0.5) return cb - (1 - 2 * cs) * cb * (1 - cb);
      const D = cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(cb);
      return cb + (2 * cs - 1) * (D - cb);
    }
    case 'vividLight': {
      if (cs <= 0.5) { const C = 2 * cs; return C <= 0 ? 0 : 1 - Math.min(1, (1 - cb) / C); }
      const C = 2 * cs - 1; return C >= 1 ? 1 : Math.min(1, cb / (1 - C));
    }
    case 'linearLight': return Math.max(0, Math.min(1, cb + 2 * cs - 1));
    case 'pinLight':    return cs <= 0.5 ? Math.min(cb, 2 * cs) : Math.max(cb, 2 * cs - 1);
    default:            return cs;
  }
}

// بلندینگ روی سه‌تایی رنگ (غیرپیش‌ضرب خطی) — شامل مدهای غیرجداشدنی
export function blendColor(mode, cb, cs) {
  switch (mode) {
    case 'hue': {
      const [r, g, b] = setSat(cs[0], cs[1], cs[2], sat(cb[0], cb[1], cb[2]));
      return setLum(r, g, b, lum(cb[0], cb[1], cb[2]));
    }
    case 'saturation': {
      const [r, g, b] = setSat(cb[0], cb[1], cb[2], sat(cs[0], cs[1], cs[2]));
      return setLum(r, g, b, lum(cb[0], cb[1], cb[2]));
    }
    case 'color':       return setLum(cs[0], cs[1], cs[2], lum(cb[0], cb[1], cb[2]));
    case 'luminosity':  return setLum(cb[0], cb[1], cb[2], lum(cs[0], cs[1], cs[2]));
    case 'darkerColor': return lum(cs[0], cs[1], cs[2]) <  lum(cb[0], cb[1], cb[2]) ? cs.slice() : cb.slice();
    case 'lighterColor':return lum(cs[0], cs[1], cs[2]) >  lum(cb[0], cb[1], cb[2]) ? cs.slice() : cb.slice();
    default:
      return [blendChannel(mode, cb[0], cs[0]), blendChannel(mode, cb[1], cs[1]), blendChannel(mode, cb[2], cs[2])];
  }
}

// ترکیب «منبع روی زمینه»؛ ورودی/خروجی = رنگ مستقیم خطی + آلفا
// bottomStraight/topStraight: [r,g,b] خطی (r در ۰..۱)
// bottomA/topA: آلفا در ۰..۱
export function compositeOver(bottomStraight, bottomA, topStraight, topA, mode = 'normal', opacity = 1) {
  const as = clamp01(topA) * clamp01(opacity);
  if (as <= 0) return [bottomStraight[0], bottomStraight[1], bottomStraight[2], bottomA];
  const ab = clamp01(bottomA);
  if (ab <= 0) return [topStraight[0], topStraight[1], topStraight[2], as]; // زمینه شفاف: چیزی برای بلند نیست

  const B = (mode === 'normal') ? topStraight : blendColor(mode, bottomStraight, topStraight);
  const ao = as + ab * (1 - as);
  const cr = as * (1 - ab) * topStraight[0] + as * ab * B[0] + (1 - as) * ab * bottomStraight[0];
  const cg = as * (1 - ab) * topStraight[1] + as * ab * B[1] + (1 - as) * ab * bottomStraight[1];
  const cb2 = as * (1 - ab) * topStraight[2] + as * ab * B[2] + (1 - as) * ab * bottomStraight[2];
  const inv = ao > 0 ? 1 / ao : 0;
  return [cr * inv, cg * inv, cb2 * inv, ao];
}

// نسخه‌ی سطح u8 (ورودی/خروجی RGBA8 مستقیم) — برای راحتی و تست
const TMPL = new Array(4);
export function compositePixelU8(bottomU8, topU8, mode = 'normal', opacity = 1) {
  const bl = u8ToLinear(bottomU8[0], bottomU8[1], bottomU8[2], bottomU8[3]);
  const tl = u8ToLinear(topU8[0], topU8[1], topU8[2], topU8[3]);
  const [r, g, b, a] = compositeOver([bl[0], bl[1], bl[2]], bl[3], [tl[0], tl[1], tl[2]], tl[3], mode, opacity);
  return linearToU8(r, g, b, a);
}

// هش قطعی برای dithering مد dissolve (بدون تصادف واقعی → قابل تکرار در تست)
export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = ((h ^ (h >>> 13)) * 1274126177) | 0;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}
