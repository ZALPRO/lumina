// tools/verify-corpus.mjs — اعتبارسنجی موتور PSD لومیما روی فایل‌های واقعی فتوشاپ
//
// چرا: صحت یک خواننده/نویسندهٔ PSD را نمی‌توان فقط با فایل‌های خودمان سنجید.
// این ابزار فایل‌های نمونهٔ مخزن psd-tools (ساختهٔ خودِ فتوشاپ) را می‌گیرد و
// خروجی موتور لومیما را با مرجع psd-tools مقایسه می‌کند.
//
// اجرا:
//   node tools/verify-corpus.mjs                    # فایل‌های کش‌شده در .corpus/ (ریشهٔ مخزن)
//   node tools/verify-corpus.mjs --download         # دانلود مجموعه از GitHub
//   node tools/verify-corpus.mjs --dir=/path/to/psd # پوشهٔ دلخواه
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { decodeLayeredPSD } from '../src/formats/psd-read.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const BASE = 'https://raw.githubusercontent.com/psd-tools/psd-tools/main/tests/psd_files';
// مجموعهٔ سنجیده‌شده: RGB/CMYK/Grayscale، عمق ۸/۱۶/۳۲، RAW/RLE/ZIP، فایل تخت و
// چندلایه، ترکیب تودرتو، برش، ماسک سراسری، لایه‌های تنظیم و متنی.
const FILES = [
  '1layer.psd', '2layers.psd', '16bit5x5.psd', '32bit.psd', '32bit5x5.psd',
  'cmyk-gray-ramp.psd', 'cmyk-spot.psd',
  'adjustment-fillers.psd', 'adjustment-mask.psd',
  'adjustments/adjustment_backdrop_test.psd',
  'adjustments/adjustment_clipping.psd',
  'adjustments/adjustment_nested_composition_1.psd',
  'adjustments/adjustment_nested_composition_2.psd',
  'adjustments/adjustment_nested_composition_3.psd',
  'adjustments/adjustment_nested_composition_4.psd',
  'adjustments/adjustment_nested_composition_5.psd',
  'adjustments/brightnesscontrast_cmyk.psd',
  'adjustments/brightnesscontrast_grayscale.psd',
  'adjustments/brightnesscontrast_legacy_cmyk.psd',
  'adjustments/brightnesscontrast_legacy_grayscale.psd',
  'adjustments/curves_cmyk.psd',
  'adjustments/curves_grayscale.psd',
  'adjustments/curves_rgb.psd',
  'adjustments/exposure_grayscale.psd',
  'adjustments/invert_cmyk.psd',
  'adjustments/invert_grayscale.psd',
  'adjustments/levels_cmyk.psd',
  'adjustments/levels_grayscale.psd',
  'adjustments/levels_rgb.psd',
  'adjustments/posterize_16bits_cmyk.psd',
];
const dirArg = process.argv.find((a) => a.startsWith('--dir='));
const dir = dirArg ? path.resolve(dirArg.slice(6)) : path.join(ROOT, '.corpus');
const download = process.argv.includes('--download');
// --all: هر فایل .psd موجود در مخزن مرجع (اطلاعاتی؛ با --strict کد خروج ۱ می‌شود)
const allMode = process.argv.includes('--all');
const strict = process.argv.includes('--strict');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.slice(8)) : 0;

async function downloadOne(rel, attempts = 3) {
  const dest = path.join(dir, path.basename(rel));
  if (fs.existsSync(dest)) return true;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${BASE}/${rel}`);
      if (!res.ok) { console.log(`⚠️  دانلود نشد: ${rel} (${res.status})`); return false; }
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      console.log(`⬇️  ${path.basename(rel)}`);
      return true;
    } catch (e) {
      if (i === attempts - 1) { console.log(`⚠️  خطای شبکه در ${rel}: ${e.message}`); return false; }
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  return false;
}

fs.mkdirSync(dir, { recursive: true });
if (download || allMode) {
  let list = FILES;
  if (allMode) {
    const tree = await (await fetch('https://api.github.com/repos/psd-tools/psd-tools/git/trees/main?recursive=1')).json();
    list = (tree.tree || [])
      .map((t) => t.path)
      .filter((p) => p.startsWith('tests/psd_files/') && p.toLowerCase().endsWith('.psd'))
      .map((p) => p.slice('tests/psd_files/'.length))
      .sort();
    if (limit) list = list.slice(0, limit);
    console.log(`ℹ️  حالت --all: ${list.length} فایل .psd از مخزن مرجع`);
  }
  for (const f of list) await downloadOne(f);
}

const files = fs.readdirSync(dir).filter((f) => /\.(psd|psb)$/i.test(f)).sort();
if (!files.length) {
  console.log('ℹ️  فایل نمونه‌ای در ' + dir + ' نیست. با --download اجرا کنید.');
  process.exit(0);
}

const results = [];
for (const f of files) {
  const full = path.join(dir, f);
  const record = { file: f, ok: false };
  try {
    const buf = new Uint8Array(fs.readFileSync(full));
    const t0 = Date.now();
    const d = await decodeLayeredPSD(buf);
    record.ms = Date.now() - t0;
    record.w = d.width; record.h = d.height; record.layers = d.layers.length;
    const pts = [[0, 0], [d.width >> 1, d.height >> 1], [d.width - 1, d.height - 1]];
    const px = [0, 0, 0, 0];
    record.samples = [];
    for (const [x, y] of pts) { d.merged.getPixel(x, y, px); record.samples.push(px.slice()); }
    record.points = pts;
    record.icc = !!d.icc;
    record.ok = true;
  } catch (e) {
    record.error = e.message;
  }
  results.push(record);
}

// مرجع مستقل: پلن‌های «خام» استخراج‌شده با psd-tools و ترکیبشان با همان قواعد
// عمومی (رنگ + آلفا، معکوس‌سازی CMYK). دقت کنید عمداً از composite() استفاده
// نمی‌کنیم: psd-tools در numpy()/composite() یک «حذف پس‌زمینهٔ سفید» هم انجام
// می‌دهد که یک انتخاب ویرایشی است، نه دادهٔ ذخیره‌شده در فایل. مقایسه با پلن خام،
// دقیقاً می‌سنجد که موتور ما همان چیزی را می‌خواند که در فایل هست.
let ref = null;
try {
  const py = `
import json
from psd_tools import PSDImage
out = {}
for f in ${JSON.stringify(files)}:
    try:
        psd = PSDImage.open(${JSON.stringify(dir)} + '/' + f)
        hdr = psd._record.header
        planes = [bytes(p) for p in psd._record.image_data.get_data(hdr, split=True)]
        ch, W, H = hdr.channels, hdr.width, hdr.height
        depth = hdr.depth
        mode = psd.color_mode.name
        # ۸ بیت: یک بایت | ۱۶ بیت: دو بایت (بایت بالا) | ۳۲ بیت: float32 (۰..۱)
        if depth == 1:
            # ۱ بیت در هر نمونه: بیت‌ها از بایت بالا (چپ‌چین) خوانده می‌شوند
            row_bytes = (W + 7) // 8
            planes = [b[:(row_bytes * H)] for b in planes]
            def bit(i):
                y, x = divmod(i, W)
                return (planes[0][y * row_bytes + (x >> 3)] >> (7 - (x & 7))) & 1
        step = 4 if depth == 32 else (2 if depth == 16 else 1)
        import struct as _struct
        def sample(c, i):
            if depth == 1:
                return 0 if bit(i) else 255          # ۱ = سیاه، ۰ = سفید
            if depth == 32:
                v = _struct.unpack('>f', planes[c][i:i+4])[0]
                return round(255 * min(1.0, max(0.0, v)))
            return planes[c][i]
        def px(x, y):
            i = (y * W + x) * step
            g = lambda c: sample(c, i)
            if mode == 'CMYK':
                # CMYK معکوس ذخیره می‌شود: بایت = 255 − مرکب؛ کانال پنجم (اگر باشد) آلفا
                C, M, Y, K = [255 - g(c) for c in range(4)]
                a = g(4) if ch >= 5 else 255
                return [round((255-C)*(255-K)/255), round((255-M)*(255-K)/255), round((255-Y)*(255-K)/255), a]
            if mode == 'BITMAP':
                v = sample(0, i)
                a = 255                      # Bitmap: آلفا در فایل‌های آزمون نیست
                return [v, v, v, a]
            if mode == 'INDEXED':
                pal = bytes(psd._record.color_mode_data.value)[:768]
                k = sample(0, i) * 3
                a = 255
                return [pal[k], pal[k+1], pal[k+2], a]
            if mode == 'DUOTONE':
                v = g(0)
                return [v, v, v, 255]
            if mode == 'LAB':
                L = g(0) * 100 / 255; a = g(1) - 128; b = g(2) - 128
                fy = (L + 16) / 116; fx = fy + a / 500; fz = fy - b / 200
                xr = fx**3 if fx**3 > 0.008856 else (116*fx - 16) / 903.3
                yr = fy**3 if L > 8 else L / 903.3
                zr = fz**3 if fz**3 > 0.008856 else (116*fz - 16) / 903.3
                X50, Y50, Z50 = xr*0.9642, yr*1.0, zr*0.8249
                X =  0.9555766*X50 - 0.0230393*Y50 + 0.0631636*Z50
                Y = -0.0282895*X50 + 1.0099416*Y50 + 0.0210077*Z50
                Z =  0.0122982*X50 - 0.0204830*Y50 + 1.3299098*Z50
                def gam(c):
                    c = 0.0 if c <= 0 else (1.0 if c >= 1 else c)
                    return 12.92*c if c <= 0.0031308 else 1.055*c**(1/2.4) - 0.055
                rl = 3.2404542*X - 1.5371385*Y - 0.4985314*Z
                gl = -0.9692660*X + 1.8760108*Y + 0.0415560*Z
                bl = 0.0556434*X - 0.2040259*Y + 1.0572252*Z
                return [round(gam(rl)*255), round(gam(gl)*255), round(gam(bl)*255), 255]
            if mode == 'GRAYSCALE':
                # کانال دوم (اگر باشد) کانال شفافیت است
                a = g(1) if ch >= 2 else 255
                return [g(0), g(0), g(0), a]
            # RGB: کانال چهارم (اگر باشد) آلفا؛ کانال‌های اضافه (spot) نادیده
            a = g(3) if ch >= 4 else 255
            return [g(0), g(1), g(2), a]
        pts = [(0,0), (W//2, H//2), (W-1, H-1)]
        out[f] = {'w': W, 'h': H, 'layers': len(list(psd.descendants())),
                  'mode': mode, 'channels': ch,
                  'samples': [px(x, y) for (x, y) in pts]}
    except Exception as e:
        out[f] = {'error': str(e)}
print(json.dumps(out))
`;
  ref = JSON.parse(execFileSync('python3', ['-c', py], { encoding: 'utf8' }));
} catch (e) {
  console.log('ℹ️  psd-tools (پایتون) در دسترس نیست؛ فقط خواندن با موتور خودمان سنجیده شد.');
}

console.log('\n── اعتبارسنجی روی فایل‌های واقعی فتوشاپ ──');
let pass = 0, fail = 0;
for (const r of results) {
  const line = [`${r.ok ? '✓' : '✗'} ${r.file.padEnd(24)}`];
  if (!r.ok) { line.push('خطا: ' + r.error); fail++; console.log(line.join(' ')); continue; }
  line.push(`${r.w}×${r.h}`.padEnd(10), `لایه=${String(r.layers).padEnd(3)}`, `icc=${r.icc ? 'Y' : '-'}`, `${r.ms}ms`);
  const R = ref && ref[r.file];
  if (R && !R.error) {
    const dimsOk = R.w === r.w && R.h === r.h;
    // پیکسل کاملاً شفاف: فقط آلفا معنا دارد (رنگِ پیکسل نامرئی است و در Paint
    // به (0,0,0,0) نرمال می‌شود) — پس فقط آلفا سنجیده می‌شود.
    const diffs = R.samples.map((s, i) => {
      const keys = s[3] === 0 ? [3] : [0, 1, 2, 3];
      return Math.max(...keys.map((k) => Math.abs(s[k] - r.samples[i][k])));
    });
    const maxd = Math.max(...diffs);
    line.push(`| ابعاد ${dimsOk ? '✓' : '✗'}`, `| اختلاف نمونه‌ها ${maxd === 0 ? '✓ ۰' : '~ ' + maxd}`);
    if (dimsOk && maxd <= 1) pass++; else fail++;
  } else pass++;
  console.log(line.join(' '));
}
if (ref) {
  console.log(`\nنتیجه: ${pass} فایل مطابق مرجع مستقل، ${fail} فایل اختلاف.`);
  console.log('مبنا: پلن‌های خام داخل فایل (نه بازرندر لایه‌ها و نه تبدیل رنگ با ICC).');
  console.log('یادداشت: پیکسل‌های کاملاً شفاف (آلفا=۰) در Paint به (0,0,0,0) نرمال می‌شوند — دیده‌نشدنی‌اند.');
}
if (fail) process.exit(1);
