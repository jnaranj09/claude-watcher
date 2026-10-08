"""Renders liquid-glass's wallpapers. Run from the theme dir. Three modes:

    python3 src/wallpapers.py --photos
    python3 src/wallpapers.py --convert
    python3 src/wallpapers.py <mohammed-kareem-vI2xy3k5QKE-unsplash.jpg> <pexels-splitshire-1526.jpg>

--photos (spec 2026-10-08): Lake, Bridge and Subway, with the canvas recipe (canvas-capture.md
"08 Ground"): cover-crop to 1600x1000, Gaussian blur 10, keep 15% brightness, then a triangular
dither (+-1 level, the ground.py dither the canvas ground was rendered with) BEFORE rounding to
8 bits. Fetch each original once into src/ (the .jpg files are git-ignored, not committed):

    curl -sL -o src/<id>.jpg "https://images.unsplash.com/<id>?fm=jpg&q=90&w=2400"

--convert: Graphite (ground.png, from src/ground.py), Aurora and Warm smoke are converted
LOSSLESSLY from their PNGs to WebP: pixel-identical, the dither kept. Regenerating Graphite = run
ground.py, then --convert.

The positional mode is the 2026-09-24 recipe that made aurora.png and smoke.png from the original
photos (resized to 1600px wide, darkened to 20% brightness; Aurora keeps 33% and 50% of its
saturation, 2026-09-25: at 20% it read too dark and its colours too intense). Run --convert after.

Every wallpaper ships as LOSSLESS WebP, never JPEG and never lossy WebP. The first cut was JPEG q90
and showed both faults the dither exists to prevent (measured 2026-09-24): JPEG smoothed the dither
away inside each 8x8 block (neighbour difference 0.02 levels vs 0.36 in ground.png), so Warm smoke
banded, and left steps on the block edges (0.15), which the glass's saturate(175%) turned into
Aurora's blocky colour noise. Lossless keeps the dither. WebP rather than PNG because all six
listed wallpapers count toward the theme's 5 MB asset cap and six PNGs (~1.06 MB each) do not fit.

Credits: WALLPAPERS-LICENSE.md. Lake, Bridge, Subway: Unsplash ids in PHOTOS below.
"""
import sys

import numpy as np
from PIL import Image, ImageFilter, ImageOps

# The Unsplash original is ~172 MP, past Pillow's bomb warning; these are trusted local files.
Image.MAX_IMAGE_PIXELS = None

WIDTH = 1600
# (output, brightness kept, saturation kept) — in argv order.
OUT = [("aurora.png", 0.33, 0.5), ("smoke.png", 0.2, 1.0)]
LUMA = [0.2126, 0.7152, 0.0722]

PHOTO_RECIPE = dict(width=1600, height=1000, blur=10, keep=0.15)  # canvas-capture.md "08 Ground"
# (output, Unsplash photo id) — fetched by the caller to src/<id>.jpg.
PHOTOS = [
    ("lake.webp", "photo-1779808241016-c893e448234c"),
    ("bridge.webp", "photo-1531512649811-01a8c802172f"),
    ("subway.webp", "photo-1710693792037-4322234b7f45"),
]
# (committed PNG, lossless WebP)
CONVERT = [("ground.png", "graphite.webp"), ("aurora.png", "aurora.webp"), ("smoke.png", "smoke.webp")]


def save_webp(img: Image.Image, dst: str) -> None:
    img.save(dst, "WEBP", lossless=True, method=6, quality=100)


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


def photo(src: str, dst: str, seed: int) -> None:
    img = Image.open(src).convert("RGB")
    size = (PHOTO_RECIPE["width"], PHOTO_RECIPE["height"])
    img = ImageOps.fit(img, size, Image.Resampling.LANCZOS)
    img = img.filter(ImageFilter.GaussianBlur(PHOTO_RECIPE["blur"]))
    a = np.asarray(img, dtype=np.float64) * PHOTO_RECIPE["keep"]
    rng = np.random.default_rng(seed)
    a += rng.random(a.shape) - rng.random(a.shape)  # triangular, like ground.py
    save_webp(Image.fromarray(np.clip(np.round(a), 0, 255).astype(np.uint8), "RGB"), dst)


def convert(src: str, dst: str) -> None:
    img = Image.open(src).convert("RGB")
    save_webp(img, dst)
    back = np.asarray(Image.open(dst).convert("RGB"))
    if not np.array_equal(back, np.asarray(img)):
        sys.exit(f"{dst}: not pixel-identical to {src}")


if __name__ == "__main__":
    if sys.argv[1:] == ["--photos"]:
        for i, (dst, pid) in enumerate(PHOTOS):
            photo(f"src/{pid}.jpg", dst, 20261008 + i)
    elif sys.argv[1:] == ["--convert"]:
        for src, dst in CONVERT:
            convert(src, dst)
    elif len(sys.argv) == 3:
        for i, (src, (dst, keep, sat)) in enumerate(zip(sys.argv[1:], OUT)):
            render(src, dst, keep, sat, 20260924 + i)
    else:
        sys.exit(__doc__)
