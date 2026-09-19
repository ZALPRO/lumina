// engine/inpaint.js — الگوریتم inpainting (انتشار از لبه) — همان افکت healing-brush فتوشاپ
//
// انتشار رنگ از لبه‌های سالم به داخل ماسک لکه، با وزن‌دهی فاصله (مشابه Telea FMM).
// در هر تکرار، پیکسل‌های لکه که حداقل یک همسایهٔ known دارند با میانگین وزنی
// همسایه‌های known پر می‌شوند و خود known می‌شوند؛ تا حفره کامل پر شود.
//
// ورودی:
//   src      Uint8ClampedArray RGBA (w×h)
//   mask     Uint8Array باینری (۱ = لکه، ۰ = سالم)
//   radius   شعاع همسایگی نمونه‌گیری (پیش‌فرض 2)
// خروجی: Uint8ClampedArray RGBA — فقط لکه‌ها پر شده، سالم دست‌نخورده

export function inpaintTelea(src, w, h, mask, radius = 2) {
  const N = w * h;
  const known = new Uint8Array(N); // 1 = رنگ قطعی
  for (let i = 0; i < N; i++) known[i] = mask[i] ? 0 : 1;

  const OUT = new Uint8ClampedArray(src.length);
  OUT.set(src);

  let remaining = 0;
  for (let i = 0; i < N; i++) if (mask[i]) remaining++;

  const R = Math.max(1, radius | 0);
  const idx = (x, y) => y * w + x;

  // تکرار: پرشدن حفره از بیرون به داخل
  let iter = 0;
  const MAX_ITER = N; // برای ایمنی
  while (remaining > 0 && iter++ < MAX_ITER) {
    const toFill = [];  // پیکسل‌هایی که این تکرار پر می‌شوند
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = idx(x, y);
      if (known[i]) continue;
      // همسایهٔ known دارد؟
      let hasKnown = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        if (known[idx(nx, ny)]) { hasKnown = true; break; }
      }
      if (hasKnown) toFill.push(i);
    }
    if (toFill.length === 0) break; // جلوگیری از حلقه‌ی بی‌نهایت
    for (const i of toFill) {
      const x = i % w, y = (i / w) | 0;
      // میانگین وزنی همسایه‌های known در شعاع R
      let rSum = 0, gSum = 0, bSum = 0, wSum = 0;
      for (let dy = -R; dy <= R; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -R; dx <= R; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          const ni = idx(nx, ny);
          if (!known[ni]) continue;
          const d2 = dx * dx + dy * dy;
          const weight = 1 / (1 + d2);
          const p = ni * 4;
          rSum += OUT[p] * weight; gSum += OUT[p + 1] * weight; bSum += OUT[p + 2] * weight;
          wSum += weight;
        }
      }
      if (wSum > 0) {
        const p = i * 4;
        OUT[p] = rSum / wSum; OUT[p + 1] = gSum / wSum; OUT[p + 2] = bSum / wSum;
      }
      known[i] = 1;
      remaining--;
    }
  }
  return OUT;
}
