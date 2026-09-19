// formats/psd-descriptor.js — نویسندهٔ «دسکریپتور» فتوشاپ (big-endian)
//
// دسکریپتور ساختاری است که فتوشاپ برای Layer Style و Smart Object و ... استفاده
// می‌کند. مشخصات دقیق (مطابق خواننده/نویسندهٔ مرجع psd-tools):
//   Descriptor : UnicodeString(نام) + طول‌کلید(۴ بایت) + کلید(classID) + u32 تعداد
//                و برای هر آیتم: طول‌کلید + کلید + ۴ بایت OSType + مقدار
//   طول‌کلید   : اگر کلید در فهرست «واژه‌های شناخته‌شدهٔ» فتوشاپ باشد مقدار صفر
//                نوشته می‌شود (یعنی کلید ۴ کاراکتری ثابت)، وگرنه طول کلید.
//   UnicodeString : u32 تعداد کاراکتر + UTF-16BE + پدینگ به مضرب ۲ (نسبت به ابتدای خودش)
//
// این نکتهٔ پدینگ حیاتی است: پدینگ نسبت به «ابتدای همان رشته» حساب می‌شود، نه
// نسبت به ابتدای کل بلاک.
export const OSTYPE = {
  REFERENCE: 'obj ', PROPERTY: 'prop', DESCRIPTOR: 'Objc', LIST: 'VlLs',
  DOUBLE: 'doub', UNIT_FLOAT: 'UntF', STRING: 'TEXT', ENUMERATED: 'enum',
  INTEGER: 'long', LARGE_INTEGER: 'comp', BOOLEAN: 'bool', GLOBAL_OBJECT: 'GlbO',
  CLASS1: 'Clss', CLASS2: 'Clss', ALIAS: 'alis', RAW_DATA: 'tdta',
};

export const UNIT = { ANGLE: '#Ang', DENSITY: '#Rsl', DISTANCE: '#Pxl', NONE: '#Nne', PERCENT: '#Prc', PIXELS: '#Pxl', POINTS: '#Pnt' };

// واژه‌های شناخته‌شدهٔ فتوشاپ: فقط کلیدهای «۴ کاراکتری» با طول صفر نوشته می‌شوند.
// کلیدهای بلندتر (مثل 'present' یا 'masterFXSwitch') با طولِ خودشان می‌آیند.
const TERMS = new Set([
  'null', 'Clss', 'Objc', 'VlLs', 'doub', 'UntF', 'TEXT', 'enum', 'long', 'comp',
  'bool', 'GlbO', 'GlbC', 'alis', 'tdta', 'obj ', 'prop', 'type', 'Clss',
  // کلیدهای ۴ کاراکتری
  'Angl', 'AntA', 'blur', 'BlnM', 'Ckmt', 'Clr ', 'ClrS', 'Dstn', 'enab', 'Inpr',
  'lagl', 'Md  ', 'Nm  ', 'Nose', 'Opct', 'PntT', 'Scl ', 'Styl', 'TrnS', 'uglg',
  'Sz  ', 'Hrdn', 'Algn', 'TrnF', 'Adjs', 'Cnt ', 'Ct  ', 'Cyn ', 'Dstn', 'Mdpn',
  // کلاس‌ها و enumهای ۴ کاراکتری
  'Lefx', 'RGBC', 'HSBl', 'CMYC', 'LbCl', 'Grsc', 'DrSh', 'IrSh', 'OrGl', 'IrGl',
  'SoFi', 'FrFX', 'ebbl', 'ChFX', 'GrFl', 'SfBL', 'PrBL', 'OutF', 'InsF', 'CtrF',
  'SClr', 'Ptrn', 'Nrml', 'Mltp', 'Scrn', 'Ovrl', 'Drkn', 'Lghn', 'SftL', 'HrdL',
  'CBrn', 'idiv', 'Dfrn', 'Xclu', 'hue ', 'sat ', 'colr', 'Lmns', 'FStl', 'FrFl',
  'LrSl', 'NONE', 'lbrn', 'dkCl', 'lite', 'div ', 'lddg', 'lgCl', 'over', 'sLit',
  'hLit', 'vLit', 'lLit', 'pLit', 'hMix', 'diff', 'smud', 'fsub', 'fdiv', 'diss',
  'dark', 'mul ', 'diss', 'pass', 'norm', 'crs ', 'prFl', 'PCth',
]);

function writeUnicodeString(w, value) {
  const utf16 = [];
  for (const ch of String(value ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp > 0xFFFF) {                       // surrogate pair
      const v = cp - 0x10000;
      utf16.push(0xD800 + (v >> 10), 0xDC00 + (v & 0x3FF));
    } else utf16.push(cp);
  }
  const start = w.len;
  w.u32(utf16.length);
  for (const u of utf16) w.u16(u);
  // پدینگ تا مضرب ۲ نسبت به ابتدای رشته
  if (utf16.length % 2) w.u8(0);
  return w.len - start;
}

function writeKey(w, key) {
  const k = String(key);
  if (TERMS.has(k)) { w.u32(0); w.ascii4(k); }
  else { w.u32(k.length); w.keyBytes(k); }
}

/* ── سازنده‌های مقدار ── */
export const boolValue = (v) => ({ type: OSTYPE.BOOLEAN, value: !!v });
export const doubleValue = (v) => ({ type: OSTYPE.DOUBLE, value: Number(v) });
export const unitValue = (unit, v) => ({ type: OSTYPE.UNIT_FLOAT, unit, value: Number(v) });
export const enumValue = (enumType, value) => ({ type: OSTYPE.ENUMERATED, enumType, value });
export const textValue = (v) => ({ type: OSTYPE.STRING, value: String(v) });
export const longValue = (v) => ({ type: OSTYPE.INTEGER, value: v | 0 });
export const objValue = (descriptor) => ({ type: OSTYPE.DESCRIPTOR, value: descriptor });
export const listValue = (items) => ({ type: OSTYPE.LIST, items: items || [] });
export const classValue = (name, classId) => ({ type: OSTYPE.CLASS2, name, classId });

export function encodeValue(w, val) {
  switch (val.type) {
    case OSTYPE.DOUBLE: w.f64(val.value); return;
    case OSTYPE.UNIT_FLOAT:
      w.ascii4(val.unit);
      w.f64(val.value);
      return;
    case OSTYPE.STRING:
      // StringElement.read: UTF-16 با پدینگ ۱ (نسبت به ابتدای رشته)
      writeUnicodeString(w, val.value);
      return;
    case OSTYPE.ENUMERATED:
      writeKey(w, val.enumType);
      writeKey(w, val.value);
      return;
    case OSTYPE.INTEGER: w.i32(val.value); return;
    case OSTYPE.LARGE_INTEGER: w.i64(val.value); return;
    case OSTYPE.BOOLEAN: w.u8(val.value ? 1 : 0); return;
    case OSTYPE.CLASS2:
      writeUnicodeString(w, val.name || '');
      writeKey(w, val.classId);
      return;
    case OSTYPE.DESCRIPTOR: writeDescriptor(w, val.value); return;
    case OSTYPE.LIST:
      w.u32(val.items.length);
      for (const item of val.items) { w.ascii4(item.type); encodeValue(w, item); }
      return;
    default:
      throw new Error('psd-descriptor: نوع ناشناخته ' + val.type);
  }
}

export function writeDescriptor(w, desc) {
  writeUnicodeString(w, desc.name || '');
  writeKey(w, desc.classId || 'null');
  const items = desc.items || {};
  const keys = Object.keys(items);
  w.u32(keys.length);
  for (const k of keys) {
    const key = k.length < 4 ? k.padEnd(4, ' ') : k;
    writeKey(w, key);
    w.ascii4(items[k].type);
    encodeValue(w, items[k]);
  }
}

/* ── نویسندهٔ کوچک باینری ── */
export class Writer {
  constructor() { this.buf = new Uint8Array(512); this.len = 0; }
  _need(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap); nb.set(this.buf.subarray(0, this.len)); this.buf = nb;
  }
  u8(v) { this._need(1); this.buf[this.len++] = v & 255; }
  u16(v) { this._need(2); this.buf[this.len++] = (v >>> 8) & 255; this.buf[this.len++] = v & 255; }
  i16(v) { this.u16(v < 0 ? v + 0x10000 : v); }
  i32(v) { this.u32(v >>> 0); }
  u32(v) { this._need(4); this.buf[this.len++] = (v >>> 24) & 255; this.buf[this.len++] = (v >>> 16) & 255; this.buf[this.len++] = (v >>> 8) & 255; this.buf[this.len++] = v & 255; }
  i64(v) {
    const hi = Math.floor(v / 4294967296), lo = v >>> 0;
    this.u32(hi); this.u32(lo);
  }
  f64(v) {
    this._need(8);
    const dv = new DataView(this.buf.buffer, this.buf.byteOffset + this.len, 8);
    dv.setFloat64(0, v, false); this.len += 8;
  }
  ascii4(s) { this._need(4); const t = s.padEnd(4, '\0'); for (let i = 0; i < 4; i++) this.buf[this.len++] = t.charCodeAt(i) & 255; }
  keyBytes(s) { this._need(s.length); for (let i = 0; i < s.length; i++) this.buf[this.len++] = s.charCodeAt(i) & 255; }
  bytes(a) { this._need(a.length); this.buf.set(a, this.len); this.len += a.length; }
  zeros(n) { this._need(n); this.buf.fill(0, this.len, this.len + n); this.len += n; }
  out() { return this.buf.slice(0, this.len); }
}

export { writeKey, writeUnicodeString };

// payload یک «بلاک دسکریپتوری نسخه‌دار»: u32 version + u32 descriptorVersion(=16) + دسکریپتور
// این چیدمان تأییدشده است: هم psd-tools (DescriptorBlock2) و هم ag-psd
// (readVersionAndDescriptor) دقیقاً همین دو u32 را انتظار دارند. فتوشاپ ۶ به بعد
// descriptorVersion را ۱۶ می‌نویسد.
export function encodeDescriptor(desc, { version = 0, descriptorVersion = 16 } = {}) {
  const inner = new Writer();
  writeDescriptor(inner, desc);
  const body = inner.out();
  const w = new Writer();
  w.u32(version);
  w.u32(descriptorVersion);
  w.bytes(body);
  return w.out();
}

/* ── پارسر دسکریپتور (قرینهٔ نویسنده؛ برای خواندن lfx2/vmsk و ... ) ── */
export class Reader {
  constructor(buf, off = 0) { this.b = buf; this.p = off; }
  u8() { return this.b[this.p++]; }
  u16() { const v = (this.b[this.p] << 8) | this.b[this.p + 1]; this.p += 2; return v; }
  i16() { const v = this.u16(); return v >= 0x8000 ? v - 0x10000 : v; }
  u32() { const b = this.b, p = this.p; this.p += 4; return ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0; }
  i32() { return this.u32() | 0; }
  f64() {
    const dv = new DataView(this.b.buffer, this.b.byteOffset + this.p, 8);
    this.p += 8; return dv.getFloat64(0, false);
  }
  str4() { const s = String.fromCharCode(this.b[this.p], this.b[this.p + 1], this.b[this.p + 2], this.b[this.p + 3]); this.p += 4; return s; }
  bytes(n) { const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
}

// UnicodeString: u32 تعداد کاراکتر + UTF-16BE + پدینگ به مضرب ۲ (نسبت به ابتدای خودش)
function readUnicode(r) {
  const start = r.p;
  const n = r.u32();
  let s = '';
  for (let i = 0; i < n; i++) s += String.fromCharCode(r.u16());
  if ((r.p - start) % 2) r.p++;
  return s;
}

function readKey(r) {
  const len = r.u32();
  if (len === 0) return r.str4();
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(r.u8());
  return s;
}

export function parseDescriptorValue(r, type) {
  switch (type) {
    case 'TEXT': return { __t: 'TEXT', value: readUnicode(r) };
    case 'enum': return { __t: 'enum', type: readKey(r), value: readKey(r) };
    case 'long': return r.i32();
    case 'comp': { const hi = r.u32(); const lo = r.u32(); return hi * 4294967296 + lo; }
    case 'doub': return r.f64();
    case 'UntF': { const unit = r.str4(); return { __t: 'UntF', unit, value: r.f64() }; }
    case 'bool': return r.u8() !== 0;
    case 'Objc': case 'GlbO': return parseDescriptor(r);
    case 'Clss': case 'type': return { __t: 'Clss', name: readUnicode(r), classId: readKey(r) };
    case 'VlLs': {
      const n = r.u32();
      const items = [];
      for (let i = 0; i < n; i++) items.push(parseDescriptorValue(r, r.str4()));
      return items;
    }
    case 'obj ':
      return { __t: 'ref', ref: 'obj ' };
    default:
      throw new Error('psd-descriptor: نوع ناشناخته ' + type);
  }
}

export function parseDescriptor(r) {
  const name = readUnicode(r);
  const classId = readKey(r);
  const n = r.u32();
  const items = {};
  for (let i = 0; i < n; i++) {
    const key = readKey(r);
    const type = r.str4();
    items[key] = parseDescriptorValue(r, type);
  }
  return { __t: 'Objc', name, classId, items };
}

// بلاک دسکریپتوری نسخه‌دار (payload 'lfx2'): u32 version + u32 descriptorVersion + descriptor
export function parseDescriptorBlock(buf, off) {
  const r = new Reader(buf, off);
  const version = r.u32();
  const descriptorVersion = r.u32();
  const descriptor = parseDescriptor(r);
  return { version, descriptorVersion, descriptor, end: r.p };
}

// استخراج عدد (با واحد) از یک آیتم دسکریپتور
export function numOf(obj, key, def = 0) {
  const v = obj && obj.items ? obj.items[key] : undefined;
  if (v === undefined || v === null) return def;
  if (typeof v === 'number') return v;
  if (v.__t === 'UntF') return v.value;
  return def;
}
export function unitOf(obj, key) {
  const v = obj && obj.items ? obj.items[key] : undefined;
  return v && v.__t === 'UntF' ? v.unit : null;
}
export function enumOf(obj, key, def = null) {
  const v = obj && obj.items ? obj.items[key] : undefined;
  return v && v.__t === 'enum' ? v.value : def;
}
export function boolOf(obj, key, def = false) {
  const v = obj && obj.items ? obj.items[key] : undefined;
  return typeof v === 'boolean' ? v : def;
}
export function colorOf(obj, key) {
  const c = obj && obj.items ? obj.items[key] : undefined;
  if (!c || !c.items) return null;
  const rd = typeof c.items['Rd  '] === 'number' ? c.items['Rd  '] : null;
  const gr = typeof c.items['Grn '] === 'number' ? c.items['Grn '] : null;
  const bl = typeof c.items['Bl  '] === 'number' ? c.items['Bl  '] : null;
  if (rd === null && gr === null && bl === null) return null;
  return [rd || 0, gr || 0, bl || 0];
}
