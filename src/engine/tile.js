// tile.js — کاشی ۲۵۶×۲۵۶؛ بلوک پایه‌ی حافظه‌ی تصویر (الگوی Krita/فتوشاپ)
// پیکسل‌ها به صورت RGBA مستقیم (non-premultiplied) ۸ بیتی ذخیره می‌شوند تا در
// فاز بعد بدون تغییر رابط، به نصفه (float16) ارتقا پیدا کنیم.
export const TILE_SIZE = 256;

export class Tile {
  constructor(tx = 0, ty = 0) {
    this.tx = tx;          // ایندکس کاشی در محور x
    this.ty = ty;          // ایندکس کاشی در محور y
    this.w = TILE_SIZE;
    this.h = TILE_SIZE;
    this.data = null;      // Uint8ClampedArray به طول w*h*4 — null یعنی کاشی خالی/شفاف
  }
  get x() { return this.tx * TILE_SIZE; }
  get y() { return this.ty * TILE_SIZE; }
  get allocated() { return this.data !== null; }

  allocate() {
    if (!this.data) this.data = new Uint8ClampedArray(this.w * this.h * 4); // صفر = شفاف
    return this.data;
  }

  idx(lx, ly) { return (ly * this.w + lx) * 4; }

  get(lx, ly, out) {
    if (!this.data) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; return out; }
    const i = this.idx(lx, ly);
    out[0] = this.data[i]; out[1] = this.data[i + 1]; out[2] = this.data[i + 2]; out[3] = this.data[i + 3];
    return out;
  }

  set(lx, ly, r, g, b, a) {
    if (!this.data) this.allocate();
    const i = this.idx(lx, ly);
    this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; this.data[i + 3] = a;
  }

  isEmpty() {
    if (!this.data) return true;
    const d = this.data;
    for (let i = 3; i < d.length; i += 4) { if (d[i] !== 0) return false; }
    return true;
  }
}
