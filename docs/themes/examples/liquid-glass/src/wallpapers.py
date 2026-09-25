"""Renders liquid-glass's photo wallpapers. Run from the theme dir:

    python3 src/wallpapers.py <mohammed-kareem-vI2xy3k5QKE-unsplash.jpg> <pexels-splitshire-1526.jpg>

Each photo is resized to 1600px wide (ground.png's width) and darkened to 20% brightness (the
operator's 80% darken, 2026-09-24), in float, then given a triangular dither (±1 level) BEFORE
rounding to 8 bits — the ground.py recipe: at 20% brightness a smooth gradient has ~40 codes left
and bands without it. Aurora is the exception (2026-09-25): at 20% it read too dark and its colours
too intense, so it keeps 33% brightness and 50% of its saturation (mixed toward its own luma,
before the dither). The glass's saturate(175%) boosts whatever colour is left, so less is more.

The output is PNG, never JPEG. The first cut was JPEG q90 and showed both faults the dither exists
to prevent (measured 2026-09-24): JPEG smoothed the dither away inside each 8x8 block (neighbour
difference 0.02 levels vs 0.36 in ground.png), so Warm smoke banded, and left steps on the block
edges (0.15), which the glass's saturate(175%) turned into Aurora's blocky colour noise. Lossless
keeps the dither: ~1.06 MB each, 3.2 MB for all three wallpapers, under the 5 MB theme cap.

Credits: Aurora gradient — Mohammed Kareem (Unsplash). Warm smoke — SplitShire (Pexels).
"""
import sys

import numpy as np
from PIL import Image

# The Unsplash original is ~172 MP, past Pillow's bomb warning; these are trusted local files.
Image.MAX_IMAGE_PIXELS = None

WIDTH = 1600
# (output, brightness kept, saturation kept) — in argv order.
OUT = [("aurora.png", 0.33, 0.5), ("smoke.png", 0.2, 1.0)]
LUMA = [0.2126, 0.7152, 0.0722]


def render(src: str, dst: str, keep: float, sat: float, seed: int) -> None:
    img = Image.open(src).convert("RGB")
    h = round(img.height * WIDTH / img.width)
    img = img.resize((WIDTH, h), Image.Resampling.LANCZOS)
    a = np.asarray(img, dtype=np.float64) * keep
    luma = (a @ LUMA)[..., None]
    a = luma + (a - luma) * sat
    rng = np.random.default_rng(seed)
    a += rng.random(a.shape) - rng.random(a.shape)  # triangular, like ground.py
    Image.fromarray(np.clip(np.round(a), 0, 255).astype(np.uint8), "RGB").save(dst, optimize=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    for i, (src, (dst, keep, sat)) in enumerate(zip(sys.argv[1:], OUT)):
        render(src, dst, keep, sat, 20260924 + i)
