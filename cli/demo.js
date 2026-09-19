// cli/demo.js — دموی خط لولهٔ کامل: ساخت سند چندلایه → کامپوزیت → فیلتر → ذخیره
// این فایل «ادعای موتور» را به یک مصنوع قابل‌بازرسی تبدیل می‌کند.
import { Document } from '../src/document/document.js';
import { Paint } from '../src/document/paint.js';
import { Layer } from '../src/document/layer.js';
import { encodeImage } from '../src/formats/imageio.js';
import { boxBlur } from '../src/engine/filters.js';
import { floodFill } from '../src/tools/floodfill.js';

const SIZE = 256;

// لایه‌ی ۱ (پایین): گرادیان عمودی آبی→بنفش
function gradientLayer() {
  const p = new Paint(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    const t = y / (SIZE - 1);
    const r = Math.round(30 + 40 * t);
    const g = Math.round(60 + 80 * t);
    const b = Math.round(120 + 200 * t);
    for (let x = 0; x < SIZE; x++) p.setPixel(x, y, r, g, b, 255);
  }
  return new Layer({ name: 'Gradient', paint: p });
}

// لایه‌ی ۲ (بالا): دایرهٔ قرمز نیمه‌شفاف (multiply)
function circleLayer() {
  const p = new Paint(SIZE, SIZE);
  const cx = SIZE / 2, cy = SIZE / 2, R = 90;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 <= R * R) {
        // لبهٔ نرم (anti-aliased)
        const d = Math.sqrt(d2);
        const a = Math.min(1, Math.max(0, R - d + 0.5));
        p.setPixel(x, y, 220, 40, 40, Math.round(a * 255));
      }
    }
  }
  return new Layer({ name: 'Circle', paint: p, blendMode: 'multiply', opacity: 0.9 });
}

const doc = new Document({ width: SIZE, height: SIZE, name: 'lumina-demo' });
doc.addLayer(gradientLayer());
doc.addLayer(circleLayer());

// یک عملیات تعاملی: سطل رنگ روی گوشه‌ی زمینه (برای نمایش ابزارها)
floodFill(doc.layers[0].paint, SIZE, SIZE, 4, 4, 12, [255, 200, 60, 255], false);

// کامپوزیت نهایی
const flat = doc.flatten();
const frame = doc.toRGBA();

// فیلتر بوکس‌بلور ملایم برای صافی خروجی
const soft = boxBlur(frame, SIZE, SIZE, 1);

// ذخیره
const png = await encodeImage({ width: SIZE, height: SIZE, data: soft }, 'png');
const qoi = await encodeImage({ width: SIZE, height: SIZE, data: soft }, 'qoi');

const fs = await import('node:fs');
const path = await import('node:path');
const outDir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'out');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'demo.png'), Buffer.from(png));
fs.writeFileSync(path.join(outDir, 'demo.qoi'), Buffer.from(qoi));

// گزارش
console.log('سند:', doc.name, `${SIZE}×${SIZE}`);
console.log('لایه‌ها:', doc.layers.map((l) => `${l.name}(${l.blendMode}, opacity=${l.opacity})`).join(' + '));
console.log('کاشی‌های لایه‌ی ۱:', doc.layers[0].paint.allocatedTiles(), '| لایه‌ی ۲:', doc.layers[1].paint.allocatedTiles());
console.log('تخمین حافظهٔ سند:', (doc.memoryEstimate() / 1024 / 1024).toFixed(2), 'MB');
console.log('خروجی PNG:', png.length, 'بایت | QOI:', qoi.length, 'بایت');
const px = [0, 0, 0, 0];
flat.getPixel(40, 40, px);
console.log('نمونهٔ پیکسل بعد از سطل‌رنگ (40,40):', Array.from(px).join(','));
