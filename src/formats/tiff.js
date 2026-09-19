// formats/tiff.js — دیکودر TIFF (baseline + LZW + Deflate + PackBits)
// پشتیبانی: ۸/۱۶ بیت، Gray/RGB/RGBA، Planar=Chunky، Palette، WhiteIsZero/BlackIsZero،
// strip-based و tile-based (استریم بدون، ترتیب بایت II/MM).
import { inflateZlib } from './deflate.js';

const T = {
  WIDTH: 256, LENGTH: 257, BITS: 258, COMPRESSION: 259, PHOTOMETRIC: 262,
  STRIP_OFFSETS: 273, SAMPLES: 277, ROWS_PER_STRIP: 278, STRIP_BYTES: 279,
  PLANAR: 284, PREDICTOR: 317, COLOR_MAP: 320, TILE_WIDTH: 322, TILE_LENGTH: 323,
  TILE_OFFSETS: 324, TILE_BYTES: 325, SAMPLE_FORMAT: 339,
};

// DNG (RAW) = ظرف TIFF با تگ DNGVersion (50706). برای فایل‌های RAW خطی/بدون فشرده‌سازی
// و همچنین پیش‌نمایش‌های TIFF-based، دیکودر ما کار می‌کند.
export function isDNG(u8) {
  if (!isTIFF(u8)) return false;
  try {
    const le = u8[0] === 0x49;
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const ifd = dv.getUint32(4, le);
    if (ifd + 2 > u8.length) return false;
    const n = dv.getUint16(ifd, le);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > u8.length) break;
      const tag = dv.getUint16(e, le);
      if (tag === 50706) return true;   // DNGVersion
      if (tag === 50707 || tag === 50708) return true; // DNGBackwardVersion / UniqueCameraModel
    }
  } catch { /* فایل ناقص */ }
  return false;
}

export function isTIFF(u8) {
  if (u8.length < 8) return false;
  const le = u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 0x2A && u8[3] === 0x00;
  const be = u8[0] === 0x4D && u8[1] === 0x4D && u8[2] === 0x00 && u8[3] === 0x2A;
  return le || be;
}

class Reader {
  constructor(u8, le) { this.u8 = u8; this.le = le; this.dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); }
  u16(o) { return this.dv.getUint16(o, this.le); }
  u32(o) { return this.dv.getUint32(o, this.le); }
}

// خواندن IFD → { tag: [values] }
function readIFD(r, offset) {
  const tags = {};
  const count = r.u16(offset);
  for (let i = 0; i < count; i++) {
    const e = offset + 2 + i * 12;
    const tag = r.u16(e);
    const type = r.u16(e + 2);
    const num = r.u32(e + 4);
    const size = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][type] || 1;
    const total = size * num;
    let valOff = e + 8;
    if (total > 4) valOff = r.u32(e + 8);
    const vals = [];
    for (let k = 0; k < num; k++) {
      const o = valOff + k * size;
      if (o + size > r.u8.length) break;
      if (type === 3) vals.push(r.u16(o));
      else if (type === 4) vals.push(r.u32(o));
      else if (type === 1 || type === 6 || type === 7) vals.push(r.u8[o]);
      else if (type === 5) vals.push({ num: r.u32(o), den: r.u32(o + 4) });
      else if (type === 2) vals.push(r.u8[o]);
    }
    tags[tag] = vals;
  }
  const next = r.u32(offset + 2 + count * 12);
  return { tags, next };
}

// ─── LZW (TIFF: MSB-first, EarlyChange=1) ───
function lzwDecode(data, expected) {
  let out = new Uint8Array(expected > 0 ? expected : Math.max(1024, data.length * 4));
  let outPos = 0;
  let bitPos = 0;
  const CLEAR = 256, EOI = 257;
  let dict = [];
  const reset = () => {
    dict = new Array(258);
    for (let i = 0; i < 256; i++) dict[i] = [i];
    dict[256] = []; dict[257] = [];
  };
  reset();
  let codeSize = 9, prev = null;
  const readCode = () => {
    let code = 0;
    for (let i = 0; i < codeSize; i++) {
      const byte = bitPos >> 3;
      if (byte >= data.length) return EOI;
      const bit = (data[byte] >> (7 - (bitPos & 7))) & 1;
      code = (code << 1) | bit;
      bitPos++;
    }
    return code;
  };
  for (;;) {
    const code = readCode();
    if (code === EOI) break;
    if (code === CLEAR) { reset(); codeSize = 9; prev = null; continue; }
    let entry;
    if (code < dict.length && dict[code]) entry = dict[code];
    else if (prev) entry = [...prev, prev[0]];
    else break;
    for (const b of entry) {
      if (outPos >= out.length) {
        const bigger = new Uint8Array(Math.max(out.length * 2, outPos + entry.length + 1024));
        bigger.set(out);
        out = bigger;
      }
      out[outPos++] = b;
    }
    if (prev && dict.length < 4096) {
      dict.push([...prev, entry[0]]);
      // EarlyChange=1: افزایش عرض کد یک گام جلوتر
      if (dict.length + 1 >= (1 << codeSize) && codeSize < 12) codeSize++;
    }
    prev = entry;
  }
  return out.subarray(0, outPos);
}

// ─── PackBits ───
function packBitsDecode(data, expected) {
  const out = new Uint8Array(expected > 0 ? expected : data.length * 4);
  let i = 0, o = 0;
  while (i < data.length && o < out.length) {
    const n = (data[i++] << 24) >> 24;   // بایت علامت‌دار
    if (n >= 0) {
      for (let k = 0; k <= n && i < data.length && o < out.length; k++) out[o++] = data[i++];
    } else if (n !== -128) {
      const b = data[i++];
      for (let k = 0; k < 1 - n && o < out.length; k++) out[o++] = b;
    }
  }
  return out.subarray(0, o);
}

async function inflateSmart(data) {
  try { return await inflateZlib(data); }
  catch { return null; }
}

// بازگردانی Predictor=2 (horizontal differencing)
function unPredict(buf, w, h, samples, bits) {
  if (bits === 8) {
    const stride = w * samples;
    for (let y = 0; y < h; y++) {
      const row = y * stride;
      for (let x = samples; x < stride; x++) buf[row + x] = (buf[row + x] + buf[row + x - samples]) & 0xFF;
    }
  } else {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const stride = w * samples;
    for (let y = 0; y < h; y++) {
      const row = y * stride;
      for (let x = samples; x < stride; x++) {
        const v = dv.getUint16((row + x) * 2, true) + dv.getUint16((row + x - samples) * 2, true);
        dv.setUint16((row + x) * 2, v & 0xFFFF, true);
      }
    }
  }
  return buf;
}

export async function decodeTIFF(u8) {
  const le = u8[0] === 0x49;
  const r = new Reader(u8, le);
  let ifdOff = r.u32(4);
  const { tags } = readIFD(r, ifdOff);
  if (!tags[T.WIDTH] || !tags[T.LENGTH]) throw new Error('TIFF: عرض/ارتفاع پیدا نشد');

  const w = tags[T.WIDTH][0];
  const h = tags[T.LENGTH][0];
  if (!w || !h || w > 32768 || h > 32768 || (w * h) > 100_000_000) {
    throw new Error(`TIFF: Image dimensions (${w}x${h}) exceed safe limits`);
  }
  const bits = (tags[T.BITS] && tags[T.BITS][0]) || 8;
  const comp = (tags[T.COMPRESSION] && tags[T.COMPRESSION][0]) || 1;
  const photo = (tags[T.PHOTOMETRIC] && tags[T.PHOTOMETRIC][0]) ?? 1;
  const samples = (tags[T.SAMPLES] && tags[T.SAMPLES][0]) || 1;
  const rowsPerStrip = (tags[T.ROWS_PER_STRIP] && tags[T.ROWS_PER_STRIP][0]) || h;
  const predictor = (tags[T.PREDICTOR] && tags[T.PREDICTOR][0]) || 1;
  const planar = (tags[T.PLANAR] && tags[T.PLANAR][0]) || 1;
  if (planar !== 1) throw new Error('TIFF: PlanarConfiguration=2 پشتیبانی نمی‌شود');
  if (bits !== 8 && bits !== 16) throw new Error(`TIFF: عمق ${bits} بیت بیت پشتیبانی نمی‌شود`);
  const bytesPerSample = bits / 8;
  const bytesPerPixel = bytesPerSample * samples;

  const tiles = tags[T.TILE_OFFSETS] && tags[T.TILE_OFFSETS].length;
  const stripOffsets = tags[T.STRIP_OFFSETS] || [];
  const stripBytes = tags[T.STRIP_BYTES] || [];
  if (!tiles && !stripOffsets.length) throw new Error('TIFF: نواحی داده پیدا نشد');

  const out = new Uint8ClampedArray(w * h * 4);
  const colorMap = tags[T.COLOR_MAP];

  const readBlock = async (off, len, expected) => {
    const raw = u8.subarray(off, off + len);
    if (comp === 1) return raw;
    if (comp === 8 || comp === 32946) {
      const inf = await inflateSmart(raw);
      if (!inf) throw new Error('TIFF: inflate ناموفق');
      return inf;
    }
    if (comp === 32773) return packBitsDecode(raw, expected);
    if (comp === 5) return lzwDecode(raw, expected);
    throw new Error(`TIFF: فشرده‌سازی ${comp} پشتیبانی نمی‌شود`);
  };

  const px = (buf, idx) => {
    if (bytesPerSample === 1) return buf[idx];
    const o = idx * 2;
    const v = le ? (buf[o] | (buf[o + 1] << 8)) : ((buf[o] << 8) | buf[o + 1]);
    return v >> 8;   // ۱۶ بیت → ۸ بیت (نمایش)
  };

  if (tiles) {
    const tw = tags[T.TILE_WIDTH][0], th = tags[T.TILE_LENGTH][0];
    const tileBytes = tags[T.TILE_BYTES] || [];
    const across = Math.ceil(w / tw), down = Math.ceil(h / th);
    for (let ty = 0; ty < down; ty++) {
      for (let tx = 0; tx < across; tx++) {
        const bi = ty * across + tx;
        const off = tags[T.TILE_OFFSETS][bi];
        if (off === undefined) continue;
        const expected = tw * th * bytesPerPixel;
        const buf = await readBlock(off, tileBytes[bi] || (u8.length - off), expected);
        const rows = Math.min(th, h - ty * th);
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < tw && tx * tw + x < w; x++) {
            const si = y * tw + x;
            writePixel(out, (ty * th + y) * w + tx * tw + x, buf, si * samples, samples, photo, px, bytesPerSample, colorMap);
          }
        }
      }
    }
    return { width: w, height: h, data: out };
  }

  let rowBase = 0;
  for (let i = 0; i < stripOffsets.length; i++) {
    const rows = Math.min(rowsPerStrip, h - rowBase);
    if (rows <= 0) break;
    const expected = rows * w * bytesPerPixel;
    let buf = await readBlock(stripOffsets[i], stripBytes[i] || (u8.length - stripOffsets[i]), expected);
    if (predictor === 2) buf = unPredict(buf, w, rows, samples, bits);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < w; x++) {
        const si = y * w + x;
        writePixel(out, (rowBase + y) * w + x, buf, si * samples, samples, photo, px, bytesPerSample, colorMap);
      }
    }
    rowBase += rows;
  }
  return { width: w, height: h, data: out };
}

function writePixel(out, di, buf, si, samples, photo, px, bytesPerSample, colorMap) {
  const d = di * 4;
  if (colorMap && colorMap.length) {
    // ColorMap: 3×N مقدار u16؛ اول R، بعد G، بعد B (۱۶ بیت → ۸ بیت با شیفت راست)
    const idx = bytesPerSample === 1 ? buf[si] : ((buf[si * 2] << 8) | buf[si * 2 + 1]);
    const n = Math.floor(colorMap.length / 3);
    if (idx < n) {
      out[d] = (colorMap[idx] >> 8) & 0xFF;
      out[d + 1] = (colorMap[n + idx] >> 8) & 0xFF;
      out[d + 2] = (colorMap[2 * n + idx] >> 8) & 0xFF;
      out[d + 3] = 255;
    }
    return;
  }
  if (samples === 1) {
    let v = px(buf, si);
    if (photo === 0) v = 255 - v;    // WhiteIsZero
    out[d] = v; out[d + 1] = v; out[d + 2] = v; out[d + 3] = 255;
    return;
  }
  if (samples >= 3) {
    out[d] = px(buf, si);
    out[d + 1] = px(buf, si + 1);
    out[d + 2] = px(buf, si + 2);
    out[d + 3] = samples >= 4 ? px(buf, si + 3) : 255;
    return;
  }
  // samples === 2 (Gray+Alpha)
  let v = px(buf, si);
  if (photo === 0) v = 255 - v;
  out[d] = v; out[d + 1] = v; out[d + 2] = v; out[d + 3] = px(buf, si + 1);
}

/* ================= TIFF Encoder (baseline، بدون فشرده‌سازی) ================= */
// نوشتن TIFF ساده‌ی ۸ بیتی RGBA (سازگار با فتوشاپ/Preview/GIMP)
// حرفه‌ای‌ها برای بایگانی TIFF می‌خواهند؛ LZW اختیاری با دست‌ساز اعمال نمی‌شود (کیفیت بی‌افت).
export function encodeTIFF({ width, height, data }, { alpha = true, icc = null } = {}) {
  const samples = alpha ? 4 : 3;
  const rowBytes = width * samples;
  const imgBytes = rowBytes * height;
  const entries = icc && icc.length ? 14 : 13;
  const ifdOffset = 8;
  const ifdSize = 2 + entries * 12 + 4;
  const extraOff = ifdOffset + ifdSize;
  const bitsOff = extraOff;                          // 4xSHORT = 8 bytes (pointer)
  const resOff = bitsOff + samples * 2;              // 2xRATIONAL = 16 bytes
  const iccOff = resOff + 16;                        // ICC profile (tag 34675)
  const iccLen = icc && icc.length ? icc.length : 0;
  const dataOff = iccOff + iccLen + ((iccOff + iccLen) % 2);  // 2-byte aligned
  const total = dataOff + imgBytes;

  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  // header (little-endian)
  buf[0] = 0x49; buf[1] = 0x49; dv.setUint16(2, 42, true); dv.setUint32(4, ifdOffset, true);
  dv.setUint16(ifdOffset, entries, true);

  let e = ifdOffset + 2;
  const entry = (tag, type, count, value, valOff) => {
    dv.setUint16(e, tag, true); dv.setUint16(e + 2, type, true); dv.setUint32(e + 4, count, true);
    if (valOff !== undefined) dv.setUint32(e + 8, valOff, true);
    else if (type === 3 && count === 1) { dv.setUint16(e + 8, value, true); dv.setUint16(e + 10, 0, true); }
    else dv.setUint32(e + 8, value, true);
    e += 12;
  };
  entry(256, 3, 1, width);            // ImageWidth
  entry(257, 3, 1, height);           // ImageLength
  entry(258, 3, samples, 0, bitsOff); // BitsPerSample (۴ مقدار → اشارهگر)
  entry(259, 3, 1, 1);                // Compression = none
  entry(262, 3, 1, samples >= 3 ? 2 : 1); // Photometric: RGB | BlackIsZero
  entry(273, 4, 1, dataOff);          // StripOffsets (count=1 → مقدار درون‌خطی)
  entry(277, 3, 1, samples);          // SamplesPerPixel
  entry(278, 3, 1, height);           // RowsPerStrip
  entry(279, 4, 1, imgBytes);         // StripByteCounts
  entry(282, 5, 1, 0, resOff);        // XResolution (RATIONAL 72/1)
  entry(283, 5, 1, 0, resOff + 8);    // YResolution
  entry(296, 3, 1, 2);                // ResolutionUnit = inch
  entry(339, 3, 1, 1);                // SampleFormat = unsigned int (درون‌خطی)
  if (iccLen) entry(34675, 7, iccLen, 0, iccOff);   // ICC Profile (UNDEFINED، اشاره‌گر)
  dv.setUint32(e, 0, true);           // next IFD

  for (let i = 0; i < samples; i++) dv.setUint16(bitsOff + i * 2, 8, true);
  dv.setUint32(resOff, 72, true); dv.setUint32(resOff + 4, 1, true);
  dv.setUint32(resOff + 8, 72, true); dv.setUint32(resOff + 12, 1, true);
  if (iccLen) buf.set(icc, iccOff);

  let o = dataOff;
  for (let i = 0; i < width * height; i++) {
    buf[o++] = data[i * 4];
    buf[o++] = data[i * 4 + 1];
    buf[o++] = data[i * 4 + 2];
    if (alpha) buf[o++] = data[i * 4 + 3];
  }
  return buf;
}
