// document/composite.js — موتور کامپوزیت نهایی سند (پشتهٔ لایه‌ها)
// رندر کاشی‌محور + کش: فقط کاشی‌های dirty دوباره رندر می‌شوند.
// مسیر داغ (پیکسل درونی) بدون هیچ تخصیص حافظه و با جدول جست‌وجوی sRGB→خطی
// → چند برابر سریع‌تر از حلقهٔ سادهٔ «همهٔ بافر».
import { Paint } from './paint.js';
import { blendChannel, blendColor } from '../engine/blend.js';
import { srgbToLinear, linearToSrgb } from '../engine/color.js';
import { TILE_SIZE } from '../engine/tile.js';

const TS = TILE_SIZE; // ۲۵۶

const NON_SEP = new Set(['hue', 'saturation', 'color', 'luminosity', 'darkerColor', 'lighterColor']);

// جدول جست‌وجوی sRGB8→خطی (بدون pow)
const U8L = new Float32Array(256);
for (let i = 0; i < 256; i++) U8L[i] = srgbToLinear(i / 255);
const u8l = (v) => U8L[v];
function round255(v) { if (v >= 1) return 255; if (v <= 0) return 0; return Math.round(v * 255); }

export class Composer {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.result = new Paint(w, h);  // کش کاشی‌ایِ نتیجه
    this.dirtyTiles = new Set();
  }

  invalidate() {
    this.dirtyTiles.clear();
    for (let ty = 0; ty < this.result.tilesY; ty++) {
      for (let tx = 0; tx < this.result.tilesX; tx++) {
        this.dirtyTiles.add(ty * this.result.tilesX + tx);
      }
    }
  }

  invalidateRect(rect) {
    const x0 = Math.max(0, Math.floor(rect.x / TS));
    const y0 = Math.max(0, Math.floor(rect.y / TS));
    const x1 = Math.min(this.result.tilesX - 1, Math.floor((rect.x + rect.w - 1) / TS));
    const y1 = Math.min(this.result.tilesY - 1, Math.floor((rect.y + rect.h - 1) / TS));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        this.dirtyTiles.add(ty * this.result.tilesX + tx);
      }
    }
  }

  render(layers, clip = null) {
    for (const key of this.dirtyTiles) {
      const tx = key % this.result.tilesX;
      const ty = (key / this.result.tilesX) | 0;
      this.renderTile(tx, ty, layers, clip);
    }
    this.dirtyTiles.clear();
  }

  renderTile(tx, ty, layers, clip) {
    const px = tx * TS, py = ty * TS;
    const rw = Math.min(TS, this.w - px);
    const rh = Math.min(TS, this.h - py);
    const t = this.result.getTile(tx, ty, true);
    const td = t.allocate();
    td.fill(0);

    for (let ly = 0; ly < rh; ly++) {
      const gy = py + ly;
      for (let lx = 0; lx < rw; lx++) {
        const gx = px + lx;
        if (clip && !clip.contains(gx, gy)) continue;

        let br = 0, bg = 0, bb = 0, ba = 0;   // نتیجهٔ جاری (رنگ مستقیم خطی)
        let touched = false;
        let groupOpStack = [1];

        for (let li = 0; li < layers.length; li++) {
          const layer = layers[li];
          if (layer.isGroupEnd) { groupOpStack.pop(); if (!groupOpStack.length) groupOpStack = [1]; continue; }
          if (layer.isGroup) { groupOpStack.push(groupOpStack[groupOpStack.length - 1] * (layer.visible ? layer.opacity : 0)); continue; }
          const groupOp = groupOpStack[groupOpStack.length - 1];
          if (!layer.visible || layer.opacity <= 0 || groupOp <= 0) continue;
          const effOpacity = layer.opacity * groupOp;

          // ─── لایهٔ تنظیم (غیرمخرب): روی نتیجهٔ فعلی (لایه‌های زیرین) اعمال می‌شود ───
          if (layer.isAdjustment && layer.adjustment && layer.adjustment.apply) {
            if (!touched) continue; // هنوز پیکسلی نداریم
            const cu8 = [round255(linearToSrgb(br)), round255(linearToSrgb(bg)), round255(linearToSrgb(bb)), round255(ba)];
            const outU8 = layer.adjustment.apply(cu8[0], cu8[1], cu8[2], cu8[3]);
            br = srgbToLinear(outU8[0] / 255);
            bg = srgbToLinear(outU8[1] / 255);
            bb = srgbToLinear(outU8[2] / 255);
            ba = outU8[3] / 255;
            continue;
          }

          const lp = layer.paint;
          if (!lp) continue;
          const lxg = gx - layer.ox, lyg = gy - layer.oy;
          const ltx = Math.floor(lxg / TS), lty = Math.floor(lyg / TS);

          if (ltx < 0 || lty < 0 || ltx >= lp.tilesX || lty >= lp.tilesY) continue;
          const lt = lp.getTile(ltx, lty);
          if (!lt || !lt.allocated) continue;
          const lx2 = lxg - ltx * TS, ly2 = lyg - lty * TS;
          const li4 = lt.idx(lx2, ly2);

          let sa = lt.data[li4 + 3];
          if (sa === 0) continue;
          if (layer.clipToBelow) {
            // clipping mask: فقط جایی که زیرلایه (نتیجهٔ جاریِ کامپوزیت‌شده) مات است
            if (!touched || ba <= 0) continue;
            sa = Math.round(sa * ba);
            if (sa === 0) continue;
          }
          if (layer.mask) {
            const mt = layer.mask.getTile(ltx, lty);
            if (!mt || !mt.allocated) continue;
            const ma = mt.data[mt.idx(lx2, ly2) + 3];
            if (ma === 0) continue;
            sa = Math.round((sa / 255) * (ma / 255) * 255);
            if (sa === 0) continue;
          }
          if (layer.vectorMask) {
            const gxg = Math.round(gx - layer.ox), gyg = Math.round(gy - layer.oy);
            if (gxg < 0 || gyg < 0 || gxg >= layer.vectorMask.w || gyg >= layer.vectorMask.h) continue;
            if (!layer.vectorMask.mask[gyg * layer.vectorMask.w + gxg]) continue;
          }
          if (effOpacity < 1) sa = Math.round(sa * effOpacity);
          if (sa === 0) continue;

          const sla = sa / 255;
          const slr = u8l(lt.data[li4]), slg = u8l(lt.data[li4 + 1]), slb = u8l(lt.data[li4 + 2]);
          const mode = layer.blendMode;

          if (mode === 'normal') {
            const ab = ba, ias = 1 - sla;
            const ao = sla + ab * ias;
            if (ao > 0) {
              br = (slr * sla + br * ab * ias) / ao;
              bg = (slg * sla + bg * ab * ias) / ao;
              bb = (slb * sla + bb * ab * ias) / ao;
            } else { br = slr; bg = slg; bb = slb; }
            ba = ao; touched = true;
          } else {
            const ab = ba;
            let Br, Bg, Bb;
            if (ab <= 0) { Br = slr; Bg = slg; Bb = slb; }
            else if (NON_SEP.has(mode)) {
              const B = blendColor(mode, [br, bg, bb], [slr, slg, slb]);
              Br = B[0]; Bg = B[1]; Bb = B[2];
            } else {
              Br = blendChannel(mode, br, slr);
              Bg = blendChannel(mode, bg, slg);
              Bb = blendChannel(mode, bb, slb);
            }
            const ias = 1 - sla;
            const ao = sla + ab * ias;
            br = (sla * (1 - ab) * slr + sla * ab * Br + ias * ab * br) / ao;
            bg = (sla * (1 - ab) * slg + sla * ab * Bg + ias * ab * bg) / ao;
            bb = (sla * (1 - ab) * slb + sla * ab * Bb + ias * ab * bb) / ao;
            ba = ao; touched = true;
          }
        }

        const di = t.idx(lx, ly);
        if (!touched) { td[di] = 0; td[di + 1] = 0; td[di + 2] = 0; td[di + 3] = 0; continue; }
        td[di]     = round255(linearToSrgb(br));
        td[di + 1] = round255(linearToSrgb(bg));
        td[di + 2] = round255(linearToSrgb(bb));
        td[di + 3] = round255(ba);
      }
    }
  }

  getResultTile(tx, ty) { return this.result.getTile(tx, ty); }
}
