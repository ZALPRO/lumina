// cli/retouch.js — «سخت‌ترین کار فتوشاپ» (رتوش پوست High-End) — الگوریتم واقعی
//
// معادل ۴۵ دقیقه فتوشاپ، در <۱ ثانیه:
//   ۱) skin mask — تشخیص پوست (گرم: R>G>B)؛ چشم/لب/مو دست‌نخورده
//   ۲) blemish detection — لکه = انحراف مزخرف از میانگین محلی (r=3)
//   ۳) healing-brush — پرکردن لکه‌ها با نمونه‌گیری بافت سالم اطراف (annulus)
//   ۴) tone smoothing — صاف‌کردن تناژ پوست ONLY داخل ماسک (حذف قرمزی/سایه)
//   ۵) dodge & burn — روشن‌کردن ملایم مرکز صورت، تیره‌کردن محیط
//   ۶) sharpening + film grain — پایان‌بندی حرفه‌ای
import { readFileSync, writeFileSync } from 'node:fs';
import { decodeImage, encodeImage } from '../src/formats/imageio.js';
import { gaussianBlur, unsharpMask, grain } from '../src/engine/fx.js';
import { encodePngLikePSD } from '../src/formats/psd.js';
import { inpaintTelea } from '../src/engine/inpaint.js';

const IN = process.argv[2];
const OUTDIR = process.argv[3] || 'out';
const MASK_IN = process.argv[4] || null;   // PNG ماسک لکه (سفید=لکه) — مثل کلیک رتوشر
// پارامترها: تنظیم‌پذیر از CLI
const BLEND_HEAL = parseFloat(process.env.HEAL || '1.0');   // قدرت healing
const BLEND_TONE = parseFloat(process.env.TONE || '0.18');  // قدرت tone-smooth
const BLEND_DB   = parseFloat(process.env.DB || '0.06');    // قدرت dodge&burn
const SPOT_THR   = parseFloat(process.env.SPOT_THR || '40'); // آستانهٔ لکهٔ خودکار

function clamp8(v) { v = Math.round(v); return v < 0 ? 0 : (v > 255 ? 255 : v); }

// ماسک پوست [0..1] — نرم، بدون نویز
function skinMask(src, w, h) {
  const raw = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const R = src[p], G = src[p + 1], B = src[p + 2];
    if (R > B + 8 && G > B + 2 && R > G + 2) {
      const lum = 0.299 * R + 0.587 * G + 0.114 * B;
      if (lum > 45 && lum < 245) raw[i] = 1;
    }
  }
  // نرم‌کردن
  const bytes = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = raw[i] * 255;
    bytes[i * 4] = bytes[i * 4 + 1] = bytes[i * 4 + 2] = v; bytes[i * 4 + 3] = 255;
  }
  const soft = gaussianBlur(bytes, w, h, 5); // نویزگیر
  const mask = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = soft[i * 4] / 255;
  return mask;
}

// تشخیص لکه‌ها: داخل پوست، انحراف |src − گاوس(3)| > آستانه
function spotMask(src, skin, w, h, thr) {
  const g3 = gaussianBlur(src, w, h, 3);
  const spot = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    if (skin[i] < 0.5) { spot[i] = 0; continue; }
    const dev = Math.abs(src[p] - g3[p]) + Math.abs(src[p + 1] - g3[p + 1]) + Math.abs(src[p + 2] - g3[p + 2]);
    spot[i] = dev > thr * 3 ? 1 : 0;
  }
  return spot;
}

// healing brush: الگوریتم Telea inpainting (همان healing brush فتوشاپ)
function healSpots(src, spot, w, h) {
  const maskBin = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) maskBin[i] = spot[i] > 0.5 ? 1 : 0;
  return inpaintTelea(src, w, h, maskBin, 7);
}

// گاوس روی بافر float (مقادیر 0..255) → Uint8
function gaussianBlobU8(floatBuf, w, h, radius) {
  const sinceFloat = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h * 4; i++) sinceFloat[i] = clamp8(floatBuf[i]);
  return gaussianBlur(sinceFloat, w, h, radius);
}

// tone smoothing: صاف‌کردن تناژ داخل پوست
function toneSmooth(src, skin, w, h, strength) {
  const bl = gaussianBlur(src, w, h, 10);
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const m = skin[i] * strength;
    out[p] = clamp8(src[p] + (bl[p] - src[p]) * m);
    out[p + 1] = clamp8(src[p + 1] + (bl[p + 1] - src[p + 1]) * m);
    out[p + 2] = clamp8(src[p + 2] + (bl[p + 2] - src[p + 2]) * m);
    out[p + 3] = src[p + 3];
  }
  return out;
}

// dodge & burn با ماسک بیضوی نرم مرکزگرا
function dodgeBurn(src, skin, w, h, strength) {
  const cx = 0.5 * w, cy = 0.45 * h, ax = 0.34 * w, by = 0.42 * h;
  const out = new Uint8ClampedArray(src.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (skin[i / 4 | 0] < 0.4) { out[i] = src[i]; out[i + 1] = src[i + 1]; out[i + 2] = src[i + 2]; out[i + 3] = src[i + 3]; continue; }
    const dx = (x - cx) / ax, dy = (y - cy) / by;
    const d2 = dx * dx + dy * dy;
    let m = 1;
    if (d2 <= 1) m = 1 + 0.12 * strength * (1 - d2);       // داج ملایم مرکز
    else m = 1 - 0.10 * strength * Math.min(1, (Math.sqrt(d2) - 1) * 1.5); // برن اطراف
    out[i] = clamp8(src[i] * m);
    out[i + 1] = clamp8(src[i + 1] * m);
    out[i + 2] = clamp8(src[i + 2] * m);
    out[i + 3] = src[i + 3];
  }
  return out;
}

async function main() {
  if (!IN) { console.log('usage: node cli/retouch.js <photo> [outdir]'); process.exit(1); }
  console.log('▶ Lumina High-End Skin Retouch — healing-brush + FS + D&B');
  console.log(`  input: ${IN}  (spot_thr=${SPOT_THR}, heal=${BLEND_HEAL}, tone=${BLEND_TONE}, db=${BLEND_DB})`);

  const buf = new Uint8Array(readFileSync(IN));
  const dec = await decodeImage(buf);
  const W = dec.width, H = dec.height;
  const src = dec.data;
  console.log(`  decoded ${W}×${H} (${buf.length} B)`);
  const t0 = Date.now();

  // ۱) skin mask
  const skin = skinMask(src, W, H);
  console.log(`  1) skin mask: ${Date.now() - t0}ms`);

  // ۲) blemish detection + healing
  let spot = spotMask(src, skin, W, H, SPOT_THR);
  if (MASK_IN) {
    // ماسک دستی (براش رتوشر) — PNG سفید = لکه
    const mb = new Uint8Array(readFileSync(MASK_IN));
    const md = await decodeImage(mb);
    for (let i = 0; i < W * H; i++) {
      const p = i * 4, mp = i * 4;
      // اگر ابعاد یکی بود؛ روشنایی ماسک
      const px = md.data.slice(mp, mp + 4);
      const lum = 0.299 * (px[0] || 0) + 0.587 * (px[1] || 0) + 0.114 * (px[2] || 0);
      if (lum > 128 && skin[i] > 0.3) spot[i] = 1;
    }
  }
  let nsp = 0; for (let i = 0; i < W * H; i++) nsp += spot[i];
  const healed = healSpots(src, spot, W, H);
  console.log(`  2) heal ${nsp} blemish px: ${Date.now() - t0}ms`);

  // ۳) tone smoothing
  const tone = toneSmooth(healed, skin, W, H, BLEND_TONE);
  console.log(`  3) tone smoothing: ${Date.now() - t0}ms`);

  // ۴) dodge & burn
  const db = dodgeBurn(tone, skin, W, H, BLEND_DB);
  console.log(`  4) dodge & burn: ${Date.now() - t0}ms`);

  // ۵) پایان‌بندی
  const sharp = unsharpMask(db, W, H, { amount: 0.3, radius: 1.0, threshold: 3 });
  const final = grain(sharp, W, H, { intensity: 3, seed: 12345 });
  console.log(`  5) finish: ${Date.now() - t0}ms`);

  // ذخیره
  const png = await encodeImage({ width: W, height: H, data: final }, 'png');
  const jpg = await encodeImage({ width: W, height: H, data: final }, 'jpeg', { quality: 93 });
  const psd = encodePngLikePSD({ width: W, height: H, data: final });
  const base = `${OUTDIR}/retouched-${(IN.split('/').pop() || 'photo').replace(/\.[^.]+$/, '')}`;
  writeFileSync(base + '.png', png);
  writeFileSync(base + '.jpg', jpg);
  writeFileSync(base + '.psd', psd);

  const maskPng = await encodeImage({ width: W, height: H, data: maskView(skin, W, H) }, 'png');
  writeFileSync(`${base}.mask.png`, maskPng);

  let mae = 0;
  for (let i = 0; i < W * H * 3; i++) mae += Math.abs(final[i] - src[i]);
  mae /= W * H * 3;

  console.log(`\n✅ ${base}.png / .jpg / .psd / .mask.png`);
  console.log(`📊 MAE vs input = ${mae.toFixed(2)}`);
  console.log(`⏱ ${Date.now() - t0}ms — معادل ~45 دقیقه فتوشاپ`);
}

function maskView(mask, w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = mask[i] * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  return d;
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
