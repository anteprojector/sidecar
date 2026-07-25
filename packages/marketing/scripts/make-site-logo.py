#!/usr/bin/env python3
"""Turn the black-on-white branding art into a transparent alpha mask.

branding/complex.png is opaque RGB, so it shows as a pale box on any background
that isn't exactly its off-white. Recoloring it as black-with-alpha lets the same
file sit on white, and CSS `filter: invert(1)` flips it clean for dark mode.

Run:  python3 scripts/make-site-logo.py
"""

import os
import struct
import sys
import zlib

# Paths are relative to the marketing package, wherever this runs from.
PKG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(PKG, "branding/complex.png")
DST = os.path.join(PKG, "site/assets/logo.png")
SCALE = 2  # box-downsample factor; 1254 -> 627


def read_png_rgb(path):
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        sys.exit("not a PNG")

    pos, idat = 8, []
    width = height = None
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if ctype == b"IHDR":
            width, height, depth, color = struct.unpack(">IIBB", body[:10])
            if (depth, color) != (8, 2):
                sys.exit(f"expected 8-bit RGB, got depth={depth} colortype={color}")
        elif ctype == b"IDAT":
            idat.append(body)
        elif ctype == b"IEND":
            break
        pos += 12 + length

    raw = zlib.decompress(b"".join(idat))
    return width, height, unfilter(raw, width, height)


def unfilter(raw, width, height):
    """Reverse the per-scanline PNG filters into flat RGB bytes."""
    bpp, stride = 3, width * 3
    out = bytearray(stride * height)
    pos = 0
    for y in range(height):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        pos += stride
        base = y * stride
        prior = out[base - stride : base] if y else bytes(stride)
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prior[x]
            c = prior[x - bpp] if x >= bpp else 0
            if ftype == 1:
                line[x] = (line[x] + a) & 0xFF
            elif ftype == 2:
                line[x] = (line[x] + b) & 0xFF
            elif ftype == 3:
                line[x] = (line[x] + (a + b) // 2) & 0xFF
            elif ftype == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pred) & 0xFF
        out[base : base + stride] = line
    return out


# The source art's "white" is really rgb(254,254,254) drifting to 252, so a bare
# 255-luminance gives the background alpha 1-3 rather than 0. That reads as
# nothing on its own, but it is ink, and once a fill makes the shape opaque the
# surrounding film shows up as a dirty haze. Anything at or under FLOOR is
# treated as paper; the rest is rescaled so edge antialiasing still reaches 255.
FLOOR = 8


def to_alpha_mask(width, height, rgb, scale):
    """Black pixels become opaque, white becomes transparent, box-downsampled."""
    ow, oh = width // scale, height // scale
    out = bytearray(ow * oh * 4)
    area = scale * scale
    span = 255 - FLOOR
    for oy in range(oh):
        for ox in range(ow):
            total = 0
            for dy in range(scale):
                row = ((oy * scale + dy) * width + ox * scale) * 3
                for dx in range(scale):
                    i = row + dx * 3
                    total += (rgb[i] * 299 + rgb[i + 1] * 587 + rgb[i + 2] * 114) // 1000
            alpha = 255 - total // area
            out[(oy * ow + ox) * 4 + 3] = 0 if alpha <= FLOOR else (alpha - FLOOR) * 255 // span
    return ow, oh, out


def write_png_rgba(path, width, height, pixels):
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filter: none
        raw += pixels[y * stride : (y + 1) * stride]

    def chunk(tag, body):
        return (
            struct.pack(">I", len(body))
            + tag
            + body
            + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)
        )

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def crop_to_ink(width, height, pixels, margin=6):
    """Drop the transparent border. The source art is only ~50% ink vertically,
    and that padding turns into dead space in the hero."""
    minx, miny, maxx, maxy = width, height, -1, -1
    for y in range(height):
        row = y * width * 4
        for x in range(width):
            if pixels[row + x * 4 + 3] > 8:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    if maxx < 0:
        return width, height, pixels

    minx = max(0, minx - margin)
    miny = max(0, miny - margin)
    maxx = min(width - 1, maxx + margin)
    maxy = min(height - 1, maxy + margin)
    cw, ch = maxx - minx + 1, maxy - miny + 1

    out = bytearray(cw * ch * 4)
    for y in range(ch):
        src = ((miny + y) * width + minx) * 4
        out[y * cw * 4 : (y + 1) * cw * 4] = pixels[src : src + cw * 4]
    return cw, ch, out


w, h, rgb = read_png_rgb(SRC)
ow, oh, rgba = to_alpha_mask(w, h, rgb, SCALE)
ow, oh, rgba = crop_to_ink(ow, oh, rgba)
write_png_rgba(DST, ow, oh, rgba)
print(f"{SRC} {w}x{h} -> {DST} {ow}x{oh}")
