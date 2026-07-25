#!/usr/bin/env python3
"""Write the two images that make-readme-hero-svg.mjs traces.

Two images: the region the ink encloses (bilevel, for the pale fill underneath)
and the art's own greyscale (continuous, for the posterizer to band into tones).
Tracing the enclosed region separately is what lets the fill be a shape rather
than pixels baked between the lines — the reason the vector hero has no fringe.

Both are written at the source's full resolution, not the downsampled size the
PNGs use: more input pixels give potrace more to fit its curves to.

Run:  python3 scripts/make-readme-hero-masks.py
"""

import os
import struct
import zlib
from collections import deque
from importlib import util

HERE = os.path.dirname(os.path.abspath(__file__))
spec = util.spec_from_file_location("sitelogo", os.path.join(HERE, "make-site-logo.py"))
sitelogo = util.module_from_spec(spec)
# Loading executes make-site-logo's own build, which just rewrites logo.png.
spec.loader.exec_module(sitelogo)

OUT = "/tmp/trace"
PASSABLE = 128  # alpha below this is a gap the flood fill can walk through

w, h, rgb = sitelogo.read_png_rgb(sitelogo.SRC)

# Same alpha as the PNG path, including the floor that drops the source's
# near-white background to a true zero, so the traced silhouette sits where the
# ink actually is rather than out in the noise.
span = 255 - sitelogo.FLOOR
alpha = bytearray(w * h)
for i in range(w * h):
    j = i * 3
    lum = (rgb[j] * 299 + rgb[j + 1] * 587 + rgb[j + 2] * 114) // 1000
    a = 255 - lum
    alpha[i] = 0 if a <= sitelogo.FLOOR else (a - sitelogo.FLOOR) * 255 // span

# Anything reachable from the border through sub-threshold alpha is outside;
# whatever is left is the interior the fill belongs in.
outside = bytearray(w * h)
queue = deque()
for x in range(w):
    queue.append((x, 0))
    queue.append((x, h - 1))
for y in range(h):
    queue.append((0, y))
    queue.append((w - 1, y))
while queue:
    x, y = queue.popleft()
    i = y * w + x
    if outside[i] or alpha[i] >= PASSABLE:
        continue
    outside[i] = 1
    if x > 0: queue.append((x - 1, y))
    if x < w - 1: queue.append((x + 1, y))
    if y > 0: queue.append((x, y - 1))
    if y < h - 1: queue.append((x, y + 1))


def write_gray(path, level):
    """8-bit greyscale; `level` returns 0-255 per pixel."""
    raw = bytearray()
    for y in range(h):
        raw.append(0)  # filter: none
        raw += bytes(level(y * w + x) for x in range(w))

    def chunk(tag, body):
        return (
            struct.pack(">I", len(body))
            + tag
            + body
            + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
        )

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 6)))
        f.write(chunk(b"IEND", b""))


os.makedirs(OUT, exist_ok=True)
# Bilevel: the region the fill sits in.
write_gray(os.path.join(OUT, "interior.png"), lambda i: 0 if not outside[i] else 255)
# Continuous tone: the posterizer needs the greys intact to band them, so this
# is the art's own luminance rather than a threshold. The art's soft shading —
# the tyre, the seat, the sidecar hatching — only survives because of this.
write_gray(os.path.join(OUT, "grey.png"), lambda i: 255 - alpha[i])
# Bilevel ink, for the site's single-shape logo. The site paints the mark by
# masking a themed colour through it, so only the silhouette matters there.
write_gray(os.path.join(OUT, "ink.png"), lambda i: 0 if alpha[i] >= PASSABLE else 255)

# The viewBox crops to the art; the traced coordinates stay in source space.
xs = [i % w for i in range(w * h) if not outside[i]]
ys = [i // w for i in range(w * h) if not outside[i]]
bbox = [min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1]
with open(os.path.join(OUT, "bbox.json"), "w") as f:
    f.write(str(bbox))

print(f"{sitelogo.SRC} -> {OUT}/interior.png, {OUT}/grey.png, {OUT}/ink.png  bbox={bbox}")
