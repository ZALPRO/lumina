// tools/verify-psd.mjs — ساخت و اعتبارسنجی PSD چندلایه
// اجرا:  node tools/verify-psd.mjs
// فایل نمونه را می‌سازد و (در صورت نصب بودن psd-tools پایتون) مستقل اعتبارسنجی می‌کند.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Document } from '../src/document/document.js';
import { Paint } from '../src/document/paint.js';
import { Layer } from '../src/document/layer.js';
import { encodeLayeredPSD } from '../src/formats/psd-layers.js';
import { decodeLayeredPSD } from '../src/formats/psd-read.js';
import { srgbProfile } from '../src/formats/icc.js';

const W = 320, H = 200;
const doc = new Document({ width: W, height: H, name: 'VerifyPSD' });

const mk = (name, color, rect, opts = {}) => {
  const p = new Paint(W, H);
  p.clearRect(rect, color[0], color[1], color[2], color[3]);
  doc.addLayer(new Layer({ name, paint: p, ...opts }));
};

mk('Background', [240, 238, 230, 255], { x: 0, y: 0, w: W, h: H });
mk('Hero Block', [30, 90, 200, 255], { x: 20, y: 20, w: 180, h: 120 }, { blendMode: 'multiply', opacity: 0.85 });
doc.addLayer(new Layer({ name: 'Decor Group', isGroup: true, opacity: 0.9 }));
mk('Badge', [250, 200, 40, 255], { x: 40, y: 40, w: 60, h: 60 });
mk('Star', [255, 90, 90, 255], { x: 120, y: 60, w: 40, h: 40 }, { blendMode: 'screen' });
doc.addLayer(new Layer({ name: '</Layer group>', isGroupEnd: true }));
doc.addLayer(new Layer({ name: 'Invert', adjustment: { type: 'invert', label: 'Invert' } }));
mk('Hidden Note', [10, 10, 10, 255], { x: 200, y: 150, w: 100, h: 40 }, { visible: false });

// ── قابلیت‌های کامل‌شده ──
// استایل لایه (Layer Style): سایه + خط دور + رنگ‌روی
mk('Styled Card', [250, 200, 40, 255], { x: 40, y: 40, w: 60, h: 60 }, {
  style: {
    dropShadow: { dx: 6, dy: 8, blur: 10, color: [0, 0, 0], opacity: 0.55, spread: 2 },
    stroke: { size: 3, color: [255, 255, 255], position: 'outside', opacity: 1 },
    colorOverlay: { color: [230, 60, 60], opacity: 0.2 },
  },
});
// ماسک برداری (vmsk)
{
  const vm = new Uint8Array(W * H);
  for (let y = 60; y < 140; y++) for (let x = 200; x < 300; x++) vm[y * W + x] = 1;
  doc.addLayer(new Layer({ name: 'Vector Mask', vectorMask: { mask: vm, w: W, h: H } }));
}
// لایهٔ تنظیم Curves با کلید بومی curv
doc.addLayer(new Layer({
  name: 'Curves',
  adjustment: { type: 'curves', label: 'Curves', points: [[0, 16], [64, 96], [128, 150], [255, 240]] },
}));

const outPath = process.argv[2] || '/home/user/out/verify-layered.psd';
const compression = process.env.PSD_COMPRESSION || 'zipPred';   // rle | zip | zipPred
const depth = process.env.PSD_DEPTH === '16' ? 16 : 8;
const buf = await encodeLayeredPSD(doc, {
  composite: doc.toRGBA(), icc: srgbProfile(), compression, depth, legacyEffects: true,
});
console.log(`   فشرده‌سازی: ${compression} | عمق: ${depth} بیت | افکت lfx2+lrFX`);
fs.writeFileSync(outPath, Buffer.from(buf));

console.log(`✅ PSD نوشته شد: ${outPath} (${buf.length} بایت)`);
console.log(`   لایه‌های سند: ${doc.layers.length}`);

// خواندن با موتور خودمان
const back = await decodeLayeredPSD(new Uint8Array(buf));
console.log(`🔁 خواندن با موتور Lumina: ${back.layers.length} لایه`);
for (const l of back.layers) {
  console.log(`     - ${String(l.name).padEnd(16)} group=${l.isGroup ? 'Y' : ' '} end=${l.isGroupEnd ? 'Y' : ' '} vis=${l.visible ? 'Y' : 'n'} op=${l.opacity.toFixed(2)} blend=${l.blendMode}${l.adjustment ? ' adj=' + l.adjustment.type : ''}`);
}

// اعتبارسنجی مستقل با psd-tools (پایتون) — اگر موجود باشد
try {
  const py = `
from psd_tools import PSDImage
from PIL import ImageCms
import io, sys
psd = PSDImage.open(${JSON.stringify(outPath)})
print("   size:", psd.size, "channels:", psd.channels, "depth:", psd.depth)
def walk(c, d=1):
    for l in c:
        print("   " + "  "*d + f"- {l.name!r} kind={l.kind} vis={l.visible} op={l.opacity} blend={l.blend_mode.name}")
        if l.is_group(): walk(l, d+1)
walk(psd)

# ── قابلیت‌های کامل‌شده: استایل لایه، ماسک برداری، Curves، فشرده‌سازی ──
from psd_tools.constants import Tag, Compression
ok = []
prob = []
for l in psd.descendants():
    if l.name == 'Styled Card':
        shadows = list(l.effects.find('DropShadow'))
        strokes = list(l.effects.find('Stroke'))
        overlays = list(l.effects.find('ColorOverlay'))
        if shadows and strokes and overlays:
            sd = shadows[0]
            ok.append(f"استایل لایه: سایه(بلور={sd.size:.0f}px، فاصله={sd.distance:.1f}px، شفافیت={sd.opacity:.0f}%) + خط دور({strokes[0].size:.0f}px، {strokes[0].position.decode()}) + رنگ‌روی")
        else:
            prob.append('استایل لایه ناقص: ' + str([len(shadows), len(strokes), len(overlays)]))
    if l.name == 'Vector Mask' and l.vector_mask:
        sub = l.vector_mask.paths[0] if l.vector_mask.paths else None
        ok.append(f"ماسک برداری: {len(sub) if sub else 0} گره، عملیات={getattr(sub, 'operation', '?')}")
    if l.name == 'Curves':
        adj = psd._record.layer_and_mask_information.layer_info
        try:
            from psd_tools.psd.adjustments import Curves
            rec = [r for r in adj.layer_records if r.name.strip() == 'Curves'][0]
            curv = rec.tagged_blocks.get_data(Tag.CURVES)
            ok.append(f"Curves بومی: نسخه={curv.version}، کانال‌ها={len(curv.data)}، نقاط={len(curv.data[0])}")
        except Exception as e:
            prob.append('Curves: ' + str(e))

# فشرده‌سازی کانال‌های لایه
recs = psd._record.layer_and_mask_information.layer_info.layer_records
comps = set()
try:
    from psd_tools.psd.layer_and_mask import ChannelImageData
    cid = psd._record.layer_and_mask_information.layer_info.channel_image_data
    for cd in cid:
        for cell in cd:
            comps.add(int(cell.compression))
    names = {1: 'RLE', 2: 'ZIP', 3: 'ZIP+Prediction', 0: 'RAW'}
    ok.append('فشرده‌سازی کانال لایه: ' + ', '.join(sorted(names.get(c, str(c)) for c in comps)))
except Exception as e:
    prob.append('فشرده‌سازی: ' + str(e))

print("   ★ قابلیت‌های کامل‌شده:")
for line in ok: print("      ✓", line)
for line in prob: print("      ✗", line)
if prob: sys.exit(3)
icc = psd.image_resources.get(1039) or psd.image_resources.get(1041)
if icc is not None:
    raw_icc = icc.value if hasattr(icc, "value") else bytes(icc.data)
    print("   ICC:", ImageCms.getProfileDescription(ImageCms.ImageCmsProfile(io.BytesIO(raw_icc))).strip())
else:
    print("   ICC: —")
comp = psd.composite(apply_icc=False)
print("   composite:", comp.size, "pixel(1,1):", comp.getpixel((1,1)))
`;
  const res = execFileSync('python3', ['-c', py], { encoding: 'utf8' });
  console.log('🔎 اعتبارسنجی مستقل (psd-tools / LCMS):');
  console.log(res.replace(/\s+$/, ''));
  console.log('✅ PSD توسط کتابخانهٔ مستقل با موفقیت خوانده شد (سازگار با فتوشاپ).');
} catch (e) {
  const msg = (e.stderr || e.message || '').toString().trim();
  if (/No module named 'psd_tools'/.test(msg)) {
    console.log('ℹ️  psd-tools نصب نیست؛ اعتبارسنجی مستقل انجام نشد (pip install psd-tools).');
  } else {
    console.log('⚠️  اعتبارسنجی مستقل ناموفق بود:\n' + msg);
  }
}
