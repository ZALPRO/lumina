# Lumina architecture

Lumina is a web-first image editor whose engine has **no runtime dependencies**.
The same ES modules power the browser app (`npm run web`), the desktop app
(Electron) and the Node command line (`cli/`, `tools/`). Nothing in `src/`
imports Electron, DOM APIs or npm packages — the only browser API it touches is
`DecompressionStream`/`CompressionStream`, and even that is optional (see
*Compression* below).

```
ui/            the editor: DOM, canvas, panels, tools UI  (imports src/)
src/
  document/    Document, Layer, Paint (tiles), Composer, LayeredHistory
  engine/      blend modes, filters, adjustments, effects, inpaint, layer styles
  formats/     png jpeg tiff webp(dec) bmp qoi psd psd-read psd-layers icc deflate
  tools/       brush, flood fill, paint tools, clone stamp
  text/        text-layer spec + rasterisation through a 2D canvas
  utils/       memory estimation, quantisation
electron/      desktop shell (app:// protocol, sandboxed renderer)
cli/           headless scripts: demo, thumbnail builders, retouch
tools/         verification harnesses (PSD, corpus)
test/          node:test suites + a real headless-browser UI suite
```

## Documents and layers

`Document` owns width/height, bit depth, colour space and an ordered list of
layers, plus a `Composer` and a `MemoryEstimate`.

A layer is a union type discriminated by which field is non-null:

| Field | Layer kind |
|---|---|
| `paint` | raster layer (pixel data) |
| `text` | editable text layer (rendered on demand, re-editable) |
| `adjustment` | non-destructive adjustment layer (Curves, Levels, …) |
| `isGroup` / `isGroupEnd` | container markers in the flat layer list |

Cross-cutting properties: `opacity`, `blendMode`, `visible`, `mask`,
`vectorMask`, `clipToBelow`, `style` (drop shadow / stroke / colour overlay)
and `effects`.

Because a group is a marker pair rather than a nested tree, layer reordering,
hit-testing and PSD serialisation all operate on one flat array — the same
representation Photoshop uses on disk, which keeps the reader and the writer
symmetric.

## Paint: tiles with copy-on-write

`Paint` is a sparse grid of 128×128 `Uint8ClampedArray` tiles.

- Layers start empty and allocate a tile only when something is painted into it
  (`getTile(..., true)`), so a 10-layer 4000×4000 document that is mostly empty
  costs almost nothing.
- Duplicating a layer or taking an undo snapshot copies the **tile map**, not
  the pixels. A tile is detached (`#detachIfShared`) the moment it is written
  to, so the copy is invisible to the caller and costs one allocation per
  touched tile.
- `getPixel`/`setPixel` are allocation-free on the hot path, and the composer
  iterates tile-by-tile, which keeps brush strokes interactive on large
  documents.

`LayeredHistory` is a stack of COW snapshots with labels, which is what the
History panel displays; undo/redo is a pointer move, not a re-render.

## Compositing and colour

`Composer` walks the layer list bottom-up and produces the flattened result.
Blend maths happens in **linear light** (`engine/blend.js`): sRGB samples are
linearised, blended with one of 27 Photoshop modes, and converted back. Opacity,
clipping masks, masks and vector masks are applied per layer, and layer styles
are rendered into a scratch paint before compositing.

Colour management lives in `formats/icc.js`, which builds a complete sRGB
profile — D50 white point, Bradford chromatic-adaptation matrix, chromaticities,
parametric type-3 transfer function — so files written by Lumina look identical
in Photoshop, Preview, GIMP or a browser that honours embedded profiles.

## Formats

| Format | Read | Write | Notes |
|---|---|---|---|
| PNG | ✅ | ✅ | own decoder/encoder, ICC (`iCCP`), 8/16-bit |
| JPEG | ✅ | ✅ | baseline + progressive decode, Huffman/quality tables |
| TIFF | ✅ | ✅ | uncompressed, LZW-ish subset, RGB/gray |
| WebP | ✅ | — | lossless (VP8L) and lossy (VP8) decode |
| GIF | ✅ | — | |
| BMP | ✅ | ✅ | |
| QOI | ✅ | ✅ | byte-exact interop with the reference C implementation |
| DNG | ✅ | — | reads the embedded linear preview |
| PSD / PSB | ✅ | ✅ | see below |

### PSD

- `psd-read.js` — full document walk: header, colour-mode data, image
  resources (ICC), Layer & Mask section, per-layer records and channel data,
  tagged blocks (`luni`, `lsct`, `lfx2`, `lrFX`, `vmsk`, `vibA`, adjustment
  keys), plus the merged composite image at the correct offset (end of the
  Layer & Mask section).
- `psd-layers.js` — writer: layer records, masks, vector-mask paths, styles,
  native adjustment descriptors, and channel payloads in RAW, RLE, ZIP or
  ZIP + prediction, in RGB / CMYK / Grayscale and 8 / 16-bit.
- `psd-descriptor.js` — the little object-descriptor format Photoshop uses to
  store adjustment and style parameters, both directions.
- `psd-layerstyles.js` — renders the styles we understand back onto the canvas.

Deep detail, including the CMYK polarity convention, the byte-shuffle rule for
32-bit ZIP channels and the `'Crv '` marker: [PSD.md](PSD.md).

## Compression

`formats/deflate.js` wraps inflation in `DecompressionStream` when it exists
(browsers, Node 18+) and falls back to a pure-JS zlib implementation otherwise.
That is why opening a ZIP-compressed PSD works in the browser *and* in Node with
the same code, and why the engine stays dependency-free.

## The `app://` desktop shell

`electron/main.js` registers a privileged `app://` scheme and serves the file
tree from it, so the renderer keeps `webSecurity` on, gets real ES-module
semantics and never needs a local HTTP server. Navigation outside the app is
denied and `http(s)` links open in the system browser. The window is created
once (single-instance lock), the renderer is sandboxed with a minimal
CommonJS preload, and no network requests are made by the app itself.

## Testing

- `node --test test/` — unit and integration suites per subsystem.
- `test/browser.e2e.js` — drives the real UI in headless Chromium through a
  small hook (`window.__lumina`) that also powers `scripts/screenshot.mjs`.
- `tools/verify-psd.mjs` — builds a feature-rich PSD and validates it with
  external tools if they are installed.
- `tools/verify-corpus.mjs` — downloads/locates real Photoshop files and
  compares Lumina's output against raw planes read by psd-tools.
