// document/document.js — سند: ظرف لایه‌ها + مشخصات رنگ + API کامپوزیت
import { Paint } from './paint.js';
import { Layer, resetLayerIds } from './layer.js';
import { Composer } from './composite.js';
import { MemoryEstimate } from '../utils/memory.js';

export class Document {
  constructor({ width = 0, height = 0, bitDepth = 8, colorSpace = 'sRGB', name = 'Untitled' } = {}) {
    this.width = width;
    this.height = height;
    this.bitDepth = bitDepth;      // 8 | 16 | 32 (رزرو برای فاز نصفه)
    this.colorSpace = colorSpace;  // 'sRGB' | 'AdobeRGB' | 'Linear' | 'ProPhoto'...
    this.name = name;
    this.layers = [];              // آیتم ۰ = پایین، آخر = بالا
    this.composer = new Composer(width, height);
    this.mem = new MemoryEstimate();
    this.history = null;           // فاز بعد: Command pattern / snapshots
  }

  get width()  { return this._w; }
  set width(v) { this._w = v; }
  get height() { return this._h; }
  set height(v) { this._h = v; }

  addLayer(layer, index) {
    if (index === undefined || index < 0 || index > this.layers.length) {
      this.layers.push(layer);
    } else {
      this.layers.splice(index, 0, layer);
    }
    this.composer.invalidate();
    return layer;
  }

  removeLayer(layer) {
    const i = this.layers.indexOf(layer);
    if (i >= 0) { this.layers.splice(i, 1); this.composer.invalidate(); return true; }
    return false;
  }

  get topLayer() { return this.layers[this.layers.length - 1] || null; }

  // کامپوزیت کامل → Paint (کش داخلی composer)
  flatten() {
    this.composer.render(this.layers);
    return this.composer.result;
  }

  // تخمین حافظهٔ سند (بدون ساخت بافر)
  memoryEstimate() {
    const layersBuf = this.layers.reduce((sum, l) => {
      let s = 0;
      if (l.paint) s += MemoryEstimate.layerBytes(l.paint.w, l.paint.h);
      if (l.mask) s += MemoryEstimate.layerBytes(l.mask.w, l.mask.h);
      return sum + s;
    }, 0);
    return layersBuf + MemoryEstimate.layerBytes(this.width, this.height); // + buffer خروجی
  }

  // صدور نهایی به فریم RGBA (برای ذخیره/پیش‌نمایش)
  toRGBA() {
    const flat = this.flatten();
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    const px = new Array(4);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        flat.getPixel(x, y, px);
        const i = (y * this.width + x) * 4;
        out[i] = px[0]; out[i + 1] = px[1]; out[i + 2] = px[2]; out[i + 3] = px[3];
      }
    }
    return out;
  }

  // سازندهٔ سریع: یک تصویر صاف به سند (لایهٔ پس‌زمینه)
  static fromRGBA(frame, w, h, opts = {}) {
    const doc = new Document({ width: w, height: h, ...opts });
    const paint = new Paint(w, h);
    paint.writeFromRGBA(frame, w, h);
    doc.addLayer(new Layer({ name: opts.layerName || 'Background', paint }));
    return doc;
  }
}
