// formats/icc.js — پروفایل رنگ ICC (sRGB v2) + درج/خواندن در PNG (iCCP) و JPEG (APP2)
// چرا مهم: فتوشاپ بدون پروفایل، تصویر را «بی‌هویت رنگی» می‌داند و مدیریت رنگ می‌شکند.
// این ماژول یک پروفایل sRGB استاندارد می‌سازد (بدون فایل باینری خارجی) و آن را در خروجی می‌نویسد.

// ── کمکی‌ها ──
function s15_16(v) {
  const n = Math.round(v * 65536);
  return (n < 0 ? n + 0x100000000 : n) >>> 0;
}
function u32(arr, off, v) { arr[off] = (v >>> 24) & 255; arr[off + 1] = (v >>> 16) & 255; arr[off + 2] = (v >>> 8) & 255; arr[off + 3] = v & 255; }
function u16(arr, off, v) { arr[off] = (v >>> 8) & 255; arr[off + 1] = v & 255; }
function sig(str) { const a = new Uint8Array(4); for (let i = 0; i < 4; i++) a[i] = str.charCodeAt(i); return a; }

export function isICC(u8) {
  return u8 && u8.length >= 128 && u8[36] === 0x61 && u8[37] === 0x63 && u8[38] === 0x73 && u8[39] === 0x70;
}

// ── ساخت پروفایل sRGB v2 (matrix/TRC) ──
// نکته‌های مهم سازگاری (اصلاح‌شده):
//   • در ICC، فضای اتصال (PCS) همیشه D50 است؛ پس نقطهٔ سفید باید D50 باشد و
//     ماتریس‌های رنگی هم همان‌های «تطبیق‌یافته با D50» باشند. قبلاً wtpt روی D65
//     نوشته می‌شد در حالی که رنگ‌ها D50 بودند ⇒ تبدیل رنگ تا ۹ سطح خطا می‌داد.
//   • منحنی تُن باید منحنی تکه‌ای استاندارد sRGB باشد (نه گامای سادهٔ ۲.۲)؛
//     در غیر این صورت سایه‌ها در فتوشاپ/LCMS جابه‌جا می‌شوند.
const SRGB = {
  rXYZ: [0.436065674, 0.222488403, 0.013916016],
  gXYZ: [0.385147095, 0.716873169, 0.097076416],
  bXYZ: [0.143066406, 0.060607910, 0.714096069],
  wtpt: [0.964202881, 1.0, 0.824905396],           // D50 (استاندارد PCS)
  chad: [                                          // Bradford: D65 → D50
    1.047882, 0.022919, -0.050217,
    0.029602, 0.990463, -0.017075,
    -0.009216, 0.015076, 0.751724,
  ],
  chrm: [[0.6400, 0.3300], [0.3000, 0.6000], [0.1500, 0.0600]],
  // پارامترهای منحنی استاندارد sRGB با همان کوانتیزهٔ پروفایل‌های مرجع (s15Fixed16)
  //   g=2.4 | a=1/1.055 | b=0.055/1.055 | c=1/12.92 | d=0.04045
  para: [2.399994, 0.947861, 0.052139, 0.077393, 0.040451],
};

// textDescriptionType ('desc') — ساختار v2 با کدگذاری محلی (ASCII) + یونیکد + scriptcode
function descTag(text) {
  const bytes = [];
  const pushU32 = (v) => bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  pushU32(0x64657363);                          // امضای نوع: 'desc'
  pushU32(0);                                   // reserved
  const ascii = text + '\0';
  pushU32(ascii.length);                        // شمارش ASCII (با NUL)
  for (let i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i) & 0xFF);
  pushU32(0);                                   // unicode language code
  pushU32(0);                                   // unicode count
  pushU32(0);                                   // scriptcode code
  for (let i = 0; i < 67; i++) bytes.push(0);   // scriptcode (۶۷ بایت ثابت)
  return new Uint8Array(bytes);
}

// textType ('text') — رشتهٔ ASCII خالص
function textTag(text) {
  const bytes = [];
  const pushU32 = (v) => bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  pushU32(0x74657874);                          // امضای نوع: 'text'
  pushU32(0);                                   // reserved
  const ascii = text + '\0';
  for (let i = 0; i < ascii.length; i++) bytes.push(ascii.charCodeAt(i) & 0xFF);
  return new Uint8Array(bytes);
}

function xyzTag(xyz) {
  // XYZType: 'XYZ ' + reserved(4) + ۳ مقدار s15Fixed16 (X,Y,Z)
  const d = new Uint8Array(20);
  u32(d, 0, 0x58595A20);                        // 'XYZ '
  u32(d, 4, 0);
  u32(d, 8, s15_16(xyz[0]));
  u32(d, 12, s15_16(xyz[1]));
  u32(d, 16, s15_16(xyz[2]));
  return d;
}

function curveTag(gamma) {
  const d = new Uint8Array(14);
  u32(d, 0, 0x63757276);                        // 'curv'
  u32(d, 4, 0);
  u32(d, 8, 1);                                 // count = 1 → مقدار گاما
  u16(d, 12, Math.round(gamma * 256));          // u8Fixed8
  return d;
}

// parametricCurveType ('para') با تابع نوع ۳ ⇒ منحنی دقیق sRGB
//   Y = (a·X + b)^g برای X ≥ d، وگرنه Y = c·X
function paraCurveTag(params) {
  const [g, a, b, c, d] = params;
  const out = new Uint8Array(12 + 4 + 5 * 4);
  u32(out, 0, 0x70617261);                      // 'para'
  u32(out, 4, 0);
  u16(out, 8, 3);                               // function type = 3
  u16(out, 10, 0);                              // reserved
  const vals = [g, a, b, c, d];
  for (let i = 0; i < 5; i++) u32(out, 12 + i * 4, s15_16(vals[i]));
  return out;
}

// s15Fixed16ArrayType ('sf32') — برای تگ تطبیق کروماتیک (chad)
function sf32Tag(matrix) {
  const out = new Uint8Array(8 + matrix.length * 4);
  u32(out, 0, 0x73663332);                      // 'sf32'
  u32(out, 4, 0);
  for (let i = 0; i < matrix.length; i++) u32(out, 8 + i * 4, s15_16(matrix[i]));
  return out;
}

// chromaticityType ('chrm')
function chrmTag(primaries) {
  const out = new Uint8Array(12 + primaries.length * 8);
  u32(out, 0, 0x6368726D);                      // 'chrm'
  u32(out, 4, 0);
  u32(out, 8, primaries.length);
  for (let i = 0; i < primaries.length; i++) {
    u32(out, 12 + i * 8, s15_16(primaries[i][0]));
    u32(out, 16 + i * 8, s15_16(primaries[i][1]));
  }
  return out;
}

export function buildSRGBProfile() {
  const tags = [
    { sig: 'desc', data: descTag('Lumina sRGB IEC61966-2.1') },
    { sig: 'wtpt', data: xyzTag(SRGB.wtpt) },
    { sig: 'rXYZ', data: xyzTag(SRGB.rXYZ) },
    { sig: 'gXYZ', data: xyzTag(SRGB.gXYZ) },
    { sig: 'bXYZ', data: xyzTag(SRGB.bXYZ) },
    { sig: 'chad', data: sf32Tag(SRGB.chad) },
    { sig: 'chrm', data: chrmTag(SRGB.chrm) },
    { sig: 'rTRC', data: paraCurveTag(SRGB.para) },
    { sig: 'gTRC', data: paraCurveTag(SRGB.para) },
    { sig: 'bTRC', data: paraCurveTag(SRGB.para) },
    { sig: 'cprt', data: textTag('Public Domain - Lumina') },
  ];
  const tableSize = 4 + tags.length * 12;
  let dataOff = 128 + tableSize;
  if (dataOff % 4) dataOff += 4 - (dataOff % 4);

  const chunks = tags.map((t) => {
    const pad = (4 - (t.data.length % 4)) % 4;
    const buf = new Uint8Array(t.data.length + pad);
    buf.set(t.data);
    return buf;
  });
  let total = dataOff;
  for (const c of chunks) total += c.length;

  const out = new Uint8Array(total);
  // header
  u32(out, 0, total);
  u32(out, 4, 0);                                  // CMM
  u32(out, 8, 0x02100000);                         // v2.1.0
  out[12] = 0x6D; out[13] = 0x6E; out[14] = 0x74; out[15] = 0x72;   // 'mntr'
  out[16] = 0x52; out[17] = 0x47; out[18] = 0x42; out[19] = 0x20;   // 'RGB '
  out[20] = 0x58; out[21] = 0x59; out[22] = 0x5A; out[23] = 0x20;   // 'XYZ '
  u16(out, 24, 2026); u16(out, 26, 9); u16(out, 28, 18);            // تاریخ ساخت
  u16(out, 30, 12); u16(out, 32, 0); u16(out, 34, 0);
  out.set(sig('acsp'), 36);
  u32(out, 40, 0);                                 // platform
  u32(out, 44, 0);                                 // flags
  u32(out, 48, 0); u32(out, 52, 0);                // manufacturer / model
  u32(out, 56, 0); u32(out, 60, 0);                // attributes
  u32(out, 64, 0);                                 // rendering intent = perceptual
  u32(out, 68, s15_16(0.96420288));                // PCS illuminant D50 X
  u32(out, 72, s15_16(1.0));
  u32(out, 76, s15_16(0.82490540));
  out.set(sig('Lumi'), 80);                        // creator
  // profile ID (MD5) خالی — اختیاری در v2
  u32(out, 84, 0); u32(out, 88, 0); u32(out, 92, 0); u32(out, 96, 0);
  u32(out, 100, 0); u32(out, 104, 0); u32(out, 108, 0); u32(out, 112, 0);
  u32(out, 116, 0); u32(out, 120, 0); u32(out, 124, 0);
  // tag table
  u32(out, 128, tags.length);
  let p = dataOff;
  tags.forEach((t, i) => {
    const e = 132 + i * 12;
    out.set(sig(t.sig), e);
    u32(out, e + 4, p);
    u32(out, e + 8, chunks[i].length);
    p += chunks[i].length;
  });
  let q = dataOff;
  for (const c of chunks) { out.set(c, q); q += c.length; }
  return out;
}

let _cached = null;
export function srgbProfile() { return _cached || (_cached = buildSRGBProfile()); }

// خواندن نام پروفایل از تگ desc (برای نمایش در UI)
export function describeICC(u8) {
  if (!isICC(u8)) return null;
  try {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const n = dv.getUint32(128, false);
    for (let i = 0; i < n; i++) {
      const e = 132 + i * 12;
      const s = String.fromCharCode(u8[e], u8[e + 1], u8[e + 2], u8[e + 3]);
      if (s === 'desc') {
        const off = dv.getUint32(e + 4, false);
        const type = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
        if (type === 'desc') {
          const cnt = dv.getUint32(off + 8, false);
          let str = '';
          for (let k = 0; k < cnt; k++) {
            const c = u8[off + 12 + k];
            if (!c) break;
            str += String.fromCharCode(c);
          }
          return str;
        }
        if (type === 'mluc') {   // v4: اولین رکورد UTF-16BE
          const cnt = dv.getUint32(off + 8, false);
          const len = dv.getUint32(off + 20, false);
          const strOff = dv.getUint32(off + 24, false);
          let str = '';
          for (let k = 0; k < len / 2; k++) {
            const c = dv.getUint16(off + strOff + k * 2, false);
            if (!c) break;
            str += String.fromCharCode(c);
          }
          return str || null;
        }
        return null;
      }
    }
  } catch { /* پروفایل ناقص */ }
  return null;
}

// ── درج در JPEG (APP2 / ICC_PROFILE) ──
export function jpegICCSegments(profile) {
  const MAX = 65519 - 14;   // سقف سگمنت
  const parts = [];
  const total = Math.ceil(profile.length / MAX) || 1;
  for (let i = 0; i < total; i++) {
    const chunk = profile.subarray(i * MAX, Math.min(profile.length, (i + 1) * MAX));
    const len = chunk.length + 14;
    const seg = new Uint8Array(len + 2);
    seg[0] = 0xFF; seg[1] = 0xE2;
    seg[2] = (len >> 8) & 255; seg[3] = len & 255;
    seg.set(sig('ICC_PROFILE'), 4);
    seg[8] = i + 1; seg[9] = total;
    seg.set(chunk, 10);
    parts.push(seg);
  }
  return parts;
}

// ── بلوک iCCP برای PNG ──
export function pngICCPChunk(profile) {
  // iCCP: name(NUL) + compression method(0=zlib) + zlib(profile)
  const name = 'Lumina sRGB';
  const head = new Uint8Array(name.length + 2);
  for (let i = 0; i < name.length; i++) head[i] = name.charCodeAt(i);
  head[name.length] = 0;
  head[name.length + 1] = 0;
  return { head, profile };
}
