# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-09-19

First public release. Everything below is verified against independent tools —
see [docs/VERIFICATION.md](docs/VERIFICATION.md).

### Added

- **PSD engine written from scratch** (`src/formats/psd*.js`): full document
  walk, layer records, tagged blocks, merged composite, and a writer that
  produces files Photoshop opens.
  - Native layered PSD output in RGB, CMYK or Grayscale, 8- or 16-bit, with RAW,
    PackBits RLE, ZIP or ZIP + prediction channel compression.
  - Read support for 8/16/**32-bit float** documents, flat and layered, including
    nested compositions, clipping masks, global masks and per-channel
    compression.
  - Tagged blocks: `luni`, `lsct`, `lfx2`, `lrFX`, `vmsk`/`vsms`, `TySh`, `vibA`,
    `Crv ` and other adjustment keys, plus the descriptor mini-format in both
    directions.
- **Native adjustment layers**: Curves (v1 `'Crv '` and v4), Levels,
  Brightness/Contrast, Invert, Posterize, Exposure, Hue/Saturation, Threshold,
  Vibrance — non-destructive, with live sliders.
- **Layer styles** (drop shadow, stroke, colour overlay) read from `lfx2`/`lrFX`
  and re-rendered; vector masks rasterised for compositing.
- **Colour management**: standards-compliant sRGB ICC profile (D50 white point,
  Bradford `chad`, parametric type-3 curve), verified ≤1 level of error against
  LCMS on 50k random colours.
- **Formats**: PNG (own codec, ICC), JPEG, TIFF, BMP, QOI (byte-exact interop
  with the reference C implementation), WebP and GIF and DNG on read.
- **Editor**: tile-based `Paint` with copy-on-write, unified history panel,
  navigator, 27 Photoshop blend modes in linear space, groups, clipping masks,
  layer masks, editable text layers, marching-ants selections, lasso, magic
  wand, gradient/shape/brush/clone tools, effects (blur, sharpening, posterize,
  cel-shade, kuwahara, bloom, motion blur, grain, thermal, vaporwave …).
- **Apps**: framework-free web UI (`npm run web`) and an Electron desktop shell
  for macOS, Windows and Linux using a privileged `app://` scheme with a
  sandboxed renderer.
- **Verification harnesses**: `tools/verify-psd.mjs`, `tools/verify-corpus.mjs`
  (30 real Photoshop files), a 269-test suite including a real headless-browser
  UI suite, and reproducible screenshot generation.

### Fixed

- **Merged image offset** — the flattened composite is read from the end of the
  whole Layer & Mask section; documents that store extra data between the
  layer-info block and the image data (852 bytes in `adjustment_backdrop_test.psd`)
  previously decoded corrupted bottom rows.
- **Flat documents** (Layer & Mask length 0, e.g. `cmyk-spot.psd`) no longer
  walk past the buffer end.
- **Flat PSD writer** emitted a stray 4-byte length before the compression
  marker, producing files Photoshop, Pillow and psd-tools all rejected
  (`20 is not a valid Compression`). The writer is now spec-conformant and
  embeds an sRGB ICC profile.
- **CMYK polarity** — Photoshop stores CMYK inverted in PSD (byte = 255 − ink);
  both reader and writer now follow the convention, proven against the raw
  planes of `cmyk-gray-ramp.psd`.
- **ICC profile** rewritten from a D65/gamma approximation to D50 + Bradford
  `chad` + parametric transfer; colour shifts of up to 9 levels in managed
  readers are gone.
- **32-bit float** decoding implemented for RAW, RLE and ZIP channels, including
  byte-shuffle reversal for the predicted variant.

## [0.3.0] — 2026-09-17

- Brand and packaging: name, logo, window title, Electron product name.
- Non-destructive adjustment layers, layer panel controls (blend mode, opacity,
  merge down, flatten), theme switching, and a first round of UI bug fixes.
- Desktop build pipeline (`npm run dist:win`, `npm run dist:dir`).

## [0.2.0] — 2026-09-14

- Engine work: linear-light blending across 27 modes, tile compositor with no
  allocation on the hot path, QOI codec with C-reference interop, PNG codec,
  first headless-browser UI tests.

## [0.1.0] — 2026-09-10

- Initial prototype: document model, paint engine, brush/fill tools, canvas UI.

[1.0.0]: https://github.com/ZALPRO/lumina/releases/tag/v1.0.0
[0.3.0]: https://github.com/ZALPRO/lumina/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/ZALPRO/lumina/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ZALPRO/lumina/releases/tag/v0.1.0
