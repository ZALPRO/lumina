// cli/thumbnail-psd.js — ساخت PSD چندلایهٔ واقعی از لایه‌های استخراج‌شدهٔ تامنیل
// اجرا: node cli/thumbnail-psd.js
// ورودی: out/layers/*.png  →  خروجی: out/thumbnail-layered.psd (لایه‌دار، بازشدنی در فتوشاپ)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../src/formats/png.js';
import { encodeLayeredPSD } from '../src/formats/psd-layers.js';
import { Document } from '../src/document/document.js';
import { Paint } from '../src/document/paint.js';
import { Layer } from '../src/document/layer.js';
import { srgbProfile } from '../src/formats/icc.js';

const LOUT = new URL('../../out/layers/', import.meta.url);
const OUT = new URL('../../out/', import.meta.url);

// ترتیب پشته: پایین → بالا (همان ترتیبی که کامپوزیت تامنیل را می‌سازد)
const STACK = [
  ['photo.png', 'Photo (inpainted background)', 1],
  ['green.png', 'Green band', 1],
  ['banner.png', 'Golden banner', 1],
  ['red.png', 'Red arrows', 1],
  ['banner-text.png', 'Banner text', 1],
  ['title.png', 'Headline text', 1],
];

const doc = null;
let width = 0, height = 0;
const layers = [];

for (const [file, name] of STACK) {
  const path = fileURLToPath(new URL(file, LOUT));
  if (!fs.existsSync(path)) { console.warn(`⚠️  پیدا نشد: ${file}`); continue; }
  const dec = await decodePng(new Uint8Array(fs.readFileSync(path)));
  if (!width) { width = dec.width; height = dec.height; }
  const p = new Paint(width, height);
  for (let y = 0; y < Math.min(height, dec.height); y++) {
    for (let x = 0; x < Math.min(width, dec.width); x++) {
      const i = (y * dec.width + x) * 4;
      const a = dec.data[i + 3];
      if (!a) continue;
      p.setPixel(x, y, dec.data[i], dec.data[i + 1], dec.data[i + 2], a);
    }
  }
  layers.push(new Layer({ name, paint: p }));
}

const d = new Document({ width, height, name: 'thumbnail' });
for (const l of layers) d.addLayer(l);

// کامپوزیت نهایی از خروجی PNG اصلی (تا رنگ‌ها بیت‌به‌بیت همان تامنیل باشد)
const flatPng = fileURLToPath(new URL('thumbnail-exact.png', OUT));
let composite;
if (fs.existsSync(flatPng)) {
  composite = (await decodePng(new Uint8Array(fs.readFileSync(flatPng)))).data;
} else {
  composite = d.toRGBA();
}

// نسخهٔ اصلی (RLE — سازگارترین حالت با فتوشاپ)
const psd = await encodeLayeredPSD(d, { composite, icc: srgbProfile() });
fs.writeFileSync(fileURLToPath(new URL('thumbnail-layered.psd', OUT)), Buffer.from(psd));
console.log(`✅ out/thumbnail-layered.psd — ${width}×${height}، ${layers.length} لایهٔ واقعی، RLE، ${(psd.length / 1024 / 1024).toFixed(2)} مگابایت`);
for (const l of layers) console.log(`     - ${l.name}`);

// نسخهٔ فشرده (ZIP + Prediction) — حجم کمتر با همان پیکسل‌ها
const zip = await encodeLayeredPSD(d, { composite, icc: srgbProfile(), compression: 'zipPred' });
fs.writeFileSync(fileURLToPath(new URL('thumbnail-layered-zip.psd', OUT)), Buffer.from(zip));
console.log(`✅ out/thumbnail-layered-zip.psd — ZIP+Prediction، ${(zip.length / 1024 / 1024).toFixed(2)} مگابایت ` +
  `(${Math.round((1 - zip.length / psd.length) * 100)}٪ کوچک‌تر)`);

// نسخهٔ CMYK (چهار رنگ — برای چاپ)
const cmyk = await encodeLayeredPSD(d, { composite, icc: null, compression: 'zip', colorMode: 'cmyk' });
fs.writeFileSync(fileURLToPath(new URL('thumbnail-layered-cmyk.psd', OUT)), Buffer.from(cmyk));
console.log(`✅ out/thumbnail-layered-cmyk.psd — حالت CMYK (۴ کانال)، ${(cmyk.length / 1024 / 1024).toFixed(2)} مگابایت`);
