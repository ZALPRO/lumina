#!/usr/bin/env python3
"""Generate the neutral demo artwork used by the README screenshots and by the
layered-PSD sample.

Outputs (docs/screenshots/):
  sample-artwork.png      flat 1200x675 artwork
  sample-layers/01-background.png ... 04-ellipse.png   separate RGBA layers

Everything here is procedurally drawn shapes and gradients: no third-party
imagery, so the files are safe to ship in a public repository.
"""
import os, random
from PIL import Image, ImageDraw, ImageFilter

W, H = 1200, 675
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "docs", "screenshots"))
LAYERS = os.path.join(OUT, "sample-layers")
os.makedirs(LAYERS, exist_ok=True)


def gradient():
    im = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(im)
    for y in range(H):
        t = y / H
        d.line([(0, y), (W, y)], fill=(int(18 + 60 * t), int(24 + 30 * t), int(48 + 20 * t)))
    return im


def halos(base):
    im = base.convert("RGB")
    for cx, cy, rad, col in ((300, 220, 320, (90, 140, 255)),
                             (920, 430, 380, (255, 120, 90)),
                             (600, 560, 300, (60, 220, 190))):
        halo = Image.new("RGB", (W, H), (0, 0, 0))
        hd = ImageDraw.Draw(halo)
        hd.ellipse([cx - rad, cy - rad, cx + rad, cy + rad], fill=col)
        halo = halo.filter(ImageFilter.GaussianBlur(110))
        mask = halo.convert("L").point(lambda v: 255 if v > 6 else 0)
        im = Image.composite(Image.blend(im, halo, 0.55), im, mask)
    return im


def background_rgba():
    return halos(gradient()).convert("RGBA")


def card_rgba():
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.rounded_rectangle([70, 70, 470, 330], radius=28, outline=(235, 240, 255, 255),
                        width=6, fill=(30, 38, 70, 235))
    return layer


def triangle_rgba():
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.polygon([(560, 330), (660, 150), (760, 330)], fill=(255, 196, 64, 255))
    return layer


def ellipse_rgba():
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse([840, 120, 1160, 340], outline=(120, 255, 220, 255), width=8, fill=(12, 26, 34, 230))
    random.seed(7)
    for i in range(1, 7):
        for j in range(1, 4):
            x, y = 70 + i * 62, 370 + j * 40
            d.rectangle([x, y, x + 34, y + 16], fill=((200 * i) % 255, 90, 255 - 30 * j, 255))
    for i in range(12):
        x = 70 + i * 88
        d.rectangle([x, 530, x + 72, 600], fill=((i * 21) % 256, (i * 57) % 256, (i * 93) % 256, 255))
    return layer


def main():
    bg = background_rgba()
    parts = [("01-background", bg), ("02-card", card_rgba()),
             ("03-triangle", triangle_rgba()), ("04-ellipse", ellipse_rgba())]
    for name, layer in parts:
        layer.save(os.path.join(LAYERS, f"{name}.png"))
    flat = bg.copy()
    for _, layer in parts[1:]:
        flat = Image.alpha_composite(flat, layer)
    flat.convert("RGB").save(os.path.join(OUT, "sample-artwork.png"))
    print("wrote", os.path.join(OUT, "sample-artwork.png"), "+", len(parts), "layers")


if __name__ == "__main__":
    main()
