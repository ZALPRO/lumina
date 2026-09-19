// utils/memory.js — برآورد و حسابداری حافظه (پادزهر مستقیمِ «بلعیدن رم» فتوشاپ)
// واحدها: byte. هر کاشی ۲۵۶×۲۵۶×۴ = ۲۶۲٬۱۴۴ بایت.

import { TILE_SIZE } from '../engine/tile.js';

export const TILE_BYTES = TILE_SIZE * TILE_SIZE * 4;

export class MemoryEstimate {
  constructor() {
    this.allocatedTiles = 0;
    this.snapshotTiles = 0;
  }

  // تخمین حافظه بر اساس تعداد پیکسل و ابعاد (بدون ساخت بافر)
  static imageBytes(w, h, channels = 4, bytesPerChannel = 1) {
    return w * h * channels * bytesPerChannel;
  }

  // تخمین کاشی‌های لازم برای پوشش یک مستطیل
  static tilesFor(w, h) {
    const tx = Math.ceil(w / TILE_SIZE);
    const ty = Math.ceil(h / TILE_SIZE);
    return tx * ty;
  }

  static layerBytes(w, h) {
    return MemoryEstimate.tilesFor(w, h) * TILE_BYTES;
  }

  totalAllocatedBytes(layers = []) {
    let sum = 0;
    for (const l of layers) {
      if (l.paint) sum += MemoryEstimate.layerBytes(l.paint.w, l.paint.h);
      if (l.mask) sum += MemoryEstimate.layerBytes(l.mask.w, l.mask.h);
    }
    return sum + this.snapshotTiles * TILE_BYTES;
  }

  static fmt(bytes) {
    const KB = 1024, MB = KB * 1024, GB = MB * 1024;
    if (bytes >= GB) return (bytes / GB).toFixed(2) + ' GB';
    if (bytes >= MB) return (bytes / MB).toFixed(1) + ' MB';
    if (bytes >= KB) return (bytes / KB).toFixed(1) + ' KB';
    return bytes + ' B';
  }
}
