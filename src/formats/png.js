// formats/png.js — دیکدر/انکودر PNG از صفر (بدون وابستگی خارجی به جز node:zlib برای deflate/inflate)
// پشتیبانی کامل دیکد: color types 0,2,3,4,6 · عمق‌های 1,2,4,8,16 · tRNS (هر سه نوع) · PLTE
// انکودر: RGBA8 → PNG (color type 6، فیلتر adaptive سادهٔ Up)
import { crc32 } from './crc32.js';
import { inflateZlib as inflate, deflateZlib as deflate } from './deflate.js';

const SIG = [137, 80, 78, 71, 13, 10, 26, 10];

const CHANNELS = [1, undefined, 3, 1, 2, undefined, 4]; // ایندکس = color type

export async function decodePng(u8) {
  if (u8.length < 8) throw new Error('PNG: فایل خیلی کوتاه');
  for (let i = 0; i < 8; i++) if (u8[i] !== SIG[i]) throw new Error('PNG: امضای نامعتبر');

  let off = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let plte = null, trns = null;

  while (off < u8.length) {
    const len = read32(u8, off); off += 4;
    const type = ascii(u8, off, 4); off += 4;
    const data = u8.subarray(off, off + len); off += len + 4; // +4 برای CRC
    if (type === 'IHDR') {
      width = read32(data, 0); height = read32(data, 4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IEND') break;
  }
  if (!width || !height) throw new Error('PNG: IHDR یافت نشد');
  if (interlace !== 0) throw new Error('PNG: Adam7 interlacing پشتیبانی نمی‌شود');
  const ch = CHANNELS[colorType];
  if (!ch) throw new Error(`PNG: color type ${colorType} پشتیبانی نمی‌شود`);

  const raw = await inflate(concat(idat));
  const bitsPerPixel = ch * bitDepth;
  const scanStride = Math.ceil((width * bitsPerPixel) / 8);
  const filterBpp = Math.max(1, Math.ceil(bitsPerPixel / 8));

  const rows = unfilter(raw, height, scanStride, filterBpp);
  return samplesToRGBA(rows, width, height, colorType, bitDepth, plte, trns);
}

function unfilter(raw, h, stride, bpp) {
  const out = new Uint8Array(stride * h);
  let src = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[src++];
    if (ft > 4) throw new Error(`PNG: فیلتر ${ft} نامعتبر`);
    for (let x = 0; x < stride; x++) {
      const b = raw[src++];
      const left = x >= bpp ? out[y * stride + x - bpp] : 0;
      const up = y > 0 ? out[(y - 1) * stride + x] : 0;
      const upLeft = y > 0 && x >= bpp ? out[(y - 1) * stride + x - bpp] : 0;
      let v;
      switch (ft) {
        case 0: v = b; break;
        case 1: v = (b + left) & 0xFF; break;
        case 2: v = (b + up) & 0xFF; break;
        case 3: v = (b + ((left + up) >> 1)) & 0xFF; break;
        case 4: v = (b + paeth(left, up, upLeft)) & 0xFF; break;
      }
      out[y * stride + x] = v;
    }
  }
  return out;
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

// نمونه‌های خام هر پیکسل → RGBA8
function samplesToRGBA(rows, w, h, ct, bd, plte, trns) {
  const out = new Uint8ClampedArray(w * h * 4);
  const ch = CHANNELS[ct];
  const stride = Math.ceil((w * ch * bd) / 8);
  const scale8 = bd < 8 ? 255 / ((1 << bd) - 1) : 1;

  for (let y = 0; y < h; y++) {
    const row = rows.subarray(y * stride, (y + 1) * stride);
    let bitBuf = 0, bitCount = 0, byteIdx = 0;

    function nextBits(n) {
      while (bitCount < n) {
        bitBuf = (bitBuf << 8) | row[byteIdx++];
        bitCount += 8;
      }
      bitCount -= n;
      return (bitBuf >>> bitCount) & ((1 << n) - 1);
    }

    for (let x = 0; x < w; x++) {
      let r, g, b, a = 255;
      if (bd >= 8) {
        const bpc = bd / 8;
        const o = x * ch * bpc;
        if (ct === 0) {
          const v = sample(row, o, bpc);
          r = g = b = bpc === 2 ? v >> 8 : v;
          if (trns && sd(trns, 0) === (bpc === 2 ? v : v)) a = 0;
        } else if (ct === 2) {
          const R = sample(row, o, bpc), G = sample(row, o + bpc, bpc), B = sample(row, o + 2 * bpc, bpc);
          r = R >> (bpc === 2 ? 8 : 0); g = G >> (bpc === 2 ? 8 : 0); b = B >> (bpc === 2 ? 8 : 0);
          if (trns && sd(trns, 0) === R && sd(trns, 1) === G && sd(trns, 2) === B) a = 0;
        } else if (ct === 3) {
          const idx = row[o];
          if (!plte) throw new Error('PNG: پالت گم است');
          r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
          if (trns && idx < trns.length) a = trns[idx];
        } else if (ct === 4) {
          const v = sample(row, o, bpc), A = sample(row, o + bpc, bpc);
          r = g = b = v >> (bpc === 2 ? 8 : 0); a = A >> (bpc === 2 ? 8 : 0);
        } else if (ct === 6) {
          r = row[o]; g = row[o + 1]; b = row[o + 2]; a = row[o + 3];
        }
      } else {
        // عمق 1/2/4: تنها gray (0) یا palette (3)
        if (ct === 0) {
          const v = nextBits(bd);
          r = g = b = Math.round(v * scale8);
        } else if (ct === 3) {
          const idx = nextBits(bd);
          if (!plte) throw new Error('PNG: پالت گم است');
          r = plte[idx * 3]; g = plte[idx * 3 + 1]; b = plte[idx * 3 + 2];
          if (trns && idx < trns.length) a = trns[idx];
        } else {
          throw new Error(`PNG: عمق ${bd} با color type ${ct} نامعتبر`);
        }
      }
      const pi = (y * w + x) * 4;
      out[pi] = r; out[pi + 1] = g; out[pi + 2] = b; out[pi + 3] = a;
    }
  }
  return { width: w, height: h, data: out, colorType: ct, bitDepth: bd };
}

function sample(row, byteOffset, bytes) {
  if (bytes === 1) return row[byteOffset];
  return (row[byteOffset] << 8) | row[byteOffset + 1];
}
function sd(t, i) { return t.length > i * 2 + 1 ? (t[i * 2] << 8 | t[i * 2 + 1]) : t[i]; }

// ---------- انکودر ----------
export async function encodePng({ width: w, height: h, data }, opts = {}) {
  const stride = w * 4;
  const raw = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const dst = y * (stride + 1);
    raw[dst] = 2; // Up
    for (let x = 0; x < stride; x++) {
      const cur = data[y * stride + x];
      const up = y > 0 ? data[(y - 1) * stride + x] : 0;
      raw[dst + 1 + x] = (cur - up) & 0xFF;
    }
  }
  const compressed = await deflate(raw);

  const ihdr = new Uint8Array(13);
  write32(ihdr, 0, w); write32(ihdr, 4, h);
  ihdr[8] = 8; ihdr[9] = 6; // RGBA8
  const parts = [new Uint8Array(SIG), chunk('IHDR', ihdr)];

  // iCCP — پروفایل رنگ (مدیریت رنگ واقعی؛ فتوشاپ پروفایل را می‌شناسد)
  if (opts.icc) {
    const name = 'Lumina sRGB';
    const head = new Uint8Array(name.length + 2);
    for (let i = 0; i < name.length; i++) head[i] = name.charCodeAt(i);
    head[name.length] = 0;      // NUL
    head[name.length + 1] = 0;  // compression method = zlib
    const zprof = await deflate(opts.icc);
    parts.push(chunk('iCCP', concat([head, zprof])));
  }
  // gAMA/sRGB — سازگاری با نرم‌افزارهای قدیمی
  if (opts.gamma !== false) {
    const gam = new Uint8Array(4); write32(gam, 0, 45455); // 1/2.2 در مقیاس 100000
    parts.push(chunk('gAMA', gam));
  }
  for (let i = 0; i < compressed.length; i += 8192) {
    parts.push(chunk('IDAT', compressed.subarray(i, i + 8192)));
  }
  parts.push(chunk('IEND', new Uint8Array(0)));
  return concat(parts);
}

function chunk(type, data) {
  const t = new Uint8Array(4);
  for (let i = 0; i < 4; i++) t[i] = type.charCodeAt(i);
  const out = new Uint8Array(12 + data.length);
  write32(out, 0, data.length);
  out.set(t, 4);
  out.set(data, 8);
  write32(out, 8 + data.length, crc32(concat([t, data])));
  return out;
}

function read32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
function write32(b, o, v) { b[o] = v >>> 24; b[o + 1] = (v >> 16) & 0xFF; b[o + 2] = (v >> 8) & 0xFF; b[o + 3] = v & 0xFF; }
function ascii(b, o, n) { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[o + i]); return s; }
function concat(arrs) {
  let len = 0; for (const a of arrs) len += a.length;
  const out = new Uint8Array(len);
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
