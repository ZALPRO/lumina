// formats/psd-layerstyles.js — استایل لایهٔ واقعی فتوشاپ برای PSD
//
// دو نمایش استاندارد و هر دو پشتیبانی می‌شود:
//   • 'lfx2' — Object-based effects layer info (فرمتی که فتوشاپ امروز ذخیره می‌کند)
//   • 'lrFX' — Layer effects (Photoshop 5.0، رکوردهای ثابت‌اندازه) — اختیاری
//
// کلیدها مطابق terminology فتوشاپ: Mode='Md  ', Color='Clr ', Opacity='Opct',
// Distance='Dstn', Choke='Ckmt', Size='blur', Noise='Nose', AntiAlias='AntA',
// UseGlobalAngle='uglg', LocalLightingAngle='lagl', Style='Styl', PaintType='PntT'.
import { Writer, encodeDescriptor, objValue, boolValue, doubleValue, unitValue, enumValue, UNIT } from './psd-descriptor.js';

const ENUM_BLEND = 'BlnM';
const BLEND_ENUM = {
  normal: 'Nrml', multiply: 'Mltp', screen: 'Scrn', overlay: 'Ovrl', darken: 'Drkn',
  lighten: 'Lghn', colorDodge: 'CBrn', colorBurn: 'CBrn', linearDodge: 'linearDodge',
  softLight: 'SftL', hardLight: 'HrdL', difference: 'Dfrn', exclusion: 'Xclu',
  hue: 'hue ', saturation: 'sat ', color: 'colr', luminosity: 'Lmns',
};

function colorDescriptor(rgb = [0, 0, 0]) {
  return {
    classId: 'RGBC',
    items: {
      'Rd  ': doubleValue(rgb[0] ?? 0),
      'Grn ': doubleValue(rgb[1] ?? 0),
      'Bl  ': doubleValue(rgb[2] ?? 0),
    },
  };
}

/* ── Drop Shadow ── */
export function dropShadowEffect(opts = {}) {
  const {
    dx = 6, dy = 8, blur = 10, color = [0, 0, 0], opacity = 0.55, spread = 0,
    angle, distance, blendMode = 'multiply', enabled = true, useGlobalAngle = false,
  } = opts;
  const a = angle !== undefined ? angle : (Math.atan2(dy, dx) * 180) / Math.PI;
  const dist = distance !== undefined ? distance : Math.hypot(dx, dy);
  return {
    type: 'Objc',
    value: {
      classId: 'DrSh',
      items: {
        'enab': boolValue(enabled),
        'present': boolValue(true),
        'showInDialog': boolValue(true),
        'Md  ': enumValue(ENUM_BLEND, BLEND_ENUM[blendMode] || 'Mltp'),
        'Clr ': objValue(colorDescriptor(color)),
        'Opct': unitValue(UNIT.PERCENT, Math.round(opacity * 100)),
        'uglg': boolValue(useGlobalAngle),
        'lagl': unitValue(UNIT.ANGLE, a),
        'Dstn': unitValue(UNIT.DISTANCE, dist),
        'Ckmt': unitValue(UNIT.DISTANCE, spread),
        'blur': unitValue(UNIT.DISTANCE, blur),
        'Nose': unitValue(UNIT.PERCENT, 0),
        'AntA': boolValue(true),
        'TrnS': objValue({ classId: 'TrnS', items: { 'Nm  ': { type: 'TEXT', value: 'Linear' } } }),
        'layerConceals': boolValue(true),
      },
    },
  };
}

/* ── Stroke ── */
export function strokeEffect(opts = {}) {
  const {
    size = 3, color = [0, 0, 0], opacity = 1, position = 'outside',
    blendMode = 'normal', enabled = true,
  } = opts;
  const posEnum = position === 'inside' ? 'InsF' : position === 'center' ? 'CtrF' : 'OutF';
  return {
    type: 'Objc',
    value: {
      classId: 'FrFX',
      items: {
        'enab': boolValue(enabled),
        'present': boolValue(true),
        'showInDialog': boolValue(true),
        'Styl': enumValue('FStl', posEnum),
        'PntT': enumValue('FrFl', 'SClr'),
        'Md  ': enumValue(ENUM_BLEND, BLEND_ENUM[blendMode] || 'Nrml'),
        'Clr ': objValue(colorDescriptor(color)),
        'Opct': unitValue(UNIT.PERCENT, Math.round(opacity * 100)),
        'Sz  ': unitValue(UNIT.DISTANCE, size),
        'overprint': boolValue(false),
      },
    },
  };
}

/* ── Color Overlay ── */
export function colorOverlayEffect(opts = {}) {
  const { color = [255, 0, 0], opacity = 1, blendMode = 'normal', enabled = true } = opts;
  return {
    type: 'Objc',
    value: {
      classId: 'SoFi',
      items: {
        'enab': boolValue(enabled),
        'present': boolValue(true),
        'showInDialog': boolValue(true),
        'Md  ': enumValue(ENUM_BLEND, BLEND_ENUM[blendMode] || 'Nrml'),
        'Clr ': objValue(colorDescriptor(color)),
        'Opct': unitValue(UNIT.PERCENT, Math.round(opacity * 100)),
      },
    },
  };
}

/* ── ساخت lfx2 ── */
export function buildLfx2(layer, style = layer && layer.style) {
  if (!style) return null;
  const items = {
    'Scl ': unitValue(UNIT.PERCENT, 100),
    'masterFXSwitch': boolValue(true),
  };
  if (style.dropShadow) items.DrSh = dropShadowEffect(style.dropShadow);
  if (style.stroke) items.FrFX = strokeEffect(style.stroke);
  if (style.colorOverlay) items.SoFi = colorOverlayEffect(style.colorOverlay);
  if (Object.keys(items).length <= 2) return null;
  return encodeDescriptor({ classId: 'Lefx', items });
}

/* ── فرمت قدیمی lrFX (Photoshop 5/6) ──
   چیدمان رکوردها مطابق مشخصات فتوشاپ و پیاده‌سازی مرجع ag-psd:
     • dsdw/isdw (سایه): size=51 → version(0) + بلور/شدت/زاویه/فاصله (هر کدام 16.16)
       + رنگ(۲ بایت فضا + ۴×u16) + '8BIM'+حالت + enabled + useGlobalAngle + opacity(u8)
       + رنگ بومی
     • sofi (رنگ روی لایه): size=34 → version(2) + '8BIM'+حالت + رنگ + opacity + enabled + رنگ بومی
     • cmnS (وضعیت مشترک): size=7 → version(0) + visible + ۲ بایت صفر
*/
const FX = 65536;                                   // 16.16 ثابت‌نقطه
function fxColor(w, rgb) {
  w.u16(2);                                         // فضای رنگی = RGB
  w.u16((rgb[0] ?? 0) * 257); w.u16((rgb[1] ?? 0) * 257);
  w.u16((rgb[2] ?? 0) * 257); w.u16(0);
}
function fxBlendMode(w, mode) {
  w.ascii4('8BIM');
  w.ascii4((BLEND_ENUM[mode] && mode === 'normal' ? 'norm' : lrFxBlend(mode)));
}
function lrFxBlend(mode) {
  return { normal: 'norm', multiply: 'mul ', screen: 'scrn', overlay: 'over',
    darken: 'dark', lighten: 'lite', difference: 'diff', exclusion: 'smud',
    colorDodge: 'div ', colorBurn: 'idiv', softLight: 'sLit', hardLight: 'hLit' }[mode] || 'norm';
}

export function buildLrFX(layer, style = layer && layer.style) {
  if (!style) return null;
  const records = [];
  if (style.dropShadow) {
    const s = style.dropShadow;
    const angle = s.angle !== undefined ? s.angle : (Math.atan2(s.dy ?? 0, s.dx ?? 0) * 180) / Math.PI;
    const dist = s.distance !== undefined ? s.distance : Math.hypot(s.dx ?? 0, s.dy ?? 0);
    const color = s.color || [0, 0, 0];
    // بدنهٔ رکورد = ۵۱ بایت (طول را خودِ بلاک lrFX می‌نویسد؛ داخل بدنه فیلد اندازه نیست)
    const b = new Writer();
    b.u32(0);                                       // version
    b.u32(Math.round((s.blur ?? 0) * FX));          // blur
    b.u32(0);                                       // intensity
    b.u32(Math.round((((angle % 360) + 360) % 360) * FX));  // angle
    b.u32(Math.round(dist * FX));                   // distance
    fxColor(b, color);
    fxBlendMode(b, s.blendMode || 'multiply');
    b.u8(1); b.u8(0);                               // enabled, useGlobalAngle
    b.u8(Math.round((s.opacity ?? 1) * 255));
    fxColor(b, color);                              // رنگ بومی
    records.push({ key: 'dsdw', body: b.out() });
  }
  if (style.colorOverlay || style.stroke) {
    const ov = style.colorOverlay || { color: style.stroke.color, opacity: style.stroke.opacity };
    const color = ov.color || [255, 0, 0];
    // بدنهٔ رکورد = ۳۴ بایت
    const b = new Writer();
    b.u32(2);                                       // version = 2
    fxBlendMode(b, ov.blendMode || 'normal');
    fxColor(b, color);
    b.u8(Math.round((ov.opacity ?? 1) * 255));
    b.u8(1);                                        // enabled
    fxColor(b, color);
    records.push({ key: 'sofi', body: b.out() });
  }
  if (!records.length) return null;
  const out = new Writer();
  out.u16(0);                                       // version = 0 (مثل فتوشاپ)
  out.u16(records.length);
  for (const r of records) {
    out.ascii4('8BIM'); out.ascii4(r.key);
    out.u32(r.body.length); out.bytes(r.body);
  }
  return out.out();
}

export { BLEND_ENUM, colorDescriptor };
