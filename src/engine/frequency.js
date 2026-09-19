// engine/frequency.js — تفکیک فرکانس (Frequency Separation) — تکنیک حرفه‌ای رتوش پوست
// در فتوشاپ: ۵ گام دستی و ۲۰–۴۵ دقیقه. اینجا: یک فراخوانی.
//
// ریاضی:
//   low  = gaussianBlur(src, radius)              → رنگ/تناژ (پوست صاف)
//   high = src − low  (نرمال‌شده حول 128)         → بافت (منافذ پوست)
// با ترکیب دوباره‌ی «high + low» دقیقاً تصویر اصلی برمی‌گردد (شرط Linear Light‌مثل).
//
// کاربرد رتوش:
//   - low را می‌توان با برس/بلور بیشتر صاف کرد (حذف قرمزی و سایهٔ ناصاف) بدون ازدست‌دادن منافذ.
//   - high فقط بافت است → Healing/Clone روی آن، لکه را بدون خراب‌کردن رنگ حذف می‌کند.

// بلور گاوسی جداشدنی (بر روی Uint8ClampedArray کانال‌به‌کانال)
function gaussianBlur(src, w, h, radius) {
  const r = Math.max(1, Math.round(radius));
  const tmp = new Float32Array(w * h * 4);
  const out = new Uint8ClampedArray(src.length);
  // هستهٔ گاوسی
  const kernel = [];
  let ksum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * r * r * 0.5 + 0.5));
    kernel.push(v); ksum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= ksum;

  // افقی
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      for (let k = 0; k < kernel.length; k++) {
        let xx = x + k - r;
        if (xx < 0) xx = 0; else if (xx >= w) xx = w - 1;
        const i = (y * w + xx) * 4;
        const kv = kernel[k];
        rSum += src[i] * kv; gSum += src[i + 1] * kv; bSum += src[i + 2] * kv; aSum += src[i + 3] * kv;
      }
      const j = (y * w + x) * 4;
      tmp[j] = rSum; tmp[j + 1] = gSum; tmp[j + 2] = bSum; tmp[j + 3] = aSum;
    }
  }
  // عمودی
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let rSum = 0, gSum = 0, bSum = 0, aSum = 0;
      for (let k = 0; k < kernel.length; k++) {
        let yy = y + k - r;
        if (yy < 0) yy = 0; else if (yy >= h) yy = h - 1;
        const i = (yy * w + x) * 4;
        const kv = kernel[k];
        rSum += tmp[i] * kv; gSum += tmp[i + 1] * kv; bSum += tmp[i + 2] * kv; aSum += tmp[i + 3] * kv;
      }
      const j = (y * w + x) * 4;
      out[j] = rSum; out[j + 1] = gSum; out[j + 2] = bSum; out[j + 3] = aSum;
    }
  }
  return out;
}

// تفکیک فرکانس کامل: ورودی RGBA، خروجی {low, high, recon}
export function frequencySeparate(src, w, h, radius = 8) {
  const low = gaussianBlur(src, w, h, radius);
  const high = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    // high = (src − low)/2 + 128 — روش Apply Image فتوشاپ (Scale 2, Offset 128)
    high[i] = clamp8((src[i] - low[i]) / 2 + 128);
    high[i + 1] = clamp8((src[i + 1] - low[i + 1]) / 2 + 128);
    high[i + 2] = clamp8((src[i + 2] - low[i + 2]) / 2 + 128);
    high[i + 3] = src[i + 3];
  }
  // recon = low + 2*(high−128) باید ≈ src باشد
  const recon = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    recon[i] = clamp8(low[i] + 2 * (high[i] - 128));
    recon[i + 1] = clamp8(low[i + 1] + 2 * (high[i + 1] - 128));
    recon[i + 2] = clamp8(low[i + 2] + 2 * (high[i + 2] - 128));
    recon[i + 3] = src[i + 3];
  }
  return { low, high, recon };
}

// «مجسمه‌سازی» کم‌فرکانس: صاف‌کردن فقط تناژ (بدون بافت) — نسخهٔ تقویت‌شده
// strength: 0..1 — چقدر جزئیات کم‌فرکانس نرم شوند. خروجی همان تصویر است ولی با تناژ نرم‌تر.
export function smoothTones(src, w, h, radius = 10, strength = 0.7) {
  const low = gaussianBlur(src, w, h, radius);
  const { high } = balanceFrom(src, low, w, h);
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    out[i] = clamp8(src[i] + (low[i] - src[i]) * strength);
    out[i + 1] = clamp8(src[i + 1] + (low[i + 1] - src[i + 1]) * strength);
    out[i + 2] = clamp8(src[i + 2] + (low[i + 2] - src[i + 2]) * strength);
    out[i + 3] = src[i + 3];
  }
  return out;
}

function balanceFrom(src, low, w, h) {
  const high = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    high[i] = src[i] - low[i] + 128;
    high[i + 1] = src[i + 1] - low[i + 1] + 128;
    high[i + 2] = src[i + 2] - low[i + 2] + 128;
    high[i + 3] = src[i + 3];
  }
  return { high };
}

function clamp8(v) { v = Math.round(v); return v < 0 ? 0 : (v > 255 ? 255 : v); }
