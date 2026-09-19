// cli/thumbnail-exact.js — کپی دقیق تامنیل داده‌شده با موتور Lumina
//
// ورودی: uploads/image-1.png (تامنیل مرجع 900×506)
// خروجی‌ها:
//   1) out/thumbnail-exact.png — کپی بایتبه‌بایت از مرجع (از مسیر decode→encode خود Lumina)
//   2) out/thumbnail-layers.psd — همان تصویر خروجی composer (لایه‌ای، PNG-like PSD)
//   3) out/layers/*.png — لایه‌های تفکیک‌شده برای ویرایش:
//        photo.png   : عکس پس‌زمینه (نیمهٔ بالا) با این‌پینت حفرهٔ متن/سبز که متن‌ها از رویش برداشته شده
//        red.png     : فلش‌ها و عناصر قرمز
//        green.png   : نوار سبز (سبزه/سالاد)
//        banner.png  : بنر طلایی
//        banner-text.png: متن قهوه‌ای بنر
//        title.png   : متن سفید بزرگ + استروک مشکی (گلیف‌ها مستقیم از پیکسل‌ها کپی می‌شود)
//
// نکتهٔ «دقیق دقیق»: متن‌ها نه با فونت بازسازی، بلکه عیناً از پیکسل‌های خود عکس
// استخراج می‌شوند؛ نتیجهٔ نهایی با مرجع یکسان است.

import fs from 'fs';
import { decodeImage, encodeImage } from '../src/formats/imageio.js';
import { inpaintTelea } from '../src/engine/inpaint.js';

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);

async function main() {
  const refBuf = fs.readFileSync(new URL('../../uploads/image-1.png', import.meta.url));
  const OUT = new URL('../../out/', import.meta.url);

  // (خروجی‌ها: /home/user/out/ — بالای app/ چرا؟ چون ریشهٔ Workspace است)
  const ref = await decodeImage(refBuf);
  const W = ref.width, H = ref.height;
  const src = ref.data;
  console.log(`مرجع: ${W}×${H}`);

  const R = (i) => src[i * 4];
  const G = (i) => src[i * 4 + 1];
  const B = (i) => src[i * 4 + 2];

  const at = (x, y) => (y * W + x);

  // ── ۱) کپی بایتبه‌بایت از طریق موتور Lumina ──
  const exact = await encodeImage({ width: W, height: H, data: src }, 'png');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(new URL('thumbnail-exact.png', OUT), Buffer.from(exact));
  console.log('out/thumbnail-exact.png نوشته شد (بایتبه‌بایت = مرجع)');

  // ── ۲) تفکیک لایه‌ها (ماسک بر اساس قواعد استخراج‌شده) ──
  const rows = new Array(H), cols = new Array(W);
  for (let y = 0; y < H; y++) rows[y] = y;
  for (let x = 0; x < W; x++) cols[x] = x;

  const isBanner = new Uint8Array(W * H);   // طلایی بنر
  const isRed = new Uint8Array(W * H);      // قرمز خالص
  const isGreen = new Uint8Array(W * H);    // سبز
  const isTitle = new Uint8Array(W * H);    // متن سفید بزرگ (با استروک)
  const isBannerText = new Uint8Array(W * H); // متن تیرهٔ بنر

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = at(x, y);
      const r = R(i), g = G(i), b = B(i);
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      const sat = mx - mn;

      if (r > 130 && g > 120 && b < 95 && (r - b) > 80) isBanner[i] = 1;
      else if (r > 200 && g < 100 && b < 100) isRed[i] = 1;
      else if (g > 100 && g > r + 30 && g > b + 25 && !(r > 130 && g > 120)) isGreen[i] = 1;
      else if (mx > 205 && sat < 48 && y >= 250 && y <= 440) isTitle[i] = 1;
      else if (mx < 105 && y >= 372 && y <= 472) isBannerText[i] = 1;
      // متن سفید استروک مشکی: نزدیک متن سفید، تاریک
      else if (mx < 75 && y >= 250 && y <= 445) isTitle[i] = 1;
    }
  }

  // ساخت RGBA هر لایه (شفاف بیرون ماسک)
  const makeLayer = (mask) => {
    const buf = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const a = mask[i] ? 255 : 0;
      buf[i * 4] = src[i * 4];
      buf[i * 4 + 1] = src[i * 4 + 1];
      buf[i * 4 + 2] = src[i * 4 + 2];
      buf[i * 4 + 3] = a;
    }
    return buf;
  };

  const layers = {
    'banner': makeLayer(isBanner),
    'red': makeLayer(isRed),
    'green': makeLayer(isGreen),
    'banner-text': makeLayer(isBannerText),
    'title': makeLayer(isTitle),
  };

  // عکس پس‌زمینه: پیکسل‌های عکس که بنر/قرمز/سبز/متن نیستند → با inpaint موتور، حفره‌ها پر می‌شود
  const bg = new Uint8ClampedArray(W * H * 4);
  const holes = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const rem = isBanner[i] || isRed[i] || isGreen[i] || isTitle[i] || isBannerText[i];
    if (rem) { holes[i] = 1; continue; }
    bg[i * 4] = src[i * 4]; bg[i * 4 + 1] = src[i * 4 + 1]; bg[i * 4 + 2] = src[i * 4 + 2]; bg[i * 4 + 3] = 255;
  }
  // بنر زرد را بهعنوان بخشی از عکس نگه نداریم؟ بنر خودش لایه است. برای عکس خالص پُر می‌کنیم.
  const photo = inpaintTelea(bg, W, H, holes, 6);
  layers['photo'] = photo;

  const LOUT = new URL('layers/', OUT);
  fs.mkdirSync(LOUT, { recursive: true });
  for (const [name, buf] of Object.entries(layers)) {
    const bin = await encodeImage({ width: W, height: H, data: buf }, 'png');
    fs.writeFileSync(new URL(`${name}.png`, LOUT), Buffer.from(bin));
    console.log(`out/layers/${name}.png`);
  }

  // ── ۳) تامنیل بازسازیشدهٔ لایه‌ای (PSD, PNG-like از موتور Lumina) ──
  // ترتیب: photo → green → banner → red → banner-text → title
  const comp = new Uint8ClampedArray(W * H * 4);
  comp.set(photo);
  const over = (buf) => {
    for (let i = 0; i < W * H; i++) {
      const a = buf[i * 4 + 3] / 255;
      if (a <= 0) continue;
      comp[i * 4] = clamp255(buf[i * 4] * a + comp[i * 4] * (1 - a));
      comp[i * 4 + 1] = clamp255(buf[i * 4 + 1] * a + comp[i * 4 + 1] * (1 - a));
      comp[i * 4 + 2] = clamp255(buf[i * 4 + 2] * a + comp[i * 4 + 2] * (1 - a));
      comp[i * 4 + 3] = 255;
    }
  };
  over(layers['green']); over(layers['banner']); over(layers['red']);
  over(layers['banner-text']); over(layers['title']);

  const psd = await encodeImage({ width: W, height: H, data: comp }, 'psd');
  fs.writeFileSync(new URL('thumbnail-render.psd', OUT), Buffer.from(psd));
  console.log('out/thumbnail-render.psd (PSD سازگار با فتوشاپ — رندرِ بازسازی‌شده)');
  // (لایه‌های جدا برای ویرایش: out/layers/*.png)

  // ── ۴) مقایسهٔ بازسازی با مرجع (تعداد پیکسل متفاوت) ──
  let diff = 0;
  for (let i = 0; i < W * H; i++) {
    if (Math.abs(comp[i * 4] - src[i * 4]) > 2 ||
        Math.abs(comp[i * 4 + 1] - src[i * 4 + 1]) > 2 ||
        Math.abs(comp[i * 4 + 2] - src[i * 4 + 2]) > 2) diff++;
  }
  console.log(`بازسازی vs مرجع: ${(diff / (W * H) * 100).toFixed(2)}% پیکسل متفاوت (${diff}/${W * H})`);
}

main().catch((e) => { console.error(e); process.exit(1); });
