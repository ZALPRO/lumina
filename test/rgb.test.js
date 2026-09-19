import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hexToRgb, rgbToHex, rgbToHsl, hslToRgb, rgbToHsv, lerpColorU8,
} from '../src/engine/rgb.js';

test('hexToRgb', () => {
  assert.deepEqual(hexToRgb('#ff0000'), [255, 0, 0]);
  assert.deepEqual(hexToRgb('00FF00'), [0, 255, 0]);
  assert.deepEqual(hexToRgb('#fff'), [255, 255, 255]);
  assert.equal(hexToRgb('نادرست'), null);
});

test('rgbToHex', () => {
  assert.equal(rgbToHex(255, 0, 0), '#ff0000');
  assert.equal(rgbToHex(0, 255, 128), '#00ff80');
});

test('rgbToHsl: قرمز = (0,1,0.5) ، خاکستری = (0,0,L)', () => {
  const [h, s, l] = rgbToHsl(255, 0, 0);
  assert.equal(h, 0);
  assert.ok(Math.abs(s - 1) < 1e-9);
  assert.ok(Math.abs(l - 0.5) < 1e-9);
  const [hg, sg, lg] = rgbToHsl(128, 128, 128);
  assert.equal(hg, 0); assert.equal(sg, 0);
  assert.ok(Math.abs(lg - 128 / 255) < 1e-9);
});

test('hslToRgb: دور کامل', () => {
  for (const [r, g, b] of [[255, 0, 0], [0, 255, 0], [12, 200, 90], [250, 240, 230]]) {
    const [h, s, l] = rgbToHsl(r, g, b);
    const [r2, g2, b2] = hslToRgb(h, s, l);
    assert.ok(Math.abs(r - r2) <= 1, `R ${r}->${r2}`);
    assert.ok(Math.abs(g - g2) <= 1, `G ${g}->${g2}`);
    assert.ok(Math.abs(b - b2) <= 1, `B ${b}->${b2}`);
  }
});

test('rgbToHsv: مشکی = (0,0,0) ، سفید = (0,0,1)', () => {
  assert.deepEqual(rgbToHsv(0, 0, 0), [0, 0, 0]);
  const [, s, v] = rgbToHsv(255, 255, 255);
  assert.equal(s, 0); assert.equal(v, 1);
});

test('lerpColorU8: میانه، دو سر، و فضای خطی', () => {
  assert.deepEqual(lerpColorU8([0, 0, 0], [255, 255, 255], 0), [0, 0, 0]);
  assert.deepEqual(lerpColorU8([0, 0, 0], [255, 255, 255], 1), [255, 255, 255]);
  // میانه در فضای خطی ~188 (نه 127/128 گامای اشتباه)
  const [m] = lerpColorU8([0, 0, 0], [255, 255, 255], 0.5);
  assert.ok(Math.abs(m - 188) <= 2, `mid=${m}`);
});
