// formats/psd.js — پشتیبانی PSD/PSB (خواندن + نوشتن) — فرمت بومی فتوشاپ
// محدوده: RGB 8بیت (و PSB خواندن). RLE PackBits per-row + raw planar.
// خروجی Lumina: PSD تخت استاندارد (RGB، ۴ کانال) که فتوشاپ می‌گشاید.

import { srgbProfile } from './icc.js';

const SIG = 0x38425053; // '8BPS'
const SIG8BIM = 0x3842494d; // '8BIM'

export function isPSD(buf) {
  if (!buf || buf.length < 4) return false;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return dv.getUint32(0, false) === SIG;
}
export function isPSB(buf) {
  if (!isPSD(buf)) return false;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return dv.getUint16(4, false) === 2;
}

// ----- PackBits (RLE) -----
export function packBitsEncode(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    let run = 1;
    while (i + run < n && src[i + run] === src[i] && run < 128) run++;
    if (run >= 2) {
      out.push(1 - run, src[i]);
      i += run;
    } else {
      let lit = 1;
      while (i + lit < n && lit < 128) {
        if (i + lit + 1 < n && src[i + lit] === src[i + lit + 1]) break;
        lit++;
      }
      out.push(lit - 1);
      for (let k = 0; k < lit; k++) out.push(src[i + k]);
      i += lit;
    }
  }
  return new Uint8Array(out);
}

export function packBitsDecode(src, dstLen) {
  const out = new Uint8Array(dstLen);
  let i = 0, o = 0;
  while (i < src.length && o < dstLen) {
    let c = src[i++];
    if (c === 128) continue;
    if (c < 128) { // literal: c+1 bytes
      const cnt = c + 1;
      for (let k = 0; k < cnt && o < dstLen; k++) out[o++] = src[i++];
    } else { // repeat: (1-c)+1 = 257-c times
      const cnt = 257 - c;
      const b = src[i++];
      for (let k = 0; k < cnt && o < dstLen; k++) out[o++] = b;
    }
  }
  return out;
}

// ----- Encode (flattened PSD) -----
export function encodePngLikePSD({ width, height, data }) {
  // data: Uint8ClampedArray RGBA
  const ch = 4;
  const planars = [];
  for (let c = 0; c < ch; c++) {
    const plane = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) plane[p] = data[i + c];
    planars.push(plane);
  }
  // RLE per row
  const channelStreams = [];
  let totalCountLen = 0;
  for (const plane of planars) {
    const rows = [];
    for (let y = 0; y < height; y++) {
      rows.push(packBitsEncode(plane.subarray(y * width, (y + 1) * width)));
    }
    channelStreams.push(rows);
    totalCountLen += height * 2;
  }
  const imageDataLen = 2 + totalCountLen + channelStreams.reduce((s, rows) => s + rows.reduce((a, r) => a + r.length, 0), 0);

  // منابع تصویر: پروفایل ICC sRGB (مثل فتوشاپ، تا رنگ‌ها «مدیریت‌شده» باشند)
  const icc = srgbProfile();
  const resourceBlocks = [];
  {
    const b = new Uint8Array(4 + 2 + 2 + 4 + icc.length + (icc.length % 2));
    const bdv = new DataView(b.buffer);
    let o = 0;
    bdv.setUint32(o, SIG8BIM, false); o += 4;
    bdv.setUint16(o, 1039, false); o += 2;      // 1039 = ICC Profile
    bdv.setUint16(o, 0, false); o += 2;         // نام خالی (pascal، به‌همراه padding)
    bdv.setUint32(o, icc.length, false); o += 4;
    b.set(icc, o);
    resourceBlocks.push(b);
  }
  const resourcesLen = resourceBlocks.reduce((n, b) => n + b.length, 0);

  // ساختار استاندارد: پس از طول «Layer & Mask» بلافاصله بایت فشرده‌سازی تصویر
  // ادغام‌شده می‌آید؛ هیچ فیلد طولی در میان نیست (باگ قبلی: یک u32 اضافه نوشته
  // می‌شد و فتوشاپ/PIL/psd-tools فایل را خراب می‌خواندند).
  const imageDataSection = 2 + imageDataLen;
  const total = 26 + 4 + 4 + resourcesLen + 4 + imageDataSection;
  const buf = new ArrayBuffer(total);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let off = 0;

  dv.setUint32(off, SIG, false); off += 4;        // 8BPS
  dv.setUint16(off, 1, false); off += 2;          // version
  dv.setUint32(off, 0, false); off += 4;          // reserved (4)
  dv.setUint16(off, 0, false); off += 2;          // reserved (2) → مجموع ۶ بایت
  dv.setUint16(off, ch, false); off += 2;         // channels
  dv.setUint32(off, height, false); off += 4;
  dv.setUint32(off, width, false); off += 4;
  dv.setUint16(off, 8, false); off += 2;          // depth
  dv.setUint16(off, 3, false); off += 2;          // color mode RGB
  // color mode data: length = 0
  dv.setUint32(off, 0, false); off += 4;
  // image resources (ICC)
  dv.setUint32(off, resourcesLen, false); off += 4;
  for (const b of resourceBlocks) { u8.set(b, off); off += b.length; }
  // layer and mask info: length = 0 (سند تخت)
  dv.setUint32(off, 0, false); off += 4;
  // image data
  dv.setUint16(off, 1, false); off += 2;          // compression = RLE
  for (let c = 0; c < ch; c++) {
    for (let y = 0; y < height; y++) {
      dv.setUint16(off, channelStreams[c][y].length, false); off += 2;
    }
  }
  for (let c = 0; c < ch; c++) {
    for (let y = 0; y < height; y++) {
      u8.set(channelStreams[c][y], off);
      off += channelStreams[c][y].length;
    }
  }
  return new Uint8Array(buf, 0, off);
}

// ----- Decode -----
export function decodePSD(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, false) !== SIG) throw new Error('Not a PSD');
  const version = dv.getUint16(4, false);
  const psb = version === 2;
  const u32 = (o) => dv.getUint32(o, false);

  const channels = dv.getUint16(12, false);
  const height = u32(14);
  const width = u32(18);
  const depth = dv.getUint16(22, false);
  const colorMode = dv.getUint16(24, false);

  if (colorMode !== 3 && colorMode !== 4) throw new Error('Unsupported color mode: ' + colorMode);
  if (depth !== 8) throw new Error('Unsupported bit depth: ' + depth + ' (only 8-bit for now)');

  const hasAlpha = channels >= 4;

  let off = 26;
  // color mode data
  const cmdLen = u32(off); off += 4 + cmdLen;
  // image resources
  const resLen = u32(off); off += 4 + resLen;
  // layer & mask
  const lmLen = u32(off); off += 4 + lmLen;
  // image data — بایت فشرده‌سازی بلافاصله پس از طول Layer & Mask
  const compression = dv.getUint16(off, false); off += 2;

  const chCount = Math.max(channels, 3);
  const planeLen = width * height;
  const planes = [];
  if (compression === 0) {
    // raw planar
    for (let c = 0; c < chCount; c++) {
      planes.push(new Uint8Array(buf.buffer, buf.byteOffset + off, planeLen).slice());
      off += planeLen;
    }
  } else if (compression === 1) {
    // RLE: 2-byte count per row per channel
    const rowCounts = [];
    for (let c = 0; c < chCount; c++) {
      const counts = [];
      for (let y = 0; y < height; y++) { counts.push(dv.getUint16(off, false)); off += 2; }
      rowCounts.push(counts);
    }
    for (let c = 0; c < chCount; c++) {
      const plane = new Uint8Array(planeLen);
      for (let y = 0; y < height; y++) {
        const n = rowCounts[c][y];
        const raw = new Uint8Array(buf.buffer, buf.byteOffset + off, n);
        off += n;
        const dec = packBitsDecode(raw, width);
        plane.set(dec, y * width);
      }
      planes.push(plane);
    }
  } else if (compression === 2 || compression === 3) {
    throw new Error('Zip compression in PSD not supported yet');
  } else {
    throw new Error('Unknown PSD compression: ' + compression);
  }

  // interleave to RGBA (CMYK: فایل فتوشاپ معکوس ذخیره می‌کند → ۲۵۵ − بایت)
  const data = new Uint8ClampedArray(planeLen * 4);
  if (colorMode === 4) {
    for (let i = 0; i < planeLen; i++) {
      const c = 255 - planes[0][i], m = 255 - planes[1][i], y = 255 - planes[2][i], k = 255 - planes[3][i];
      const o4 = i * 4;
      data[o4]     = Math.round((255 - c) * (255 - k) / 255);
      data[o4 + 1] = Math.round((255 - m) * (255 - k) / 255);
      data[o4 + 2] = Math.round((255 - y) * (255 - k) / 255);
      data[o4 + 3] = 255;
    }
    return { width, height, data, colorMode };
  }
  const R = planes[0], G = planes[1], B = planes[2];
  const A = hasAlpha ? planes[3] : null;
  for (let i = 0; i < planeLen; i++) {
    const o4 = i * 4;
    data[o4] = R[i]; data[o4 + 1] = G[i]; data[o4 + 2] = B[i];
    data[o4 + 3] = A ? A[i] : 255;
  }
  return { width, height, data, channels: chCount, psb };
}
