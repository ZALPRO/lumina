// text/spec.js — لایهٔ متنی «قابل ویرایش» (بازآرایی زنده از روی مشخصات، نه رستر مرده)
// رویکرد حرفه‌ای: مشخصات متن (content/font/size/color/stroke/align…) روی لایه ذخیره می‌شود
// و هر بار تغییر، متن دوباره رستر می‌شود. کاربر می‌تواند بعداً هم متن را ویرایش کند.
// (مثل Text Layer فتوشاپ؛ رستر فقط برای کامپوزیت است.)

export function defaultTextSpec(over = {}) {
  return {
    content: 'متن نمونه',
    font: 'Vazirmatn',
    size: 64,
    bold: false,
    italic: false,
    underline: false,
    color: '#ffffff',            // رنگ متن
    strokeColor: '#000000',      // استروک دور حروف
    strokeWidth: 0,              // 0 = بدون استروک
    shadow: false,               // سایهٔ نرم زیر متن
    align: 'left',               // left | center | right
    lineHeight: 1.25,
    letterSpacing: 0,            // px
    x: 0, y: 0,                  // موقعیت لایهٔ متن روی بوم
    ...over,
  };
}

export function clampTextSpec(s, doc) {
  const o = { ...s };
  o.size = Math.max(4, Math.min(4000, +o.size || 64));
  o.strokeWidth = Math.max(0, Math.min(200, +o.strokeWidth || 0));
  o.lineHeight = Math.max(0.5, Math.min(4, +o.lineHeight || 1.25));
  o.letterSpacing = Math.max(-200, Math.min(400, +o.letterSpacing || 0));
  if (!['left', 'center', 'right'].includes(o.align)) o.align = 'left';
  if (doc) {
    o.x = Math.max(0, Math.min(doc.width, Math.round(o.x || 0)));
    o.y = Math.max(0, Math.min(doc.height, Math.round(o.y || 0)));
  }
  return o;
}

// ساخت رشتهٔ font برای Canvas 2D
export function canvasFont(spec) {
  const style = spec.italic ? 'italic ' : '';
  const weight = spec.bold ? '700 ' : '400 ';
  return `${style}${weight}${spec.size}px "${spec.font}", "Inter", "Vazirmatn", sans-serif`;
}

// شکستن متن به خطوط (با احترام به \n و شکست خودکار در عرض حداکثر)
export function layoutLines(g, content, maxWidth) {
  const paragraphs = String(content == null ? '' : content).split('\n');
  const lines = [];
  for (const p of paragraphs) {
    if (!maxWidth || maxWidth <= 0) { lines.push(p); continue; }
    // شکست مبتنی بر کلمه (فارسی/انگلیسی هر دو با فاصله)
    const words = p.split(/(\s+)/);   // جداکننده‌ها حفظ می‌شوند
    let cur = '';
    for (const w of words) {
      const test = cur + w;
      if (g.measureText(test).width > maxWidth && cur.trim() !== '') {
        lines.push(cur.replace(/\s+$/, ''));
        cur = w.replace(/^\s+/, '');
      } else {
        cur = test;
      }
    }
    lines.push(cur);
  }
  return lines.length ? lines : [''];
}

// اندازهٔ جعبهٔ متن بر اساس مشخصات (بدون رندر) — برای UI و برنامه‌ریزی
export function measureTextBox(spec, maxWidth = 0) {
  const off = document.createElement('canvas');
  off.width = 8; off.height = 8;
  const g = off.getContext('2d', { willReadFrequently: true });
  g.font = canvasFont(spec);
  if ('letterSpacing' in g) g.letterSpacing = `${spec.letterSpacing || 0}px`;
  const lines = layoutLines(g, spec.content, maxWidth);
  let w = 0;
  for (const ln of lines) w = Math.max(w, g.measureText(ln).width);
  const pad = Math.ceil(spec.size * 0.25 + spec.strokeWidth + (spec.shadow ? spec.size * 0.2 : 0));
  const blockH = Math.ceil(spec.size * 1.18) + Math.ceil(spec.size * (spec.lineHeight - 1));
  const h = lines.length * blockH;
  return {
    lines, width: Math.ceil(w) + pad * 2, height: Math.ceil(h) + pad * 2,
    lineHeightPx: blockH, pad,
  };
}

// رندر متن به ImageData (بستر مرورگر) — خروجی برای Paint
export function rasterizeText(spec, maxWidth = 0) {
  const m = measureTextBox(spec, maxWidth);
  const off = document.createElement('canvas');
  off.width = Math.max(1, m.width);
  off.height = Math.max(1, m.height);
  const g = off.getContext('2d', { willReadFrequently: true });
  g.font = canvasFont(spec);
  if ('letterSpacing' in g) g.letterSpacing = `${spec.letterSpacing || 0}px`;
  g.textBaseline = 'top';
  g.lineJoin = 'round';
  g.miterLimit = 2;

  const totalW = m.width - m.pad * 2;
  for (let i = 0; i < m.lines.length; i++) {
    const ln = m.lines[i];
    const lw = g.measureText(ln).width;
    let x = m.pad;
    if (spec.align === 'center') x = m.pad + (totalW - lw) / 2;
    else if (spec.align === 'right') x = m.pad + (totalW - lw);
    const y = m.pad + i * m.lineHeightPx;
    if (spec.shadow) {
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.55)';
      g.shadowBlur = Math.max(2, spec.size * 0.12);
      g.shadowOffsetY = Math.max(1, spec.size * 0.06);
      g.fillStyle = spec.color;
      g.fillText(ln, x, y);
      g.restore();
    }
    if (spec.strokeWidth > 0) {
      g.strokeStyle = spec.strokeColor;
      g.lineWidth = spec.strokeWidth * 2;   // نصف بیرون، نصف داخل (مثل Stroke Outside)
      g.strokeText(ln, x, y);
    }
    g.fillStyle = spec.color;
    g.fillText(ln, x, y);
    if (spec.underline) {
      g.strokeStyle = spec.color;
      g.lineWidth = Math.max(1, spec.size / 14);
      g.beginPath();
      g.moveTo(x, y + spec.size * 1.02);
      g.lineTo(x + lw, y + spec.size * 1.02);
      g.stroke();
    }
  }
  return { imageData: g.getImageData(0, 0, off.width, off.height), width: off.width, height: off.height, metrics: m };
}
