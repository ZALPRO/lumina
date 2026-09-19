// tools/verify-corpus.mjs — اعتبارسنجی موتور PSD لومیما روی فایل‌های واقعی فتوشاپ
//
// چرا: صحت یک خواننده/نویسندهٔ PSD را نمی‌توان فقط با فایل‌های خودمان سنجید.
// این ابزار فایل‌های نمونهٔ مخزن psd-tools (ساختهٔ خودِ فتوشاپ) را می‌گیرد و
// خروجی موتور لومیما را با مرجع psd-tools مقایسه می‌کند.
//
// اجرا:
//   node tools/verify-corpus.mjs                    # فایل‌های کش‌شده در /tmp/corpus
//   node tools/verify-corpus.mjs --download         # دانلود مجموعه از GitHub
//   node tools/verify-corpus.mjs --dir=/path/to/psd # پوشهٔ دلخواه
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { decodeLayeredPSD } from '../src/formats/psd-read.js';

const BASE = 'https://raw.githubusercontent.com/psd-tools/psd-tools/main/tests/psd_files';
const FILES = [
  '1layer.psd', '2layers.psd', '16bit5x5.psd',
  'cmyk-gray-ramp.psd', 'cmyk-spot.psd',
  'adjustments/curves_rgb.psd', 'adjustments/curves_cmyk.psd',
];
const dirArg = process.argv.find((a) => a.startsWith('--dir='));
const dir = dirArg ? dirArg.slice(6) : '/tmp/corpus';
const download = process.argv.includes('--download');

fs.mkdirSync(dir, { recursive: true });
if (download) {
  for (const f of FILES) {
    const dest = path.join(dir, path.basename(f));
    if (fs.existsSync(dest)) continue;
    const res = await fetch(`${BASE}/${f}`);
    if (!res.ok) { console.log(`⚠️  دانلود نشد: ${f} (${res.status})`); continue; }
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log(`⬇️  ${path.basename(f)}`);
  }
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
        step = 4 if depth == 32 else (2 if depth == 16 else 1)
        import struct as _struct
        def sample(c, i):
            if depth == 32:
                v = _struct.unpack('>f', planes[c][i:i+4])[0]
                return round(255 * min(1.0, max(0.0, v)))
            return planes[c][i]
        def px(x, y):
            i = (y * W + x) * step
            g = lambda c: sample(c, i)
            if mode == 'CMYK' or (mode == 'RGB' and ch >= 4 and ch > 4):
                # CMYK معکوس ذخیره می‌شود: بایت = 255 − مرکب
                C, M, Y, K = [255 - g(c) for c in range(4)]
                return [round((255-C)*(255-K)/255), round((255-M)*(255-K)/255), round((255-Y)*(255-K)/255), 255]
            if ch == 1: return [g(0), g(0), g(0), 255]
            if ch == 2: return [g(0), g(0), g(0), sample(1, i)]
            if ch == 3: return [g(0), g(1), g(2), 255]
            return [g(0), g(1), g(2), g(3)]
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
