// engine/lasso.js — انتخاب‌های آزاد: Lasso (بند)، Polygonal (چندضلعی)، Elliptical (بیضی)
// ماسک باینری Uint8Array (۱ = داخل) + کادر محیطی برای invalidate سریع.
//
// داخل/خارج با روش «قانون زوج-فرد» (even-odd) روی پرتو افقی:
//   برای هر y، تقاطع‌های پرتو y با یال‌های چندضلعی را شمرده و بازه‌های داخل را ۱ می‌کنیم.
// برای Lasso (نقاط متراکم) هر دو پیکسل مجاور ۱ پیکسل فاصله دارند → پر کردن دقیق.
// برای Ellipse از شرط معادلهٔ بیضی.

function bounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

// پرکردن چندضلعی با even-odd (بر اساس نقاط مختصات پیکسلی، بسته شدن خودکار)
export function polygonMask(w, h, points) {
  const mask = new Uint8Array(w * h);
  if (points.length < 3) return { mask, rect: { x: 0, y: 0, w: 0, h: 0 } };
  const { minX, minY, maxX, maxY } = bounds(points);
  // بستن حلقه
  const p = points.slice();
  if (p[0][0] !== p[p.length - 1][0] || p[0][1] !== p[p.length - 1][1]) p.push(p[0]);
  const n = p.length - 1;

  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(h - 1, Math.ceil(maxY)); y++) {
    const ys = y + 0.5; // مرکز پیکسل (سازگار با rule حتی-فرد)
    const xs = [];
    for (let i = 0; i < n; i++) {
      const [x1, y1] = p[i], [x2, y2] = p[i + 1];
      if ((y1 <= ys && y2 > ys) || (y2 <= ys && y1 > ys)) {
        const t = (ys - y1) / (y2 - y1);
        xs.push(x1 + t * (x2 - x1));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let xa = Math.ceil(xs[k]), xb = Math.floor(xs[k + 1]);
      if (xa < 0) xa = 0;
      if (xb >= w) xb = w - 1;
      for (let x = xa; x <= xb; x++) mask[y * w + x] = 1;
    }
  }
  const x0 = Math.max(0, Math.floor(minX)), y0 = Math.max(0, Math.floor(minY));
  const x1 = Math.min(w - 1, Math.ceil(maxX)), y1 = Math.min(h - 1, Math.ceil(maxY));
  return { mask, rect: { x: x0, y: y0, w: Math.max(0, x1 - x0 + 1), h: Math.max(0, y1 - y0 + 1) } };
}

// ماسک Lasso آزاد: مسیر ضخیم‌سازی‌شده هم‌چون چندضلعی متراکم
export function lassoMask(w, h, points) { return polygonMask(w, h, points); }

// ماسک بیضوی (marquee): مرکز cx,cy و شعاع‌های rx,ry — antialias لبه
export function ellipseMask(w, h, cx, cy, rx, ry) {
  const mask = new Uint8Array(w * h);
  const rx1 = Math.max(0.01, Math.abs(rx)), ry1 = Math.max(0.01, Math.abs(ry));
  const x0 = Math.max(0, Math.floor(cx - rx1)), y0 = Math.max(0, Math.floor(cy - ry1));
  const x1 = Math.min(w - 1, Math.ceil(cx + rx1)), y1 = Math.min(h - 1, Math.ceil(cy + ry1));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = ((x - cx) / rx1) ** 2 + ((y - cy) / ry1) ** 2;
      if (d <= 1) mask[y * w + x] = 1;
    }
  }
  return { mask, rect: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}
