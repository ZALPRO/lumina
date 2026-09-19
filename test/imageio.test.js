import test from 'node:test';
import assert from 'node:assert/strict';
import { detectFormat, decodeImage, encodeImage, formatFromName } from '../src/formats/imageio.js';
import { encodePng } from '../src/formats/png.js';

function img(w, h) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = (i * 7) & 255; d[i * 4 + 1] = (i * 13) & 255; d[i * 4 + 2] = (i * 23) & 255; d[i * 4 + 3] = 255;
  }
  return d;
}

test('detectFormat: امضای PNG/BMP/QOI/PSD و null', async () => {
  const png = await encodePng({ width: 2, height: 2, data: img(2, 2) });
  assert.equal(detectFormat(png), 'png');
  assert.equal(detectFormat(new Uint8Array([0x42, 0x4D, 0, 0, 0, 0, 0, 0])), 'bmp');
  assert.equal(detectFormat(new Uint8Array([0x71, 0x6F, 0x69, 0x66, 0, 0, 0, 0])), 'qoi');
  assert.equal(detectFormat(new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, 0, 0, 0])), 'psd');
  assert.equal(detectFormat(new Uint8Array([0x38, 0x42, 0x50, 0x53, 0, 2, 0, 0])), 'psb');
  assert.equal(detectFormat(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])), null);
});

test('decodeImage: PNG و QOI و BMP و PSD (با تشخیص خودکار)', async () => {
  const w = 11, h = 9;
  const src = img(w, h);
  for (const fmt of ['png', 'qoi', 'bmp', 'psd']) {
    const enc = await encodeImage({ width: w, height: h, data: src }, fmt);
    const dec = await decodeImage(enc);
    assert.equal(dec.width, w); assert.equal(dec.height, h);
    for (let i = 0; i < w * h * 4; i++) assert.equal(dec.data[i], src[i], `${fmt} px ${i}`);
  }
});

test('decodeImage: فرمت ناشناس خطا می‌دهد', async () => {
  await assert.rejects(() => decodeImage(new Uint8Array(40).fill(9)), /فرمت/);
});

test('formatFromName: پسوند و پیش‌فرض', () => {
  assert.equal(formatFromName('a.PNG'), 'png');
  assert.equal(formatFromName('a.qoi'), 'qoi');
  assert.equal(formatFromName('a.bmp'), 'bmp');
  assert.equal(formatFromName('a.psd'), 'psd');
  assert.equal(formatFromName('بدون پسوند'), 'png');
});
