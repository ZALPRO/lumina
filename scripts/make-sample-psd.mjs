// scripts/make-sample-psd.mjs — build the neutral demo PSD shown in the README
//
// Takes the RGBA layer PNGs produced by scripts/make-sample-artwork.py and writes
// docs/screenshots/sample-layered.psd (RLE) and sample-layered-zip.psd
// (ZIP + prediction) using the Lumina encoder itself. Run the python script first:
//
//   python3 scripts/make-sample-artwork.py
//   node scripts/make-sample-psd.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Document } from '../src/document/document.js';
import { Paint } from '../src/document/paint.js';
import { Layer } from '../src/document/layer.js';
import { encodeLayeredPSD } from '../src/formats/psd-layers.js';
import { decodeImage } from '../src/formats/imageio.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(ROOT, 'docs', 'screenshots');
const LAYER_DIR = path.join(SHOTS, 'sample-layers');

const names = ['01-background', '02-card', '03-triangle', '04-ellipse'];
const files = names.map((n) => path.join(LAYER_DIR, `${n}.png`));
for (const f of files) {
  if (!fs.existsSync(f)) {
    console.error(`missing ${path.relative(ROOT, f)} — run: python3 scripts/make-sample-artwork.py`);
    process.exit(1);
  }
}

const first = await decodeImage(new Uint8Array(fs.readFileSync(files[0])));
const W = first.width, H = first.height;
const doc = new Document({ width: W, height: H, name: 'SampleArtwork' });

const pretty = { '01-background': 'Background', '02-card': 'Card', '03-triangle': 'Triangle', '04-ellipse': 'Ellipse + swatches' };
for (const f of files) {
  const dec = await decodeImage(new Uint8Array(fs.readFileSync(f)));
  const paint = new Paint(W, H);
  paint.writeFromRGBA(dec.data, W, H);
  doc.addLayer(new Layer({ name: pretty[path.basename(f, '.png')], paint }));
}

// Flattened composite for the merged-image channel of the layered files.
// We use the exported flat artwork as ground truth so that the PSD preview is
// pixel-identical to sample-artwork.png (the layers themselves are independent).
const flatDec = await decodeImage(new Uint8Array(fs.readFileSync(path.join(SHOTS, 'sample-artwork.png'))));
const rgba = flatDec.data;
if (flatDec.width !== W || flatDec.height !== H) throw new Error('flat artwork size mismatch');

const rle = await encodeLayeredPSD(doc, { composite: rgba, compression: 'rle' });
const zip = await encodeLayeredPSD(doc, { composite: rgba, compression: 'zipPred' });
fs.writeFileSync(path.join(SHOTS, 'sample-layered.psd'), Buffer.from(rle));
fs.writeFileSync(path.join(SHOTS, 'sample-layered-zip.psd'), Buffer.from(zip));
console.log(`sample-layered.psd      ${W}x${H}, ${doc.layers.length} layers, ${(rle.length / 1024).toFixed(0)} KB (RLE)`);
console.log(`sample-layered-zip.psd  ${W}x${H}, ${doc.layers.length} layers, ${(zip.length / 1024).toFixed(0)} KB (ZIP+prediction)`);
