// engine/transform.js — ریاضیات چرخش/مقیاس/جابه‌جایی و تبدیل نقطه
// ماتریس افین ۲×۳ ستونی (a,b,c,d,e,f): x' = a*x + c*y + e، y' = b*x + d*y + f
export function identity() { return [1, 0, 0, 1, 0, 0]; }

export function multiply(m, n) {
  const [a1, b1, c1, d1, e1, f1] = m, [a2, b2, c2, d2, e2, f2] = n;
  return [
    a1 * a2 + c1 * b2, b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2, b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1, b1 * e2 + d1 * f2 + f1,
  ];
}

export function translate(dx, dy) { return [1, 0, 0, 1, dx, dy]; }
export function scale(sx, sy) { return [sx, 0, 0, sy, 0, 0]; }
export function rotateRad(a) { const c = Math.cos(a), s = Math.sin(a); return [c, s, -s, c, 0, 0]; }

export function compositeTransform({ cx = 0, cy = 0, angle = 0, sx = 1, sy = 1, tx = 0, ty = 0 } = {}) {
  // ترتیب استاندارد: p - pivot → scale → rotate → translate to target
  let m = identity();
  m = multiply(m, translate(cx + tx, cy + ty));
  m = multiply(m, rotateRad(angle));
  m = multiply(m, scale(sx, sy));
  m = multiply(m, translate(-cx, -cy));
  return m;
}

export function applyToPoint(m, x, y) {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

// معکوس ماتریس افین (برای sampling معکوس)
export function invertAffine(m) {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-12) return null;
  const i = 1 / det;
  return [
    d * i, -b * i, -c * i, a * i,
    (c * f - d * e) * i, (b * e - a * f) * i,
  ];
}
