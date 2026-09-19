// scripts/bench.js — بنچمارک موتور: کامپوزیت کاشی‌ایِ ما در برابر روش سادهٔ خطی
import { Document } from '../src/document/document.js';
import { Paint } from '../src/document/paint.js';
import { Layer } from '../src/document/layer.js';
import { compositePixelU8 } from '../src/engine/blend.js';
import { MemoryEstimate } from '../src/utils/memory.js';

function randomLayer(w, h, seed) {
  const p = new Paint(w, h);
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  // فقط یک چهارم پیکسل‌ها را می‌نویسیم (واقع‌گرایانه: لایهٔ عکس پر نیست)
  for (let y = 0; y < h; y++) {
    if (rnd() < 0.75) continue;         // skip
    for (let x = 0; x < w; x++) {
      if (rnd() < 0.4) continue;
      p.setPixel(x, y, (rnd() * 255) | 0, (rnd() * 255) | 0, (rnd() * 255) | 0, (rnd() * 255) | 0);
    }
  }
  return p;
}

function bench(name, fn, iters = 1) {
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const ms = (performance.now() - t0) / iters;
  console.log(`  ${name.padEnd(46)} ${ms.toFixed(1).padStart(9)} ms`);
  return ms;
}

const W = 2048, H = 2048;

console.log(`\nبنچمارک کامپوزیت ${W}×${H} (۴ لایه)`);

// سند ما: ۳ لایه + پس‌زمینه
const doc = new Document({ width: W, height: H });
for (let i = 0; i < 4; i++) {
  doc.addLayer(new Layer({
    name: `Layer ${i}`,
    paint: randomLayer(W, H, 1000 + i),
    blendMode: ['normal', 'multiply', 'screen', 'overlay'][i],
    opacity: [1, 0.5, 0.8, 1][i],
  }));
}

// --- روش ما: کامپوزیت کاشی‌ای + dostęp به نتیجه ---
bench('کامپوزیتور کاشی‌ای + خروجی RGBA کامل', () => {
  doc.composer.invalidate();
  doc.flatten();
  doc.toRGBA();
});

// --- روش ساده: حلقهٔ خطی کل بافر با همان بلندینگ ---
const flatLayers = doc.layers.map((l) => {
  const buf = new Uint8ClampedArray(W * H * 4);
  const px = [0, 0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    l.paint.getPixel(x, y, px);
    const i = (y * W + x) * 4;
    buf[i] = px[0]; buf[i+1] = px[1]; buf[i+2] = px[2]; buf[i+3] = px[3];
  }
  return { buf, blendMode: l.blendMode, opacity: l.opacity };
});

bench('حلقهٔ خطی ساده (بدون کاشی/کش)', () => {
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      let br = 0, bg = 0, bb = 0, ba = 0;
      for (const L of flatLayers) {
        const res = compositePixelU8([br, bg, bb, ba], [L.buf[i], L.buf[i+1], L.buf[i+2], L.buf[i+3]], L.blendMode, L.opacity);
        br = res[0]; bg = res[1]; bb = res[2]; ba = res[3];
      }
      out[i] = br; out[i+1] = bg; out[i+2] = bb; out[i+3] = ba;
    }
  }
});

// --- حافظه ---
const est = doc.memoryEstimate();
const naive = W * H * 4 * 5 + W * H * 4;
console.log(`\nحافظهٔ تخمینی سند ما: ${MemoryEstimate.fmt(est)} | روش سادهٔ تمام-بافر: ${MemoryEstimate.fmt(naive)}`);
console.log(`کاشی‌های واقعیِ تخصیص‌یافته: ${doc.layers.reduce((s, l) => s + l.paint.allocatedTiles(), 0)} (از ۶۴ ممکن در هر لایه)`);
