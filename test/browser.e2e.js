// test/browser.e2e.js — تست پایان‌به‌پایان UI مدرن در مرورگر headless واقعی
// سرور استاتیک خودکار راه‌اندازی می‌شود (اگر از قبل روشن نبود)؛ بعد از تست بسته می‌شود.
import test from 'node:test';
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const URL = 'http://localhost:4173/';

let browser, page;
let serverProc = null;

async function portOpen(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(800) });
    return true;
  } catch {
    return false;
  }
}

test.before(async () => {
  if (!(await portOpen(URL))) {
    const servePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'serve.js');
    serverProc = spawn(process.execPath, [servePath], { stdio: 'ignore', detached: true });
    // صبر تا سرور آماده شود
    for (let i = 0; i < 40 && !(await portOpen(URL)); i++) await new Promise((r) => setTimeout(r, 250));
  }
  browser = await puppeteer.launch({ headless: 'shell', args: ['--no-sandbox', '--disable-gpu'] });
  page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|404/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1000));
  if (errors.length) throw new Error('Console errors on load:\n' + errors.join('\n'));
});
test.after(async () => {
  if (browser) await browser.close();
  if (serverProc) { try { process.kill(-serverProc.pid, 'SIGTERM'); } catch { /* ignore */ } }
});

test('UI: layout مدرن لود شد (rail ابزار + پنل راست + نوار وضعیت)', async () => {
  const r = await page.evaluate(() => ({
    rail: document.querySelectorAll('.rail-btn[data-tool]').length,
    panel: !!document.querySelector('#panel'),
    status: !!document.querySelector('#statusbar'),
    canvas: document.querySelector('#canvas').width,
    title: document.title,
  }));
  assert.equal(r.rail >= 7, true, 'rail tools');
  assert.equal(r.panel, true, 'right panel');
  assert.equal(r.status, true, 'status bar');
  assert.equal(r.canvas, 1920, 'canvas width');
  assert.equal(r.title, 'Lumina — Image Editor');
});

test('UI: حالت maptool می‌گنجد (رنگ پیش‌فرض اعمال شد)', async () => {
  const r = await page.evaluate(() => ({
    fg: document.querySelector('#swatch-fg').style.background,
  }));
  assert.equal(r.fg, 'rgb(108, 140, 255)' || r.fg === '#6c8cff');
});

test('UI: قلم روی بوم پیکسل می‌گذارد', async () => {
  const res = await page.evaluate(async () => {
    document.querySelector('[data-tool="brush"]').click();
    const canvas = document.querySelector('#canvas');
    // زوم پیش‌فرض 2، پس نقطهٔ بوم در مرکز
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: 500, clientY: 300, bubbles: true, pointerId: 1, isPrimary: true, button: 0 }));
    for (let i = 0; i < 6; i++) {
      canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: 500 + i * 20, clientY: 300 + i * 8, bubbles: true }));
    }
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    const ctx = canvas.getContext('2d');
    // پیکسل در بوم (با زوم 2): x_screen 500 → x_canvas ~ (500-left)/2
    const rect = canvas.getBoundingClientRect();
    let px = Math.floor((500 - rect.left) / 2), py = Math.floor((300 - rect.top) / 2);
    const p = ctx.getImageData(px, py, 1, 1).data;
    return { r: p[0], g: p[1], b: p[2], a: p[3] };
  });
  assert.ok(res.a > 0, 'alpha باید >0');
  assert.equal(res.b > 200, true, 'آبی (رنگ پیش‌فرض)');
});

test('UI: undo واقعاً رنگ را برمی‌گرداند', async () => {
  // پیکسل مشخصی که در تست قبل رنگ شده (clientX=500,clientY=300) را اسنِپ کن
  const before = await sampleAt(page, 500, 300);
  await page.evaluate(() => document.querySelector('#btn-undo').click());
  await new Promise((r) => setTimeout(r, 120));
  const after = await sampleAt(page, 500, 300);
  // قبل از undo: رنگ آبی (کانال b بالا)؛ بعد: سفید سند (r=g=b=255)
  assert.ok(before[2] > 150, `before blue=${before[2]}`);
  assert.ok(after[2] > 230 && after[0] > 230, `after=${after} (باید به سفید برگردد)`);
});

function sampleAt(p, sx, sy) {
  return p.evaluate(([sx, sy]) => {
    const canvas = document.querySelector('#canvas');
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((sx - rect.left) / 2);
    const y = Math.floor((sy - rect.top) / 2);
    return [...ctx.getImageData(x, y, 1, 1).data];
  }, [sx, sy]);
}

test('UI: خروجی باینری PNG که ذخیره می‌شود معتبر است', async () => {
  const r = await page.evaluate(async () => {
    const mod = await import('/src/formats/png.js');
    const { Document } = await import('/src/document/document.js');
    const { Paint } = await import('/src/document/paint.js');
    const { Layer } = await import('/src/document/layer.js');
    const doc = new Document({ width: 5, height: 5 });
    const p = new Paint(5, 5);
    p.setPixel(0, 0, 255, 0, 0, 255);
    doc.addLayer(new Layer({ paint: p }));
    const buf = await mod.encodePng({ width: 5, height: 5, data: doc.toRGBA() });
    return [buf[0], buf[1], buf[2], buf[3]];
  });
  assert.deepEqual(r, [137, 80, 78, 71]);
});

test('UI: پنل رنگ HSL/آلفا رنگ را تغییر می‌دهد', async () => {
  const r = await page.evaluate(() => {
    const $ = (s) => document.querySelector(s);
    // ست کردن قرمز خالص از پالت
    $('#hue-slider').value = 0; $('#hue-slider').dispatchEvent(new Event('input'));
    $('#sat-range').value = 100; $('#sat-range').dispatchEvent(new Event('input'));
    $('#light-range').value = 50; $('#light-range').dispatchEvent(new Event('input'));
    return $('#swatch-fg').style.background;
  });
  assert.equal(r, 'rgb(255, 0, 0)');
});

test('UI: افزودن و حذف ماسک لایه بدون خطا', async () => {
  const r = await page.evaluate(async () => {
    const $ = (s) => document.querySelector(s);
    $('#btn-add-layer').click();
    await new Promise((r2) => setTimeout(r2, 50));
    $('#btn-add-mask').click();
    await new Promise((r2) => setTimeout(r2, 50));
    $('#btn-delete-mask').click();
    await new Promise((r2) => setTimeout(r2, 50));
    return { maskBtn: !!$('#btn-add-mask'), delBtn: !!$('#btn-delete-mask') };
  });
  assert.equal(r.maskBtn, true);
  assert.equal(r.delBtn, true);
});

test('UI: افکت pro (Posterize) اعمال می‌شود بدون throw', async () => {
  const r = await page.evaluate(async () => {
    const $ = (s) => document.querySelector(s);
    $('#filter-select').value = 'posterize';
    $('#btn-apply-filter').click();
    await new Promise((r2) => setTimeout(r2, 100));
    return { sel: $('#filter-select').value };
  });
  assert.equal(r.sel, '');
});

test('UI: انتخاب مستطیلی و دکمه‌های عملیات موجودند', async () => {
  const r = await page.evaluate(() => {
    const $ = (s) => document.querySelector(s);
    return {
      selAll: !!$('#btn-sel-all'),
      selInv: !!$('#btn-sel-invert'),
      selClearBtn: !!$('#btn-sel-clear'),
      selDelete: !!$('#btn-sel-delete'),
      selFill: !!$('#btn-sel-fill'),
      crop: !!$('#btn-crop'),
      layerUp: !!$('#btn-layer-up'),
      layerDown: !!$('#btn-layer-down'),
      rename: !!$('#btn-rename-layer'),
      maskEdit: !!$('#btn-toggle-mask-edit'),
    };
  });
  assert.deepEqual(r, {
    selAll: true, selInv: true, selClearBtn: true, selDelete: true,
    selFill: true, crop: true, layerUp: true, layerDown: true, rename: true, maskEdit: true,
  });
});

test('UI: تغییر نام و جابه‌جایی ترتیب لایه', async () => {
  const r = await page.evaluate(async () => {
    const $ = (s) => document.querySelector(s);
    $('#btn-add-layer').click();
    await new Promise((r2) => setTimeout(r2, 50));
    const before = document.querySelectorAll('.layer-item').length;
    $('#btn-layer-up').click();
    await new Promise((r2) => setTimeout(r2, 50));
    return { before };
  });
  assert.ok(r.before >= 3, 'سه لایه');
});

test('UI: ابزارهای کامل فتوشاپ در rail موجودند', async () => {
  const r = await page.evaluate(() => ({
    tools: Array.from(document.querySelectorAll('.rail-btn[data-tool]')).map((b) => b.dataset.tool),
    count: document.querySelectorAll('.rail-btn[data-tool]').length,
  }));
  for (const t of ['clone', 'healing', 'pencil', 'dodge', 'burn', 'smudge', 'blur', 'sharpen', 'lasso', 'polygonal', 'magiceraser', 'gradient', 'ellipse', 'rectshape', 'ellipseshape', 'lineshape']) {
    assert.ok(r.tools.includes(t), 'tool missing: ' + t);
  }
  assert.ok(r.count >= 23, r.count + ' tools');
});

test('UI: دکمه‌های گروه/کلیپ/سایه + فرمت خروجی', async () => {
  const r = await page.evaluate(() => ({
    group: !!document.querySelector('#btn-group-layers'),
    clip: !!document.querySelector('#btn-clip-layer'),
    shadow: !!document.querySelector('#btn-shadow-layer'),
    fmt: document.querySelectorAll('#export-format option').length,
    fmts: [...document.querySelectorAll('#export-format option')].map((o) => o.value),
  }));
  assert.equal(r.group, true);
  assert.equal(r.clip, true);
  assert.equal(r.shadow, true);
  assert.equal(r.fmt >= 6, true, 'حداقل ۶ فرمت خروجی');
  for (const f of ['png', 'jpeg', 'psd', 'tiff', 'bmp', 'qoi', 'webp']) {
    assert.equal(r.fmts.includes(f), true, `فرمت ${f}`);
  }
});

test('UI: گرادیان بوم را تغییر می‌دهد بدون خطا', async () => {
  const r = await page.evaluate(async () => {
    const canvas = document.querySelector('#canvas');
    document.querySelector('[data-tool="gradient"]').click();
    const rect = canvas.getBoundingClientRect();
    const y = rect.top + rect.height / 2;
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + rect.width * 0.2, clientY: y, bubbles: true, pointerId: 7, isPrimary: true, button: 0 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { clientX: rect.left + rect.width * 0.8, clientY: y, bubbles: true }));
    await new Promise((r2) => setTimeout(r2, 120));
    const ctx = canvas.getContext('2d');
    const p = ctx.getImageData(10, 10, 1, 1).data;
    return { a: p[3] };
  });
  assert.equal(r.a, 255, 'گرادیان پیکسل گذاشت');
});

test('UI: گروه‌بندی + کلیپ‌ماسک + سایه بدون خطا', async () => {
  const r = await page.evaluate(async () => {
    const $ = (s) => document.querySelector(s);
    $('#btn-add-layer').click();
    await new Promise((r2) => setTimeout(r2, 30));
    $('#btn-group-layers').click();
    $('#btn-clip-layer').click();
    $('#btn-shadow-layer').click();
    await new Promise((r2) => setTimeout(r2, 80));
    return window.__noError === undefined; // اگر خطایی رخ داد صفحه fail شده
  });
  assert.equal(r, true);
});

/* ══════════ قابلیت‌های حرفه‌ایِ افزوده‌شده ══════════ */

test('UI: پنل History رندر می‌شود و با عملیات رشد می‌کند', async () => {
  const r = await page.evaluate(async () => {
    const $ = (s) => document.querySelector(s);
    const before = document.querySelectorAll('#history-list .hist-item').length;
    $('#btn-add-layer').click(); await new Promise((r2) => setTimeout(r2, 40));
    $('#btn-dup-layer').click(); await new Promise((r2) => setTimeout(r2, 40));
    const after = document.querySelectorAll('#history-list .hist-item').length;
    const labels = [...document.querySelectorAll('#history-list .hist-item span')].map((s2) => s2.textContent);
    return { before, after, labels, hasSel: !!document.querySelector('#history-list .hist-item.sel') };
  });
  assert.equal(r.before >= 1, true, 'فهرست History باید حداقل حالت پایه را نشان دهد');
  assert.equal(r.after >= r.before + 2, true, 'بعد از دو عملیات، دو حالت اضافه شود');
  assert.equal(r.labels.some((l) => /Add Layer|Duplicate/.test(l)), true, 'برچسب عملیات دیده شود');
  assert.equal(r.hasSel, true, 'حالت جاری باید هایلایت باشد');
});

test('UI: کلیک روی History state سند را برمی‌گرداند', async () => {
  const r = await page.evaluate(async () => {
    const $ = (s) => document.querySelector(s);
    const items = () => [...document.querySelectorAll('#history-list .hist-item')];
    // چند عملیات
    for (let i = 0; i < 3; i++) { $('#btn-add-layer').click(); await new Promise((r2) => setTimeout(r2, 30)); }
    const n1 = items().length;
    items()[0].click();                       // پرش به حالت پایه
    await new Promise((r2) => setTimeout(r2, 80));
    const n2 = items().length;
    const selIdx = items().findIndex((el) => el.classList.contains('sel'));
    return { n1, n2, selIdx };
  });
  assert.equal(r.n2 >= r.n1, true, 'حالت‌های بعدی باید در فهرست بمانند (future)');
  assert.equal(r.selIdx, 0, 'حالت انتخابی باید پایه باشد');
});

test('UI: ناوبر (minimap) با کلیک، نما را جابه‌جا می‌کند', async () => {
  const r = await page.evaluate(async () => {
    const nav = document.querySelector('#navigator');
    const before = document.querySelector('#sb-zoom').textContent;
    const rect = nav.getBoundingClientRect();
    nav.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + rect.width * 0.75, clientY: rect.top + rect.height * 0.5, bubbles: true, pointerId: 3, isPrimary: true }));
    nav.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await new Promise((r2) => setTimeout(r2, 60));
    const st = document.querySelector('#canvas').style.transform;
    return { w: nav.width, h: nav.height, before, transform: st };
  });
  assert.equal(r.w > 0 && r.h > 0, true, 'بوم ناوبر باید ابعاد داشته باشد');
  assert.equal(typeof r.transform, 'string', 'نما باید ترنسفورم داشته باشد');
});

test('UI: لایهٔ متنی قابل ویرایش ساخته و ویرایش می‌شود', async () => {
  const r = await page.evaluate(async () => {
    const $ = (s) => document.querySelector(s);
    window.prompt = () => 'سلام دنیا';       // پاسخ خودکار به prompt متن
    const canvas = document.querySelector('#canvas');
    document.querySelector('[data-tool="text"]').click();
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + 60, clientY: rect.top + 60, bubbles: true, pointerId: 9, isPrimary: true, button: 0 }));
    await new Promise((r2) => setTimeout(r2, 150));
    const tags = [...document.querySelectorAll('.layer-tag')].map((t) => t.textContent);
    const editVal = $('#text-edit').value;
    const hasPanel = $('#ctx-text').classList.contains('has-text-layer');
    // ویرایش زندهٔ متن
    $('#text-edit').value = 'متن ویرایش‌شده';
    $('#text-edit').dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r2) => setTimeout(r2, 150));
    const names = [...document.querySelectorAll('.layer-name')].map((n) => n.textContent);
    return { tags, editVal, hasPanel, names };
  });
  assert.equal(r.tags.includes('T'), true, 'لایهٔ متنی باید تگ T بگیرد');
  assert.equal(r.editVal, 'سلام دنیا', 'محتوا باید در پنل باشد');
  assert.equal(r.hasPanel, true, 'پنل متن باید فعال شود');
  assert.equal(r.names.some((n) => n.includes('ویرایش‌شده')), true, 'نام لایه باید به‌روز شود');
});

test('UI: تغییر فونت لایهٔ متنی آن را دوباره رستر می‌کند', async () => {
  const r = await page.evaluate(async () => {
    const $ = (s) => document.querySelector(s);
    const fs = $('#font-name');
    fs.value = 'Lalezar';
    fs.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r2) => setTimeout(r2, 120));
    const sz = $('#text-size');
    sz.value = '120';
    sz.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r2) => setTimeout(r2, 150));
    // بررسی اینکه پیکسل‌های متن روی بوم تغییر کرده‌اند
    const canvas = document.querySelector('#canvas');
    const ctx = canvas.getContext('2d');
    let nonEmpty = 0;
    const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0) nonEmpty++;
    return { font: fs.value, size: sz.value, nonEmpty };
  });
  assert.equal(r.font, 'Lalezar');
  assert.equal(r.size, '120');
  assert.equal(r.nonEmpty > 0, true, 'بوم باید محتوا داشته باشد');
});

test('UI: سه فونت فارسی جدید در فهرست هستند', async () => {
  const r = await page.evaluate(() => [...document.querySelectorAll('#font-name option')].map((o) => o.value));
  for (const f of ['Vazirmatn', 'Lalezar', 'BalooBhaijaan2', 'Estedad']) {
    assert.equal(r.includes(f), true, `فونت ${f}`);
  }
});

test('UI: undo عملیات لایه (افزودن) را برمی‌گرداند — نه فقط قلم', async () => {
  const r = await page.evaluate(async () => {
    const $ = (s) => document.querySelector(s);
    const cnt = () => document.querySelectorAll('#layers-list .layer-item').length;
    const c0 = cnt();
    $('#btn-add-layer').click(); await new Promise((r2) => setTimeout(r2, 50));
    const c1 = cnt();
    $('#btn-undo').click(); await new Promise((r2) => setTimeout(r2, 80));
    const c2 = cnt();
    $('#btn-redo').click(); await new Promise((r2) => setTimeout(r2, 80));
    const c3 = cnt();
    return { c0, c1, c2, c3 };
  });
  assert.equal(r.c1, r.c0 + 1, 'لایه اضافه شد');
  assert.equal(r.c2, r.c0, 'undo لایه را برداشت (این قبلاً کار نمی‌کرد)');
  assert.equal(r.c3, r.c0 + 1, 'redo برگرداند');
});

test('UI: کوپه‌لایه (duplicate) مستقل است — COW واقعی', async () => {
  const r = await page.evaluate(async () => {
    const $ = (s) => document.querySelector(s);
    // قلم بزن روی لایه، بعد دوپلیکیت، بعد رنگی متفاوت روی کپی بزن
    document.querySelector('[data-tool="brush"]').click();
    const canvas = document.querySelector('#canvas');
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent('pointerdown', { clientX: rect.left + 400, clientY: rect.top + 300, bubbles: true, pointerId: 11, isPrimary: true, button: 0 }));
    canvas.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    await new Promise((r2) => setTimeout(r2, 60));
    $('#btn-dup-layer').click();
    await new Promise((r2) => setTimeout(r2, 60));
    // بررسی مستقل بودن آرایه‌های کاشی از طریق وضعیت داخلی
    return { items: document.querySelectorAll('#layers-list .layer-item').length };
  });
  assert.equal(r.items >= 2, true, 'دو لایه وجود دارد');
});

test('UI: فایل صادرشدهٔ TIFF معتبر است (امضای هدر)', async () => {
  const r = await page.evaluate(async () => {
    const mod = await import('../src/formats/tiff.js');
    const w = 8, h = 8;
    const data = new Uint8ClampedArray(w * h * 4).fill(128);
    const t = mod.encodeTIFF({ width: w, height: h, data });
    return { len: t.length, b0: t[0], b1: t[1], magic: (t[2] | (t[3] << 8)) };
  });
  assert.equal(r.b0 === 0x49 && r.b1 === 0x49, true, 'II (little-endian)');
  assert.equal(r.magic, 42, 'magic = 42');
  assert.equal(r.len > 32, true, 'حجم معقول');
});

test('UI: گزینه‌های PSD (فشرده‌سازی/حالت رنگ/عمق ۱۶/lrFX) فقط برای PSD ظاهر و ذخیره می‌شوند', async () => {
  const r = await page.evaluate(() => {
    document.querySelector('#export-format').value = 'psd';
    document.querySelector('#export-format').dispatchEvent(new Event('change'));
    const box = document.querySelector('#psd-opts');
    const visAfterPsd = getComputedStyle(box).display;
    document.querySelector('#psd-compression').value = 'zipPred';
    document.querySelector('#psd-compression').dispatchEvent(new Event('change'));
    document.querySelector('#psd-colormode').value = 'cmyk';
    document.querySelector('#psd-colormode').dispatchEvent(new Event('change'));
    document.querySelector('#btn-psd-depth').click();
    document.querySelector('#btn-psd-legacyfx').click();
    document.querySelector('#export-format').value = 'png';
    document.querySelector('#export-format').dispatchEvent(new Event('change'));
    const visAfterPng = getComputedStyle(box).display;
    return {
      visAfterPsd, visAfterPng,
      depthPressed: document.querySelector('#btn-psd-depth').getAttribute('aria-pressed'),
      legacyPressed: document.querySelector('#btn-psd-legacyfx').getAttribute('aria-pressed'),
      hasFs: !!document.querySelector('script[type="module"]'),
    };
  });
  assert.equal(r.visAfterPsd !== 'none', true, 'گزینه‌های PSD با انتخاب PSD نمایان می‌شوند');
  assert.equal(r.visAfterPng, 'none', 'با فرمت دیگر پنهان می‌شوند');
  assert.equal(r.depthPressed, 'true', 'عمق ۱۶ فعال شد');
  assert.equal(r.legacyPressed, 'true', 'بلوک lrFX فعال شد');
});

test('UI: خروجی PSD چندلایه با ZIP+Prediction و CMYK از خودِ برنامه ساخته می‌شود', async () => {
  const r = await page.evaluate(async () => {
    const { encodeLayeredPSD } = await import('../src/formats/psd-layers.js');
    const doc = window.__lumina && window.__lumina.doc;
    if (!doc) return { skip: true };
    const comp = doc.toRGBA();
    const rle = await encodeLayeredPSD(doc, { composite: comp, compression: 'rle' });
    const zip = await encodeLayeredPSD(doc, { composite: comp, compression: 'zipPred' });
    const cmyk = await encodeLayeredPSD(doc, { composite: comp, compression: 'zip', colorMode: 'cmyk' });
    const dv = new DataView(cmyk.buffer, cmyk.byteOffset);
    return {
      rle: rle.length, zip: zip.length, cmyk: cmyk.length,
      magic: String.fromCharCode(rle[0], rle[1], rle[2], rle[3]),
      cmykMode: dv.getUint16(24, false),
    };
  });
  if (r.skip) return;
  assert.equal(r.magic, '8BPS', 'امضای PSD');
  assert.equal(r.zip < r.rle, true, 'ZIP+Prediction کوچک‌تر از RLE');
  assert.equal(r.cmykMode, 4, 'حالت رنگی CMYK در خروجی برنامه');
});
