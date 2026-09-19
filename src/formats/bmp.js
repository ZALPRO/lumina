// formats/bmp.js — دیکدر/انکودر BMP (بی‌کمپرشن ۲۴/۳۲ بیتی؛ row stride با pad به ۴)
export function decodeBmp(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint8(0) !== 0x42 || dv.getUint8(1) !== 0x4D) throw new Error('BMP: امضای نامعتبر (BM)');
  const dataOffset = dv.getUint32(10, true);
  const headerSize = dv.getUint32(14, true);
  const width = dv.getInt32(18, true);
  let height = dv.getInt32(22, true);
  const bpp = dv.getUint16(28, true);
  if (bpp !== 24 && bpp !== 32) throw new Error(`BMP: عمق ${bpp} بیت پشتیبانی نمی‌شود (فقط 24/32)`);
  const compression = dv.getUint32(30, true);
  if (compression !== 0) throw new Error('BMP: RLE/heur/compressed پشتیبانی نمی‌شود');

  const topDown = height < 0;
  height = Math.abs(height);

  const rowSize = Math.floor((bpp * width + 31) / 32) * 4;
  const bytesPP = bpp / 8;
  const out = new Uint8ClampedArray(width * height * 4);

  for (let y = 0; y < height; y++) {
    const sy = topDown ? y : (height - 1 - y);
    const rowOff = dataOffset + sy * rowSize;
    for (let x = 0; x < width; x++) {
      const off = rowOff + x * bytesPP;
      const B = u8[off], G = u8[off + 1], R = u8[off + 2];
      const A = bpp === 32 ? u8[off + 3] : 255;
      const pi = (y * width + x) * 4;
      out[pi] = R; out[pi + 1] = G; out[pi + 2] = B; out[pi + 3] = A;
    }
  }
  return { width, height, data: out };
}

export function encodeBmp({ width: w, height: h, data }) {
  const rowSize = Math.floor((32 * w + 31) / 32) * 4;
  const pixelBytes = rowSize * h;
  const fileSize = 14 + 40 + pixelBytes;
  const out = new Uint8Array(fileSize);

  // BITMAPFILEHEADER
  out[0] = 0x42; out[1] = 0x4D;
  writeLE32(out, 2, fileSize);
  writeLE32(out, 10, 54);
  // BITMAPINFOHEADER
  writeLE32(out, 14, 40);
  writeLE32(out, 18, w);
  writeLE32(out, 22, h);
  out[26] = 1; out[27] = 0;                 // planes
  out[28] = 32; out[29] = 0;                // bpp
  writeLE32(out, 30, 0);                    // compression BI_RGB
  writeLE32(out, 34, pixelBytes);

  for (let y = 0; y < h; y++) {
    const sy = h - 1 - y;
    for (let x = 0; x < w; x++) {
      const src = (sy * w + x) * 4;
      const dst = 54 + y * rowSize + x * 4;
      out[dst] = data[src + 2]; out[dst + 1] = data[src + 1]; out[dst + 2] = data[src]; out[dst + 3] = data[src + 3];
    }
  }
  return out;
}

function writeLE32(b, o, v) { b[o] = v & 0xFF; b[o + 1] = (v >> 8) & 0xFF; b[o + 2] = (v >> 16) & 0xFF; b[o + 3] = (v >> 24) & 0xFF; }
