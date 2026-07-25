#!/usr/bin/env python3
"""Draw the favicon: a diagonally split square with a happy face in the yellow half.

The bottom-right triangle is the brand yellow, the top-left is transparent, so the
mark keeps its wedge silhouette on a light or dark tab strip. Geometry lives here
once and is emitted twice — as SVG for browsers that take it, and as a supersampled
RGBA PNG for the ones that don't.

The face sits at the triangle's incenter (~0.707, 0.707) rather than its centroid —
equidistant from all three edges, which is what actually looks centered in a wedge.
The eyes ride above that point so the whole eyes-plus-smile block is what's centered.

  python3 scripts/make-favicon.py              # write the chosen face to site/assets/
  python3 scripts/make-favicon.py --variants   # write review renders to branding/faces/
"""

import math
import os
import struct
import sys
import zlib

# All paths are relative to the marketing package, wherever this runs from.
PKG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG_DST = os.path.join(PKG, "site/assets/favicon.svg")
PNG_DST = os.path.join(PKG, "site/assets/favicon.png")
VARIANT_DIR = os.path.join(PKG, "branding/faces")

SIZE = 512  # PNG output edge
VARIANT_SIZE = 256
SS = 4  # supersampling factor per axis

YELLOW = (0xFF, 0xC6, 0x1E)  # --accent, the yellow from branding/color.png
PALE = (0xFF, 0xE9, 0xA3)  # the paper of the site's yellow theme
INK = (0x1A, 0x1A, 0x1A)
SHINE = (0xFF, 0xFF, 0xFF)
WHITE = (0xFF, 0xFF, 0xFF)

# Every length is a fraction of the icon edge; y points down. An eye is a tall oval
# with a smaller oval of shine near its top, as on the headlight in the branding art.
BASE = dict(
    cx=0.695,
    cy=0.65,  # eye centerline
    rot=9.0,  # whole-face tilt, degrees clockwise; the lean reads as motion
    paper=PALE,  # the triangle behind the face
    ink=INK,  # eyes and smile
    shine=SHINE,  # the highlight inside each eye
    eye_dx=0.143,  # half the distance between the eyes
    eye_rx=0.082,
    eye_ry=0.14,
    eye_r_dy=0.0,  # right eye pushed down relative to the left
    eye_r_scale=1.0,  # right eye size relative to the left
    shine_dx=-0.3,  # shine offset, as a fraction of the eye's own radii
    shine_dy=-0.38,
    shine_r=0.34,  # shine size, as a fraction of the eye's radii
    smile_dy=0.06,  # smile arc center, below the eye centerline
    smile_dx=0.0,  # smile shifted sideways
    smile_r=0.173,
    smile_arc=0.68,  # radians either side of straight down
    smile_rot=0.0,  # smile rotated on its own, degrees clockwise
    smile_w=0.098,  # stroke width, round caps
)

# Named explorations for review. Each is BASE plus the listed overrides. The
# geometry is settled — these are the same face in three colorways.
VARIANTS = {
    "a-yellow": dict(paper=YELLOW),
    "b-pale": {},  # the chosen face — BASE as-is
    "c-mono": dict(paper=INK, ink=WHITE, shine=INK),
}


def eyes(p):
    """(center_x, center_y, rx, ry) for the left and right eye."""
    return (
        (p["cx"] - p["eye_dx"], p["cy"], p["eye_rx"], p["eye_ry"]),
        (
            p["cx"] + p["eye_dx"],
            p["cy"] + p["eye_r_dy"],
            p["eye_rx"] * p["eye_r_scale"],
            p["eye_ry"] * p["eye_r_scale"],
        ),
    )


def smile_center(p):
    return p["cx"] + p["smile_dx"], p["cy"] + p["smile_dy"]


def smile_ends(p):
    """The two arc endpoints, in draw order (left to right)."""
    cx, cy = smile_center(p)
    tilt = math.radians(p["smile_rot"])
    out = []
    for sign in (-1.0, 1.0):
        a = sign * p["smile_arc"] + tilt
        out.append((cx + p["smile_r"] * math.sin(a), cy + p["smile_r"] * math.cos(a)))
    return out


def sample(px, py, p):
    """The color at a point, or None where the icon is transparent."""
    if px + py < 1.0:
        return None

    # Undo the whole-face tilt, so the face geometry below is always upright.
    if p["rot"]:
        a = math.radians(-p["rot"])
        dx, dy = px - p["cx"], py - p["cy"]
        px = p["cx"] + dx * math.cos(a) - dy * math.sin(a)
        py = p["cy"] + dx * math.sin(a) + dy * math.cos(a)

    for ex, ey, rx, ry in eyes(p):
        dx, dy = (px - ex) / rx, (py - ey) / ry
        if dx * dx + dy * dy <= 1.0:
            sx, sy = ex + p["shine_dx"] * rx, ey + p["shine_dy"] * ry
            sdx, sdy = (px - sx) / (rx * p["shine_r"]), (py - sy) / (ry * p["shine_r"])
            return p["shine"] if sdx * sdx + sdy * sdy <= 1.0 else p["ink"]

    scx, scy = smile_center(p)
    dx, dy = px - scx, py - scy
    dist = math.hypot(dx, dy)
    if dist > 1e-9:
        # Angle from straight down, with the smile's own tilt taken out.
        ang = math.atan2(dx, dy) - math.radians(p["smile_rot"])
        if abs(ang) <= p["smile_arc"]:
            if abs(dist - p["smile_r"]) <= p["smile_w"] / 2:
                return p["ink"]
        else:
            for ex, ey in smile_ends(p):  # round caps
                if math.hypot(px - ex, py - ey) <= p["smile_w"] / 2:
                    return p["ink"]

    return p["paper"]


def render_png(size, ss, p):
    out = bytearray(size * size * 4)
    samples = ss * ss
    step = 1.0 / (size * ss)
    for y in range(size):
        for x in range(size):
            hits, r_sum, g_sum, b_sum = 0, 0, 0, 0
            for sy in range(ss):
                py = (y * ss + sy + 0.5) * step
                for sx in range(ss):
                    c = sample((x * ss + sx + 0.5) * step, py, p)
                    if c is not None:
                        hits += 1
                        r_sum += c[0]
                        g_sum += c[1]
                        b_sum += c[2]
            if not hits:
                continue
            i = (y * size + x) * 4
            out[i] = r_sum // hits
            out[i + 1] = g_sum // hits
            out[i + 2] = b_sum // hits
            out[i + 3] = round(hits / samples * 255)
    return out


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


def svg(p):
    S = 64  # SVG user units

    def u(v):
        return round(v * S, 2)

    hex_ = lambda c: "#%02x%02x%02x" % c
    (lx, ly), (rx_, ry_) = smile_ends(p)
    eye_svg = []
    for ex, ey, rx, ry in eyes(p):
        eye_svg.append(
            f'    <ellipse cx="{u(ex)}" cy="{u(ey)}" rx="{u(rx)}" ry="{u(ry)}" fill="{hex_(p["ink"])}"/>\n'
            f'    <ellipse cx="{u(ex + p["shine_dx"] * rx)}" cy="{u(ey + p["shine_dy"] * ry)}"'
            f' rx="{u(rx * p["shine_r"])}" ry="{u(ry * p["shine_r"])}" fill="{hex_(p["shine"])}"/>'
        )
    tilt = f' transform="rotate({p["rot"]} {u(p["cx"])} {u(p["cy"])})"' if p["rot"] else ""
    # width/height as well as viewBox: without an intrinsic size, an SVG drawn
    # into a <canvas> renders as nothing in some browsers.
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{S}" height="{S}" viewBox="0 0 {S} {S}">
  <path fill="{hex_(p["paper"])}" d="M0 {S}H{S}V0Z"/>
  <g{tilt}>
{chr(10).join(eye_svg)}
    <path d="M{u(lx)} {u(ly)}A{u(p["smile_r"])} {u(p["smile_r"])} 0 0 0 {u(rx_)} {u(ry_)}"
          fill="none" stroke="{hex_(p["ink"])}" stroke-width="{u(p["smile_w"])}" stroke-linecap="round"/>
  </g>
</svg>
"""


if __name__ == "__main__":
    if "--variants" in sys.argv:
        os.makedirs(VARIANT_DIR, exist_ok=True)
        for name, over in VARIANTS.items():
            p = {**BASE, **over}
            write_png_rgba(
                f"{VARIANT_DIR}/{name}.png",
                VARIANT_SIZE,
                VARIANT_SIZE,
                render_png(VARIANT_SIZE, SS, p),
            )
            open(f"{VARIANT_DIR}/{name}.svg", "w").write(svg(p))
            print(f"wrote {VARIANT_DIR}/{name}.png|.svg")
        sys.exit(0)

    open(SVG_DST, "w").write(svg(BASE))
    write_png_rgba(PNG_DST, SIZE, SIZE, render_png(SIZE, SS, BASE))
    print(f"wrote {SVG_DST}, {PNG_DST} ({SIZE}x{SIZE})")
