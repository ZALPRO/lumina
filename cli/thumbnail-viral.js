// cli/thumbnail-viral.js — تامنیل وایرال یوتیوب (سبک Mr Taster / فود چلنج)
// ساختار استخراج‌شده از آنالیز تامنیل‌های مرجع:
//   1) پس‌زمینهٔ تخت گرادیان شدیداً اشباع (قرمز→نارنجی→زرد)
//   2) ترکیب دو سوژهٔ بریده‌شده (green-screen) با هالهٔ تابان
//   3) بدج‌ها: ستارهٔ زرد، فلش قرمز
//   4) متن غول‌آسا (رندر بیت‌مپ) با استروک مشکی ۲۰٪ ضخامت
// خروجی: PNG 1280×720 + JPG
import fs from 'fs';
import { decodeImage, encodeImage } from '../src/formats/imageio.js';
import { chromaKeyRemove, glowFromAlpha, flatGradient, drawStar, drawArrow } from '../src/engine/chroma.js';

const clamp255 = (v) => (v < 0 ? 0 : (v > 255 ? 255 : v | 0));

// اسکیل دوخطی
function scaleBilinear(src, sw, sh, tw, th) {
  const out = new Uint8ClampedArray(tw * th * 4);
  for (let y = 0; y < th; y++) {
    const fy = y * (sh - 1) / Math.max(1, th - 1);
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < tw; x++) {
      const fx = x * (sw - 1) / Math.max(1, tw - 1);
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), tx = fx - x0;
      let R = 0, G = 0, B = 0, A = 0;
      for (let yy = 0; yy < 2; yy++) for (let xx = 0; xx < 2; xx++) {
        const j = ((y0 + yy) * sw + (x0 + xx)) * 4;
        const wgt = (yy ? ty : 1 - ty) * (xx ? tx : 1 - tx);
        R += src[j] * wgt; G += src[j + 1] * wgt; B += src[j + 2] * wgt; A += src[j + 3] * wgt;
      }
      const i = (y * tw + x) * 4;
      out[i] = R; out[i + 1] = G; out[i + 2] = B; out[i + 3] = A;
    }
  }
  return out;
}

// کامپوزیت با آلفا
function composite(bg, bgW, bgH, fg, fgw, fgh, fx, fy, brightnessMul = 1) {
  const out = bg; // in-place on copy is fine
  for (let y = 0; y < fgh; y++) {
    for (let x = 0; x < fgw; x++) {
      const i = (y * fgw + x) * 4;
      const a = fg[i + 3] / 255;
      if (a === 0) continue;
      const dx = fx + x, dy = fy + y;
      if (dx < 0 || dy < 0 || dx >= bgW || dy >= bgH) continue;
      const j = (dy * bgW + dx) * 4;
      out[j] = fg[i] * a * brightnessMul + out[j] * (1 - a);
      out[j + 1] = fg[i + 1] * a * brightnessMul + out[j + 1] * (1 - a);
      out[j + 2] = fg[i + 2] * a * brightnessMul + out[j + 2] * (1 - a);
      out[j + 3] = 255;
    }
  }
  return out;
}

// متن بیت‌مپ (حروف بزرگ بلوک) با استروک — از thumbnail.js
function renderText(text, fontPx = 120, { color = [255, 255, 255], stroke = [0, 0, 0] } = {}) {
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
    '#': ['01010','11111','01010','01010','11111','01010','00000'],
    '%': ['11001','11010','00010','00100','01000','01011','10011'],
    ' ': ['00000','00000','00000','00000','00000','00000','00000'],
  };
  const ch = (c) => GLYPHS[c] || GLYPHS[' '];
  const scalePx = Math.floor(fontPx / 9);
  const gap = Math.floor(fontPx * 0.12);
  const charW = 6 * scalePx;
  const charH = 8 * scalePx;
  const str = text.toUpperCase();
  const totalW = str.length * (charW + gap) - gap;
  const pad = Math.ceil(fontPx * 0.25);
  const W2 = totalW + pad * 2;
  const H2 = charH + pad * 2;
  const out = new Uint8ClampedArray(W2 * H2 * 4);
  // استروک
  const strokeTh = Math.max(2, Math.ceil(scalePx * 0.45));
  let cx0 = pad;
  for (let s = 0; s < str.length; s++) {
    const glyph = ch(str[s]);
    for (let cy = 0; cy < 7; cy++) for (let cx = 0; cx < 5; cx++) {
      if (glyph[cy][cx] !== '1') continue;
      const px = cx0 + cx * scalePx, py = cy * scalePx;
      for (let yy = -strokeTh; yy < scalePx + strokeTh; yy++) for (let xx = -strokeTh; xx < scalePx + strokeTh; xx++) {
        const ax = px + xx, ay = py + yy;
        if (ax < 0 || ay < 0 || ax >= W2 || ay >= H2) continue;
        const i = (ay * W2 + ax) * 4;
        out[i] = stroke[0]; out[i + 1] = stroke[1]; out[i + 2] = stroke[2]; out[i + 3] = 255;
      }
    }
    cx0 += charW + gap;
  }
  // رنگ
  cx0 = pad;
  for (let s = 0; s < str.length; s++) {
    const glyph = ch(str[s]);
    for (let cy = 0; cy < 7; cy++) for (let cx = 0; cx < 5; cx++) {
      if (glyph[cy][cx] !== '1') continue;
      const px = cx0 + cx * scalePx, py = cy * scalePx;
      for (let yy = 0; yy < scalePx; yy++) for (let xx = 0; xx < scalePx; xx++) {
        const i = ((py + yy) * W2 + (px + xx)) * 4;
        out[i] = color[0]; out[i + 1] = color[1]; out[i + 2] = color[2]; out[i + 3] = 255;
      }
    }
    cx0 += charW + gap;
  }
  return { data: out, w: W2, h: H2 };
}

async function main() {
  const foodFile = process.argv[2]; // green-screen غذا
  const manFile = process.argv[3];  // green-screen چهره
  const title = (process.argv[4] || 'BEST FAST FOOD').toUpperCase();
  const sub = (process.argv[5] || 'IRAN!').toUpperCase();
  const outPng = process.argv[6] || 'out/thumb-viral.png';

  const W = 1280, H = 720;

  // ۱) پس‌زمینهٔ گرادیان تخت اشباع
  let canvas = flatGradient(W, H, [255, 40, 20], [255, 170, 0], 0);

  // ۲) غذا: green-screen حذف → اسکیل → glow → کامپوزیت (چپ-پایین، بزرگ)
  const fbuf = new Uint8Array(fs.readFileSync(foodFile));
  const fdec = await decodeImage(fbuf);
  let food = chromaKeyRemove(fdec.data, fdec.width, fdec.height, { r: 0, g: 255, b: 0 }, 100);
  const fh = Math.round(H * 0.72);
  const fw = Math.round(fh * fdec.width / fdec.height);
  food = scaleBilinear(food, fdec.width, fdec.height, fw, fh);
  const fglow = glowFromAlpha(food, fw, fh, [255, 200, 0], 12, 1.0);
  const foodL = -60, foodT = H - fh + 90;
  canvas = composite(canvas, W, H, fglow, fw, fh, foodL, foodT, 0.9);
  canvas = composite(canvas, W, H, food, fw, fh, foodL, foodT, 1.12);

  // ۳) چهره: green-screen حذف → اسکیل → سایه → کامپوزیت (راست، بریده از لبه)
  const mbuf = new Uint8Array(fs.readFileSync(manFile));
  const mdec = await decodeImage(mbuf);
  let man = chromaKeyRemove(mdec.data, mdec.width, mdec.height, { r: 0, g: 255, b: 0 }, 100);
  const mh = Math.round(H * 0.74);
  const mw = Math.round(mh * mdec.width / mdec.height);
  man = scaleBilinear(man, mdec.width, mdec.height, mw, mh);
  const mglow = glowFromAlpha(man, mw, mh, [255, 240, 210], 10, 0.8);
  const manX = W - Math.round(mw * 0.8), manY = H - mh + 60;
  canvas = composite(canvas, W, H, mglow, mw, mh, manX, manY, 0.5);
  canvas = composite(canvas, W, H, man, mw, mh, manX, manY, 1.05);

  // ۴) بدج‌ها
  canvas = drawStar(canvas, W, H, { cx: 120, cy: 110, radius: 56, color: [255, 210, 0], stroke: [0, 0, 0] });
  canvas = drawStar(canvas, W, H, { cx: 250, cy: 60, radius: 30, color: [255, 255, 255], stroke: [0, 0, 0] });
  // فلش قرمز به سمت غذا
  canvas = drawArrow(canvas, W, H, { x1: 380, y1: 560, x2: 300, y2: 430, color: [230, 30, 30], stroke: [255, 255, 255], thick: 26 });

  // ۵) متن اصلی (سفید با استروک مشکی ضخیم) — پایین
  let t = renderText(title, 130, { color: [255, 255, 255], stroke: [0, 0, 0] });
  // اگر متن از عرض بیرون زد، تا جا شدن در 1100px کوچک کن
  let tpix = 130;
  while (t.w > 1100 && tpix > 60) {
    tpix -= 8;
    t = renderText(title, tpix, { color: [255, 255, 255], stroke: [0, 0, 0] });
  }
  const tx = 50, ty = H - t.h - 16;
  canvas = composite(canvas, W, H, t.data, t.w, t.h, tx, ty, 1);

  // ۶) زیرنویس (قرمز با استروک سفید)
  let s = renderText(sub, 90, { color: [255, 60, 30], stroke: [255, 255, 255] });
  let spix = 90;
  while (s.w > 1100 && spix > 50) {
    spix -= 6;
    s = renderText(sub, spix, { color: [255, 60, 30], stroke: [255, 255, 255] });
  }
  canvas = composite(canvas, W, H, s.data, s.w, s.h, tx, ty - s.h - 40, 1);

  const png = await encodeImage({ width: W, height: H, data: canvas }, 'png');
  fs.writeFileSync(outPng, png);
  const jpgPath = outPng.replace(/\.png$/, '.jpg');
  const jpg = await encodeImage({ width: W, height: H, data: canvas }, 'jpeg', { quality: 92 });
  fs.writeFileSync(jpgPath, jpg);
  console.log(`✅ ${outPng} (${png.length}B) / ${jpgPath} (${jpg.length}B)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
