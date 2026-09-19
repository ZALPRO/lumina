<div align="center">

<img src="ui/logo.png" alt="Lumina Logo" width="104">

# Lumina

**A fast, dependency-light image editor with a from-scratch PSD & ICC engine.**

Layered PSD Read/Write · Native Curves & Levels · Vector Masks · Layer Effects · Linear-Light Compositing · Zero Native Codecs

[![CI](https://github.com/ZALPRO/lumina/actions/workflows/ci.yml/badge.svg)](https://github.com/ZALPRO/lumina/actions/workflows/ci.yml)
[![Release](https://github.com/ZALPRO/lumina/actions/workflows/release.yml/badge.svg)](https://github.com/ZALPRO/lumina/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-274%20passing-34c759.svg)](#verification)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg)](#installation--setup)

[Quick Start](#quick-start) · [Features](#key-features) · [Supported Formats](#supported-formats) · [Installation](#installation--setup) · [Verification](#verification) · [Architecture](#architecture) · [License](#license)

<br>

<img src="docs/screenshots/editor-psd-layers.png" alt="Lumina Editor Interface" width="920">

</div>

---

## Overview

Most modern editors delegate Photoshop format handling to heavy external dependencies or cloud conversion services, often losing layer trees, masks, blending modes, and color profiles along the way.

**Lumina** implements full PSD/PSB parsing, serialization, and image decoding completely from scratch with zero runtime engine dependencies. It writes production-grade layered PSDs compatible with Adobe Photoshop, Clip Studio Paint, and Affinity Photo, while providing a snappy, lightweight desktop and browser editing experience.

---

## Key Features

### 🎨 Layer Stack & Non-Destructive Adjustments
- **Full Adjustment Layers**: Real-time Curves, Levels, Brightness/Contrast, Exposure, Invert, Posterize, Hue/Saturation, Threshold, and Vibrance.
- **27 Linear Blend Modes**: Precise W3C and Photoshop-compliant linear light compositing (Normal, Multiply, Screen, Overlay, Color Dodge, Linear Light, Difference, Luminosity, etc.).
- **Vector & Raster Masks**: Embedded vector masks (`vmsk`) with bezier knot paths and raster layer masks.
- **Layer Styles (`lfx2` / legacy `lrFX`)**: Drop Shadow, Stroke (outer/inner/center), and Color Overlay.
- **Editable Text Layers**: Vector font rasterization with TrueType parser and live typography styling.
- **Tile-Based Engine**: 256×256 tiled sparse canvas with bidirectional Copy-on-Write (COW) memory sharing for instantaneous undo/redo and layer duplication.

### 🔬 Retouching & Professional Tools
- **Frequency Separation**: High/low texture separation with mathematically calibrated linear-space high-pass reconstruction.
- **Brush & Retouch Tools**: Soft & hard brushes, Clone Stamp, Healing Brush, Smudge with inertia, Dodge, Burn, Blur, Sharpen, and Flood Fill.
- **Selections**: Marching-ants animated rect selection, elliptical selection, polygonal lasso, and color-aware Magic Wand.
- **Color & Gradients**: Full HSL / HSV color picker, Linear / Radial gradients, and bundled Persian & international fonts.

### 🛡️ Secure & Sandboxed by Design
- **Memory Bomb Protection**: Strict safety bounds across PNG, JPEG, TIFF, and PSD codecs (32,768px maximum edge limit, 100-megapixel total allocation ceiling).
- **Hardened Local Server**: Path traversal prevention, dotfile restriction, loopback-only binding (`127.0.0.1`), and strict Content Security Policy (`CSP`).
- **Completely Offline**: Zero telemetry, zero external network requests.

---

## Supported Formats

| Format | Read | Write | Color Modes | Bit Depths | Compression Schemes |
|---|:---:|:---:|---|---|---|
| **PSD / PSB** | ✅ | ✅ | RGB, CMYK, Grayscale, Bitmap, Indexed, Lab, Duotone | 8-bit, 16-bit, 32-bit | RAW, PackBits (RLE), ZIP, ZIP+Prediction |
| **PNG** | ✅ | ✅ | RGBA, RGB, Grayscale, Indexed | 8-bit, 16-bit | Deflate (zlib) with ICC embedding |
| **JPEG** | ✅ | ✅ | RGB, Grayscale, YCbCr | 8-bit | Baseline DCT, JFIF, EXIF |
| **TIFF / DNG** | ✅ | ✅ | RGB, RGBA, Grayscale, CMYK | 8-bit, 16-bit | Uncompressed, LZW (dynamic buffer), PackBits, ZIP |
| **WebP** | ✅ | ✅ | RGBA, RGB | 8-bit | Lossless & VP8 |
| **BMP** | ✅ | ✅ | RGB, RGBA, 24-bit, 32-bit | 8-bit | Uncompressed, Bitfields |
| **QOI** | ✅ | ✅ | RGB, RGBA | 8-bit | Quite OK Image format |

---

## Quick Start

### 🌐 Run in Browser (Local Static Server)

```bash
# Clone the repository
git clone https://github.com/ZALPRO/lumina.git
cd lumina

# Install dependencies
npm install

# Start the secure local server (binds to http://127.0.0.1:4173)
npm run web
```

### 🖥️ Run Desktop App (Electron)

```bash
npm start
```

---

## Installation & Setup

### Prebuilt Binaries

Ready-to-use binaries are available on the [GitHub Releases](https://github.com/ZALPRO/lumina/releases) page:

- **macOS**: `Lumina-1.0.0-mac-arm64.dmg` (Apple Silicon) / `Lumina-1.0.0-mac-x64.dmg` (Intel)
- **Linux**: `Lumina-1.0.0-linux-x86_64.AppImage` (Universal) or `.deb` (Debian/Ubuntu)
- **Windows**: `Lumina-Setup-1.0.0-win-x64.exe` (NSIS Installer) or `-portable.exe`

### Building from Source

Ensure you have **Node.js 20+** installed.

#### macOS
```bash
git clone https://github.com/ZALPRO/lumina.git
cd lumina
npm install
npm run dist:mac       # Generates DMG and ZIP in release/
```
*Note: If launching an unsigned build for the first time, right-click the app in Finder and choose **Open**.*

#### Linux (Debian, Ubuntu, Fedora, Arch)
```bash
# Ubuntu / Debian system prerequisites for headless test & electron:
sudo apt update && sudo apt install -y libnspr4 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libgbm1 libasound2

git clone https://github.com/ZALPRO/lumina.git
cd lumina
npm install
npm run dist:linux     # Generates AppImage, .deb, and tar.gz in release/
```

#### Windows
```powershell
# In PowerShell:
git clone https://github.com/ZALPRO/lumina.git
cd lumina
npm install
npm run dist:win       # Generates NSIS installer and portable EXE in release/
```

---

## Verification & Testing

Lumina maintains an extensive verification suite tested against **real Photoshop files** and verified independently using Python's `psd-tools` 1.19 and `LittleCMS` (LCMS):

```bash
# Run the complete test suite (274 unit and browser E2E tests)
npm test

# Run unit tests only
npm run test:unit

# Run headless browser E2E tests
npm run test:browser

# Generate an advanced layered PSD and verify against independent python psd-tools
npm run verify:psd

# Verify against curated Photoshop reference corpus
npm run verify:corpus
```

### Test Results

- **Automated Tests**: 274 total tests passing (272 passed, 2 skipped, 0 failed).
- **Corpus Verification**: 253 / 254 real-world Photoshop files bit-for-bit matched (1 file excluded as Multichannel without standard RGB color mapping).
- **Color Profiles**: ICC identity round-trip verified against LittleCMS (`mean delta = 0.0014`).
- **Layered Round-Trip**: Multi-layer PSD files exported by Lumina decompress and composite identically in Adobe Photoshop and `psd-tools`.

<div align="center">
<br>
<img src="docs/screenshots/sample-artwork.png" alt="Sample Artwork Output" width="620">
<p><em>Procedural artwork generated and exported as a layered PSD (<code>npm run sample</code>).</em></p>
</div>

---

## Architecture

Lumina is cleanly split into modular ES6 modules with no external runtime bundle:

```text
lumina/
├── cli/              # Headless CLI utilities & conversion scripts
├── docs/             # Technical deep-dive documentation (PSD, Architecture, Verification)
├── electron/         # Desktop application shell & sandboxed window management
├── scripts/          # Development server, test runner, benchmark utilities
├── src/
│   ├── document/     # Document model, Layer hierarchy, History, COW Tiled Paint
│   ├── engine/       # Blend modes (Linear RGB), Adjustments, Filters, FX, Inpainting
│   ├── formats/      # Codecs: PSD (read/write), ICC, PNG, JPEG, TIFF, WebP, BMP, QOI
│   ├── text/         # Typography specification and TrueType rasterizer
│   └── tools/        # Brush engine, Retouching, Selections, Flood Fill
├── tools/            # Python & node verification harnesses
└── ui/               # Modular UI, SVG icon system, responsive layouts, CSS variables
```

For more details, see:
- [Architecture Deep Dive](docs/ARCHITECTURE.md)
- [PSD Format Specifications & Notes](docs/PSD.md)
- [Verification Methodology](docs/VERIFICATION.md)
- [Installation Guide](docs/INSTALL.md)

---

## Contributing

Contributions, bug reports, and suggestions are welcome!
Please see [CONTRIBUTING.md](CONTRIBUTING.md) before submitting pull requests.

1. Fork the repository
2. Create your branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Verify tests pass (`npm test`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

---

## License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.

*Disclaimer: Adobe and Adobe Photoshop are registered trademarks of Adobe Systems Inc. Lumina is an independent open-source project and is not affiliated with or endorsed by Adobe.*
