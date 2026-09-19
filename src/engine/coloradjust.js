// engine/coloradjust.js — توابع سادهٔ درجه‌بندی رنگ برای لایه‌های تنظیم (غیرمخرب)
// مولفه‌های رنگی برای منحنی فتوشاپ:
//   0 → سیاه، 0.5 → خاکستری میانه، 1 → سفید
// gamma از فتوشاپ: y = x^(1/gamma)
export function brightnessMapping(x, amount) {
  // amount در [-1, 1]
  const s = 1 + amount;
  const y = x * s;
  return y < 0 ? 0 : (y > 1 ? 1 : y);
}

export function gammaMapping(x, gamma) {
  const g = gamma > 0 ? gamma : 1;
  return Math.pow(x, 1 / g);
}

// منحنی با نقاط کنترل: درون‌یابی ساده (linearly interpolated control points)
// کنترل‌ها هر کدام [x,y] در 0..1؛ سورس مرتب‌شده در افزایش x بریده می‌شود
export function curveMapping(x, points) {
  if (points.length === 0) return x;
  // پیدا کردن بازه
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return points[points.length - 1][1];
}

// Hue/Saturation/Lightness (شبیه فتوشاپ: sat و light نسبی)
export function hslAdjust(x, r /* [0..1] ref */, hs /* hue shift deg */, satMul, lightAdd) {
  let v = x;
  if (lightAdd !== 0) v = v + lightAdd;
  if (satMul !== 1 && r !== undefined) v = (v - r) * satMul + r;
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}
