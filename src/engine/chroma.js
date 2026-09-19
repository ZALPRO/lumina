// engine/chroma.js — حذف پس‌زمینه با کلید رنگی (chroma key) + هاله + گرادیان تخت
//
// 1) chromaKeyRemove: هر پیکسل نزدیک به رنگ کلید (مثل #00FF00) را شفاف می‌کند؛
//    spill suppression (حذف هالهٔ سبز روی لبه‌ها) + نرم‌سازی لبه (anti-alias)
// 2) addGlow: هالهٔ تابان پشت سوژه (کارتونی/وایرال)
// 3) flatGradient: پس‌زمینهٔ تخت گرادیانی اشباع (سبک تامنیل فارسی/فود)

export function chromaKeyRemove(src, w, h, key = { r: 0, g: 255, b: 0 }, tol = 90, feather = 3) {
  const out = new Uint8ClampedArray(w * h * 4);
  const maxD = tol * Math.sqrt(3);

  // ── تشخیص پس‌زمینهٔ کلیدرنگ (فقط نواحی متصل به لبه — flood fill) ──
  // این روش از حذف اجزای سبزِ داخل سوژه (مثل کاهو) جلوگیری می‌کند.
  const isKey = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const dr = src[p] - key.r, dg = src[p + 1] - key.g, db = src[p + 2] - key.b;
    const d = Math.sqrt(dr * dr + dg * dg + db * db);
    isKey[i] = d < maxD ? 1 : 0;
  }
  // flood fill از همهٔ پیکسل‌های لبهٔ کلیدرنگ
  const bg = new Uint8Array(w * h);
  const queue = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i = y * w + x;
    if (isKey[i] && !bg[i]) { bg[i] = 1; queue.push(i); }
  };
  for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); }
  for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
  while (queue.length) {
    const i = queue.pop();
    const x = i % w, y = (i / w) | 0;
    push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
  }

  // پاس ۱: آلفا بر اساس flood-fill + فاصله (نرم‌سازی لبه)
  const alpha = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    if (bg[i]) { alpha[i] = 0; continue; }
    const dr = src[p] - key.r, dg = src[p + 1] - key.g, db = src[p + 2] - key.b;
    const d = Math.sqrt(dr * dr + dg * dg + db * db);
    let a = d / maxD;
    a = a < 0 ? 0 : (a > 1 ? 1 : a);
    alpha[i] = a;
  }
  // پاس ۲: نرم‌سازی لبه (گوسی 3x3 روی آلفا)
  const falpha = new Float32Array(w * h);
  const ker = [1, 2, 1, 2, 4, 2, 1, 2, 1]; const ksum = 16;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      let a;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) a = alpha[y * w + x];
      else a = alpha[ny * w + nx];
      s += a * ker[(dy + 1) * 3 + (dx + 1)];
    }
    falpha[y * w + x] = s / ksum;
  }
  // پاس ۳: خروجی + spill suppression (حذف هالهٔ سبز لبه)
  const spill = 0.7;
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const a = falpha[i];
    let r = src[p], g = src[p + 1], b = src[p + 2];
    // spill: اگر سبز غالب است، به میانگین r/b نزدیک کن (مخصوص لبه‌های نیمه‌شفاف)
    const spillA = Math.min(1, (1 - a) * spill);
    if (spillA > 0 && g > r && g > b) {
      const avg = (r + b) / 2;
      g = g + (avg - g) * spillA * 2;
    }
    out[p] = r; out[p + 1] = g; out[p + 2] = b;
    out[p + 3] = Math.round(a * 255);
  }
  return out;
}

// هالهٔ تابان (glow) پشت سوژه: نسخهٔ آلفا با گسترش نرم + رنگ
export function glowFromAlpha(rgba, w, h, color = [255, 210, 0], radius = 14, intensity = 1.0) {
  const alpha = new Float32Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) alpha[i] = rgba[p + 3] / 255;
  // گسترش: گوسی روی آلفا
  const r = Math.max(1, radius | 0);
  const sigma = r * 0.6;
  const ker = []; let ksum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); ker.push(v); ksum += v; }
  for (let i = 0; i < ker.length; i++) ker[i] /= ksum;
  const tmp = new Float32Array(w * h);
  const glowA = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = 0; k < ker.length; k++) {
      let xx = x + k - r; if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
      s += alpha[y * w + xx] * ker[k];
    }
    tmp[y * w + x] = s;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let k = 0; k < ker.length; k++) {
      let yy = y + k - r; if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
      s += tmp[yy * w + x] * ker[k];
    }
    glowA[y * w + x] = s;
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const a = Math.min(1, glowA[i] * 1.4 * intensity);
    if (a <= 0) { out[p + 3] = 0; continue; }
    out[p] = color[0]; out[p + 1] = color[1]; out[p + 2] = color[2];
    out[p + 3] = Math.round(a * 255);
  }
  return out;
}

// پس‌زمینهٔ تخت: گرادیان دو رنگ اشباع (سبک تامنیل فود وایرال)
export function flatGradient(w, h, fromColor = [255, 70, 40], toColor = [255, 160, 0], angle = 0) {
  const out = new Uint8ClampedArray(w * h * 4);
  const [r1, g1, b1] = fromColor, [r2, g2, b2] = toColor;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let t;
    if (angle === 0) t = y / (h - 1);
    else if (angle === 90) t = x / (w - 1);
    else t = (x / (w - 1) + y / (h - 1)) / 2;
    const i = (y * w + x) * 4;
    out[i] = r1 + (r2 - r1) * t;
    out[i + 1] = g1 + (g2 - g1) * t;
    out[i + 2] = b1 + (b2 - b1) * t;
    out[i + 3] = 255;
  }
  return out;
}

// اشکال بدج (بردار ساده): فلش قرمز با استروک، ستارهٔ زرد — روی بافر RGBA می‌کشد
export function drawArrow(canvas, w, h, { x1, y1, x2, y2, color = [230, 30, 30], stroke = [255, 255, 255], thick = 22 } = {}) {
  const out = new Uint8ClampedArray(canvas.length);
  out.set(canvas);
  // خط بولد با استروک سفید + پر قرمز
  const put = (px, py, c) => {
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    const i = (py * w + px) * 4;
    out[i] = c[0]; out[i + 1] = c[1]; out[i + 2] = c[2]; out[i + 3] = 255;
  };
  const dist = Math.max(1, Math.hypot(x2 - x1, y2 - y1));
  const ux = (x2 - x1) / dist, uy = (y2 - y1) / dist;
  const nx = -uy, ny = ux;
  const half = thick / 2;
  // خط (چند دایره در طول)
  for (let t = 0; t <= dist; t += 1.5) {
    const cx = x1 + ux * t, cy = y1 + uy * t;
    for (let r = 0; r <= half + 8; r += 1) {
      for (let a = 0; a < 6.283; a += 0.25) {
        const px = Math.round(cx + Math.cos(a) * r), py = Math.round(cy + Math.sin(a) * r);
        put(px, py, r > half ? stroke : color);
      }
    }
  }
  // نوک پیکان (مثلث)
  const tipLen = thick * 2.6;
  for (let a = 0; a < tipLen; a += 0.8) {
    const rr = tipLen - a;
    for (let th = 0; th < 6.283; th += 0.3) {
      const px = Math.round(x2 + ux * a + Math.cos(th) * rr * 0.34);
      const py = Math.round(y2 + uy * a + Math.sin(th) * rr * 0.34);
      put(px, py, color);
    }
  }
  return out;
}

// ستارهٔ زرد با استروک مشکی — پلیگون ساده + point-in-polygon
export function drawStar(canvas, w, h, { cx, cy, radius, color = [255, 210, 0], stroke = [0, 0, 0], points = 5 } = {}) {
  const out = new Uint8ClampedArray(canvas.length);
  out.set(canvas);
  const inner = radius * 0.45;
  // رأس‌های پلیگون ستاره (10 نقطه)
  const vs = [];
  for (let k = 0; k < points * 2; k++) {
    const r = k % 2 === 0 ? radius : inner;
    const ang = -Math.PI / 2 + k * Math.PI / points;
    vs.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
  }
  const inPoly = (px, py) => {
    let inside = false;
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const [xi, yi] = vs[i], [xj, yj] = vs[j];
      if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  const nearEdge = (px, py, thr) => {
    for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
      const [ax, ay] = vs[i], [bx, by] = vs[j];
      const l2 = Math.max(1e-6, (bx - ax) ** 2 + (by - ay) ** 2);
      const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2));
      if (Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay))) <= thr) return true;
    }
    return false;
  };
  const bbox = radius + 8;
  for (let py = cy - bbox; py <= cy + bbox; py++) for (let px = cx - bbox; px <= cx + bbox; px++) {
    if (Math.hypot(px - cx, py - cy) > bbox) continue;
    if (px < 0 || py < 0 || px >= w || py >= h) continue;
    if (!inPoly(px, py)) continue;
    const i = (py * w + px) * 4;
    const edge = nearEdge(px, py, 5);
    out[i] = edge ? stroke[0] : color[0];
    out[i + 1] = edge ? stroke[1] : color[1];
    out[i + 2] = edge ? stroke[2] : color[2];
    out[i + 3] = 255;
  }
  return out;
}
