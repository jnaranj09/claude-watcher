"""Drive-run PNG analysis for the glass checks (tests/drive/glassCheck.mjs). Python 3 + Pillow.

  align <dir> <top> <cardX> <cardW> <nameX> <nameW>  each card body paired with the first text inside
                                               it; share of pairs at the common offset
  region <png> <x> <y> <w> <h>                 rim rows (row-mean jumps > 12 levels) inside the box
  lum <png> <x> <y> <w> <h> <x2> <y2> <w2> <h2> mean luminance of two boxes and their difference
  contrast <png> <x> <y> <w> <h> <r> <g> <b> <a>  WCAG ratio: computed ink at alpha a over the median ground
"""
import glob
import json
import sys

from PIL import Image


def lum_rows(im, x0, x1):
    g = im.convert("L")
    w, h = g.size
    px = g.load()
    return [sum(px[x, y] for x in range(max(0, x0), min(w, x1))) / max(1, min(w, x1) - max(0, x0)) for y in range(h)]


def rim_rows(rows, jump=12):
    return [y for y in range(1, len(rows)) if rows[y] - rows[y - 1] > jump]


def text_starts(im, x0, x1, delta=60, min_px=3, max_share=0.6):
    # Relative threshold: calm cards render at opacity 0.82, so their ink is ~180, not white.
    # A glass rim lights the WHOLE row; text lights scattered pixels — rows over max_share are rims.
    g = im.convert("L")
    w, h = g.size
    px = g.load()
    xs = range(max(0, x0), min(w, x1))
    ground = sorted(px[x, y] for y in range(0, h, 4) for x in xs)[len(xs) * h // 8]  # median-ish

    def is_text(y):
        n = sum(1 for x in xs if px[x, y] > ground + delta)
        return min_px <= n <= max_share * len(xs)

    hits = [is_text(y) for y in range(h)]
    return [y for y in range(1, h) if hits[y] and not hits[y - 1]]


def bodies(rows, y0, min_h=30):
    """Card bodies: runs of rows brighter than the gap/card midpoint (10th and 60th percentile)."""
    seg = sorted(rows[y0:])
    th = (seg[len(seg) // 10] + seg[len(seg) * 6 // 10]) / 2
    out, start = [], None
    for y in range(y0, len(rows)):
        inside = rows[y] > th
        if inside and start is None:
            start = y
        if not inside and start is not None:
            if y - start > min_h:
                out.append((start, y))
            start = None
    return out


def align(d, top, cx, cw, nx, nw):
    """Each card body (detected in a text-free strip) paired with the first text row inside it. If
    the glass lags the DOM, that distance changes with the scroll step (18 px per wheel tick);
    aligned, it is the same in every frame. `top` = the scroll area's top (bodies touching it are
    clipped and skipped). Reports the share of pairs within ±1 px of the most common offset."""
    offsets = []
    for f in sorted(glob.glob(f"{d}/*.png")):
        im = Image.open(f)
        rows = lum_rows(im, int(cx + 0.55 * cw), int(cx + 0.8 * cw))
        texts = text_starts(im, int(nx), int(nx + nw))
        for a, b in bodies(rows, int(top)):
            # +3: the body's own top rim can read as a text row; a card's padding is >= 8 px.
            inside = [t for t in texts if a + 3 <= t < b]
            if inside and a > top + 3:
                offsets.append(inside[0] - a)
    if not offsets:
        return {"pairs": 0, "mode": None, "aligned": 0.0}
    mode = max(set(offsets), key=offsets.count)
    aligned = sum(1 for o in offsets if abs(o - mode) <= 1) / len(offsets)
    return {"pairs": len(offsets), "mode": mode, "aligned": aligned}


def lin(c):
    s = c / 255
    return s / 12.92 if s <= 0.03928 else ((s + 0.055) / 1.055) ** 2.4


def L(rgb):
    return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2])


def main(a):
    cmd = a[0]
    if cmd == "align":
        print(json.dumps(align(a[1], *map(float, a[2:7]))))
    elif cmd == "region":
        x, y, w, h = map(int, map(float, a[2:6]))
        rows = lum_rows(Image.open(a[1]), x, x + w)[y:y + h]
        print(json.dumps({"rims": [y + r for r in rim_rows(rows)]}))
    elif cmd == "lum":
        im = Image.open(a[1]).convert("L")
        def mean(b):
            x, y, w, h = map(int, map(float, b))
            crop = im.crop((x, y, x + w, y + h))
            vals = [crop.getpixel((i, j)) for j in range(crop.height) for i in range(crop.width)]
            return sum(vals) / len(vals)
        m1, m2 = mean(a[2:6]), mean(a[6:10])
        print(json.dumps({"a": m1, "b": m2, "diff": abs(m1 - m2)}))
    elif cmd == "contrast":
        # Ground = the median pixel behind the text (the real glass); ink = the computed text colour
        # (r g b, 0-255) at its effective alpha, composited over that ground. Pixel-sampling glyphs
        # under-reads thin anti-aliased text at 1x, so the ink is never taken from the screenshot.
        x, y, w, h = map(int, map(float, a[2:6]))
        r, g, b, alpha = map(float, a[6:10])
        crop = Image.open(a[1]).convert("RGB").crop((x, y, x + w, y + h))
        px = sorted((crop.getpixel((i, j)) for j in range(crop.height) for i in range(crop.width)), key=L)
        ground = px[len(px) // 2]
        ink = [alpha * c + (1 - alpha) * gc for c, gc in zip((r, g, b), ground)]
        hi, lo = max(L(ink), L(ground)), min(L(ink), L(ground))
        print(json.dumps({"ground": ground, "ratio": (hi + 0.05) / (lo + 0.05)}))

if __name__ == "__main__":
    main(sys.argv[1:])
