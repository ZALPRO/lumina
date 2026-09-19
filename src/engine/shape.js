// engine/shape.js — رسم شکل‌های پایه (مستطیل، بیضی، خط) قابل تست
// هر تابع روی Paint با رنگ مربع/خط می‌کشد

export function fillRectShape(paint, x0, y0, x1, y1, [r, g, b, a]) {
  const minX = Math.floor(Math.min(x0, x1)), maxX = Math.ceil(Math.max(x0, x1));
  const minY = Math.floor(Math.min(y0, y1)), maxY = Math.ceil(Math.max(y0, y1));
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    paint.setPixel(x, y, r, g, b, a);
  }
}

export function strokeRectShape(paint, x0, y0, x1, y1, [r, g, b, a], thickness = 1) {
  const minX = Math.floor(Math.min(x0, x1)), maxX = Math.ceil(Math.max(x0, x1));
  const minY = Math.floor(Math.min(y0, y1)), maxY = Math.ceil(Math.max(y0, y1));
  const t = Math.max(1, thickness | 0);
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const inside = (x - minX < t) || (maxX - x < t) || (y - minY < t) || (maxY - y < t);
    if (inside) paint.setPixel(x, y, r, g, b, a);
  }
}

export function fillEllipse(paint, cx, cy, rx, ry, [r, g, b, a]) {
  const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
  const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d <= 1) paint.setPixel(x, y, r, g, b, a);
  }
}

export function strokeEllipse(paint, cx, cy, rx, ry, [r, g, b, a], thickness = 1) {
  const t = Math.max(1, thickness | 0);
  const x0 = Math.floor(cx - rx), x1 = Math.ceil(cx + rx);
  const y0 = Math.floor(cy - ry), y1 = Math.ceil(cy + ry);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dd = ((x - cx) / (rx + t)) ** 2 + ((y - cy) / (ry + t)) ** 2;
    const dInner = ((x - cx) / Math.max(1, rx - t)) ** 2 + ((y - cy) / Math.max(1, ry - t)) ** 2;
    if (dd <= 1 && dInner >= 1) paint.setPixel(x, y, r, g, b, a);
  }
}

// خط برسنهام ضخیم
export function drawLine(paint, x0, y0, x1, y1, [r, g, b, a], thickness = 1) {
  const t = Math.max(1, thickness | 0);
  const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let x = x0, y = y0;
  const dot = (px, py) => {
    for (let oy = -Math.floor(t / 2); oy <= Math.floor(t / 2); oy++)
      for (let ox = -Math.floor(t / 2); ox <= Math.floor(t / 2); ox++)
        paint.setPixel(px + ox, py + oy, r, g, b, a);
  };
  while (true) {
    dot(x, y);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
}
