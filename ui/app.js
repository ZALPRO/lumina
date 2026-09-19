// ui/app.js — Lumina editor UI (English, modern design-tool layout)
import { Document } from '../src/document/document.js';
import { Paint } from '../src/document/paint.js';
import { Layer } from '../src/document/layer.js';
import { LayeredHistory, TileHistory } from '../src/document/history.js';
import { brushStamp, squareStamp } from '../src/tools/brush.js';
import { floodFill, magicWand, rectSelectionMask } from '../src/tools/floodfill.js';
import { normRect, rectMask, rectMaskInv, fillSelection, clearSelection as clearSelectionPx, cropPaint } from '../src/engine/selection.js';
import { Rect } from '../src/engine/rect.js';
import { linearGradient, radialGradient, applyCurves, exposureAdjust, vibranceAdjust } from '../src/engine/gradient.js';
import { fillRectShape, strokeRectShape, fillEllipse, strokeEllipse, drawLine } from '../src/engine/shape.js';
import { encodePngLikePSD as encodePSDFlat } from '../src/formats/psd.js';
import { encodeJPEG as encodeJPEGFlat } from '../src/formats/jpeg.js';
import { encodeBmp as encodeBmpFlat } from '../src/formats/bmp.js';
import { encodeQoi as encodeQoiFlat } from '../src/formats/qoi.js';
import { cloneStamp, healingStamp } from '../src/tools/clone.js';
import { pencilStamp, dodgeBurnStamp, blurStamp, sharpenStamp, smudgeStamp, magicEraser, snapshotRect } from '../src/tools/paintools.js';
import { polygonMask, lassoMask, ellipseMask } from '../src/engine/lasso.js';
import { frequencySeparate, smoothTones } from '../src/engine/frequency.js';
import { inpaintTelea } from '../src/engine/inpaint.js';
import { chromaKeyRemove } from '../src/engine/chroma.js';
import { renderDropShadow } from '../src/engine/layerstyle.js';
import { decodeImage, encodeImage, formatFromName, detectFormat } from '../src/formats/imageio.js';
import { decodePng, encodePng } from '../src/formats/png.js';
import { invertMap, grayscaleMap, hueSatMap, levelsMap, brightnessContrast, thresholdMap, curvesLUT, curvesMap, exposureMap, vibranceMap } from '../src/engine/adjustments.js';
import { boxBlur, grayscale, invert, sepia, threshold } from '../src/engine/filters.js';
import {
  gaussianBlur, unsharpMask, emboss, sobelEdge, medianFilter, pixelate,
  posterize, celShade, kuwahara, bloom, motionBlur, vignette, thermal,
  vaporwave, rain, grain, colorBalance, gradientMap, kaleidoscope,
} from '../src/engine/fx.js';
import { MemoryEstimate } from '../src/utils/memory.js';
import { defaultTextSpec, clampTextSpec, rasterizeText, measureTextBox, canvasFont } from '../src/text/spec.js';
import { srgbProfile } from '../src/formats/icc.js';
import { encodeLayeredPSD } from '../src/formats/psd-layers.js';
import { decodeLayeredPSD, psdHasLayers } from '../src/formats/psd-read.js';

const $ = (s) => document.querySelector(s);
const canvas = $('#canvas');
const ctx = canvas.getContext('2d', { alpha: true });

const PALETTE = ['#6c8cff','#3ddcc3','#ff6b6b','#ffb454','#ff5ba0','#a86bff','#34c759','#ff9500','#8e8e93','#e5e5ea','#000000','#ffffff'];

// قلاب تست (فقط برای تست‌های خودکار و ابزارها؛ بدون تأثیر روی رفتار برنامه)
const testHooks = {
  get doc() { return state.doc; },
  get exportFormat() { return state.exportFormat; },
  get psdOptions() { return layeredPSDOptions(); },
};
if (typeof window !== 'undefined') window.__lumina = testHooks;

const state = {
  doc: null,
  history: null,
  tool: 'brush',
  color: [108, 140, 255, 255],
  brush: { size: 24, hard: 0.7, flow: 1, alpha: 1, shape: 'round' },
  fillTol: 32,
  fillContig: true,
  zoom: 2,
  panX: 0, panY: 0,
  drawing: false, pointing: false,
  selectedLayer: null,
  canvasImageData: null,
  panning: false, lastPan: null,
  selRectStart: null,
  moveStart: null, moveOrigO: null,
  selection: null,          // Uint8Array ماسک انتخاب فعال
  maskEditing: false,       // نقاشی روی ماسک
  font: 'Inter',
  textStyle: { bold: false, italic: false, underline: false },
  shapeStart: null,         // شروع کشیدن شکل/گرادیان
  gradStyle: 'linear',      // gradient type
  rectFill: 'fill',         // fill | stroke
  strokeW: 2,
  // clone/healing/smudge/burn state
  cloneSource: null,        // { paint, x, y } — محل Alt+Click منبع Clone
  cloneSnap: null,          // Paint اسنپ‌شات منبع (ثابت)
  strokeActive: null,       // { target, offx, offy, lastX, lastY, type, paint }
  lassoPath: null,          // نقاط Lasso آزاد در حال کشیدن
  polyPath: null,           // نقاط Polygonal در حال کشیدن
  retouchStrength: 0.8,
  embedICC: true,           // جاسازی پروفایل sRGB در خروجی (مدیریت رنگ)
  layeredPSD: true,         // خروجی PSD چندلایه (قابل ویرایش در فتوشاپ)
  psdCompression: 'rle',    // فشرده‌سازی کانال‌های لایه: rle | zip | zipPred
  psdColorMode: 'rgb',      // حالت رنگ خروجی PSD: rgb | cmyk
  psdDepth16: false,        // عمق ۱۶ بیت بر کانال
  psdLegacyFX: false,       // نوشتن بلوک قدیمی lrFX هم (سازگاری با فتوشاپ ۵)
  range: 'midtones',
};

/* ================= core ================= */
function createDocument(w, h, bg = 'transparent') {
  const doc = new Document({ width: w, height: h, name: 'Untitled' });
  const hist = new LayeredHistory();
  if (bg === 'white') { fillPaintWith(doc, [255, 255, 255, 255]); }
  const top = new Layer({ name: 'Layer 1', paint: new Paint(w, h) });
  doc.addLayer(top);
  state.doc = doc; state.history = hist; state.selectedLayer = top;
  state.histBaseLabel = 'New Document';
  onDocChanged(); render(); refreshLayerPanel(); fitToScreen(true);
}

function fillPaintWith(doc, c) {
  const p = new Paint(doc.width, doc.height);
  p.clearRect({ x: 0, y: 0, w: doc.width, h: doc.height }, c[0], c[1], c[2], c[3]);
  doc.addLayer(new Layer({ name: 'Background', paint: p }));
}

function render() {
  if (!state.doc) return;
  state.doc.composer.render(state.doc.layers);
  const result = state.doc.composer.result;
  const w = state.doc.width, h = state.doc.height;
  if (!state.canvasImageData || state.canvasImageData.width !== w || state.canvasImageData.height !== h) {
    canvas.width = w; canvas.height = h;
    state.canvasImageData = ctx.createImageData(w, h);
  }
  const img = state.canvasImageData.data;
  for (let ty = 0; ty < result.tilesY; ty++) {
    for (let tx = 0; tx < result.tilesX; tx++) {
      const t = result.getTile(tx, ty);
      if (!t || !t.allocated) continue;
      const px = tx * 256, py = ty * 256;
      const rw = Math.min(256, w - px), rh = Math.min(256, h - py);
      for (let ly = 0; ly < rh; ly++) {
        const src = t.idx(0, ly);
        const dst = ((py + ly) * w + px) * 4;
        img.set(t.data.subarray(src, src + rw * 4), dst);
      }
    }
  }
  ctx.putImageData(state.canvasImageData, 0, 0);
  applyView();
  updateStatusbar();
}

function applyView() {
  const z = state.zoom;
  canvas.style.width = (state.doc.width * z) + 'px';
  canvas.style.height = (state.doc.height * z) + 'px';
  const wrap = $('#canvas-wrap');
  canvas.style.left = ((wrap.clientWidth - state.doc.width * z) / 2 + state.panX) + 'px';
  canvas.style.top = ((wrap.clientHeight - state.doc.height * z) / 2 + state.panY) + 'px';
  $('#sb-zoom').textContent = Math.round(z * 100) + '%';
}

function fitToScreen(initial = false) {
  const wrap = $('#canvas-wrap');
  const zw = (wrap.clientWidth - 120) / state.doc.width;
  const zh = (wrap.clientHeight - 120) / state.doc.height;
  state.zoom = Math.min(Math.max(Math.min(zw, zh), 0.05), initial ? 1 : 32);
  state.panX = 0; state.panY = 0;
  applyView();
}

function onDocChanged() {
  $('#doc-name').textContent = state.doc.name || 'Untitled';
  $('#doc-sub').textContent = `${state.doc.width} × ${state.doc.height} px · RGB ${state.doc.bitDepth}-bit · sRGB`;
  $('#sb-size').textContent = `${state.doc.width} × ${state.doc.height}`;
  $('#layer-count').textContent = String(state.doc.layers.length);
}

function updateStatusbar() {
  const est = state.doc.memoryEstimate();
  $('#mem-value').textContent = MemoryEstimate.fmt(est);
  const tiles = state.doc.layers.reduce((s, l) => s + (l.paint ? l.paint.allocatedTiles() : 0), 0);
  $('#tile-value').textContent = String(tiles);
  $('#hist-value').textContent = state.history ? String(state.history.depth) : '0';
  const nz = $('#nav-zoom'); if (nz) nz.textContent = Math.round(state.zoom * 100) + '%';
  renderHistoryPanel();
  drawNavigator();
}

/* ================= History panel ================= */
const HIST_ICON = {
  'Paint': 'brush', 'Erase': 'eraser', 'Pencil': 'pencil', 'Fill': 'paint-bucket',
  'Wand': 'wand-sparkles', 'Filter': 'sliders-horizontal', 'Text': 'type',
  'Add Layer': 'plus', 'Delete Layer': 'trash-2', 'Duplicate Layer': 'copy',
};
function renderHistoryPanel() {
  const list = $('#history-list');
  if (!list || !state.history) return;
  const h = state.history;
  const base = state.histBaseLabel || 'Open';
  const past = h.undoStack.map((e) => e.label);
  const future = h.redoStack.slice().reverse().map((e) => e.label);
  const all = [base, ...past, ...future];
  const cur = past.length;                       // ایندکس حالت جاری در all
  const sig = all.length + '|' + cur + '|' + all.join('¦');
  if (list.dataset.sig === sig) return;          // بدون تغییر → رندر دوباره نکن
  list.dataset.sig = sig;
  list.innerHTML = '';
  all.forEach((label, i) => {
    const row = document.createElement('button');
    row.className = 'hist-item' + (i === cur ? ' sel' : '') + (i > cur ? ' future' : '');
    const ic = document.createElement('i');
    ic.setAttribute('data-lucide', HIST_ICON[label] || 'dot');
    ic.className = 'hist-ic';
    const sp = document.createElement('span');
    sp.textContent = (i === 0 && label === base ? base : label) || 'ویرایش';
    const num = document.createElement('b');
    num.textContent = String(i);
    num.className = 'hist-num';
    row.appendChild(ic); row.appendChild(sp); row.appendChild(num);
    row.addEventListener('click', () => {
      if (state.history.jumpToDepth(i, base)) {
        state.doc.composer.invalidate(); render(); refreshLayerPanel();
      }
    });
    list.appendChild(row);
  });
  const hc = $('#hist-count'); if (hc) hc.textContent = `${cur}/${all.length - 1}`;
  if (window.lucide && window.lucide.createIcons) window.lucide.createIcons();
}
$('#btn-hist-clear')?.addEventListener('click', () => {
  if (!state.history) return;
  state.history.undoStack.length = 0;
  state.history.redoStack.length = 0;
  refreshLayerPanel(); render();
});

/* ================= Navigator (minimap) ================= */
let _navDragging = false;
function drawNavigator() {
  const cv = $('#navigator');
  if (!cv || !state.doc || !state.doc.composer.result) return;
  const g = cv.getContext('2d');
  const res = state.doc.composer.result;
  const dw = state.doc.width, dh = state.doc.height;
  const cw = cv.width, ch = cv.height;
  g.fillStyle = '#101116'; g.fillRect(0, 0, cw, ch);
  // تصویر سند کوچک‌شده در ناوبر
  const off = document.createElement('canvas');
  off.width = dw; off.height = dh;
  const og = off.getContext('2d');
  const id = og.createImageData(dw, dh);
  const px = new Array(4);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      res.getPixel(x, y, px);
      const i = (y * dw + x) * 4;
      id.data[i] = px[0]; id.data[i + 1] = px[1]; id.data[i + 2] = px[2]; id.data[i + 3] = px[3];
    }
  }
  og.putImageData(id, 0, 0);
  const s = Math.min(cw / dw, ch / dh);
  const iw = dw * s, ih = dh * s;
  const ix = (cw - iw) / 2, iy = (ch - ih) / 2;
  g.drawImage(off, ix, iy, iw, ih);
  g.strokeStyle = '#3a3c46'; g.lineWidth = 1; g.strokeRect(ix - 0.5, iy - 0.5, iw + 1, ih + 1);
  // کادر نمای دید (viewport)
  const rect = canvas.getBoundingClientRect();
  const vx = (-state.panX / state.zoom) * s, vy = (-state.panY / state.zoom) * s;
  const vw = (rect.width / state.zoom) * s, vh = (rect.height / state.zoom) * s;
  g.strokeStyle = '#6c8cff'; g.lineWidth = 2;
  g.strokeRect(ix + vx, iy + vy, vw, vh);
  cv._navScale = s; cv._navOrigin = [ix, iy];
}
$('#navigator')?.addEventListener('pointerdown', (e) => {
  if (!state.doc) return;
  _navDragging = true; navPanTo(e); $('#navigator').setPointerCapture(e.pointerId);
});
$('#navigator')?.addEventListener('pointermove', (e) => { if (_navDragging) navPanTo(e); });
$('#navigator')?.addEventListener('pointerup', (e) => { _navDragging = false; try { $('#navigator').releasePointerCapture(e.pointerId); } catch { /* ignore */ } });
function navPanTo(e) {
  const cv = $('#navigator');
  const r = cv.getBoundingClientRect();
  const s = cv._navScale || 1, [ix, iy] = cv._navOrigin || [0, 0];
  const cdw = (e.clientX - r.left - ix) / s;
  const cdh = (e.clientY - r.top - iy) / s;
  const view = canvas.getBoundingClientRect();
  state.panX = -(cdw * state.zoom) + view.width / 2;
  state.panY = -(cdh * state.zoom) + view.height / 2;
  applyView();
}

function invalidateRect(r) { if (state.doc) state.doc.composer.invalidateRect(r); }

// Space-pan موقت (فتوشاپ-مانند)
let spaceHeld = false;
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !spaceHeld) {
    spaceHeld = true;
    canvas.style.cursor = 'grab';
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spaceHeld = false;
    canvas.style.cursor = state.tool === 'move' ? 'move' : 'crosshair';
  }
});

/* ================= tools ================= */
function screenToCanvas(e) {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left) / state.zoom, (e.clientY - r.top) / state.zoom];
}

canvas.addEventListener('pointerdown', (e) => {
  if (!state.doc) return;
  const [x, y] = screenToCanvas(e);
  if (e.button === 1 || e.button === 2 || e.ctrlKey || spaceHeld) {
    state.panning = true; state.lastPan = [e.clientX, e.clientY];
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    return;
  }
  const l = state.selectedLayer;
  if (!l || !l.paint) return;

  if (state.tool === 'brush' || state.tool === 'eraser' || state.tool === 'pencil' ||
      state.tool === 'dodge' || state.tool === 'burn' || state.tool === 'blur' || state.tool === 'sharpen') {
    state.drawing = true; state.pointing = true;
    canvas.setPointerCapture(e.pointerId);
    // نقاشی روی ماسک اگر حالت ماسک فعال است
    const target = (state.maskEditing && l.mask) ? l.mask : l.paint;
    state.history.record(target, state.tool === 'eraser' ? 'Erase' : (state.tool === 'pencil' ? 'Pencil' : state.tool));
    state.drawingTarget = target;
    paintAt(x, y);
  } else if (state.tool === 'fill') {
    state.history.record(l.paint, 'Fill');
    const rect = floodFill(l.paint, state.doc.width, state.doc.height, x | 0, y | 0, state.fillTol, state.color, false, state.fillContig);
    invalidateRect(rect); render();
  } else if (state.tool === 'picker') {
    const c = pickAt(x | 0, y | 0);
    if (c) setColor(c);
  } else if (state.tool === 'move') {
    // جابه‌جایی لایهٔ انتخابی: شروع درگ
    state.moveStart = [x, y];
    state.moveOrigO = l.offset();
    canvas.setPointerCapture(e.pointerId);
  } else if (state.tool === 'wand') {
    // عصای جادویی: انتخاب ماسک بر اساس ناحیهٔ هم‌رنگ
    const { mask, rect } = magicWand(l.paint, state.doc.width, state.doc.height, x | 0, y | 0, state.fillTol, false);
    if (!l.mask) l.mask = new Paint(l.paint.w, l.paint.h);
    state.history.record(l.mask, 'Wand');
    l.mask.clearRect({ x: 0, y: 0, w: l.mask.w, h: l.mask.h }, 0, 0, 0, 0);
    for (let yy = rect.y; yy < rect.y + rect.h; yy++) for (let xx = rect.x; xx < rect.x + rect.w; xx++) {
      if (mask[yy * state.doc.width + xx] > 0) l.mask.setPixel(xx, yy, 255, 255, 255, 255);
    }
    state.doc.composer.invalidate(); render(); refreshLayerPanel();
  } else if (state.tool === 'rect') {
    // انتخاب مستطیلی
    state.selRectStart = [x, y];
  } else if (state.tool === 'ellipse') {
    // انتخاب بیضوی: شروع مبدأ
    state.selRectStart = [x, y];
  } else if (state.tool === 'lasso') {
    state.lassoPath = [[x | 0, y | 0]];
    state.history && drawPathPreview();
    canvas.setPointerCapture(e.pointerId);
  } else if (state.tool === 'polygonal') {
    if (!state.polyPath) state.polyPath = [];
    state.polyPath.push([x | 0, y | 0]);
    canvas.setPointerCapture(e.pointerId);
  } else if (state.tool === 'gradient') {
    state.shapeStart = [x | 0, y | 0];
    canvas.setPointerCapture(e.pointerId);
  } else if (state.tool === 'rectshape' || state.tool === 'ellipseshape' || state.tool === 'lineshape') {
    state.shapeStart = [x | 0, y | 0];
    canvas.setPointerCapture(e.pointerId);
      } else if (state.tool === 'clone') {
    if (e.altKey) copyCloneSource(x, y);
    else startRetouchStroke('clone', x, y);
  } else if (state.tool === 'healing') {
    if (e.altKey) copyCloneSource(x, y);
    else startRetouchStroke('healing', x, y);
  } else if (state.tool === 'smudge') {
    startRetouchStroke('smudge', x, y);
  } else if (state.tool === 'magiceraser') {
    state.history.record(l.paint, 'Magic Eraser');
    const rect = magicEraser(l.paint, state.doc.width, state.doc.height, x | 0, y | 0, state.fillTol, true);
    invalidateRect(rect); render();
  } else if (state.tool === 'text') {
    addTextLayer(x, y);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!state.doc) return;
  if (state.panning && state.lastPan) {
    state.panX += e.clientX - state.lastPan[0];
    state.panY += e.clientY - state.lastPan[1];
    state.lastPan = [e.clientX, e.clientY];
    applyView(); return;
  }
  if (state.drawing) {
    const [x, y] = screenToCanvas(e);
    paintAt(x, y);
  } else if (state.strokeActive) {
    const [x, y] = screenToCanvas(e);
    const prev = state.strokeActive.lastX !== undefined ? [state.strokeActive.lastX, state.strokeActive.lastY] : [x, y];
    retouchAt(x, y, prev[0], prev[1]);
    state.strokeActive.lastX = x; state.strokeActive.lastY = y;
  } else if (state.moveStart && state.tool === 'move') {
    const [x, y] = screenToCanvas(e);
    const l = state.selectedLayer;
    if (l) {
      l.move(Math.round(state.moveOrigO[0] + (x - state.moveStart[0])), Math.round(state.moveOrigO[1] + (y - state.moveStart[1])));
      state.doc.composer.invalidate(); render();
    }
  } else if (state.tool === 'rect' || state.tool === 'ellipse') {
    if (state.selRectStart) {
      const [x, y] = screenToCanvas(e);
      drawRectSelection(state.selRectStart[0], state.selRectStart[1], x, y);
    }
  } else if (state.tool === 'lasso' && state.lassoPath) {
    const [x, y] = screenToCanvas(e);
    state.lassoPath.push([x | 0, y | 0]);
    drawPathPreview();
  } else if (state.tool === 'polygonal' && state.polyPath) {
    const [x, y] = screenToCanvas(e);
    drawPolyPreview(state.polyPath, [x | 0, y | 0]);
  }
});

window.addEventListener('pointerup', (e) => {
  state.drawingTarget = null;
  if (state.moveStart && state.tool === 'move') state.moveStart = null;
  if (state.strokeActive) {
    state.strokeActive = null;
    render();
  }
  if (state.shapeStart && (state.tool === 'gradient' || state.tool === 'rectshape' || state.tool === 'ellipseshape' || state.tool === 'lineshape')) {
    const [x1, y1] = state.shapeStart;
    const [x2, y2] = screenToCanvas(e);
    commitShapeOrGradient(x1, y1, x2 | 0, y2 | 0);
    state.shapeStart = null;
  }
  if (state.tool === 'lasso' && state.lassoPath) {
    const [x2, y2] = screenToCanvas(e);
    if (state.lassoPath.length > 2) {
      state.selection = lassoMask(state.doc.width, state.doc.height, state.lassoPath.concat([[x2 | 0, y2 | 0]])).mask;
      state.selRectObj = maskBounds(state.selection, state.doc.width, state.doc.height);
    }
    state.lassoPath = null;
    renderSelection();
  }
  if (state.tool === 'ellipse' && state.selRectStart) {
    const [x1, y1] = state.selRectStart;
    const [x2, y2] = screenToCanvas(e);
    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
    const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
    if (rx > 1 && ry > 1) {
      state.selection = ellipseMask(state.doc.width, state.doc.height, cx, cy, rx, ry).mask;
      state.selRectObj = maskBounds(state.selection, state.doc.width, state.doc.height);
    }
    state.selRectStart = null;
    renderSelection();
  }
  if (state.selRectStart && state.tool === 'rect') {
    // ساخت انتخاب مستطیلی ماندگار
    const [x1, y1] = state.selRectStart;
    const [x2, y2] = screenToCanvas(e);
    const rect = normRect(x1 | 0, y1 | 0, x2 | 0, y2 | 0);
    if (rect.w > 1 && rect.h > 1) {
      state.selection = rectMask(state.doc.width, state.doc.height, rect);
      state.selRectObj = rect;
    }
    state.selRectStart = null;
    renderSelection();
  }
  state.drawing = false; state.pointing = false; state.panning = false;
});

function paintAt(x, y) {
  const l = state.selectedLayer;
  if (!l || !l.paint) return;
  const paint = state.drawingTarget || l.paint;
  const shape = state.brush.shape || 'round';
  const stampFn = shape === 'square' ? squareStamp : brushStamp;
  const r = state.brush.size / 2;
  if (state.tool === 'eraser') {
    if (shape === 'square') {
      // پاک‌کن مربعی: پوشش مربع را از آلفا کم کن
      eraseAt(paint, x, y, state.brush.size / 2, state.brush.hard, true);
    } else {
      eraseAt(paint, x, y, state.brush.size / 2, state.brush.hard);
    }
  } else if (state.tool === 'pencil') {
    pencilStamp(paint, x, y, r, state.color, state.brush.flow * state.brush.alpha);
  } else if (state.tool === 'dodge' || state.tool === 'burn') {
    const exposure = state.tool === 'dodge' ? Math.max(0.05, state.retouchStrength || state.brush.flow) : -Math.max(0.05, state.retouchStrength || state.brush.flow);
    dodgeBurnStamp(paint, x, y, r, state.brush.hard, exposure, state.range || 'midtones');
  } else if (state.tool === 'blur') {
    blurStamp(paint, state.doc.width, state.doc.height, x, y, r, state.brush.hard, Math.round((state.retouchStrength || 1) * 3));
  } else if (state.tool === 'sharpen') {
    sharpenStamp(paint, state.doc.width, state.doc.height, x, y, r, state.brush.hard, 0.3 + (state.retouchStrength || 0.5) * 0.7);
  } else {
    stampFn(paint, x, y, r, state.brush.hard,
      state.color, state.brush.flow * state.brush.alpha);
  }
  invalidateRect({ x: x - state.brush.size, y: y - state.brush.size, w: state.brush.size * 2, h: state.brush.size * 2 });
  render();
}

// انتخاب منبع Clone/Healing با Alt+Click
function copyCloneSource(x, y) {
  const l = state.selectedLayer;
  if (!l || !l.paint) return;
  state.cloneSource = { x: x | 0, y: y | 0 };
  state.cloneSnap = l.paint.clone();
}

// آغاز stroke برای clone/healing/smudge (اسنپ‌شات + target)
function startRetouchStroke(type, x, y) {
  const l = state.selectedLayer;
  if (!l || !l.paint) return;
  const p = l.paint;
  if ((type === 'clone' || type === 'healing') && !state.cloneSnap) copyCloneSource(x, y);
  const offx = state.cloneSource ? (state.cloneSource.x - (x | 0)) : 0;
  const offy = state.cloneSource ? (state.cloneSource.y - (y | 0)) : 0;
  state.strokeActive = { type, paint: p, offx, offy, lastX: x, lastY: y };
  state.history.record(p, type === 'clone' ? 'Clone Stamp' : type === 'healing' ? 'Healing Brush' : 'Smudge');
}

// stroke پردازش‌گر حرکت برای clone/healing/smudge
function retouchAt(x, y, prevX, prevY) {
  const act = state.strokeActive;
  if (!act) return;
  const p = act.paint;
  const r = state.brush.size / 2;
  const src = state.cloneSnap || p;
  if (act.type === 'clone') {
    cloneStamp(src, p, x, y, r, state.brush.hard, act.offx, act.offy, state.brush.flow);
  } else if (act.type === 'healing') {
    healingStamp(src, p, x, y, r, state.brush.hard, act.offx, act.offy, state.brush.flow);
  } else if (act.type === 'smudge') {
    const ddx = x - (prevX ?? x), ddy = y - (prevY ?? y);
    if (Math.hypot(ddx, ddy) < 0.5) return;
    const { snap, ox, oy } = snapshotRect(p, x, y, r + 2);
    const len = Math.max(1, Math.hypot(ddx, ddy));
    smudgeStamp(snap, p, x - ox, y - oy, r, state.brush.hard, ddx / len, ddy / len, 0.6 * state.brush.flow);
  }
  invalidateRect({ x: x - state.brush.size, y: y - state.brush.size, w: state.brush.size * 2, h: state.brush.size * 3 });
  render();
}

function eraseAt(paint, cx, cy, radius, hard, square = false) {
  const r = Math.max(1, radius);
  const x0 = Math.floor(cx - r - 1), x1 = Math.ceil(cx + r + 1);
  const y0 = Math.floor(cy - r - 1), y1 = Math.ceil(cy + r + 1);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const d = square ? (Math.max(Math.abs(x - cx), Math.abs(y - cy)) / r) : (Math.hypot(x - cx, y - cy) / r);
    if (d > 1) continue;
    const cov = hard >= 1 ? 1 : Math.pow(1 - d, 1.6);
    const c = [0, 0, 0, 0];
    paint.getPixel(x, y, c);
    if (c[3] > 0) paint.setPixel(x, y, c[0], c[1], c[2], Math.max(0, c[3] - Math.round(cov * 255)));
  }
}

function pickAt(x, y) {
  if (!state.doc) return null;
  const flat = state.doc.composer.result;
  const c = [0, 0, 0, 0];
  flat.getPixel(x, y, c);
  return c[3] === 0 ? null : [c[0], c[1], c[2], 255];
}

function commitShapeOrGradient(x1, y1, x2, y2) {
  const l = state.selectedLayer;
  if (!l || !l.paint) return;
  const p = l.paint;
  state.history.record(p, 'Shape/Gradient');
  const col = state.color;
  // گرادیان پیش‌فرض: رنگ جاری → شفاف
  const gradStops = state.gradStyle === 'radial'
    ? [[0, col], [1, [col[0], col[1], col[2], 0]]]
    : [[0, [255, 255, 255, 255]], [1, col]];

  switch (state.tool) {
    case 'gradient':
      if (state.gradStyle === 'radial') {
        const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
        const r = Math.max(1, Math.hypot(x2 - x1, y2 - y1) / 2);
        radialGradient(p, state.doc.width, state.doc.height, cx, cy, r, gradStops);
      } else {
        linearGradient(p, state.doc.width, state.doc.height, x1, y1, x2, y2, gradStops);
      }
      break;
    case 'rectshape':
      // با shift مربع
      if (state.rectFill !== 'stroke') fillRectShape(p, x1, y1, x2, y2, col);
      else strokeRectShape(p, x1, y1, x2, y2, col, state.strokeW || 2);
      break;
    case 'ellipseshape': {
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2, ry = Math.abs(y2 - y1) / 2;
      if (state.rectFill !== 'stroke') fillEllipse(p, cx, cy, rx, ry, col);
      else strokeEllipse(p, cx, cy, rx, ry, col, state.strokeW || 2);
      break;
    }
    case 'lineshape':
      drawLine(p, x1, y1, x2, y2, col, state.strokeW || 2);
      break;
  }
  state.doc.composer.invalidate();
  render(); refreshLayerPanel();
}

/* ================= selection rendering + operations ================= */
function renderSelection() {
  // نمای ماسک انتخابی روی بوم (marching ants)
  render();
  if (!state.selection) return;
  const z = state.zoom;
  const w = state.doc.width, h = state.doc.height;
  ctx.save();
  ctx.lineWidth = 1 / z;
  ctx.setLineDash([5 / z, 4 / z]);
  ctx.lineDashOffset = (Date.now() % 900) / 900 * (9 / z);
  // اگر ماسک کادر مستطیلی ساده دارد از rect استفاده می‌کنیم، وگرنه مرز پیکسلی می‌کشیم
  const useRect = state.selRectObj && isRectangularSelection();
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  if (useRect) {
    const r = state.selRectObj;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeRect(r.x, r.y, r.w, r.h);
  } else {
    paintMaskOutline();
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.lineDashOffset += (3 / z);
    paintMaskOutline();
  }
  ctx.restore();
}

// آیا ماسک فعلی دقیقاً یک مستطیل توپُر است؟
function isRectangularSelection() {
  const m = state.selection, w = state.doc.width, h = state.doc.height;
  const b = state.selRectObj;
  if (!b || b.w <= 0 || b.h <= 0) return false;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const inside = x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
    if ((m[y * w + x] ? 1 : 0) !== (inside ? 1 : 0)) return false;
  }
  return true;
}

// رسم مرز ماسک آزاد (پیکسل‌های مرزی)
function paintMaskOutline() {
  const m = state.selection, w = state.doc.width, h = state.doc.height;
  const z = state.zoom;
  ctx.beginPath();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!m[y * w + x]) continue;
    const edge = x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
      !m[y * w + x - 1] || !m[y * w + x + 1] || !m[(y - 1) * w + x] || !m[(y + 1) * w + x];
    if (edge) { ctx.moveTo(x + 0.5 / z, y + 0.5 / z); ctx.lineTo(x + 0.5 / z + 1, y + 0.5 / z); }
  }
  ctx.stroke();
}

function clearSelection() {
  state.selection = null;
  state.selRectObj = null;
  render();
}

function deleteSelection() {
  if (!state.selection || !state.selectedLayer || !state.selectedLayer.paint) return;
  state.history.record(state.selectedLayer.paint, 'Delete');
  clearSelectionPx(state.selectedLayer.paint, state.doc.width, state.doc.height, state.selection);
  state.doc.composer.invalidate(); render();
  clearSelection();
}

function fillSelectionActive() {
  if (!state.selection || !state.selectedLayer || !state.selectedLayer.paint) return;
  state.history.record(state.selectedLayer.paint, 'Fill Selection');
  fillSelection(state.selectedLayer.paint, state.doc.width, state.doc.height, state.selection, state.color);
  state.doc.composer.invalidate(); render();
}

function invertSelection() {
  if (!state.selection) return;
  if (isRectangularSelection()) {
    state.selection = rectMaskInv(state.doc.width, state.doc.height, state.selRectObj);
  } else {
    const m = state.selection;
    for (let i = 0; i < m.length; i++) m[i] = m[i] ? 0 : 1;
    state.selRectObj = maskBounds(m, state.doc.width, state.doc.height);
  }
  renderSelection();
}

function selectAll() {
  state.selection = rectMask(state.doc.width, state.doc.height, { x: 0, y: 0, w: state.doc.width, h: state.doc.height });
  state.selRectObj = new Rect(0, 0, state.doc.width, state.doc.height);
  renderSelection();
}

function cropToSelection() {
  if (!state.selRectObj || !state.selectedLayer || !state.selectedLayer.paint) return;
  const r = state.selRectObj;
  const newW = r.w, newH = r.h;
  for (const l of state.doc.layers) {
    if (!l.paint) continue;
    l.paint = cropPaint(l.paint, state.doc.width, state.doc.height, r);
  }
  state.doc.width = newW;
  state.doc.height = newH;
  // ساخت کامپوزیتور جدید با ابعاد تازه
  const ComposerCtor = state.doc.composer.constructor;
  state.doc.composer = new ComposerCtor(newW, newH);
  state.selection = null;
  state.selRectObj = null;
  onDocChanged(); fitToScreen(true); render();
}

// کادر محیطی یک ماسک (برای رسم marchند-ants انتخابات آزاد)
function maskBounds(mask, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (mask[y * w + x]) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return new Rect(0, 0, 0, 0);
  return new Rect(minX, minY, maxX - minX + 1, maxY - minY + 1);
}

// پیش‌نمایش Lasso آزاد در حین کشیدن
function drawPathPreview() {
  requestAnimationFrame(() => {
    render();
    if (!state.lassoPath || state.lassoPath.length < 1) return;
    const z = state.zoom;
    ctx.save();
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([5 / z, 4 / z]);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(state.lassoPath[0][0], state.lassoPath[0][1]);
    for (let i = 1; i < state.lassoPath.length; i++) ctx.lineTo(state.lassoPath[i][0], state.lassoPath[i][1]);
    ctx.stroke();
    ctx.restore();
  });
}

// پیش‌نمایش Polygonal Lasso
function drawPolyPreview(pts, cursor) {
  requestAnimationFrame(() => {
    render();
    const z = state.zoom;
    ctx.save();
    ctx.lineWidth = 1 / z;
    ctx.setLineDash([5 / z, 4 / z]);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.lineTo(cursor[0], cursor[1]);
    ctx.stroke();
    ctx.restore();
  });
}

// پایان Polygonal Lasso و commit (double-click یا Enter)
function commitPolygonal() {
  if (!state.polyPath || state.polyPath.length < 3) { state.polyPath = null; render(); return; }
  const mask = polygonMask(state.doc.width, state.doc.height, state.polyPath).mask;
  state.selection = mask;
  state.selRectObj = maskBounds(mask, state.doc.width, state.doc.height);
  state.polyPath = null;
  renderSelection();
}

/* ================= rect selection (marching-ants live preview) ================= */
function drawRectSelection(x1, y1, x2, y2) {
  const z = state.zoom;
  const x0 = Math.min(x1, x2), y0 = Math.min(y1, y2);
  const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
  requestAnimationFrame(() => {
    render();
    if (w < 1 || h < 1) return;
    ctx.save();
    ctx.lineWidth = 1 / z;
    ctx.strokeStyle = '#ffffff';
    ctx.setLineDash([5 / z, 4 / z]);
    ctx.strokeRect(x0, y0, w, h);
    ctx.setLineDash([5 / z, 4 / z]);
    ctx.lineDashOffset = (Date.now() % 900) / 900 * (9 / z);
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeRect(x0, y0, w, h);
    ctx.restore();
  });
}

/* ================= text tool (لایهٔ متنیِ قابل ویرایش) ================= */
// متن «زنده» است: مشخصات روی لایه می‌ماند و هر تغییر دوباره رستر می‌شود.
// پس کاربر می‌تواند بعداً محتوا/فونت/سایز/رنگ را عوض کند (مثل Text Layer فتوشاپ).
function currentTextSpec(over = {}) {
  return defaultTextSpec({
    font: state.font || 'Vazirmatn',
    size: +($('#text-size').value || 64),
    bold: state.textStyle.bold,
    italic: state.textStyle.italic,
    underline: state.textStyle.underline,
    color: rgbHex(state.color),
    ...over,
  });
}

function addTextLayer(x, y) {
  const t = window.prompt('Text to add:', '');
  if (t === null || t === '') return;
  state.history.recordDoc(state.doc, 'Add Text Layer');
  const spec = clampTextSpec(currentTextSpec({ content: t, x: x | 0, y: y | 0 }), state.doc);
  const tl = new Layer({ name: `T: ${t.slice(0, 20)}`, text: spec });
  tl.move(spec.x, spec.y);
  rasterizeTextLayer(tl);
  state.doc.addLayer(tl);
  state.selectedLayer = tl;
  state.doc.composer.invalidate(); render(); refreshLayerPanel(); syncTextPanel(tl);
}

// رستر مجدد از روی مشخصات → paint لایه
function rasterizeTextLayer(l, maxWidth = 0) {
  if (!l || !l.text) return;
  const { imageData, width, height } = rasterizeText(l.text, maxWidth);
  const p = new Paint(width, height);
  p.writeFromRGBA(imageData.data, width, height);
  l.paint = p;
  l.move(Math.round(l.text.x), Math.round(l.text.y));
  return p;
}

// ویرایش مشخصات متن (با ثبت undo)
function updateTextLayer(l, patch, label = 'Edit Text') {
  if (!l || !l.text) return;
  state.history.recordDoc(state.doc, label);
  l.text = clampTextSpec({ ...l.text, ...patch }, state.doc);
  if (patch.content !== undefined || patch.font !== undefined || patch.bold !== undefined || patch.italic !== undefined) {
    l.name = `T: ${String(l.text.content).slice(0, 20)}`;
  }
  rasterizeTextLayer(l);
  state.doc.composer.invalidate(); render(); refreshLayerPanel(); syncTextPanel(l);
}

function selectedTextLayer() {
  const l = state.selectedLayer;
  return l && l.text ? l : null;
}

// پرکردن پنل متن از مشخصات لایه
function syncTextPanel(l) {
  const t = l && l.text ? l.text : null;
  const grp = $('#ctx-text');
  if (!grp) return;
  const edit = $('#text-edit');
  if (edit) edit.value = t ? t.content : '';
  if (t) {
    const fs = $('#font-name'); if (fs) fs.value = t.font;
    const sz = $('#text-size'); if (sz) { sz.value = t.size; $('#text-size-v').textContent = t.size; }
    const st = $('#text-stroke-w'); if (st) { st.value = t.strokeWidth; $('#text-stroke-w-v').textContent = t.strokeWidth; }
    const sc = $('#text-stroke-color'); if (sc) sc.value = t.strokeColor;
    const tl = $('#text-line-height'); if (tl) { tl.value = t.lineHeight; $('#text-line-height-v').textContent = t.lineHeight; }
    const ls = $('#text-letter-spacing'); if (ls) { ls.value = t.letterSpacing; $('#text-letter-spacing-v').textContent = t.letterSpacing; }
    document.querySelectorAll('#text-align button').forEach((b) => b.classList.toggle('on', b.dataset.align === t.align));
    const sh = $('#text-shadow'); if (sh) sh.classList.toggle('on', !!t.shadow);
    ['bold', 'italic', 'underline'].forEach((k) => {
      const btn = $('#t-' + k); if (btn) btn.classList.toggle('on', !!t[k]);
    });
  }
  grp.classList.toggle('has-text-layer', !!t);
}

/* ================= adjustment layers (non-destructive) ================= */
function addAdjustmentLayer(kind) {
  if (!state.doc) return;
  let a;
  const n = (kind) => state.doc.layers.reduce((s, l) => s + (l.isAdjustment && l.adjustment.type === kind ? 1 : 0), 0) + 1;
  switch (kind) {
    case 'invert': a = { type: 'invert', label: 'Invert', apply: invertMap() }; break;
    case 'grayscale': a = { type: 'grayscale', label: 'Grayscale', apply: grayscaleMap() }; break;
    case 'hue-sat': a = { type: 'hue-sat', label: 'Hue/Saturation', hue: 0, sat: 0, light: 0, apply: hueSatMap({ hue: 0, sat: 0, light: 0 }) }; break;
    case 'levels': a = { type: 'levels', label: 'Levels', shadows: 0, highlights: 255, gamma: 1, apply: levelsMap(0, 255, 1) }; break;
    case 'brightness-contrast': a = { type: 'brightness-contrast', label: 'Brightness/Contrast', brightness: 0, contrast: 0, apply: brightnessContrast(0, 0) }; break;
    case 'threshold': a = { type: 'threshold', label: 'Threshold', t: 128, apply: thresholdMap(128) }; break;
    case 'curves': {
      // S-curve پیش‌فرض: سه نقطهٔ کنترل
      const pt = [[0, 40], [128, 140], [255, 215]];
      const lutR = curvesLUT(pt), lutG = curvesLUT(pt), lutB = curvesLUT(pt);
      a = { type: 'curves', label: 'Curves', points: pt, lutR, lutG, lutB, apply: curvesMap(lutR, lutG, lutB) };
      break;
    }
    case 'exposure': a = { type: 'exposure', label: 'Exposure', ev: 0.5, apply: exposureMap(0.5) }; break;
    case 'vibrance': a = { type: 'vibrance', label: 'Vibrance', amount: 0.4, apply: vibranceMap(0.4) }; break;
  }
  const l = new Layer({ name: `${a.label} ${a.type !== 'invert' && a.type !== 'grayscale' ? n(a.type) : ''}`.trim(), adjustment: { ...a } });
  state.doc.addLayer(l);
  state.selectedLayer = l;
  state.doc.composer.invalidate(); render(); refreshLayerPanel();
}

// بازسازی apply بر اساس پارامترهای ذخیره‌شده (وقتی کاربر پارامترها را ویرایش می‌کند)
function refreshAdjustmentApply(l) {
  const a = l.adjustment;
  switch (a.type) {
    case 'hue-sat': a.apply = hueSatMap({ hue: a.hue, sat: a.sat, light: a.light }); break;
    case 'levels': a.apply = levelsMap(a.shadows, a.highlights, a.gamma); break;
    case 'brightness-contrast': a.apply = brightnessContrast(a.brightness, a.contrast); break;
    case 'threshold': a.apply = thresholdMap(a.t); break;
    case 'invert': a.apply = invertMap(); break;
    case 'grayscale': a.apply = grayscaleMap(); break;
    case 'curves': {
      a.lutR = curvesLUT(a.points); a.lutG = curvesLUT(a.points); a.lutB = curvesLUT(a.points);
      a.apply = curvesMap(a.lutR, a.lutG, a.lutB);
      break;
    }
    case 'exposure': a.apply = exposureMap(a.ev); break;
    case 'vibrance': a.apply = vibranceMap(a.amount); break;
  }
}

/* ================= layer panel ================= */
const EYE_OPEN = '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/>';
const EYE_OFF = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>';

function refreshLayerPanel() {
  const list = $('#layers-list');
  list.innerHTML = '';
  const layers = state.doc.layers;
  let depth = 0;
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.isGroupEnd) { depth++; continue; } // وارد اعضای گروه می‌شویم
    const item = document.createElement('div');
    item.className = 'layer-item' + (l === state.selectedLayer ? ' sel' : '') + (l.isAdjustment ? ' adj' : '') + (l.isGroup ? ' group' : '');
    const indent = l.isGroup ? Math.max(0, depth - 1) : depth;
    if (indent > 0) item.style.marginLeft = (indent * 14) + 'px';
    if (l.isGroup) depth = Math.max(0, depth - 1);

    const eye = document.createElement('button');
    eye.className = 'layer-eyeball' + (l.visible ? '' : ' off');
    eye.innerHTML = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (l.visible ? EYE_OPEN : EYE_OFF) + '</svg>';
    eye.addEventListener('click', (ev) => {
      ev.stopPropagation();
      state.history.recordDoc(state.doc, l.visible ? 'Hide Layer' : 'Show Layer');
      l.visible = !l.visible;
      state.doc.composer.invalidate(); render(); refreshLayerPanel();
    });

    const thumb = document.createElement('canvas');
    thumb.className = 'layer-thumb'; thumb.width = 28; thumb.height = 28;
    drawThumb(thumb, l);

    const mid = document.createElement('div');
    mid.style.flex = '1'; mid.style.minWidth = '0';
    const name = document.createElement('div');
    name.className = 'layer-name'; name.textContent = l.name;
    const blend = document.createElement('div');
    blend.className = 'layer-blend';
    const tags = [];
    if (l.blendMode !== 'normal') tags.push(l.blendMode);
    if (l.opacity < 1) tags.push(Math.round(l.opacity * 100) + '%');
    if (l.clipToBelow) tags.push('clipped');
    if (l.style && l.style.dropShadow) tags.push('fx');
    if (l.vectorMask) tags.push('vmask');
    blend.textContent = tags.join(' · ');
    mid.appendChild(name); mid.appendChild(blend);
    if (l.isAdjustment) {
      const tag = document.createElement('span');
      tag.className = 'layer-tag'; tag.textContent = 'ADJ';
      mid.appendChild(tag);
    }
    if (l.isText) {
      const tag = document.createElement('span');
      tag.className = 'layer-tag'; tag.textContent = 'T';
      mid.appendChild(tag);
    }

    item.appendChild(eye); item.appendChild(thumb); item.appendChild(mid);
    item.addEventListener('click', () => {
      state.selectedLayer = l;
      // vtune opacity/blend به لایهٔ انتخابی
      $('#layer-opacity').value = Math.round(l.opacity * 100);
      $('#layer-blend').value = l.blendMode;
      refreshLayerPanel();
      syncTextPanel(l);
    });
    // دابل‌کلیک روی لایهٔ متنی → پرش به ویرایش متن (مثل فتوشاپ)
    if (l.isText) {
      item.addEventListener('dblclick', (ev) => {
        ev.stopPropagation();
        state.selectedLayer = l;
        setTool('text');
        syncTextPanel(l);
        const ed = $('#text-edit');
        if (ed) { ed.focus(); ed.select(); }
      });
    }
    list.appendChild(item);

    // جعبهٔ تنظیمات پارامتری (فقط برای لایهٔ تنظیم انتخابی)
    if (l === state.selectedLayer && l.isAdjustment) buildAdjustmentControls(l, item);
  }
  syncTextPanel(state.selectedLayer);
}

function drawThumb(c, l) {
  const g = c.getContext('2d');
  const frame = g.createImageData(28, 28);
  const w = state.doc.width, h = state.doc.height;
  if (l.isGroup) {
    for (let i = 0; i < 28 * 28; i++) {
      frame.data[i * 4] = 90; frame.data[i * 4 + 1] = 95; frame.data[i * 4 + 2] = 110; frame.data[i * 4 + 3] = 255;
    }
    g.putImageData(frame, 0, 0);
    g.fillStyle = '#ffffff';
    g.font = 'bold 13px Inter, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('■', 14, 14);
    return;
  }
  if (l.isAdjustment) {
    // نشانگر لایهٔ تنظیم: پس‌زمینهٔ ساده + نماد فلش نزولی در وسط
    for (let i = 0; i < 28 * 28; i++) {
      frame.data[i * 4] = 96; frame.data[i * 4 + 1] = 106; frame.data[i * 4 + 2] = 128; frame.data[i * 4 + 3] = 255;
    }
    g.putImageData(frame, 0, 0);
    g.fillStyle = '#ffffff';
    g.font = 'bold 14px Inter, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('▽', 14, 14);
    return;
  }
  if (!l.paint) return;
  for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) {
    const sx = Math.floor(x * w / 28), sy = Math.floor(y * h / 28);
    const p = [0, 0, 0, 0];
    l.paint.getPixel(sx, sy, p);
    const i = (y * 28 + x) * 4;
    frame.data[i] = p[0]; frame.data[i + 1] = p[1]; frame.data[i + 2] = p[2]; frame.data[i + 3] = p[3];
  }
  g.putImageData(frame, 0, 0);
}

// کنترل‌های پارامتری لایهٔ تنظیم (غیرمخرب)
function buildAdjustmentControls(l, item) {
  const a = l.adjustment;
  const box = document.createElement('div');
  box.className = 'adj-controls';
  const upd = () => { refreshAdjustmentApply(l); state.doc.composer.invalidate(); render(); refreshLayerPanel(); };
  const bind = (min, max, step, label, get, set) => {
    const r = document.createElement('div'); r.className = 'adj-row';
    const lb = document.createElement('span'); lb.textContent = label;
    const input = document.createElement('input'); input.type = 'range';
    input.min = min; input.max = max; input.step = step; input.value = get();
    const v = document.createElement('span'); v.className = 'field-val'; v.textContent = get();
    input.addEventListener('input', () => { v.textContent = input.value; });
    input.addEventListener('change', () => { set(+input.value); upd(); });
    r.appendChild(lb); r.appendChild(input); r.appendChild(v);
    box.appendChild(r);
  };
  switch (a.type) {
    case 'hue-sat':
      bind(-180, 180, 1, 'Hue', () => a.hue, (v2) => { a.hue = v2; });
      bind(-100, 100, 1, 'Saturation', () => a.sat, (v2) => { a.sat = v2; });
      bind(-100, 100, 1, 'Lightness', () => a.light, (v2) => { a.light = v2; });
      break;
    case 'levels':
      bind(0, 255, 1, 'Shadows', () => a.shadows, (v2) => { a.shadows = v2; });
      bind(0, 255, 1, 'Highlights', () => a.highlights, (v2) => { a.highlights = v2; });
      bind(0.1, 10, 0.1, 'Gamma', () => a.gamma, (v2) => { a.gamma = v2; });
      break;
    case 'brightness-contrast':
      bind(-100, 100, 1, 'Brightness', () => a.brightness, (v2) => { a.brightness = v2; });
      bind(-100, 100, 1, 'Contrast', () => a.contrast, (v2) => { a.contrast = v2; });
      break;
    case 'threshold':
      bind(0, 255, 1, 'Threshold', () => a.t, (v2) => { a.t = v2; });
      break;
    case 'exposure':
      bind(-3, 3, 0.1, 'EV', () => a.ev, (v2) => { a.ev = v2; });
      break;
    case 'vibrance':
      bind(-1, 1, 0.05, 'Amount', () => a.amount, (v2) => { a.amount = v2; });
      break;
    case 'curves': {
      // نقطهٔ میانی (کانتراست S-curve): فقط نقطهٔ 128 را اسلایدر می‌کنیم
      bind(0, 255, 1, 'Midpoint', () => (a.points && a.points[1] && a.points[1][1]) || 128, (v2) => {
        const p = a.points && a.points.length ? a.points : [[0, 0], [128, 128], [255, 255]];
        p[1] = [128, v2];
        a.points = p;
      });
      break;
    }
  }
  item.appendChild(box);
}

/* ================= color ================= */
function setColor(c) {
  state.color = c;
  $('#swatch-fg').style.background = rgbHex(c);
  $('#hex-input').value = rgbHex(c).replace('#', '');
  // همگام‌سازی اسلایدرهای HSL/آلفا
  const [h, s, l] = rgbToHsl(c[0], c[1], c[2]);
  $('#hue-slider').value = Math.round(h); $('#hue-v').textContent = Math.round(h) + '°';
  $('#sat-range').value = Math.round(s * 100); $('#sat-v').textContent = Math.round(s * 100) + '%';
  $('#light-range').value = Math.round(l * 100); $('#light-v').textContent = Math.round(l * 100) + '%';
  $('#alpha-range').value = Math.round(c[3] / 255 * 100); $('#alpha-v').textContent = Math.round(c[3] / 255 * 100) + '%';
}
function rgbHex(c) { return '#' + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, '0')).join(''); }
function hexRgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255]; }
function rgbToHsl(r0, g0, b0) {
  const r = r0 / 255, g = g0 / 255, b = b0 / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h;
  if (mx === r) h = ((g - b) / d) + (g < b ? 6 : 0);
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h /= 6;
  return [h * 360, s, l];
}
function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

function buildSwatches() {
  const grid = $('#color-swatches');
  grid.innerHTML = '';
  PALETTE.forEach((hex) => {
    const b = document.createElement('div');
    b.className = 'csw'; b.style.background = hex;
    b.addEventListener('click', () => setColor(hexRgb(hex)));
    grid.appendChild(b);
  });
}

/* ================= toolbar / contextbar wiring ================= */
const TOOLS = ['move', 'brush', 'pencil', 'eraser', 'clone', 'healing', 'blur', 'sharpen', 'smudge', 'dodge', 'burn', 'magiceraser', 'gradient', 'fill', 'picker', 'wand', 'rect', 'ellipse', 'lasso', 'polygonal', 'rectshape', 'ellipseshape', 'lineshape', 'text'];
function setTool(t) {
  state.tool = t;
  document.querySelectorAll('.rail-btn[data-tool]').forEach((b) => {
    const on = b.dataset.tool === t;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));   // دسترس‌پذیری: وضعیت برای screen-reader
  });
  ['brush', 'fill', 'text', 'gradient', 'retouch', 'default'].forEach((id) => $('#ctx-' + id).classList.add('is-hidden'));
  const map = {
    brush: 'brush', pencil: 'brush', eraser: 'brush', blur: 'brush', sharpen: 'brush', smudge: 'brush',
    clone: 'retouch', healing: 'retouch',
    dodge: 'retouch', burn: 'retouch',
    fill: 'fill', wand: 'fill', magiceraser: 'fill',
    gradient: 'gradient', text: 'text',
    move: 'default', picker: 'default', rect: 'default', ellipse: 'default', lasso: 'default', polygonal: 'default',
    rectshape: 'default', ellipseshape: 'default', lineshape: 'default',
  };
  const show = map[t] || 'default';
  $('#ctx-' + show).classList.remove('is-hidden');
  const hints = {
    move: 'Move tool', brush: 'Brush — press B', pencil: 'Pencil — hard edge', eraser: 'Eraser — press E',
    clone: 'Clone Stamp (S) — Alt+Click to set source', healing: 'Healing Brush (J) — Alt+Click to set source',
    blur: 'Blur tool', sharpen: 'Sharpen tool', smudge: 'Smudge tool', dodge: 'Dodge (O) — lighten', burn: 'Burn (O) — darken',
    magiceraser: 'Magic Eraser — click to remove same-color area',
    gradient: 'Gradient — press G', fill: 'Fill — press F', picker: 'Eyedropper — press I',
    wand: 'Magic Wand — press W', text: 'Text — press T', rect: 'Rect Select — press M',
    ellipse: 'Ellipse Select', lasso: 'Lasso (L) — drag freehand', polygonal: 'Polygonal Lasso — click, double-click to close',
    rectshape: 'Rectangle (U)', ellipseshape: 'Ellipse (U)', lineshape: 'Line (L)',
  };
  $('#sb-tool-hint').textContent = hints[t] || '';
  // retouch context: range برای dodge/burn
  const rangeEl = $('#range-label');
  if (rangeEl) rangeEl.textContent = t === 'dodge' || t === 'burn' ? 'Range' : 'Strength';
}

document.querySelectorAll('.rail-btn[data-tool]').forEach((b) => {
  b.addEventListener('click', () => setTool(b.dataset.tool));
});
setTool('brush');

// brush shape
$('#brush-round').addEventListener('click', () => { state.brush.shape = 'round'; $('#brush-round').classList.add('active'); $('#brush-square').classList.remove('active'); });
$('#brush-square').addEventListener('click', () => { state.brush.shape = 'square'; $('#brush-square').classList.add('active'); $('#brush-round').classList.remove('active'); });

// gradient + shape options
$('#grad-linear').addEventListener('click', () => { state.gradStyle = 'linear'; $('#grad-linear').classList.add('active'); $('#grad-radial').classList.remove('active'); });
$('#grad-radial').addEventListener('click', () => { state.gradStyle = 'radial'; $('#grad-radial').classList.add('active'); $('#grad-linear').classList.remove('active'); });
$('#shape-fill').addEventListener('click', () => { state.rectFill = 'fill'; $('#shape-fill').classList.add('active'); $('#shape-stroke').classList.remove('active'); });
$('#shape-stroke').addEventListener('click', () => { state.rectFill = 'stroke'; $('#shape-stroke').classList.add('active'); $('#shape-fill').classList.remove('active'); });
$('#stroke-w').addEventListener('input', (e) => { state.strokeW = +e.target.value; $('#stroke-w-v').textContent = e.target.value; });
// retouch strength + dodge/burn range
$('#retouch-range').addEventListener('input', (e) => { state.retouchStrength = +e.target.value / 100; $('#retouch-range-v').textContent = e.target.value + '%'; });
$('#dodgeburn-range').addEventListener('change', (e) => { state.range = e.target.value; });

// brush sliders
$('#brush-size').addEventListener('input', (e) => { state.brush.size = +e.target.value; $('#brush-size-v').textContent = e.target.value; });
$('#brush-hard').addEventListener('input', (e) => { state.brush.hard = +e.target.value / 100; $('#brush-hard-v').textContent = e.target.value + '%'; });
$('#brush-op').addEventListener('input', (e) => { state.brush.flow = +e.target.value / 100; $('#brush-op-v').textContent = e.target.value + '%'; });
$('#brush-alpha').addEventListener('input', (e) => { state.brush.alpha = +e.target.value / 100; $('#brush-alpha-v').textContent = e.target.value + '%'; });
$('#fill-tol').addEventListener('input', (e) => { state.fillTol = +e.target.value; $('#fill-tol-v').textContent = e.target.value; });
$('#hex-input').addEventListener('input', (e) => {
  const v = e.target.value;
  if (/^[0-9a-fA-F]{6}$/.test(v)) setColor(hexRgb('#' + v));
});
$('#fill-contig').addEventListener('click', (e) => {
  state.fillContig = !state.fillContig;
  e.target.classList.toggle('on', state.fillContig);
  e.target.textContent = state.fillContig ? 'On' : 'Off';
});

// opacity / blend مستر (با undo سند — فقط در شروع تغییر ثبت می‌شود)
let _opacityRecording = null;
$('#layer-opacity').addEventListener('input', (e) => {
  const l = state.selectedLayer;
  if (!l) return;
  if (_opacityRecording !== l) { state.history.recordDoc(state.doc, 'Layer Opacity'); _opacityRecording = l; }
  l.opacity = +e.target.value / 100;
  $('#layer-opacity-v').textContent = e.target.value + '%';
  state.doc.composer.invalidate(); render(); refreshLayerPanel();
});
$('#layer-opacity').addEventListener('change', () => { _opacityRecording = null; });
$('#layer-blend').addEventListener('change', (e) => {
  const l = state.selectedLayer;
  if (!l) return;
  state.history.recordDoc(state.doc, 'Blend Mode');
  l.blendMode = e.target.value;
  state.doc.composer.invalidate(); render(); refreshLayerPanel();
});

// منوی لایهٔ تنظیم
$('#btn-add-adjustment').addEventListener('click', (e) => {
  e.stopPropagation();
  const m = $('#adj-menu');
  m.hidden = !m.hidden;
  if (!m.hidden) {
    const r = e.target.getBoundingClientRect();
    m.style.left = (r.left - 170) + 'px';
    m.style.top = (r.top - m.offsetHeight + 8) + 'px';
  }
});
document.addEventListener('click', () => { const m = $('#adj-menu'); if (m && !m.hidden) m.hidden = true; });
$('#adj-menu').addEventListener('click', (e) => {
  e.stopPropagation();
  const kind = e.target.dataset.adj;
  if (!kind) return;
  addAdjustmentLayer(kind);
  e.target.closest('.menu').hidden = true;
});

// merge down / flatten image
$('#btn-merge-down').addEventListener('click', () => {
  if (!state.doc || state.doc.layers.length <= 1) return;
  const i = state.doc.layers.indexOf(state.selectedLayer);
  if (i <= 0) return;
  const top = state.selectedLayer;
  const bottom = state.doc.layers[i - 1];
  if (!top.paint || !bottom.paint) return;
  state.history.recordDoc(state.doc, 'Merge Down');
  // کامپوزیت درستِ دو لایه (با بلندینگ و opacity) از طریق کامپوزیتور سند
  const tmp = new Document({ width: state.doc.width, height: state.doc.height });
  tmp.addLayer(bottom);
  tmp.addLayer(top);
  tmp.composer.invalidate();
  const merged = tmp.flatten();
  // کپی به bottom (تازه، بدون اشتراک ارجاع)
  const fresh = new Paint(state.doc.width, state.doc.height);
  merged.forEachTile((t) => {
    const nt = fresh.getTile(t.tx, t.ty, true);
    nt.data = new Uint8ClampedArray(t.data);
  });
  state.doc.removeLayer(top);
  bottom.paint = fresh;
  bottom.opacity = 1; bottom.blendMode = 'normal';
  state.selectedLayer = bottom;
  state.doc.composer.invalidate(); render(); refreshLayerPanel();
});
$('#btn-flatten').addEventListener('click', () => {
  if (!state.doc) return;
  state.history.recordDoc(state.doc, 'Flatten Image');
  const flat = state.doc.flatten();
  const fresh = new Paint(state.doc.width, state.doc.height);
  flat.forEachTile((t) => {
    const nt = fresh.getTile(t.tx, t.ty, true);
    nt.data = new Uint8ClampedArray(t.data);
  });
  const nl = new Layer({ name: 'Background', paint: fresh });
  state.doc.layers = [nl];
  state.selectedLayer = nl;
  state.doc.composer.invalidate(); render(); refreshLayerPanel();
});

// undo / redo / save
$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', () => {
  if (state.history && state.history.redo()) { state.doc.composer.invalidate(); render(); refreshLayerPanel(); }
});
function undo() {
  if (state.history && state.history.undo()) {
    state.doc.composer.invalidate(); render(); refreshLayerPanel();
    if (!state.doc.layers.includes(state.selectedLayer)) {
      state.selectedLayer = state.doc.layers[state.doc.layers.length - 1] || null;
    }
  }
}

// keymap قابل شخصی‌سازی (ذخیره در localStorage) — پاسخ به داد کاربرانی که
// نمی‌توانستند میانبرها را عوض کنند (شکایت رایج از Photopea)
let KEYMAP = null;
function loadKeymap() {
  try { KEYMAP = JSON.parse(localStorage.getItem('lumina-keymap')) || {}; } catch (_) { KEYMAP = {}; }
}
function bindKey(action, key) { KEYMAP[action] = key; try { localStorage.setItem('lumina-keymap', JSON.stringify(KEYMAP)); } catch (_) {} }
loadKeymap();

window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
  const k = e.key.toLowerCase();
  const mod = e.ctrlKey || e.metaKey;
  // دابلتاهای خالی space (بدون تغییر) را نادیده بگیر
  const keyFor = (action, def) => (KEYMAP[action] || def) === k;
  if (mod && keyFor('undo', 'z')) { e.preventDefault(); if (e.shiftKey) $('#btn-redo').click(); else undo(); }
  else if (mod && keyFor('redo', 'y')) { e.preventDefault(); $('#btn-redo').click(); }
  else if (mod && e.shiftKey && k === 'h') { e.preventDefault(); cycleTheme(); }
  else if (mod && keyFor('new', 'n')) { e.preventDefault(); createDocument(1920, 1080, 'white'); }
  else if (mod && keyFor('selectall', 'a')) { e.preventDefault(); selectAll(); }
  else if (mod && keyFor('deselect', 'd')) { e.preventDefault(); clearSelection(); }
  else if (k === 'enter') { if (state.polyPath) commitPolygonal(); else if (state.doc && !e.shiftKey) addLayer(false); }
  else if (k === 'delete' || k === 'backspace') { removeSelectedLayer(); }
  else if (!mod && !e.altKey) {
    if (keyFor('brush', 'b')) setTool(state.tool === 'brush' ? 'pencil' : 'brush');
    else if (keyFor('eraser', 'e')) setTool('eraser');
    else if (keyFor('clone', 's')) setTool('clone');
    else if (keyFor('healing', 'j')) setTool('healing');
    else if (keyFor('gradient', 'g')) setTool('gradient');
    else if (keyFor('fill', 'f')) setTool('fill');
    else if (keyFor('picker', 'i')) setTool('picker');
    else if (keyFor('move', 'v')) setTool('move');
    else if (keyFor('wand', 'w')) setTool('wand');
    else if (keyFor('rect', 'm')) setTool('rect');
    else if (keyFor('text', 't')) setTool('text');
    else if (keyFor('rectshape', 'u')) setTool('rectshape');
    else if (k === 'l') setTool('lasso');
    else if (k === 'o') { setTool(state.tool === 'dodge' ? 'burn' : 'dodge'); }
    else if (k === '[') setBrushSize(Math.max(1, state.brush.size - 4));
    else if (k === ']') setBrushSize(Math.min(200, state.brush.size + 4));
    else if (k === '0') fitToScreen();
  }
});

// layers actions
$('#btn-add-layer').addEventListener('click', () => addLayer());
$('#btn-del-layer').addEventListener('click', () => removeSelectedLayer());
$('#btn-dup-layer').addEventListener('click', () => {
  if (!state.doc) return;
  const src = state.selectedLayer;
  state.history.recordDoc(state.doc, 'Duplicate Layer');
  // کپی عمیق (COW واقعی): clone() بافر هر کاشی را مستقل کپی می‌کند.
  const nl = new Layer({ name: src.name + ' copy' });
  if (src.adjustment) nl.adjustment = { ...src.adjustment };
  else if (src.paint) nl.paint = src.paint.clone();
  nl.opacity = src.opacity;
  nl.blendMode = src.blendMode;
  state.doc.addLayer(nl);
  state.selectedLayer = nl;
  state.doc.composer.invalidate(); render(); refreshLayerPanel();
});

// filters
$('#btn-apply-filter').addEventListener('click', () => {
  const l = state.selectedLayer;
  if (!l || !l.paint) return;
  const w = state.doc.width, h = state.doc.height;
  const kind = $('#filter-select').value;
  if (!kind) return;
  const frame = new Uint8ClampedArray(w * h * 4);
  const c = [0, 0, 0, 0];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    l.paint.getPixel(x, y, c);
    const i = (y * w + x) * 4;
    frame[i] = c[0]; frame[i + 1] = c[1]; frame[i + 2] = c[2]; frame[i + 3] = c[3];
  }
  state.history.record(l.paint, 'Filter');
  let out = frame;
  if (kind === 'grayscale') out = grayscale(frame, w, h);
  else if (kind === 'invert') out = invert(frame, w, h);
  else if (kind === 'sepia') out = sepia(frame, w, h);
  else if (kind === 'threshold') out = threshold(frame, w, h);
  else if (kind === 'blur') out = boxBlur(frame, w, h, 2);
  else if (kind === 'gaussian') out = gaussianBlur(frame, w, h, 6);
  else if (kind === 'unsharp') out = unsharpMask(frame, w, h, { amount: 1.4, radius: 2, threshold: 2 });
  else if (kind === 'emboss') out = emboss(frame, w, h, { strength: 1.2, direction: 135 });
  else if (kind === 'sobel') out = sobelEdge(frame, w, h, { invert: false, boost: 1.2 });
  else if (kind === 'median') out = medianFilter(frame, w, h, 1);
  else if (kind === 'pixelate') out = pixelate(frame, w, h, 10);
  else if (kind === 'posterize') out = posterize(frame, w, h, 4);
  else if (kind === 'cel') out = celShade(frame, w, h, { levels: 4, edgeBoost: 1.2 });
  else if (kind === 'kuwahara') out = kuwahara(frame, w, h, 3);
  else if (kind === 'bloom') out = bloom(frame, w, h, { blur: 12, intensity: 0.65, threshold: 0.55 });
  else if (kind === 'motion') out = motionBlur(frame, w, h, { length: 24, angle: 0 });
  else if (kind === 'vignette') out = vignette(frame, w, h, { strength: 0.75, radius: 1 });
  else if (kind === 'thermal') out = thermal(frame, w, h);
  else if (kind === 'vaporwave') out = vaporwave(frame, w, h, { shift: 0.18 });
  else if (kind === 'rain') out = rain(frame, w, h, { density: 0.02, seed: Date.now() & 0xffff, length: 16 });
  else if (kind === 'grain') out = grain(frame, w, h, { intensity: 16, seed: Date.now() & 0xffff });
  else if (kind === 'colorbal') out = colorBalance(frame, w, h, { mr: 10, mb: -10, hg: 8 });
  else if (kind === 'gradmap') out = gradientMap(frame, w, h, { from: [20, 10, 40], to: [255, 200, 80] });
  else if (kind === 'kaleido') out = kaleidoscope(frame, w, h, { segments: 8 });
  else if (kind === 'curves') {
    const lut = curvesLUT([[64, 40], [128, 140], [192, 215]]); // S-curve ملایم
    out = applyCurves(frame, w, h, lut, lut, lut);
  }
  else if (kind === 'exposure+') out = exposureAdjust(frame, w, h, 1);
  else if (kind === 'exposure-') out = exposureAdjust(frame, w, h, -1);
  else if (kind === 'vibrance') out = vibranceAdjust(frame, w, h, 0.4);
  else if (kind === 'desaturate') out = grayscale(frame, w, h);
  else if (kind === 'chroma') {
    // حذف پس‌زمینهٔ سبز (chroma key) — مثل Magic Eraser فتوشاپ
    const rgba = chromaKeyRemove(frame, w, h, { r: 0, g: 255, b: 0 }, 100);
    out = rgba;
    if (typeof toast === 'function') toast('Green background removed (chroma key)');
  }
  else if (kind === 'autoretouch') {
    // ─── High-End Skin Retouch: skin-mask + healing (inpaint) + tone ───
    // معادل ~۴۵ دقیقه رتوش دستی فتوشاپ، در یک کلیک
    const mask = new Float32Array(w * h);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const R = frame[p], G = frame[p + 1], B = frame[p + 2];
      if (R > B + 8 && G > B + 2 && R > G + 2) {
        const lum = 0.299 * R + 0.587 * G + 0.114 * B;
        if (lum > 45 && lum < 245) mask[i] = 1;
      }
    }
    // لکه = انحراف شدید از گاوس(3)
    const g3 = gaussianBlur(frame, w, h, 3);
    const spot = new Uint8Array(w * h);
    let nsp = 0;
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      if (mask[i] < 0.5) continue;
      const dev = Math.abs(frame[p] - g3[p]) + Math.abs(frame[p + 1] - g3[p + 1]) + Math.abs(frame[p + 2] - g3[p + 2]);
      if (dev > 90) { spot[i] = 1; nsp++; }
    }
    const healed = inpaintTelea(frame, w, h, spot, 6);
    // تناژ نرم ملایم فقط پوست
    const bl = gaussianBlur(healed, w, h, 10);
    out = new Uint8ClampedArray(healed.length);
    for (let i = 0, p = 0; i < w * h; i++, p += 4) {
      const m = mask[i] * 0.25;
      out[p] = healed[p] + (bl[p] - healed[p]) * m;
      out[p + 1] = healed[p + 1] + (bl[p + 1] - healed[p + 1]) * m;
      out[p + 2] = healed[p + 2] + (bl[p + 2] - healed[p + 2]) * m;
      out[p + 3] = healed[p + 3];
    }
    if (typeof toast === 'function') toast(`Auto Retouch: ${nsp} blemishes healed`);
  }
  else if (kind === 'freqsep') {
    // ─── Frequency Separation: سخت‌ترین کار فتوشاپ، یک‌کلیکی ───
    const { low, high } = frequencySeparate(frame, w, h, 8);
    // لایهٔ فعلی = low، و یک لایهٔ High Frequency با Linear Light رویش
    l.paint.clear();
    l.paint.writeFromRGBA(low, w, h);
    l.blendMode = 'normal';
    l.name = ((l.name.match(/^[^(]+/) || [l.name])[0]).trim() + ' (Low Freq)';
    const hi = new Layer({
      name: (l.name.split(' (Low')[0]) + ' (High Freq)',
      paint: (() => { const p = new Paint(w, h); p.writeFromRGBA(high, w, h); return p; })(),
      blendMode: 'linearLight',
      opacity: 1,
    });
    state.doc.addLayer(hi);
    state.selectedLayer = l; // روی low بمان تا با brush/blur روی تناژ کار کند
    state.doc.composer.invalidate(); render(); refreshLayerPanel();
    $('#filter-select').value = '';
    return;
  }
  else if (kind === 'smoothskin') {
    // صاف‌کردن تناژ بدون ازدست‌دادن منافذ (نسخهٔ سریع High-End)
    out = smoothTones(frame, w, h, 10, 0.7);
  }
  l.paint.clear();
  l.paint.writeFromRGBA(out, w, h);
  state.doc.composer.invalidate(); render(); refreshLayerPanel();
  $('#filter-select').value = '';
});

/* ================= open / save ================= */
$('#file-input').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const buf = new Uint8Array(await f.arrayBuffer());
  try {
    // PSD/PSB با لایه → سند چندلایه؛ فایل تخت (هر فشرده‌سازی/عمق/حالت رنگی)
    // هم از همان خواننده می‌آید چون مسیر قدیمی ZIP، CMYK و ۱۶/۳۲ بیت را رد می‌کرد.
    const fmt = detectFormat(buf);
    let doc = null;
    if (fmt === 'psd' || fmt === 'psb') {
      try {
        const flat = await decodeLayeredPSD(buf);
        if (!psdHasLayers(buf)) {
          // فایل تخت: تصویر ادغام‌شده را به سند تازه تبدیل کن
          const rgba = new Uint8ClampedArray(flat.width * flat.height * 4);
          const px = [0, 0, 0, 0];
          for (let y = 0, o = 0; y < flat.height; y++) {
            for (let x = 0; x < flat.width; x++, o += 4) {
              flat.merged.getPixel(x, y, px);
              rgba[o] = px[0]; rgba[o + 1] = px[1]; rgba[o + 2] = px[2]; rgba[o + 3] = px[3];
            }
          }
          doc = Document.fromRGBA(rgba, flat.width, flat.height, { name: f.name.replace(/\.[^.]+$/, '') });
          state.loadedICC = flat.icc || null;
        }
      } catch (err) {
        console.warn('خواندن PSD از مسیر چندلایه ناموفق بود:', err.message);
        doc = null;
      }
    }
    if ((fmt === 'psd' || fmt === 'psb') && !doc && psdHasLayers(buf)) {
      try {
        const layered = await decodeLayeredPSD(buf);
        doc = new Document({ width: layered.width, height: layered.height, name: f.name.replace(/\.[^.]+$/, '') });
        for (const l of layered.layers) {
          if (l.adjustment) refreshAdjustmentApply(l);   // بازسازی apply برای لایه‌های تنظیم
          doc.addLayer(l);
        }
        if (!doc.layers.length) doc = null;
        else state.loadedICC = layered.icc || null;
      } catch (err) {
        console.warn('PSD چندلایه خوانده نشد، تصویر ادغام‌شده بارگذاری می‌شود:', err.message);
        doc = null;
      }
    }
    if (!doc) {
      const dec = await decodeImage(buf);
      doc = Document.fromRGBA(dec.data, dec.width, dec.height, { name: f.name.replace(/\.[^.]+$/, '') });
    }
    state.doc = doc; state.history = new LayeredHistory();
    state.selectedLayer = doc.layers[doc.layers.length - 1];
    state.histBaseLabel = 'Open';
    $('#empty-hint').style.display = 'none';
    onDocChanged(); refreshLayerPanel(); fitToScreen(true); render();
  } catch (err) {
    alert('Could not open image: ' + err.message);
  } finally {
    e.target.value = '';
  }
});

$('#btn-save').addEventListener('click', async () => {
  if (!state.doc) return;
  const fmt = state.exportFormat || 'png';
  const frame = state.doc.toRGBA();
  const embed = state.embedICC !== false;
  const buf = await encodePng({ width: state.doc.width, height: state.doc.height, data: frame }, { icc: embed ? srgbProfile() : null });
  if (fmt === 'psd') {
    if (state.layeredPSD !== false) {
      const b = await encodeLayeredPSD(state.doc, { composite: frame, icc: embed ? srgbProfile() : null, ...layeredPSDOptions() });
      downloadBlob(new Blob([b], { type: 'image/vnd.adobe.photoshop' }), (state.doc.name || 'lumina') + '.psd');
      return;
    }
    const b = encodePSDFlat(frame, state.doc.width, state.doc.height);
    downloadBlob(new Blob([b], { type: 'image/vnd.adobe.photoshop' }), (state.doc.name || 'lumina') + '.psd');
  } else if (fmt === 'jpeg' || fmt === 'jpg') {
    const b = encodeJPEGFlat({ width: state.doc.width, height: state.doc.height, data: frame }, 92, { icc: embed ? srgbProfile() : null });
    downloadBlob(new Blob([b], { type: 'image/jpeg' }), (state.doc.name || 'lumina') + '.jpg');
  } else if (fmt === 'bmp') {
    const b = encodeBmpFlat(frame, state.doc.width, state.doc.height);
    downloadBlob(new Blob([b], { type: 'image/bmp' }), (state.doc.name || 'lumina') + '.bmp');
  } else if (fmt === 'qoi') {
    const b = encodeQoiFlat(frame, state.doc.width, state.doc.height);
    downloadBlob(new Blob([b], { type: 'image/qoi' }), (state.doc.name || 'lumina') + '.qoi');
  } else if (fmt === 'tiff' || fmt === 'tif') {
    const b = await encodeImage({ width: state.doc.width, height: state.doc.height, data: frame }, 'tiff', { embedICC: embed });
    downloadBlob(new Blob([b], { type: 'image/tiff' }), (state.doc.name || 'lumina') + '.tiff');
  } else if (fmt === 'webp') {
    // WebP با انکودر بومی مرورگر (کیفیت بالا، شفافیت کامل)
    const b = await encodeWebP(frame, state.doc.width, state.doc.height, 0.92);
    downloadBlob(new Blob([b], { type: 'image/webp' }), (state.doc.name || 'lumina') + '.webp');
  } else {
    downloadBlob(new Blob([buf], { type: 'image/png' }), (state.doc.name || 'lumina') + '.png');
  }
});

// انکود WebP با موتور بومی مرورگر (بدون وابستگی) — شفافیت و کیفیت کامل
async function encodeWebP(frame, w, h, quality = 0.92) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const id = g.createImageData(w, h);
  id.data.set(frame);
  g.putImageData(id, 0, 0);
  const blob = await new Promise((res) => c.toBlob(res, 'image/webp', quality));
  if (!blob) throw new Error('WebP در این مرورگر پشتیبانی نمی‌شود');
  return new Uint8Array(await blob.arrayBuffer());
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

// drag & drop open
const wrap = $('#canvas-wrap');
wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('drop'); });
wrap.addEventListener('dragleave', () => wrap.classList.remove('drop'));
wrap.addEventListener('drop', (e) => {
  e.preventDefault(); wrap.classList.remove('drop');
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) { const dt = new DataTransfer(); dt.items.add(f); const fi = $('#file-input'); fi.files = dt.files; fi.dispatchEvent(new Event('change')); }
});

/* ================= theme + helpers ================= */
const THEMES = ['dark', 'midnight'];
function cycleTheme() {
  const cur = document.documentElement.dataset.theme || 'dark';
  const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('lumina-theme', next); } catch (_) {}
}
function setBrushSize(v) {
  state.brush.size = v;
  $('#brush-size').value = v;
  $('#brush-size-v').textContent = v;
}
function addLayer(focus = true) {
  if (!state.doc) return;
  if (state.history) state.history.recordDoc(state.doc, 'Add Layer');
  const l = new Layer({ name: `Layer ${state.doc.layers.length + 1}`, paint: new Paint(state.doc.width, state.doc.height) });
  state.doc.addLayer(l); state.selectedLayer = l;
  state.doc.composer.invalidate(); render(); refreshLayerPanel();
  return l;
}
function removeSelectedLayer() {
  if (!state.doc || state.doc.layers.length <= 1) return;
  if (state.history) state.history.recordDoc(state.doc, 'Delete Layer');
  const l = state.selectedLayer;
  state.doc.removeLayer(l);
  state.selectedLayer = state.doc.layers[state.doc.layers.length - 1];
  state.doc.composer.invalidate(); render(); refreshLayerPanel();
}

// zoom controls
$('#btn-zoom-in').addEventListener('click', () => { state.zoom = Math.min(32, state.zoom * 1.25); applyView(); });
$('#btn-zoom-out').addEventListener('click', () => { state.zoom = Math.max(0.02, state.zoom / 1.25); applyView(); });
$('#btn-fit').addEventListener('click', () => fitToScreen());

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
  state.zoom = Math.min(32, Math.max(0.02, state.zoom * factor));
  applyView();
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('dblclick', (e) => {
  if (state.tool === 'polygonal' && state.polyPath) { commitPolygonal(); }
});

/* ================= boot ================= */
buildSwatches();
// ترتیب لایه + نام‌گذاری
$('#btn-layer-up').addEventListener('click', () => {
  const l = state.selectedLayer; if (!l) return;
  const i = state.doc.layers.indexOf(l);
  if (i >= 0 && i < state.doc.layers.length - 1) {
    state.history.recordDoc(state.doc, 'Move Layer Up');
    state.doc.layers.splice(i, 1); state.doc.layers.splice(i + 1, 0, l);
    state.doc.composer.invalidate(); render(); refreshLayerPanel();
  }
});
$('#btn-layer-down').addEventListener('click', () => {
  const l = state.selectedLayer; if (!l) return;
  const i = state.doc.layers.indexOf(l);
  if (i > 0) {
    state.history.recordDoc(state.doc, 'Move Layer Down');
    state.doc.layers.splice(i, 1); state.doc.layers.splice(i - 1, 0, l);
    state.doc.composer.invalidate(); render(); refreshLayerPanel();
  }
});
$('#btn-rename-layer').addEventListener('click', () => {
  const l = state.selectedLayer; if (!l) return;
  const nm = window.prompt('Layer name:', l.name);
  if (nm) { state.history.recordDoc(state.doc, 'Rename Layer'); l.name = nm; refreshLayerPanel(); }
});

// group / clipping mask / drop shadow
$('#btn-group-layers').addEventListener('click', () => {
  if (!state.doc) return;
  // گروه: لایهٔ انتخابی در یک گروه تازه (opacity گروه جاری 1)
  const layers = state.doc.layers;
  const li = layers.indexOf(state.selectedLayer);
  if (li < 0) return;
  state.history.recordDoc(state.doc, 'Group Layers');
  const grp = new Layer({ name: 'Group', isGroup: true, opacity: 1 });
  const end = new Layer({ name: '—/Group', isGroupEnd: true });
  layers.splice(li, 0, grp);
  layers.splice(li + 2, 0, end);
  state.doc.composer.invalidate(); render(); refreshLayerPanel();
});
$('#btn-clip-layer').addEventListener('click', () => {
  const l = state.selectedLayer;
  if (!l) return;
  state.history.recordDoc(state.doc, 'Clipping Mask');
  l.clipToBelow = !l.clipToBelow;
  state.doc.composer.invalidate(); render(); refreshLayerPanel();
});
$('#btn-shadow-layer').addEventListener('click', () => {
  const l = state.selectedLayer;
  if (!l || !l.paint) return;
  state.history.recordDoc(state.doc, 'Drop Shadow');
  l.style = l.style || {};
  l.style.dropShadow = l.style.dropShadow ? null : { dx: 6, dy: 8, blur: 10, color: [0, 0, 0, 255], opacity: 0.55 };
  if (l.style.dropShadow && !l._shadowLayer) {
    // لایهٔ سایهٔ پشت لایه
    const p = l.paint;
    const sh = renderDropShadow(p, state.doc.width, state.doc.height, l.style.dropShadow);
    const sl = new Layer({ name: 'Shadow', paint: sh });
    const i = state.doc.layers.indexOf(l);
    state.doc.addLayer(sl, i);
    l._shadowLayer = sl;
    l._shadowOf = l;
  } else if (!l.style.dropShadow && l._shadowLayer) {
    state.doc.removeLayer(l._shadowLayer);
    l._shadowLayer = null;
  }
  state.doc.composer.invalidate(); render(); refreshLayerPanel();
});
// گزینه‌های خروجی PSD (فشرده‌سازی/حالت رنگ/عمق/افکت قدیمی)
export function layeredPSDOptions() {
  return {
    compression: state.psdCompression || 'rle',
    colorMode: state.psdColorMode || 'rgb',
    depth: state.psdDepth16 ? 16 : 8,
    legacyEffects: !!state.psdLegacyFX,
  };
}
function syncPsdOptionVisibility() {
  const box = $('#psd-opts');
  if (box) box.classList.toggle('show', (state.exportFormat || 'png') === 'psd');
}
$('#psd-compression')?.addEventListener('change', (e) => { state.psdCompression = e.target.value; });
$('#psd-colormode')?.addEventListener('change', (e) => { state.psdColorMode = e.target.value; });
$('#btn-psd-depth')?.addEventListener('click', (e) => {
  state.psdDepth16 = !state.psdDepth16;
  e.currentTarget.classList.toggle('on', state.psdDepth16);
  e.currentTarget.setAttribute('aria-pressed', String(state.psdDepth16));
});
$('#btn-psd-legacyfx')?.addEventListener('click', (e) => {
  state.psdLegacyFX = !state.psdLegacyFX;
  e.currentTarget.classList.toggle('on', state.psdLegacyFX);
  e.currentTarget.setAttribute('aria-pressed', String(state.psdLegacyFX));
});

$('#export-format').addEventListener('change', (e) => { state.exportFormat = e.target.value; syncPsdOptionVisibility(); });
$('#btn-layered-psd')?.addEventListener('click', (e) => {
  state.layeredPSD = !state.layeredPSD;
  const b = e.currentTarget;
  b.classList.toggle('on', state.layeredPSD);
  b.setAttribute('aria-pressed', String(state.layeredPSD));
});
$('#btn-embed-icc')?.addEventListener('click', (e) => {
  state.embedICC = !state.embedICC;
  const b = e.currentTarget;
  b.classList.toggle('on', state.embedICC);
  b.setAttribute('aria-pressed', String(state.embedICC));
});
$('#export-format')?.addEventListener('change', (e) => {
  const f = e.target.value;
  const noICC = f === 'bmp' || f === 'qoi';
  const btn = $('#btn-embed-icc');
  if (btn) { btn.disabled = noICC; btn.style.opacity = noICC ? 0.4 : 1; }
  syncPsdOptionVisibility();
});
syncPsdOptionVisibility();
$('#btn-toggle-mask-edit').addEventListener('click', (e) => {
  const l = state.selectedLayer;
  if (l && !l.mask) l.mask = (() => { const m = new Paint(l.paint.w, l.paint.h); m.clearRect({ x: 0, y: 0, w: m.w, h: m.h }, 255, 255, 255, 255); return m; })();
  state.maskEditing = !state.maskEditing;
  e.target.classList.toggle('active', state.maskEditing);
  $('#sb-tool-hint').textContent = state.maskEditing ? 'Painting on MASK — black hides, white reveals' : 'Mask edit off';
});

// عملیات انتخاب
$('#btn-sel-all').addEventListener('click', selectAll);
$('#btn-sel-invert').addEventListener('click', invertSelection);
$('#btn-sel-clear').addEventListener('click', clearSelection);
$('#btn-sel-delete').addEventListener('click', deleteSelection);
$('#btn-sel-fill').addEventListener('click', fillSelectionActive);
$('#btn-crop').addEventListener('click', cropToSelection);

// اسلایدرهای HSL/آلفا
function onHslChange() {
  const h = +$('#hue-slider').value, s = +$('#sat-range').value / 100, l = +$('#light-range').value / 100;
  const [r, g, b] = hslToRgb(h, s, l);
  const a = Math.round(+$('#alpha-range').value / 100 * 255);
  setColor([r, g, b, a]);
}
$('#hue-slider').addEventListener('input', () => { onHslChange(); });
$('#sat-range').addEventListener('input', () => { onHslChange(); });
$('#light-range').addEventListener('input', () => { onHslChange(); });
$('#alpha-range').addEventListener('input', () => { onHslChange(); });

// فونت متن
$('#font-name').addEventListener('change', (e) => {
  state.font = e.target.value;
  const l = selectedTextLayer();
  if (l) updateTextLayer(l, { font: e.target.value }, 'Font');
});
$('#text-size').addEventListener('input', (e) => {
  $('#text-size-v').textContent = e.target.value;
  const l = selectedTextLayer();
  if (l) updateTextLayer(l, { size: +e.target.value }, 'Text Size');
});
$('#t-bold').addEventListener('click', (e) => {
  const l = selectedTextLayer();
  if (l) { updateTextLayer(l, { bold: !l.text.bold }, 'Bold'); return; }
  state.textStyle.bold = !state.textStyle.bold;
  e.currentTarget.classList.toggle('on', state.textStyle.bold);
});
$('#t-italic').addEventListener('click', (e) => {
  const l = selectedTextLayer();
  if (l) { updateTextLayer(l, { italic: !l.text.italic }, 'Italic'); return; }
  state.textStyle.italic = !state.textStyle.italic;
  e.currentTarget.classList.toggle('on', state.textStyle.italic);
});
$('#t-underline').addEventListener('click', (e) => {
  const l = selectedTextLayer();
  if (l) { updateTextLayer(l, { underline: !l.text.underline }, 'Underline'); return; }
  state.textStyle.underline = !state.textStyle.underline;
  e.currentTarget.classList.toggle('on', state.textStyle.underline);
});

// ─── ویرایش زندهٔ لایهٔ متنی ───
$('#text-edit').addEventListener('input', (e) => {
  const l = selectedTextLayer();
  if (l) updateTextLayer(l, { content: e.target.value }, 'Text Content');
});
$('#text-align').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-align]');
  if (!b) return;
  const l = selectedTextLayer();
  if (l) updateTextLayer(l, { align: b.dataset.align }, 'Text Align');
  document.querySelectorAll('#text-align button').forEach((x) => x.classList.toggle('on', x === b));
});
$('#text-stroke-w').addEventListener('input', (e) => {
  $('#text-stroke-w-v').textContent = e.target.value;
  const l = selectedTextLayer();
  if (l) updateTextLayer(l, { strokeWidth: +e.target.value }, 'Text Stroke');
});
$('#text-stroke-color').addEventListener('input', (e) => {
  const l = selectedTextLayer();
  if (l) updateTextLayer(l, { strokeColor: e.target.value }, 'Stroke Color');
});
$('#text-line-height').addEventListener('input', (e) => {
  $('#text-line-height-v').textContent = e.target.value;
  const l = selectedTextLayer();
  if (l) updateTextLayer(l, { lineHeight: +e.target.value }, 'Line Height');
});
$('#text-letter-spacing').addEventListener('input', (e) => {
  $('#text-letter-spacing-v').textContent = e.target.value;
  const l = selectedTextLayer();
  if (l) updateTextLayer(l, { letterSpacing: +e.target.value }, 'Letter Spacing');
});
$('#text-shadow').addEventListener('click', (e) => {
  const l = selectedTextLayer();
  if (l) { updateTextLayer(l, { shadow: !l.text.shadow }, 'Text Shadow'); return; }
  state.textStyle.shadow = !state.textStyle.shadow;
  e.currentTarget.classList.toggle('on', state.textStyle.shadow);
});

// بارگذاری فونت سفارشی کاربر (TTF/OTF) — مثل Photopea's «Load Font»
$('#btn-load-font').addEventListener('click', () => $('#font-file').click());
$('#font-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const buf = await f.arrayBuffer();
    // استخراج نام خانواده از name table (ttf) — fallback به اسم فایل
    let fam = f.name.replace(/\.[^.]+$/, '').replace(/[\s_-]+/g, '');
    try { fam = extractFontFamily(buf); } catch (_) {}
    const ff = new FontFace('USER_' + fam, buf);
    await ff.load();
    document.fonts.add(ff);
    // اضافه به منوی فونت
    const sel = $('#font-name');
    const opt = document.createElement('option');
    opt.value = 'USER_' + fam; opt.textContent = fam + ' (user)';
    opt.selected = true;
    sel.appendChild(opt);
    state.font = 'USER_' + fam;
    state.userFont = { name: 'USER_' + fam, buffer: buf };
  } catch (err) {
    alert('Could not load font: ' + err.message);
  } finally {
    e.target.value = '';
  }
});

function extractFontFamily(buf) {
  const u8 = new Uint8Array(buf);
  const view = new DataView(buf);
  const numTables = view.getUint16(4, false);
  let nameOff = -1;
  for (let i = 0; i < numTables; i++) {
    const off = 12 + i * 16;
    const sig = String.fromCharCode(u8[off], u8[off + 1], u8[off + 2], u8[off + 3]);
    if (sig === 'name') { nameOff = view.getUint32(off + 8, false); break; }
  }
  if (nameOff < 0) throw new Error('no name table');
  const count = view.getUint16(nameOff + 2, false);
  const strOff = nameOff + view.getUint16(nameOff + 4, false);
  let family = null;
  for (let i = 0; i < count; i++) {
    const rec = nameOff + 6 + i * 12;
    const platformId = view.getUint16(rec, false);
    const nameId = view.getUint16(rec + 6, false);
    if (nameId !== 1) continue; // family name
    const len = view.getUint16(rec + 8, false);
    const offset = view.getUint16(rec + 10, false);
    const bytes = u8.subarray(strOff + offset, strOff + offset + len);
    let s;
    if (platformId === 3 || platformId === 0) {
      s = String.fromCharCode(...bytes);
    } else {
      s = new TextDecoder('utf-16be').decode(bytes);
    }
    s = s.split('\0')[0].trim();
    if (s && !family) family = s;
  }
  return family || 'CustomFont';
}

// ماسک لایه
$('#btn-add-mask').addEventListener('click', () => {
  const l = state.selectedLayer;
  if (!l || !l.paint) return;
  l.mask = new Paint(l.paint.w, l.paint.h);
  l.mask.clearRect({ x: 0, y: 0, w: l.paint.w, h: l.paint.h }, 255, 255, 255, 255);
  state.doc.composer.invalidate(); render(); refreshLayerPanel();
});
$('#btn-delete-mask').addEventListener('click', () => {
  const l = state.selectedLayer;
  if (!l || !l.mask) return;
  l.mask = null;
  state.doc.composer.invalidate(); render(); refreshLayerPanel();
});

setColor([108, 140, 255, 255]);
createDocument(1920, 1080, 'white');
