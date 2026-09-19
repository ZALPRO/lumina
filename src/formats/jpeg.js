// formats/jpeg.js — دیکدر/انکودر JPEG baseline از صفر (بدون وابستگی)
// دیکدر: گرامی و رنگی (1 و 3 مولفه)، زیرنمونه 4:4:4 / 4:2:2 / 4:2:0، چند اسکن،
// RST markerها، byte-stuffing، جداول چندگانه.
// انکودر: YCbCr 4:2:0 baseline با جداول استاندارد (کیفیت قابل تنظیم).

const ZIGZAG = new Uint8Array([
  0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5,
  12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21,
  28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37,
  44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47,
  55, 62, 63,
]);
const ZIGZAG_INV = new Uint8Array(64);
for (let i = 0; i < 64; i++) ZIGZAG_INV[ZIGZAG[i]] = i;

// جدول کوانتیزاسیون استاندارد (Annex K) — به ترتیب zigzag
const LUM_Q = new Uint8Array([16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55, 14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62, 18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92, 49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99]);
const CHR_Q = new Uint8Array([17, 18, 24, 47, 99, 99, 99, 99, 18, 21, 26, 66, 99, 99, 99, 99, 24, 26, 56, 99, 99, 99, 99, 99, 47, 66, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99, 99]);

// Huffman جداول استاندارد JPEG
const DCLUM = { counts: [0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0], syms: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const ACLUM = { counts: [0, 2, 1, 3, 3, 2, 4, 3, 5, 5, 4, 4, 0, 0, 1, 0x7d], syms: [0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xa1, 0x08, 0x23, 0x42, 0xb1, 0xc1, 0x15, 0x52, 0xd1, 0xf0, 0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0a, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa] };
const DCCHR = { counts: [0, 3, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0], syms: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] };
const ACCHR = { counts: [0, 2, 1, 2, 4, 4, 3, 4, 7, 5, 4, 4, 0, 1, 2, 0x77], syms: [0x00, 0x01, 0x02, 0x03, 0x11, 0x04, 0x05, 0x21, 0x31, 0x06, 0x12, 0x41, 0x51, 0x07, 0x61, 0x71, 0x13, 0x22, 0x32, 0x81, 0x08, 0x14, 0x42, 0x91, 0xa1, 0xb1, 0xc1, 0x09, 0x23, 0x33, 0x52, 0xf0, 0x15, 0x62, 0x72, 0xd1, 0x0a, 0x16, 0x24, 0x34, 0xe1, 0x25, 0xf1, 0x17, 0x18, 0x19, 0x1a, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79, 0x7a, 0x82, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xc2, 0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa] };

// COS جدول پیش‌محاسبه (IDCT)
const COS = new Float64Array(8 * 8);
for (let u = 0; u < 8; u++) for (let x = 0; x < 8; x++) COS[u * 8 + x] = Math.cos((2 * x + 1) * u * Math.PI / 16);

export function isJPEG(buf) {
  return buf && buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
}

class BitReader {
  constructor(bytes, start = 0) {
    this.bytes = bytes;
    this.pos = start;
    this.buf = 0;
    this.bits = 0;
  }
  readBits(n) {
    while (this.bits < n) {
      if (this.pos >= this.bytes.length) { this.eof = true; return 0; }
      let b = this.bytes[this.pos++];
      if (b === 0xFF) {
        if (this.pos >= this.bytes.length) { this.eof = true; return 0; }
        if (this.bytes[this.pos] === 0x00) {
          this.pos++; // byte-stuffing: 0xFF00 → 0xFF
        } else {
          // مارکر — دادهٔ اسکن تمام شد؛ 0xFF را دوباره «بپس بده» (pos-- ) و خروج
          this.pos--;
          this.eof = true;
          return 0;
        }
      }
      this.buf = (this.buf << 8) | b;
      this.bits += 8;
    }
    this.bits -= n;
    return (this.buf >>> this.bits) & ((1 << n) - 1);
  }
  readHuff(table) {
    let code = 0;
    for (let len = 1; len <= 16; len++) {
      code = (code << 1) | this.readBits(1);
      const v = table[len] ? table[len][code] : undefined;
      if (v !== undefined) return v;
    }
    throw new Error('bad huffman code');
  }
}

function buildHuffTable(counts, syms) {
  const table = new Array(17);
  let code = 0, si = 0;
  for (let len = 1; len <= 16; len++) {
    table[len] = {};
    for (let i = 0; i < counts[len - 1]; i++, si++) {
      table[len][code] = syms[si];
      code++;
    }
    code <<= 1;
  }
  return table;
}

function idctBlock(coeffs) {
  const tmp = new Float64Array(64);
  // ردیف‌ها
  for (let r = 0; r < 8; r++) {
    const off = r * 8;
    for (let x = 0; x < 8; x++) {
      let s = 0;
      for (let u = 0; u < 8; u++) {
        const cu = u === 0 ? 0.7071067811865476 : 1;
        s += cu * coeffs[off + u] * COS[u * 8 + x];
      }
      tmp[off + x] = s * 0.5;
    }
  }
  // ستون‌ها
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) {
      let s = 0;
      for (let v = 0; v < 8; v++) {
        const cv = v === 0 ? 0.7071067811865476 : 1;
        s += cv * tmp[v * 8 + x] * COS[v * 8 + y];
      }
      coeffs[y * 8 + x] = s * 0.5;
    }
  }
}

export function decodeJPEG(buf) {
  if (!isJPEG(buf)) throw new Error('Not a JPEG');
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);

  let pos = 2;
  const quantNat = new Map();   // id → Float64Array(64) در ترتیب طبیعی
  const huff = new Map();       // (tc<<4|th) → table
  let frame = null;             // {width,height,ncomp,comps:[{id,h,v,qt}] , planes}

  const findNextMarker = (from) => {
    let i = from;
    while (i + 1 < u8.length) {
      if (u8[i] === 0xFF) {
        const m = u8[i + 1];
        if (m === 0x00) { i += 2; continue; }
        if (m >= 0xD0 && m <= 0xD7) { i += 2; continue; }
        if (m === 0xFF) { i += 1; continue; }
        return i;
      }
      i++;
    }
    return u8.length;
  };

  while (pos + 4 <= u8.length) {
    if (u8[pos] !== 0xFF) { pos++; continue; }
    const marker = u8[pos + 1];
    if (marker === 0xD8 || (marker >= 0xD0 && marker <= 0xD7)) { pos += 2; continue; }
    if (marker === 0xD9) break; // EOI
    const len = view.getUint16(pos + 2, false);
    const seg = u8.subarray(pos + 4, pos + 2 + len);

    switch (marker) {
      case 0xDB: { // DQT
        let p = 0;
        while (p < seg.length) {
          const pq = seg[p] >> 4;
          const tq = seg[p] & 0x0F;
          p++;
          const nat = new Float64Array(64);
          for (let i = 0; i < 64; i++) {
            const qv = pq ? (seg[p] << 8 | seg[p + 1]) : seg[p];
            nat[ZIGZAG[i]] = qv;
            p += pq ? 2 : 1;
          }
          quantNat.set(tq, nat);
        }
        break;
      }
      case 0xC4: { // DHT
        let p = 0;
        while (p < seg.length) {
          const tc = seg[p] >> 4, th = seg[p] & 0x0F;
          p++;
          const counts = [];
          let total = 0;
          for (let i = 0; i < 16; i++) { counts.push(seg[p++]); total += counts[i]; }
          const syms = Array.from(seg.subarray(p, p + total)); p += total;
          huff.set((tc << 4) | th, buildHuffTable(counts, syms));
        }
        break;
      }
      case 0xC0:
      case 0xC1: {
        if (!frame) {
          frame = { width: 0, height: 0, ncomp: 0, comps: [], planes: null };
          frame.precision = seg[0];
          frame.height = view.getUint16(pos + 5, false);
          frame.width = view.getUint16(pos + 7, false);
          if (!frame.width || !frame.height || frame.width > 32768 || frame.height > 32768 || (frame.width * frame.height) > 100_000_000) {
            throw new Error(`JPEG: Image dimensions (${frame.width}x${frame.height}) exceed safe limits`);
          }
          frame.ncomp = seg[9 - 4]; // seg[5]
          for (let i = 0; i < frame.ncomp; i++) {
            const o = 6 + i * 3;
            frame.comps.push({ id: seg[o], h: seg[o + 1] >> 4, v: seg[o + 1] & 0x0F, qt: seg[o + 2] });
          }
        }
        break;
      }
      case 0xC2:
        throw new Error('Progressive JPEG not supported');
      case 0xDA: { // SOS
        if (!frame) throw new Error('SOS before SOF');
        const ns = seg[0];
        const scanComps = [];
        for (let i = 0; i < ns; i++) {
          const id = seg[1 + i * 2];
          const tdta = seg[2 + i * 2];
          const comp = frame.comps.find((c) => c.id === id);
          scanComps.push({ comp, dc: tdta >> 4, ac: tdta & 0x0F });
        }
        const maxH = Math.max(...frame.comps.map((c) => c.h));
        const maxV = Math.max(...frame.comps.map((c) => c.v));
        if (!frame.planes || frame.scanSeen) {
          frame.planes = frame.comps.map((c) => new Float64Array(Math.ceil(frame.width * c.h / maxH) * Math.ceil(frame.height * c.v / maxV)));
        }
        frame.scanSeen = true;

        const br = new BitReader(u8, pos + 2 + len);
        const mcusX = Math.ceil(frame.width / (maxH * 8));
        const mcusY = Math.ceil(frame.height / (maxV * 8));
        const pred = new Map();
        const coeffs = new Float64Array(64);

        for (let my = 0; my < mcusY; my++) {
          for (let mx = 0; mx < mcusX; mx++) {
            for (let si = 0; si < scanComps.length; si++) {
              const { comp, dc, ac } = scanComps[si];
              const planeIdx = frame.comps.indexOf(comp);
              const plane = frame.planes[planeIdx];
              const planeW = Math.ceil(frame.width * comp.h / maxH);
              const planeH = Math.ceil(frame.height * comp.v / maxV);
              const qt = quantNat.get(comp.qt);
              const dcTab = huff.get((0 << 4) | dc);
              const acTab = huff.get((1 << 4) | ac);
              const blocks = comp.h * comp.v;
              for (let b = 0; b < blocks; b++) {
                const bx = (b % comp.h), by = (b / comp.h) | 0;
                const blockX = mx * comp.h + bx;
                const blockY = my * comp.v + by;
                let lastDC = pred.get(comp.id) || 0;
                // --- دیکد ---
                const t = br.readHuff(dcTab);
                const cat = t & 0x0F;
                let diff = 0;
                if (cat > 0) {
                  const bits = br.readBits(cat);
                  const half = 1 << (cat - 1);
                  diff = bits >= half ? bits : bits - (1 << cat) + 1;
                }
                lastDC += diff;
                pred.set(comp.id, lastDC);
                coeffs.fill(0);
                coeffs[0] = lastDC * qt[0];
                let k = 1;
                while (k < 64) {
                  const rs = br.readHuff(acTab);
                  const r = rs >> 4, s = rs & 0x0F;
                  if (s === 0) {
                    if (r === 15) { k += 16; continue; }
                    break;
                  }
                  k += r;
                  if (k > 63) break;
                  const bits = br.readBits(s);
                  const half = 1 << (s - 1);
                  const val = bits >= half ? bits : bits - (1 << s) + 1;
                  coeffs[ZIGZAG[k]] = val * qt[ZIGZAG[k]];
                  k++;
                }
                if (blockX * 8 >= planeW || blockY * 8 >= planeH) continue;
                idctBlock(coeffs);
                const maxx = Math.min(8, planeW - blockX * 8);
                const maxy = Math.min(8, planeH - blockY * 8);
                for (let y = 0; y < maxy; y++) {
                  const off = (blockY * 8 + y) * planeW + blockX * 8;
                  for (let x = 0; x < maxx; x++) plane[off + x] = coeffs[y * 8 + x];
                }
              }
            }
          }
        }
        // همگام‌سازی pos بعد از اسکن
        pos = findNextMarker(Math.max(pos + 4, br.pos - 2));
        continue;
      }
      default:
        break;
    }
    pos += 2 + len;
  }

  if (!frame) throw new Error('No SOF frame');
  const { width: w, height: h } = frame;
  const comps = frame.comps;
  const maxH = Math.max(...comps.map((c) => c.h));
  const maxV = Math.max(...comps.map((c) => c.v));

  const out = new Uint8ClampedArray(w * h * 4);
  if (frame.ncomp === 1) {
    const plane = frame.planes[0];
    const pw = Math.ceil(w / maxH);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = Math.round(plane[y * pw + x] + 128);
      v = v < 0 ? 0 : (v > 255 ? 255 : v);
      const i = (y * w + x) * 4;
      out[i] = out[i + 1] = out[i + 2] = v; out[i + 3] = 255;
    }
  } else {
    const P = (ci, x, y) => {
      const c = comps[ci];
      const pw = Math.ceil(w * c.h / maxH);
      const ph = Math.ceil(h * c.v / maxV);
      let xx = x; let yy = y;
      if (xx < 0) xx = 0; else if (xx >= pw) xx = pw - 1;
      if (yy < 0) yy = 0; else if (yy >= ph) yy = ph - 1;
      return frame.planes[ci][yy * pw + xx];
    };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const Y = P(0, x, y) + 128;
      const Cb = P(1, Math.floor(x * comps[1].h / maxH), Math.floor(y * comps[1].v / maxV)) + 128 - 128;
      const Cr = P(2, Math.floor(x * comps[2].h / maxH), Math.floor(y * comps[2].v / maxV)) + 128 - 128;
      let r = Y + 1.402 * Cr;
      let g = Y - 0.344136 * Cb - 0.714136 * Cr;
      let b = Y + 1.772 * Cb;
      const i = (y * w + x) * 4;
      out[i] = clamp8(r);
      out[i + 1] = clamp8(g);
      out[i + 2] = clamp8(b);
      out[i + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

function clamp8(v) { v = Math.round(v); return v < 0 ? 0 : (v > 255 ? 255 : v); }

// ================= انکودر baseline =================
function encodeHuffTable(table, tcTh) {
  const counts = table.counts;
  const bytes = [tcTh];
  for (let i = 0; i < 16; i++) bytes.push(counts[i]);
  for (const s of table.syms) bytes.push(s);
  return new Uint8Array(bytes);
}

// ساخت نقشهٔ کد از جدول برای انکود (کانونیکال)
function huffEncodeMap(table) {
  const map = new Map();
  let code = 0, si = 0;
  for (let len = 1; len <= 16; len++) {
    for (let i = 0; i < table.counts[len - 1]; i++) {
      map.set(table.syms[si], { code, len });
      si++;
      code++;
    }
    code <<= 1;
  }
  return map;
}

class BitWriter {
  constructor() { this.bytes = []; this.buf = 0; this.bits = 0; }
  write(value, n) {
    this.buf = (this.buf << n) | (value & ((1 << n) - 1));
    this.bits += n;
    while (this.bits >= 8) {
      this.bits -= 8;
      const b = (this.buf >>> this.bits) & 0xFF;
      this.bytes.push(b);
      if (b === 0xFF) this.bytes.push(0x00); // byte-stuffing
    }
  }
  finish() {
    if (this.bits > 0) this.bytes.push((this.buf << (8 - this.bits)) & 0xFF);
    return new Uint8Array(this.bytes);
  }
}

function encodeCat(v) {
  let cat = 0;
  let n = Math.abs(v);
  while (n > 0) { cat++; n >>= 1; }
  return cat;
}

// بلاک ۸×۸ از یک پلین با clamp لبه — خروجی Float64Array(64) «منهای ۱۲۸»
function extractBlock(plane, pw, ph, px, py, out) {
  for (let j = 0; j < 8; j++) {
    let yy = py + j; if (yy >= ph) yy = ph - 1;
    for (let i = 0; i < 8; i++) {
      let xx = px + i; if (xx >= pw) xx = pw - 1;
      out[j * 8 + i] = plane[yy * pw + xx] - 128;
    }
  }
}

// DCT پیش‌رو + کوانتیزاسیون → coef (Int16Array به ترتیب zigzag)
function fdctQuantize(blk, q, qnat, coef) {
  const t = new Float64Array(64);
  for (let r = 0; r < 8; r++) {
    for (let u = 0; u < 8; u++) {
      let s = 0;
      for (let x = 0; x < 8; x++) s += blk[r * 8 + x] * COS[u * 8 + x];
      t[r * 8 + u] = s;
    }
  }
  for (let u = 0; u < 8; u++) {
    for (let v = 0; v < 8; v++) {
      let s = 0;
      for (let y = 0; y < 8; y++) s += t[y * 8 + u] * COS[v * 8 + y];
      const cu = u === 0 ? Math.SQRT1_2 : 1, cv = v === 0 ? Math.SQRT1_2 : 1;
      const nat = v * 8 + u;
      const c = Math.round((s * cu * cv * 0.25) / qnat[nat]);
      coef[ZIGZAG_INV[nat]] = c < -1023 ? -1023 : (c > 1023 ? 1023 : c);
    }
  }
}

// انکود یک بلاک (DC پیشگو + AC) داخل writer
function encodeBlock(w2, coef, dcMap, acMap, prevDC) {
  const dc = coef[0] - prevDC.v;
  prevDC.v = coef[0];
  const cat = encodeCat(dc);
  const dcE = dcMap.get(cat);
  w2.write(dcE.code, dcE.len);
  if (cat > 0) w2.write(dc > 0 ? dc : dc + ((1 << cat) - 1), cat);

  let run = 0;
  for (let i = 1; i < 64; i++) {
    const v = coef[i];
    if (v === 0) { run++; continue; }
    while (run >= 16) { const z = acMap.get(0xF0); w2.write(z.code, z.len); run -= 16; }
    const cat2 = encodeCat(Math.abs(v));
    const sym = (run << 4) | cat2;
    const e = acMap.get(sym);
    w2.write(e.code, e.len);
    w2.write(v > 0 ? v : v + ((1 << cat2) - 1), cat2);
    run = 0;
  }
  if (run > 0) { const eob = acMap.get(0x00); w2.write(eob.code, eob.len); }
}

// انکود YCbCr 4:2:0 baseline interleaved با کیفیت 0..100
export function encodeJPEG({ width: w, height: h, data }, quality = 88, opts = {}) {
  const dataU8 = new Uint8ClampedArray(data.buffer || data, data.byteOffset || 0, w * h * 4);
  // --- RGB→YCbCr (فرمول JFIF) ---
  const Y = new Float64Array(w * h);
  const Cbl = new Float64Array(w * h);
  const Crl = new Float64Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    const R = dataU8[p], G = dataU8[p + 1], B = dataU8[p + 2];
    Y[i] = 0.299 * R + 0.587 * G + 0.114 * B;
    Cbl[i] = -0.168736 * R - 0.331264 * G + 0.5 * B + 128;   // 0..255 (extractBlock بعد ۱۲۸ کم می‌کند)
    Crl[i] = 0.5 * R - 0.418688 * G - 0.081312 * B + 128;
  }

  // --- کوانتیزاسیون کیفیت‌دار (zigzag ترتیب، مثل Annex K) ---
  const qScale = quality < 50 ? Math.max(1, Math.round(5000 / quality)) : Math.max(1, Math.round(200 - quality * 2));
  const makeQ = (base) => {
    const q = new Uint8Array(64);
    for (let i = 0; i < 64; i++) {
      let v = (base[i] * qScale + 50) / 100 | 0;
      if (v < 1) v = 1; if (v > 255) v = 255;
      q[i] = v;
    }
    return q;
  };
  const qL = makeQ(LUM_Q), qC = makeQ(CHR_Q);
  // نسخهٔ «طبیعی» جداول (index طبیعی → مقدار)
  const qLnat = new Float64Array(64), qCnat = new Float64Array(64);
  for (let i = 0; i < 64; i++) { qLnat[i] = qL[ZIGZAG_INV[i]]; qCnat[i] = qC[ZIGZAG_INV[i]]; }

  // --- داون‌سمپل کرومینانس 4:2:0 (میانگین 2x2) ---
  const cw = Math.ceil(w / 2), ch = Math.ceil(h / 2);
  const Cb = new Float64Array(cw * ch), Cr = new Float64Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const x0 = x * 2, y0 = y * 2;
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const n = (x1 - x0 + 1) * (y1 - y0 + 1);
    let sb = 0, sr = 0;
    for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
      sb += Cbl[yy * w + xx]; sr += Crl[yy * w + xx];
    }
    Cb[y * cw + x] = sb / n; Cr[y * cw + x] = sr / n;
  }

  const encDC = huffEncodeMap(DCLUM), encAC = huffEncodeMap(ACLUM);
  const encDCc = huffEncodeMap(DCCHR), encACc = huffEncodeMap(ACCHR);

  // --- انکود interleaved ---
  const w2 = new BitWriter();
  const nY = { v: 0 }, nCb = { v: 0 }, nCr = { v: 0 };
  const blk = new Float64Array(64);
  const coef = new Int16Array(64);
  const mcusX = Math.ceil(w / 16), mcusY = Math.ceil(h / 16);

  for (let my = 0; my < mcusY; my++) {
    for (let mx = 0; mx < mcusX; mx++) {
      // 4 بلاک Y
      for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
        extractBlock(Y, w, h, mx * 16 + bx * 8, my * 16 + by * 8, blk);
        fdctQuantize(blk, qL, qLnat, coef);
        encodeBlock(w2, coef, encDC, encAC, nY);
      }
      // Cb
      extractBlock(Cb, cw, ch, mx * 8, my * 8, blk);
      fdctQuantize(blk, qC, qCnat, coef);
      encodeBlock(w2, coef, encDCc, encACc, nCb);
      // Cr
      extractBlock(Cr, cw, ch, mx * 8, my * 8, blk);
      fdctQuantize(blk, qC, qCnat, coef);
      encodeBlock(w2, coef, encDCc, encACc, nCr);
    }
  }
  const entropy = w2.finish();

  // --- سرهم‌کردن فایل ---
  const chunks = [];
  const mk = (marker, payload) => {
    chunks.push(0xFF, marker);
    if (payload) {
      const len = payload.length + 2;
      chunks.push((len >> 8) & 0xFF, len & 0xFF);
      for (const b of payload) chunks.push(b);
    }
  };
  mk(0xD8);
  mk(0xE0, new Uint8Array([0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00])); // APP0 JFIF
  // APP2 — پروفایل ICC (مدیریت رنگ؛ فتوشاپ/مرورگر رنگ‌ها را درست تفسیر می‌کنند)
  if (opts.icc && opts.icc.length) {
    const MAX = 65519 - 14;
    const total = Math.max(1, Math.ceil(opts.icc.length / MAX));
    for (let i = 0; i < total; i++) {
      const part = opts.icc.subarray(i * MAX, Math.min(opts.icc.length, (i + 1) * MAX));
      const payload = new Uint8Array(part.length + 14);
      payload.set([0x49, 0x43, 0x43, 0x5F, 0x50, 0x52, 0x4F, 0x46, 0x49, 0x4C, 0x45], 0); // 'ICC_PROFILE'
      payload[11] = 0;
      payload[12] = i + 1;      // شمارهٔ ترتیب
      payload[13] = total;
      payload.set(part, 14);
      mk(0xE2, payload);
    }
  }
  // DQT: مقادیر در ترتیب zigzag (خود qL/qC از قبل zigzag هستند)
  {
    const d = new Uint8Array(1 + 64 + 1 + 64);
    d[0] = 0x00; for (let i = 0; i < 64; i++) d[1 + i] = qL[i];
    d[65] = 0x01; for (let i = 0; i < 64; i++) d[66 + i] = qC[i];
    mk(0xDB, d);
  }
  // SOF0
  mk(0xC0, new Uint8Array([8, (h >> 8) & 0xFF, h & 0xFF, (w >> 8) & 0xFF, w & 0xFF, 3,
    1, 0x22, 0x00,   // Y h=2 v=2 qt=0
    2, 0x11, 0x01,   // Cb h=1 v=1 qt=1
    3, 0x11, 0x01]));// Cr h=1 v=1 qt=1
  // DHT
  mk(0xC4, encodeHuffTable(DCLUM, 0x00));
  mk(0xC4, encodeHuffTable(ACLUM, 0x10));
  mk(0xC4, encodeHuffTable(DCCHR, 0x01));
  mk(0xC4, encodeHuffTable(ACCHR, 0x11));
  // SOS (single interleaved scan, 3 کامپوننت)
  mk(0xDA, new Uint8Array([3, 1, 0x00, 2, 0x11, 3, 0x11, 0, 63, 0]));
  for (const b of entropy) chunks.push(b);
  mk(0xD9);
  return new Uint8Array(chunks);
}
