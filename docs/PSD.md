# PSD notes — the parts that bite

Practical notes from implementing the format, in the order they tend to be
discovered. Everything here was validated against real Photoshop documents
(see [VERIFICATION.md](VERIFICATION.md)).

## Document layout

```
8BPS | version(2) | reserved(6) | channels(2) | height(4) | width(4) | depth(2) | colourMode(2)
4 bytes  colour-mode data length + data
4 bytes  image-resources length + blocks        ← ICC profile lives here (resource 1039)
4 bytes  layer & mask length + data             ← layer records, then channel data
2 bytes  compression | merged image data
```

Two rules that are easy to get wrong:

1. **The merged image starts after the *whole* Layer & Mask section.** Not after
   the layer-info block. Photoshop can insert extra data in between (a global
   mask, for example — 852 bytes in one of the test files), and reading from the
   wrong offset silently corrupts the last rows.
2. **A Layer & Mask length of 0 means a flat file.** No layer records exist; a
   reader that assumes at least a layer-info block will walk off the buffer.

## Channel data

Each layer channel is `u16 compression` followed by payload. Per-channel
compression is allowed to differ from the document's; always read it per channel.

| Compression | Id | Notes |
|---|---|---|
| RAW | 0 | planar, no padding |
| RLE | 1 | PackBits, preceded by `height` u16 row lengths **per channel** |
| ZIP | 2 | one zlib stream per channel |
| ZIP + prediction | 3 | zlib stream whose rows are delta-encoded, then byte-shuffled for 16/32-bit |

For ZIP channels the payload is unzipped, then (for compression 3) the
byte-shuffle is undone and the row deltas are reversed. Skipping the shuffle is
the classic bug that makes 16-bit images look like noise.

```js
if (comp === 3 && depth === 32) src = unshuffle32(src, planeLen * channels);
if (comp === 3) src = applyPredictorDecode(src, rowBytes, rows);
```

## Bit depth

Lumina normalises everything to 8-bit internally:

- 16-bit: take the **high byte** of each big-endian sample.
- 32-bit: read the big-endian `float32` (0…1) and map through
  `round(255 × clamp(v, 0, 1))`.

## CMYK polarity

Photoshop stores **inverted** CMYK in PSD and JPEG: byte value `255 − ink`.

Proof (`cmyk-gray-ramp.psd`): the raw K plane runs 25 → 255 while the embedded
preview thumbnail runs black → white. So a file that shows white at the right
edge stores 255 there.

Reading:

```js
const c = 255 - planes[0][i];   // ink 0…255
const k = 255 - planes[3][i];
r = round((255 - c) * (255 - k) / 255);
```

Writing applies the same inversion. Getting this backwards produces a
photographic negative, which is exactly how the bug looked before it was fixed.

## Colour modes and the extra channel

The merged image stores the base channels of the colour mode first, then the
transparency channel, then any spot/extra channels:

| Mode | Base channels | Alpha (if present) |
|---|---|---|
| RGB (3) | R, G, B | channel 3 |
| Grayscale (1), Bitmap (0), Indexed (2), Duotone (8) | 1 | channel 1 |
| CMYK (4) | C, M, Y, K | channel 4 |
| Lab (9) | L, a, b | channel 3 |

Reading the alpha from the wrong index (or ignoring it) makes transparent
regions render as opaque — that was a real bug found by scanning `gray0.psd`,
`gray-blend-modes.psd` and `cmyk-blend-modes.psd`.

Mode-specific notes:

- **Bitmap (0)** — one bit per sample, packed 8 pixels per byte, `1 = black`,
  `0 = white`; row length is `ceil(width / 8)`.
- **Indexed (2)** — the 768-byte RGB palette lives in the colour-mode-data block
  at the top of the file, not next to the pixels.
- **Lab (9)** — 8-bit samples: `L = byte × 100/255`, `a = byte − 128`,
  `b = byte − 128`. Convert D50 → D65 with the Bradford matrix before sRGB.
- **Duotone (8)** — single channel; Lumina renders it as grayscale.

## Tagged blocks worth knowing

| Key | Meaning | Notes |
|---|---|---|
| `luni` | layer name (UTF-16BE) | fall back to the Pascal name for old files |
| `lsct` | section divider (group start/end, clipping) | Lumina keeps groups as marker pairs |
| `lfx2` / `lrFX` | layer effects descriptor / legacy list | drop shadow, stroke, colour overlay |
| `vmsk` / `vsms` | vector mask (bezier path) | mask must be rasterised for compositing |
| `TySh` | type layer | text is preserved for editing |
| `Crv ` | Curves (version 1) | **needs the space in the key**; v4 files use `'Curv'` |
| `SoLd` / `PlLd` | smart object | flattened to a pixel layer |
| `vibA` | Vibrance | |

Adjustment layers store their parameters as object descriptors; `psd-descriptor.js`
implements the reader and writer for that mini-format (including
`Objc`/`VlLs`/`UntF`/`doub`/`long` typed values).

## ICC profile

Resource `1039` holds the profile. A correct sRGB profile needs:

- `wtpt` at **D50** (0.9642, 1.0, 0.8249), not D65,
- a `chad` matrix (Bradford adaptation),
- `chrm` chromaticities,
- a parametric (`para`, type 3) or sampled (`curv`) transfer function.

Omitting the adaptation — writing D65 primaries directly — shifts colours by up
to 9 levels in colour-managed readers, while looking perfect in readers that
ignore profiles.

## Writing files Photoshop will open

Checklist used by `psd-layers.js`:

- 4-byte section lengths are big-endian and exact.
- Layer records are padded to a multiple of 4 (layer info block and section).
- Channel ids: 0=R, 1=G, 2=B, −1=alpha, −2=user mask; CMYK uses 0=C, 1=M, 2=Y, 3=K.
- The merged image must match the layer stack, or Photoshop shows the "the file
  is open in another application / needs to be maximised" repair prompt.
- Emit an ICC profile, so colours survive.

## Verifying your own writer

Never validate a PSD writer with its own reader. Cross-check with an independent
implementation and compare the **raw planes**:

```python
from psd_tools import PSDImage
psd = PSDImage.open('out.psd')
hdr = psd._record.header
planes = psd._record.image_data.get_data(hdr, split=True)   # ground truth
```

`psd.composite()` and `psd.numpy()` are convenient but apply white-background
removal, so they are not a valid pixel reference.
