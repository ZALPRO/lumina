// document/history.js — Undo/Redo بر پایه‌ی «اسنپ‌شات کاشی» (نه snapshot کل سند)
// چرا بهتر از فتوشاپ: فقط کاشی‌هایی که لمس شده‌اند کپی می‌شوند (چند ده‌کیلوبایت،
// نه کل لایه) → تاریخچهٔ عمیق بدون بلعیدن رم. (مشکل History States فتوشاپ)
export class TileHistory {
  constructor(limit = 200) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get depth() { return this.undoStack.length; }

  // ثبت وضعیت paint «قبل از» تغییر بعدی
  record(paint, label = 'ویرایش') {
    this.undoStack.push({ paint, snap: capturePaint(paint), label });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;   // شاخهٔ redo باطل می‌شود
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return false;
    const now = capturePaint(e.paint);
    restorePaint(e.paint, e.snap);
    this.redoStack.push({ paint: e.paint, snap: now, label: e.label });
    return true;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return false;
    const now = capturePaint(e.paint);
    restorePaint(e.paint, e.snap);
    this.undoStack.push({ paint: e.paint, snap: now, label: e.label });
    return true;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// LayeredHistory — تاریخچهٔ یکپارچه که هم Paint و هم «ساختار سند» را undo می‌کند.
//
// ورودی‌ها دو نوع‌اند:
//   { type:'paint', paint, snap, label }     → برای ضربهٔ قلم/فیلتر/delete
//   { type:'doc',   before, after, label }   → برای add/remove/reorder/blend/opacity/rename لایه
//
// اسنپ‌شات سند «سبک» است: ارجاع لایه‌ها + خواص GUI (بدون کپی pixel data).
// جمع‌شدن paint-data در ورودی paint خودش به‌صورت کاشی‌محور انجام می‌شود.
// تصحیح: snapshot «before/after» هر دو را نگه می‌داریم تا undo/redo قرینه باشد.
export class LayeredHistory {
  constructor(limit = 300) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get depth() { return this.undoStack.length; }

  record(paint, label = 'ویرایش') {
    this.push({ type: 'paint', paint, snap: capturePaint(paint), label });
  }

  recordDoc(doc, label = 'سند') {
    this.push({ type: 'doc', doc, before: captureDoc(doc), label });
  }

  push(entry) {
    if (entry.type === 'doc' && entry.before === null) return;   // سند نامعتبر — ثبت نمی‌شود
    this.undoStack.push(entry);
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return false;
    if (e.type === 'paint') {
      const now = capturePaint(e.paint);
      restorePaint(e.paint, e.snap);
      this.redoStack.push({ type: 'paint', paint: e.paint, snap: now, label: e.label });
    } else {
      const now = captureDoc(e.doc);
      restoreDoc(e.doc, e.before);
      this.redoStack.push({ type: 'doc', doc: e.doc, before: now, label: e.label });
    }
    return true;
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return false;
    if (e.type === 'paint') {
      const now = capturePaint(e.paint);
      restorePaint(e.paint, e.snap);
      this.undoStack.push({ type: 'paint', paint: e.paint, snap: now, label: e.label });
    } else {
      const now = captureDoc(e.doc);
      restoreDoc(e.doc, e.before);   // before همان «بعد»ِ undo است
      this.undoStack.push({ type: 'doc', doc: e.doc, before: now, label: e.label });
    }
    return true;
  }

  get lastLabel() { return this.undoStack.length ? this.undoStack[this.undoStack.length - 1].label : ''; }

  // برچسب همهٔ حالت‌ها (برای پنل History) — حالت صفر یعنی «باز/ساخت سند»
  labels(baseLabel = 'Open') { return [baseLabel, ...this.undoStack.map((e) => e.label)]; }

  // پرش به حالت مشخص (مثل کلیک روی History State در فتوشاپ)
  jumpToDepth(n, baseLabel = 'Open') {
    let moved = false;
    if (n === 'base' || n === '0' || n === 0) { n = 0; } else { n = Number(n); }
    while (this.undoStack.length > n && this.undo()) moved = true;
    while (this.undoStack.length < n && this.redo()) moved = true;
    if (moved) this._lastJump = { baseLabel };
    return moved;
  }
}

// اسنپ‌شات ساختار سند: ارجاع لایه‌ها + خواص GUI. بدون کپی پیکسل (سبک).
export function captureDoc(doc) {
  if (!doc || !Array.isArray(doc.layers)) return null;
  const order = doc.layers.slice();                       // ارجاعِ لایه‌ها
  const gui = order.map((l) => ({
    name: l.name, opacity: l.opacity, blendMode: l.blendMode,
    visible: l.visible, isGroup: l.isGroup, isGroupEnd: l.isGroupEnd,
    clipToBelow: l.clipToBelow, style: l.style ? JSON.parse(JSON.stringify(l.style)) : null,
  }));
  return { order, gui };
}

export function restoreDoc(doc, snap) {
  if (!snap) return false;
  doc.layers.length = 0;                                  // خالی کردن بدون ازدست‌دادن ارجاع‌های بیرونی
  for (const l of snap.order) doc.layers.push(l);
  snap.order.forEach((l, i) => {
    const g = snap.gui[i];
    if (!g) return;
    l.name = g.name; l.opacity = g.opacity; l.blendMode = g.blendMode;
    l.visible = g.visible; l.isGroup = g.isGroup; l.isGroupEnd = g.isGroupEnd;
    l.clipToBelow = g.clipToBelow;
    l.style = g.style ? JSON.parse(JSON.stringify(g.style)) : null;
  });
  if (doc.composer) doc.composer.invalidate();
  return true;
}

// کپی فقط کاشی‌های تخصیص‌شده → Map(key → data)
export function capturePaint(paint) {
  const map = new Map();
  paint.forEachTile((t) => {
    if (t.data) map.set(paint.key(t.tx, t.ty), new Uint8ClampedArray(t.data));
  });
  return map;
}

export function restorePaint(paint, map) {
  paint.clear();
  for (const [k, data] of map) {
    const tx = k % paint.tilesX;
    const ty = (k / paint.tilesX) | 0;
    const t = paint.getTile(tx, ty, true);
    t.data = new Uint8ClampedArray(data);
  }
}
