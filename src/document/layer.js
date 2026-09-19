// document/layer.js — لایه: واحد پایه‌ی سند (پیکسل + ماسک + خواص ترکیب + لایهٔ تنظیم)
// + گروه‌ها (isGroup / isGroupEnd) و کراپ‌ماسک (clipToBelow) و استایل لایه (style)
let NEXT_ID = 1;
export function newLayerId() { return NEXT_ID++; }
export function resetLayerIds(n = 1) { NEXT_ID = n; }

export class Layer {
  constructor({ id = newLayerId(), name = 'Layer 1', paint = null, opacity = 1, blendMode = 'normal', visible = true, adjustment = null, isGroup = false, isGroupEnd = false, clipToBelow = false, style = null, text = null, mask = null, vectorMask = null } = {}) {
    this.id = id;
    this.name = name;
    this.visible = visible;
    this.opacity = coerceOpacity(opacity);
    this.blendMode = blendMode;
    this.paint = paint;          // document/Paint (برای لایهٔ رستر)
    this.text = text;            // مشخصات متن (لایهٔ متنیِ قابل ویرایش) — src/text/spec.js
    this.mask = mask;            // document/Paint (ماسک پیکسلی)
    this.vectorMask = vectorMask;// { mask: Uint8Array, w, h } — ماسک برداری (فتوشاپ)      // { mask: Uint8Array, w, h } — ماسک برداری (فتوشاپ)
    this.adjustment = adjustment; // engine/adjustments.Adjustment (برای لایهٔ تنظیم)
    this.isGroup = isGroup;      // آغاز یک گروه
    this.isGroupEnd = isGroupEnd;// پایان گروه (نشانگر در لیست مسطح)
    this.clipToBelow = clipToBelow; // clipping mask (برش به آلفای لایهٔ زیرین)
    this.style = style;          // { dropShadow: {...}, stroke: {...} }
  }

  get isAdjustment() { return this.adjustment !== null; }
  get isText() { return this.text !== null && this.text !== undefined; }

  get width()  { return this.paint ? this.paint.w : 0; }
  get height() { return this.paint ? this.paint.h : 0; }

  move(x, y) { this._x = x; this._y = y; }
  get ox() { return this._x || 0; }
  get oy() { return this._y || 0; }
  get offset() { return [this.ox, this.oy]; }
}

export function coerceOpacity(v) {
  v = Number(v);
  if (!isFinite(v)) return 1;
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}
