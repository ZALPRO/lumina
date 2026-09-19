// cli/thumbnail.js — ساخت thumbnail استاندارد یوتیوب (1280×720) با موتور Lumina
// قواعد اعمال‌شده (مطابق تحقیق استانداردهای صنعت):
//   1) کانواس 1280×720 (16:9)
//   2) سوژه (چهره/محتوای اصلی) برش زده و بزرگ در راست/وسط
//   3) پس‌زمینه backdrop با گوسی‌بلور + تیره شده (جداسازی سوژه)
//   4) متن زرد bold با استروک مشکی ضخیم (خوانا در 120px موبایل)
//   5) کمی اشباع/کنتراست (pop) — کل فایل < 2MB (PNG یا JPG)
import fs from 'fs';
import { decodePng } from '../src/formats/png.js';
import { encodePng } from '../src/formats/png.js';
import { gaussianBlur, unsharpMask } from '../src/engine/fx.js';

const clamp255 = (v) => (v < 0 ? 0 : (v > 255 ? 255 : v | 0));

// اسکیل سادهٔ نزدیک‌ترین همسایه → باینر (برای ماسک/بافت)
function scale(src, sw, sh, tw, th) {
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const sy = Math.min(sh - 1, Math.floor(y * sh / th));
    for (let x = 0; x < tw; x++) {
      const sx = Math.min(sw - 1, Math.floor(x * sw / tw));
      const i = (y * tw + x) * 4, j = (sy * sw + sx) * 4;
      out[i] = src[j]; out[i + 1] = src[j + 1]; out[i + 2] = src[j + 2]; out[i + 3] = src[j + 3];
    }
  }
  return out;
}

// اسکیل دوخطی
function scaleBilinear(src, sw, sh, tw, th) {
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const fy = y * (sh - 1) / Math.max(1, th - 1);
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty2 = fy - y0;
    for (let x = 0; x < tw; x++) {
      const fx = x * (sw - 1) / Math.max(1, tw - 1);
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx2 = fx - x0;
      let outR = 0, outG = 0, outB = 0, outA = 0;
      for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
        const j = ((y0 + yy) * sw + (x0 + xx)) * 4;
        const wgt = (yy ? ty2 : 1 - ty2) * (xx ? tx2 : 1 - tx2);
        outR += src[j] * wgt; outG += src[j + 1] * wgt; outB += src[j + 2] * wgt; outA += src[j + 3] * wgt;
      }
      const i = (y * tw + x) * 4;
      out[i] = outR; out[i + 1] = outG; out[i + 2] = outB; out[i + 3] = outA;
    }
  }
  return out;
}

// کراپ هوشمندانه: مستطیل مرکزی از سورس
function cropCenter(src, sw, sh, cw, ch) {
  const ox = Math.floor((sw - cw) / 2), oy = Math.floor((sh - ch) / 2);
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = (y * cw + x) * 4, j = ((oy + y) * sw + (ox + x)) * 4;
    out[i] = src[j]; out[i + 1] = src[j + 1]; out[i + 2] = src[j + 2]; out[i + 3] = src[j + 3];
  }
  return out;
}

// خودکار تنظیم روشنایی (levels ساده)
function toneMap(src, w, h, { contrast = 1.12, brightness = 8, satMul = 1.15 } = {}) {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = src[i + c] / 255;
      v = (v - 0.5) * contrast + 0.5 + brightness / 255;
      out[i + c] = clamp255(v * 255);
    }
    out[i + 3] = src[i + 3];
  }
  // اشباع
  for (let i = 0; i < out.length; i += 4) {
    const r = out[i], g = out[i + 1], b = out[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    out[i] = clamp255(lum + (r - lum) * satMul);
    out[i + 1] = clamp255(lum + (g - lum) * satMul);
    out[i + 2] = clamp255(lum + (b - lum) * satMul);
  }
  return out;
}

// میسازد: { subject, backdrop } (سوژهٔ واضح در راست، پس‌زمینهٔ محو/تیره)
function buildFrame(src, sw, sh) {
  const W = 1280, H = 720;

  // 1) backdrop = کل تصویر، اسکیل + گوسی‌بلور + تیره
  let backdrop = scaleBilinear(src, sw, sh, W, H);
  backdrop = gaussianBlur(backdrop, W, H, 18);
  for (let i = 0; i < backdrop.length; i += 4) {
    backdrop[i] = backdrop[i] * 0.45;
    backdrop[i + 1] = backdrop[i + 1] * 0.45;
    backdrop[i + 2] = backdrop[i + 2] * 0.5;
  }

  // 2) سوژه: کراپ یک مربع/پورتره از مرکز، بزرگ در مرحله
  let cropW = Math.min(sw, Math.floor(sh * 0.78));
  let cropH = Math.floor(cropW * 1.15);
  if (cropW > sw) { cropW = sw; cropH = sw; }
  let subject = cropCenter(src, sw, sh, cropW, cropH);
  // تون مپ + شارپن
  subject = toneMap(subject, cropW, cropH);
  subject = unsharpMask(subject, cropW, cropH, { amount: 1.4, radius: 1.5, threshold: 2 });

  // اسکیل سوژه → حدود 55% ارتفاع کانواس در راست-وسط
  const sw2 = Math.floor(H * 0.52);
  const sh2 = Math.floor(sw2 * cropH / cropW);
  subject = scaleBilinear(subject, cropW, cropH, sw2, sh2);

  return { W, H, backdrop, subject, sw2, sh2 };
}

// متن: رندر سادهٔ bitmap (حروف بلاک) با استروک — بدون وابستگی DOM
function renderText(text, fontPx = 110, { color = [255, 214, 0], stroke = [0, 0, 0] } = {}) {
  // glyph grid 5x7 برای [A-Z0-9 !?./-] — متن ساده
  const GLYPHS = {
    'A': ['01110','10001','10001','11111','10001','10001','10001'],
    'B': ['11110','10001','10001','11110','10001','10001','11110'],
    'C': ['01110','10001','10000','10000','10000','10001','01110'],
    'D': ['11110','10001','10001','10001','10001','10001','11110'],
    'E': ['11111','10000','10000','11110','10000','10000','11111'],
    'F': ['11111','10000','10000','11110','10000','10000','10000'],
    'G': ['01110','10001','10000','10111','10001','10001','01111'],
    'H': ['10001','10001','10001','11111','10001','10001','10001'],
    'I': ['11111','00100','00100','00100','00100','00100','11111'],
    'J': ['00111','00010','00010','00010','00010','10010','01100'],
    'K': ['10001','10010','10100','11000','10100','10010','10001'],
    'L': ['10000','10000','10000','10000','10000','10000','11111'],
    'M': ['10001','11011','10101','10101','10001','10001','10001'],
    'N': ['10001','11001','10101','10011','10001','10001','10001'],
    'O': ['01110','10001','10001','10001','10001','10001','01110'],
    'P': ['11110','10001','10001','11110','10000','10000','10000'],
    'Q': ['01110','10001','10001','10001','10101','10010','01101'],
    'R': ['11110','10001','10001','11110','10100','10010','10001'],
    'S': ['01111','10000','10000','01110','00001','00001','11110'],
    'T': ['11111','00100','00100','00100','00100','00100','00100'],
    'U': ['10001','10001','10001','10001','10001','10001','01110'],
    'V': ['10001','10001','10001','10001','10001','01010','00100'],
    'W': ['10001','10001','10001','10101','10101','11011','10001'],
    'X': ['10001','10001','01010','00100','01010','10001','10001'],
    'Y': ['10001','10001','01010','00100','00100','00100','00100'],
    'Z': ['11111','00001','00010','00100','01000','10000','11111'],
    '0': ['01110','10001','10011','10101','11001','10001','01110'],
    '1': ['00100','01100','00100','00100','00100','00100','01110'],
    '2': ['01110','10001','00001','00010','00100','01000','11111'],
    '3': ['11110','00001','00001','01110','00001','00001','11110'],
    '4': ['00010','00110','01010','10010','11111','00010','00010'],
    '5': ['11111','10000','10000','11110','00001','00001','11110'],
    '6': ['01110','10000','10000','11110','10001','10001','01110'],
    '7': ['11111','00001','00010','00100','01000','01000','01000'],
    '8': ['01110','10001','10001','01110','10001','10001','01110'],
    '9': ['01110','10001','10001','01111','00001','00001','01110'],
    '!': ['00100','00100','00100','00100','00000','00100','00100'],
    '?': ['01110','10001','00001','00010','00100','00000','00100'],
    '.': ['00000','00000','00000','00000','00000','00110','00110'],
    '-': ['00000','00000','00000','11111','00000','00000','00000'],
    ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  };
  const ch = (c) => GLYPHS[c] || GLYPHS[' '];
  const scalePx = Math.floor(fontPx / 9); // هر خانه 9px
  const gap = Math.floor(fontPx * 0.18);
  const charW = 6 * scalePx;
  const charH = 8 * scalePx;
  const str = text.toUpperCase();
  const totalW = str.length * (charW + gap) - gap;
  const pad = 30;

  const W2 = totalW + pad * 2;
  const H2 = charH + pad * 2;
  const out = new Uint8ClampedArray(W2 * H2 * 4); // شفاف
  // استروک
  const drawGlyph = (cellPx, cellPy, r, g, b) => {
    for (let cy = 0; cy < 7; cy++) for (let cx = 0; cx < 5; cx++) {
      if (str !== undefined) { /*noop*/ }
    }
  };

  let cx0 = pad;
  for (let s = 0; s < str.length; s++) {
    const glyph = ch(str[s]);
    for (let cy = 0; cy < 7; cy++) {
      for (let cx = 0; cx < 5; cx++) {
        if (glyph[cy][cx] !== '1') continue;
        const px = cx0 + cx * scalePx, py = cy * scalePx;
        // استروک مشکی (ضخیم)
        for (let dy = -3 * 0; dy <= 0; dy++) { /* ساده: stroke از طریق بزرگ‌نمایی */ }
        for (let yy = -Math.ceil(scalePx * 0.22); yy < scalePx + Math.ceil(scalePx * 0.22); yy++) {
          for (let xx = -Math.ceil(scalePx * 0.22); xx < scalePx + Math.ceil(scalePx * 0.22); xx++) {
            const ax = px + xx, ay = py + yy;
            if (ax < 0 || ay < 0 || ax >= W2 || ay >= H2) continue;
            const i = (ay * W2 + ax) * 4;
            out[i] = stroke[0]; out[i + 1] = stroke[1]; out[i + 2] = stroke[2]; out[i + 3] = 255;
          }
        }
      }
    }
    cx0 += charW + gap;
  }
  // رنگ اصلی روی استروک
  cx0 = pad;
  for (let s = 0; s < str.length; s++) {
    const glyph = ch(str[s]);
    for (let cy = 0; cy < 7; cy++) {
      for (let cx = 0; cx < 5; cx++) {
        if (glyph[cy][cx] !== '1') continue;
        const px = cx0 + cx * scalePx, py = cy * scalePx;
        for (let yy = 0; yy < scalePx; yy++) {
          for (let xx = 0; xx < scalePx; xx++) {
            const i = ((py + yy) * W2 + (px + xx)) * 4;
            out[i] = color[0]; out[i + 1] = color[1]; out[i + 2] = color[2]; out[i + 3] = 255;
          }
        }
      }
    }
    cx0 += charW + gap;
  }
  return { data: out, w: W2, h: H2 };
}

// کامپوزیت نهایی با آلفا
function composite(bg, bgW, bgH, fg, fgw, fgh, fx, fy) {
  const out = new Uint8ClampedArray(bgW * bgH * 4);
  out.set(bg);
  for (let y = 0; y < fgh; y++) {
    for (let x = 0; x < fgw; x++) {
      const i = (y * fgw + x) * 4;
      const a = fg[i + 3] / 255;
      if (a === 0) continue;
      const dx = fx + x, dy = fy + y;
      if (dx < 0 || dy < 0 || dx >= bgW || dy >= bgH) continue;
      const j = (dy * bgW + dx) * 4;
      out[j] = fg[i] * a + out[j] * (1 - a);
      out[j + 1] = fg[i + 1] * a + out[j + 1] * (1 - a);
      out[j + 2] = fg[i + 2] * a + out[j + 2] * (1 - a);
    }
  }
  return out;
}

// گرادیان نیمه‌تیره از پایین برای خوانایی
function addDarkGradient(img, w, h, { fromY = 0.6, strength = 0.55 } = {}) {
  const out = new Uint8ClampedArray(img.length);
  out.set(img);
  for (let y = Math.floor(fromY * h); y < h; y++) {
    const t = (y - fromY * h) / (h - fromY * h);
    const mul = 1 - strength * t;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      out[i] *= mul; out[i + 1] *= mul; out[i + 2] *= mul;
    }
  }
  return out;
}

async function main() {
  const file = process.argv[2];
  const outName = process.argv[3] || 'out/thumbnail.png';
  if (!file) { console.error('usage: node cli/thumbnail.js <image.png> [out.png]'); process.exit(1); }

  const buf = new Uint8Array(fs.readFileSync(file));
  const img = await decodePng(buf);
  const { width: sw, height: sh, data: src } = img;

  const { W, H, backdrop, subject, sw2, sh2 } = buildFrame(src, sw, sh);

  let canvas = new Uint8ClampedArray(W * H * 4);
  canvas.set(backdrop);

  // سوژه در راست-وسط
  const subjX = W - sw2 - 90;
  const subjY = Math.floor((H - sh2) / 2) - 20;
  canvas = composite(canvas, W, H, subject, sw2, sh2, subjX, subjY);

  // گرادیان پایین برای متن
  canvas = addDarkGradient(canvas, W, H, { fromY: 0.55, strength: 0.6 });

  // متن
  const text = process.argv[4] || 'INSANE!';
  const t = renderText(text, 120, { color: [255, 214, 0], stroke: [0, 0, 0] });
  const tx = 60, ty = H - t.h - 70;
  canvas = composite(canvas, W, H, t.data, t.w, t.h, tx, ty);

  const png = await encodePng({ width: W, height: H, data: canvas });
  fs.writeFileSync(outName, png);
  console.log(`thumbnail → ${outName} (${W}×${H}, ${png.length} bytes)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
