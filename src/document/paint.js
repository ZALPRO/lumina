// document/paint.js — بافر پیکسلیِ کاشی‌محور و تنبل (lazy/sparse)
// الگوی حافظه‌ای ضد فتوشاپ: کاشی فقط وقتی ساخته می‌شود که پیکسلی در آن نوشته شود.
import { Tile, TILE_SIZE } from '../engine/tile.js';
import { TILE_BYTES } from '../utils/memory.js';

export class Paint {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.tilesX = Math.ceil(w / TILE_SIZE);
    this.tilesY = Math.ceil(h / TILE_SIZE);
    this._tiles = new Map(); // key = ty * tilesX + tx
  }

  key(tx, ty) { return ty * this.tilesX + tx; }

  hasTile(tx, ty) {
    return this._tiles.has(this.key(tx, ty)) && this._tiles.get(this.key(tx, ty)).allocated;
  }

  getTile(tx, ty, create = false) {
    if (tx < 0 || ty < 0 || tx >= this.tilesX || ty >= this.tilesY) return null;
    const k = this.key(tx, ty);
    let t = this._tiles.get(k);
    if (!t) {
      if (!create) return null;
      t = new Tile(tx, ty);
      this._tiles.set(k, t);
    }
    return t;
  }

  getPixel(x, y, out) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; return out; }
    const t = this.getTile((x / TILE_SIZE) | 0, (y / TILE_SIZE) | 0);
    if (!t || !t.allocated) { out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; return out; }
    return t.get(x % TILE_SIZE, y % TILE_SIZE, out);
  }

  setPixel(x, y, r, g, b, a) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const t = this.getTile((x / TILE_SIZE) | 0, (y / TILE_SIZE) | 0, true);
    this.#detachIfShared(t);
    t.set(x % TILE_SIZE, y % TILE_SIZE, r, g, b, a);
  }

  // نوشتن مستقیم از فریم کامل (تبدیل از بافر بزرگ به توزیع کاشی‌ها)
  writeFromRGBA(frame, fw, fh, dx = 0, dy = 0) {
    for (let y = 0; y < fh; y++) {
      for (let x = 0; x < fw; x++) {
        const src = (y * fw + x) * 4;
        const a = frame[src + 3];
        if (a === 0) continue; // بهینه: کاشی شفاف ساخته نمی‌شود
        this.setPixel(dx + x, dy + y, frame[src], frame[src + 1], frame[src + 2], a);
      }
    }
  }

  // پاک کردن مستطیل با کشیدن رنگ به‌صورت کامل روی همه (کشیدن برخلاف فتوشاپ، تمیز و سریع)
  clearRect(rect, r = 0, g = 0, b = 0, a = 0) {
    const opaque = a !== 0;
    for (let ty = 0; ty < this.tilesY; ty++) {
      for (let tx = 0; tx < this.tilesX; tx++) {
        const cx = tx * TILE_SIZE, cy = ty * TILE_SIZE;
        // برخورد کاشی با rect
        const ix = Math.max(rect.x, cx), iy = Math.max(rect.y, cy);
        const ix2 = Math.min(rect.x + rect.w, cx + TILE_SIZE);
        const iy2 = Math.min(rect.y + rect.h, cy + TILE_SIZE);
        if (ix >= ix2 || iy >= iy2) continue; // بدون برخورد
        const t = this.getTile(tx, ty, opaque);
        if (!t) continue; // غیرمات + کاشی خالی → چیزی برای نوشتن نیست
        this.#detachIfShared(t);
        t.allocate();
        for (let y = iy; y < iy2; y++) {
          for (let x = ix; x < ix2; x++) {
            t.set(x - cx, y - cy, r, g, b, a);
          }
        }
      }
    }
  }

  // پاک کردن کامل
  clear() {
    this._tiles.clear();
  }

  allocatedTiles() {
    let n = 0;
    for (const t of this._tiles.values()) if (t.allocated && !t.isEmpty()) n++;
    return n;
  }

  // کپی عمیق (COW واقعی): هر کاشی بافر مستقل می‌گیرد؛ ویرایشِ کپی هرگز اصل را عوض نمی‌کند.
  clone() {
    const p = new Paint(this.w, this.h);
    for (const [k, t] of this._tiles) {
      if (!t.data) continue;
      const nt = p.getTile(t.tx, t.ty, true);
      nt.data = new Uint8ClampedArray(t.data);   // کپی واقعی بایت‌ها (نه اشتراک ارجاع)
    }
    return p;
  }

  // کلونِ COW ارزان‌وقیمت: فقط «متادیتا» را اشتراکی می‌گیرد؛ اولین setPixel عمیق کپی می‌کند.
  // (برای دوبلهٔ سنگینِ لایه‌ها، بدون رم اضافی در لحظهٔ دوبله)
  cloneCoW() {
    const p = new Paint(this.w, this.h);
    this.shareTilesInto(p);
    return p;
  }

  shareTilesInto(dst) {
    // اشتراک ارجاعیِ کاشی‌ها (بدون کپی) + علامت COW: اولین ویرایش باید detach کند.
    for (const t of this._tiles.values()) {
      const nt = dst.getTile(t.tx, t.ty, true);
      nt.data = t.data;               // اشتراک تا اولین نوشتن
      nt._cowShared = true;           // پرچم: این کاشی مشترک است
      t._cowShared = true;            // پرچم: کاشی مبدأ هم مشترک است
    }
  }

  // اگر کاشی «مشترک» است، قبل از نوشتن باید عمیق کپی شود (detach) — ماهیت COW.
  #detachIfShared(t) {
    if (t._cowShared) {
      if (t.data) t.data = new Uint8ClampedArray(t.data);
      t._cowShared = false;
    }
  }

  allocatedBytes() {
    let n = 0;
    for (const t of this._tiles.values()) if (t.allocated && !t.isEmpty()) n += TILE_BYTES;
    return n;
  }

  // هر کاشی: برای موتور رندر و صادرات
  forEachTile(fn) {
    for (const t of this._tiles.values()) if (t.allocated && !t.isEmpty()) fn(t);
  }
}
