"""Renders liquid-glass's photo wallpapers. Run from the theme dir:

    python3 src/wallpapers.py <mohammed-kareem-vI2xy3k5QKE-unsplash.jpg> <pexels-splitshire-1526.jpg>

Each photo is resized to 1920px wide and darkened to 20% brightness (the operator's 80% darken,
2026-09-24), in float, then dithered BEFORE rounding to 8 bits — the same reason ground.py
dithers: at 20% brightness a smooth gradient has few codes left and would band.

Credits: Aurora gradient — Mohammed Kareem (Unsplash). Warm smoke — SplitShire (Pexels).
"""
import sys

import numpy as np
from PIL import Image

# The Unsplash original is ~172 MP, past Pillow's bomb warning; these are trusted local files.
Image.MAX_IMAGE_PIXELS = None

WIDTH = 1920
KEEP = 0.2  # 80% darker
OUT = ["aurora.jpg", "smoke.jpg"]


def render(src: str, dst: str) -> None:
    img = Image.open(src).convert("RGB")
    h = round(img.height * WIDTH / img.width)
    img = img.resize((WIDTH, h), Image.Resampling.LANCZOS)
    a = np.asarray(img, dtype=np.float64) * KEEP
    rng = np.random.default_rng(7)
    a += rng.uniform(-0.5, 0.5, a.shape)
    Image.fromarray(np.clip(np.rint(a), 0, 255).astype(np.uint8)).save(dst, quality=90)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    for src, dst in zip(sys.argv[1:], OUT):
        render(src, dst)
