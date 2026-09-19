// rect.js — مستطیل عدد صحیح برای نواحی، کاشی‌ها و انتخاب‌ها
export class Rect {
  constructor(x = 0, y = 0, w = 0, h = 0) {
    this.x = x; this.y = y; this.w = w; this.h = h;
  }
  get left()   { return this.x; }
  get top()    { return this.y; }
  get right()  { return this.x + this.w; }
  get bottom() { return this.y + this.h; }
  get empty()  { return this.w <= 0 || this.h <= 0; }
  contains(x, y) {
    return x >= this.x && x < this.right && y >= this.y && y < this.bottom;
  }
  intersects(o) {
    return this.x < o.right && o.x < this.right && this.y < o.bottom && o.y < this.bottom;
  }
  intersect(o) {
    const x = Math.max(this.x, o.x);
    const y = Math.max(this.y, o.y);
    const r = Math.min(this.right, o.right);
    const b = Math.min(this.bottom, o.bottom);
    if (r <= x || b <= y) return new Rect(0, 0, 0, 0);
    return new Rect(x, y, r - x, b - y);
  }
  clone() { return new Rect(this.x, this.y, this.w, this.h); }
}
