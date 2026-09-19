// formats/qoi.js — فرمت "Quite OK Image" (https://qoiformat.org/)
// فشرده‌سازی بدون اتلاف، فوق‌سریع — ایده‌آل برای کش داخلی، اسکرین‌شات و فرمت بومی اولیه.
function s8(v) { return v >= 128 ? v - 256 : v; }

const QOI_OP_RGB = 0xFE, QOI_OP_RGBA = 0xFF,
      QOI_OP_INDEX = 0x00, QOI_OP_DIFF = 0x40, QOI_OP_LUMA = 0x80, QOI_OP_RUN = 0xC0;

export function encodeQoi({ width: w, height: h, data }) {
  const out = new Uint8Array(w * h * 4 + 14 + 8 + w * h * 5);
  let p = 0;
  const w32 = (o, v) => { out[o] = (v >>> 24) & 0xFF; out[o + 1] = (v >>> 16) & 0xFF; out[o + 2] = (v >>> 8) & 0xFF; out[o + 3] = v & 0xFF; };
  out[0] = 0x71; out[1] = 0x6F; out[2] = 0x69; out[3] = 0x66; // 'qoif'
  w32(4, w); w32(8, h);
  out[12] = 4;  // RGBA
  out[13] = 0;  // sRGB
  p = 14;

  let r = 0, g = 0, b = 0, a = 255;
  let run = 0;
  const index = new Array(64).fill(null).map(() => [0, 0, 0, 0]); // zero-init طبق مرجع

  const PIX = w * h;
  for (let i = 0; i < PIX; i++) {
    const R = data[i * 4], G = data[i * 4 + 1], B = data[i * 4 + 2], A = data[i * 4 + 3];
    if (R === r && G === g && B === b && A === a) {
      run++;
      if (run === 62) { out[p++] = QOI_OP_RUN | (run - 1); run = 0; }
      continue;
    }
    if (run) { out[p++] = QOI_OP_RUN | (run - 1); run = 0; }

    const hash = (R * 3 + G * 5 + B * 7 + A * 11) & 63;
    const seen = index[hash];
    if (seen[0] === R && seen[1] === G && seen[2] === B && seen[3] === A) {
      out[p++] = QOI_OP_INDEX | hash;
    } else {
      index[hash] = [R, G, B, A];
      if (A === a) {
        const sdr = s8((R - r) & 255), sdg = s8((G - g) & 255), sdb = s8((B - b) & 255);
        if (sdr >= -2 && sdr <= 1 && sdg >= -2 && sdg <= 1 && sdb >= -2 && sdb <= 1) {
          out[p++] = QOI_OP_DIFF | ((sdr + 2) << 4) | ((sdg + 2) << 2) | (sdb + 2);
        } else {
          const vr = sdr - sdg, vb = sdb - sdg;
          if (sdg >= -32 && sdg <= 31 && vr >= -8 && vr <= 7 && vb >= -8 && vb <= 7) {
            out[p++] = QOI_OP_LUMA | (sdg + 32);
            out[p++] = ((vr + 8) << 4) | (vb + 8);
          } else {
            out[p++] = QOI_OP_RGB; out[p++] = R; out[p++] = G; out[p++] = B;
          }
        }
      } else {
        out[p++] = QOI_OP_RGBA; out[p++] = R; out[p++] = G; out[p++] = B; out[p++] = A;
      }
    }
    r = R; g = G; b = B; a = A;
  }
  if (run) out[p++] = QOI_OP_RUN | (run - 1);
  // padding طبق مشخصات: هفت 0x00 + یک 0x01
  for (let i = 0; i < 7; i++) out[p++] = 0;
  out[p++] = 1;
  return out.slice(0, p);
}

export function decodeQoi(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
  if (magic !== 'qoif') throw new Error('QOI: امضای نامعتبر');
  const w = dv.getUint32(4, false);
  const h = dv.getUint32(8, false);
  const channels = u8[12];
  let p = 14;

  const PIX = w * h;
  const data = new Uint8ClampedArray(PIX * 4);
  let r = 0, g = 0, b = 0, a = 255;
  const index = new Array(64).fill(null).map(() => [0, 0, 0, 0]); // zero-init طبق مرجع

  let i = 0;
  while (i < PIX) {
    const op = u8[p++];
    if (op === QOI_OP_RGB) {
      r = u8[p++]; g = u8[p++]; b = u8[p++];
      writePx(); index[idx(r, g, b, a)] = [r, g, b, a];
    } else if (op === QOI_OP_RGBA) {
      r = u8[p++]; g = u8[p++]; b = u8[p++]; a = u8[p++];
      writePx(); index[idx(r, g, b, a)] = [r, g, b, a];
    } else {
      const tag = op & 0xC0;
      if (tag === QOI_OP_INDEX) {
        const s = index[op & 0x3F];
        r = s[0]; g = s[1]; b = s[2]; a = s[3];
        writePx();
      } else if (tag === QOI_OP_DIFF) {
        r += ((op >> 4) & 3) - 2;
        g += ((op >> 2) & 3) - 2;
        b += (op & 3) - 2;
        writePx();
      } else if (tag === QOI_OP_LUMA) {
        const b2 = u8[p++];
        const vg = (op & 0x3F) - 32;
        r += vg - 8 + ((b2 >> 4) & 0x0F);
        g += vg;
        b += vg - 8 + (b2 & 0x0F);
        writePx();
      } else if (tag === QOI_OP_RUN) {
        const run = (op & 0x3F) + 1;
        for (let k = 0; k < run && i < PIX; k++) writePx();
      } else {
        throw new Error(`QOI: opcode نامعتبر 0x${op.toString(16)}`);
      }
    }
  }
  return { width: w, height: h, channels, data };

  function writePx() {
    data[i * 4] = r & 0xFF;
    data[i * 4 + 1] = g & 0xFF;
    data[i * 4 + 2] = b & 0xFF;
    data[i * 4 + 3] = a & 0xFF;
    index[idx(r & 0xFF, g & 0xFF, b & 0xFF, a & 0xFF)] = [r & 0xFF, g & 0xFF, b & 0xFF, a & 0xFF];
    i++;
  }
  function idx(R, G, B, A) { return (R * 3 + G * 5 + B * 7 + A * 11) & 63; }
}
