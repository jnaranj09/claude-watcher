"""Renders liquid-glass's ground (`ground.png`). Run: python3 src/ground.py (from the theme dir).

Why an image and not CSS gradients: at these very low alphas an rgba() pool's tail drops below
1/255, Chromium rounds it per channel, and every pool drew a visible ring (2026-09-23). Here the
colour is mixed in float and dithered BEFORE it is rounded to 8 bits, so there is no ring and no
banding. The image is stretched to the window (`100% 100%`), which is what the old vw/vh pools did.
"""
import numpy as np
from PIL import Image

W, H = 1600, 1000
# (radius x, radius y) as a fraction of W/H, centre as a fraction, colour, peak alpha.
# Listed bottom to top.
POOLS = [
    ((0.50, 0.44), (0.56, 0.96), (66, 78, 124), 0.072),   # slate, bottom
    ((0.50, 0.44), (0.72, 0.64), (44, 104, 92), 0.066),   # teal, right
    ((0.54, 0.48), (0.30, 0.66), (138, 72, 128), 0.072),  # pink, centre-left
]
# Eased falloff (position as a fraction of the radius, fraction of the peak alpha): smoothstep-shaped,
# it ends FLAT, so there is no edge where it stops. Gone by 0.82 of the radius (~25vh from the top).
EASE_POS = [0, 0.18, 0.32, 0.46, 0.58, 0.68, 0.76, 0.82]
EASE_VAL = [1, 0.92, 0.74, 0.5, 0.28, 0.12, 0.035, 0]

y, x = np.mgrid[0:H, 0:W].astype(np.float64)
# The base: linear-gradient(160deg, #0a0a0d, #0c0c10).
ang = np.deg2rad(160)
dx, dy = np.sin(ang), -np.cos(ang)
proj = (x - W / 2) * dx + (y - H / 2) * dy
half = abs(W / 2 * dx) + abs(H / 2 * dy)
t = ((proj / half) + 1) / 2
a, b = np.array([10, 10, 13.0]), np.array([12, 12, 16.0])
img = a + (b - a) * t[..., None]

for (rx, ry), (cx, cy), rgb, peak in POOLS:
    d = np.sqrt(((x - cx * W) / (rx * W)) ** 2 + ((y - cy * H) / (ry * H)) ** 2)
    alpha = np.interp(d, EASE_POS, EASE_VAL) * peak
    img = img * (1 - alpha[..., None]) + np.array(rgb, float) * alpha[..., None]

# Triangular dither (±1 level) before rounding to 8 bits.
rng = np.random.default_rng(20260923)
noise = rng.random(img.shape) - rng.random(img.shape)
out = np.clip(np.round(img + noise), 0, 255).astype(np.uint8)
Image.fromarray(out, 'RGB').save('ground.png', optimize=True)
