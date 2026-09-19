# Migration notes — what is actually verified

> Everything on this page was produced by running the commands in this
> repository. The reference implementation is always an **independent**
> tool — `psd-tools` 1.19 (Python) and Pillow — never Lumina's own decoder.

## The two rules that make the numbers trustworthy

1. **Compare pixels, not opinions.** A claim like "PSD support works" is replaced
   by a number: `30/30 real Photoshop files match, 0 differing pixels`.
2. **Never use the reference tool's convenience API blindly.**
   `PSDImage.composite()` and `.numpy()` in psd-tools remove the white
   background as a post-process, which silently corrupts a pixel reference.
   The correct reference is the raw plane data stored in the file:

   ```python
   planes = psd._record.image_data.get_data(psd._record.header, split=True)
   ```

   Compositing (CMYK inversion, channel interleaving, alpha handling) is then
   redone in Python from those planes. This single change flipped several
   "failures" into matches and exposed one genuine bug.

## 1. Real Photoshop corpus — 30 files, 0 differences

```bash
node tools/verify-corpus.mjs --download
```

```
نتیجه: 30 فایل مطابق مرجع مستقل، 0 فایل اختلاف.
```

Coverage of the corpus:

| Axis | Values |
|---|---|
| Colour modes | RGB, CMYK, Grayscale |
| Bit depths | 8, 16, 32 (float32) |
| Compression | RAW, RLE (PackBits), ZIP, ZIP + prediction |
| Document kind | flat files, layered files, nested compositions (up to 31 layers), clipping masks, global masks |
| Colour management | embedded ICC present / absent |

Files: `curves_{rgb,cmyk,grayscale}`, `levels_{rgb,cmyk,grayscale}`,
`invert_{cmyk,grayscale}`, `brightnesscontrast_{cmyk,grayscale,legacy_cmyk,legacy_grayscale}`,
`exposure_grayscale`, `posterize_16bits_cmyk`, `adjustment_nested_composition_1…5`,
`adjustment_clipping`, `adjustment-fillers`, `adjustment-mask`,
`adjustment_backdrop_test`, `16bit5x5`, `32bit`, `32bit5x5`, `cmyk-gray-ramp`,
`cmyk-spot`, `1layer`, `2layers`.

## 2. Our own output, re-read by independent tools

| Artifact | Pillow | psd-tools | Pixel result |
|---|---|---|---|
| `thumbnail-exact.png` | ✅ RGBA 900×506, 680-byte ICC | — | **0 / 455,400 pixels differ** from the source artwork |
| `thumbnail-render.psd` (flat) | ✅ | ✅ RGB, 0 layers | **0 pixels differ** |
| `thumbnail-layered.psd` (RLE) | ✅ | ✅ 6 layers | composite **0 / 455,400** |
| `thumbnail-layered-zip.psd` (ZIP+prediction) | ⚠️ Pillow cannot open ZIP PSD | ✅ 6 layers | composite **0 / 455,400** |
| `thumbnail-layered-cmyk.psd` (4 channels) | ⚠️ Pillow limitation | ✅ CMYK, 6 layers | composite **0 / 455,400** |
| `verify-layered.psd` (native Curves, vector mask, drop shadow, stroke, overlay, group, blend modes) | — | ✅ 8 layers | layers, masks and effects read back |

Per-layer channel planes were compared as well: for all six layers, in all three
files, the planes read by psd-tools equal the PNG layers Lumina wrote — zero
difference in RGB and alpha (considering visible pixels).

## 3. Automated tests

```
# tests 269   # pass 269   # fail 0
```

25 of them drive a real headless Chromium against the actual UI (brush strokes,
undo, colour panel, masks, effects, save round-trip, layer rename/reorder).

## 4. Bugs found by this process (and fixed)

Each of these was invisible to self-testing; every one was caught by an outside
tool on a real file.

1. **Merged-image offset.** The composite data must be read from the **end of the
   whole Layer & Mask section**, not the end of the layer-info block. In
   `adjustment_backdrop_test.psd` there are 852 bytes between the two, which
   corrupted the bottom rows of the preview.
2. **Flat documents crashed.** A Layer & Mask length of 0 (e.g. `cmyk-spot.psd`,
   640×637) walked past the buffer end. Guarded.
3. **The flat-PSD writer emitted a stray 4-byte field** before the compression
   marker, so Photoshop, Pillow and psd-tools all considered the file invalid
   (`20 is not a valid Compression`). The structure is now spec-conformant and
   carries an sRGB ICC profile.
4. **32-bit float documents** are now decoded (RAW/RLE/ZIP with byte-shuffle
   reversal), so `32bit.psd` and `32bit5x5.psd` open instead of being rejected.
5. **CMYK polarity.** Photoshop stores CMYK inverted (byte = 255 − ink) in PSD.
   Proven by comparing the raw planes of `cmyk-gray-ramp.psd` with its embedded
   preview thumbnail; both reader and writer follow it.
6. **ICC profile.** The first profile used a D65 white point and a gamma curve,
   which shifted colours by up to 9 levels in colour-managed readers. Replaced
   with a D50 white point, Bradford `chad` matrix and parametric type-3 curves —
   identity transform accuracy is now ≤1 level (mean 0.0014) against LCMS.
7. **Our own measurement method** (documented above): `composite()` is not a
   valid pixel reference.

## 5. Honest limitations

- Lab, Duotone and Multichannel documents are not decoded.
- Smart Objects (`SoLd`/`PlLd`) are flattened to pixel layers.
- Embedded **CMYK** ICC profiles are ignored on import (the standard CMYK→RGB
  formula is used instead).
- 32-bit files can be opened, but saving supports 8 and 16-bit only.
- Pillow cannot open ZIP-compressed PSDs at all (its own limitation).
- Rendering is CPU-only.
