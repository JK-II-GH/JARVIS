#!/usr/bin/env python3
"""
Generiert das App-Icon für JARVIS (macOS Dock + .app-Bundle).

Stil: Punktekugel — 3D-Drahtgitter aus leuchtenden Punkten in
hellem Blau auf dunkelblauem Hintergrund, mit kleinem rot
leuchtendem Kern in der Mitte.

Nutzung:
    python3 scripts/gen-app-icon.py build/icon.png 1024
"""

import math
import random
import struct
import sys
import zlib


# ── PNG (RGBA 8-bit) ──────────────────────────────────────────────────────

def chunk(typ: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(typ + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", crc)


def make_png_rgba(width: int, height: int, pixels: bytes, out: str) -> None:
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * stride : (y + 1) * stride])
    idat = zlib.compress(bytes(raw), 6)
    with open(out, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


# ── Math-Helfer ───────────────────────────────────────────────────────────

def smoothstep(edge0: float, edge1: float, x: float) -> float:
    if edge1 == edge0:
        return 1.0 if x >= edge0 else 0.0
    t = max(0.0, min(1.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def blend(bg, fg, fg_alpha):
    return (
        lerp(bg[0], fg[0], fg_alpha),
        lerp(bg[1], fg[1], fg_alpha),
        lerp(bg[2], fg[2], fg_alpha),
    )


# ── Farben ────────────────────────────────────────────────────────────────

BG_TOP      = (10, 26, 56)
BG_BOT      = (2,  6,  20)
DOT_CORE    = (210, 235, 255)   # heller Punkt-Kern
DOT_GLOW    = (70, 150, 230)    # blauer Glow um die Punkte
CENTER_HOT  = (255, 235, 220)   # weißglühender Kern
CENTER_GLOW = (255, 60, 50)     # roter Halo


# ── Sphäre erzeugen ───────────────────────────────────────────────────────

def generate_sphere_dots(size: float, axis_tilt_deg: float, n_dots: int = 720, seed: int = 7):
    """Punkte auf einer Kugeloberfläche — Fibonacci-Verteilung (sieht
    zufällig aus, ist aber gleichmäßig), plus kleine Rauschen-Jitter,
    damit nichts algorithmisch wirkt."""
    rng = random.Random(seed)
    cx = (size - 1) / 2
    cy = (size - 1) / 2
    sphere_r = size * 0.34
    tilt = math.radians(axis_tilt_deg)
    ct, st = math.cos(tilt), math.sin(tilt)

    golden = math.pi * (math.sqrt(5) - 1)  # ~137.5° Goldener Winkel

    dots = []
    for i in range(n_dots):
        # y geht gleichmäßig von +1 (Nordpol) bis −1 (Südpol)
        y = 1 - (i / max(n_dots - 1, 1)) * 2
        r_at_y = math.sqrt(max(0.0, 1 - y * y))
        theta = golden * i
        x3 = math.cos(theta) * r_at_y
        z3 = math.sin(theta) * r_at_y
        y3 = y

        # Kleines Rauschen, damit die Verteilung noch organischer wirkt
        jx = (rng.random() - 0.5) * 0.018
        jy = (rng.random() - 0.5) * 0.018
        jz = (rng.random() - 0.5) * 0.018
        x3 += jx
        y3 += jy
        z3 += jz
        # Wieder auf Einheitskugel normalisieren
        norm = math.sqrt(x3 * x3 + y3 * y3 + z3 * z3) or 1.0
        x3 /= norm
        y3 /= norm
        z3 /= norm

        # Kippen um die X-Achse — sieht aus wie ein leicht geneigter Globus
        y_t = y3 * ct - z3 * st
        z_t = y3 * st + z3 * ct

        # Orthographische Projektion: x → Bildschirm-X, z_t → Bildschirm-Y, y_t = Tiefe
        sx = cx + x3 * sphere_r
        sy = cy - z_t * sphere_r
        depth = y_t  # −1 hinten, +1 vorne

        # Vorne deutlich heller als hinten — und kleine Helligkeitsvariation
        brightness = 0.22 + 0.78 * ((depth + 1) / 2)
        brightness *= 0.85 + rng.random() * 0.30  # 0.85..1.15
        brightness = max(0.0, min(1.4, brightness))

        # Tiefe mit ausgeben, damit wir Vorder-/Hinterhälfte trennen können
        dots.append((sx, sy, brightness, depth))
    return dots


# ── Punkt-Rasterizer ──────────────────────────────────────────────────────

def stamp_dot(pixels, size, cx, cy, core_r, glow_r, brightness, core_color, glow_color, glow_strength=0.7):
    x0 = max(0, int(cx - glow_r) - 1)
    x1 = min(size, int(cx + glow_r) + 2)
    y0 = max(0, int(cy - glow_r) - 1)
    y1 = min(size, int(cy + glow_r) + 2)
    glow_r_sq = glow_r * glow_r
    for py in range(y0, y1):
        dy = py - cy
        for px in range(x0, x1):
            dx = px - cx
            d_sq = dx * dx + dy * dy
            if d_sq > glow_r_sq:
                continue
            d = math.sqrt(d_sq)
            i = (py * size + px) * 4
            if pixels[i + 3] == 0:
                continue
            r, g, b = pixels[i], pixels[i + 1], pixels[i + 2]
            color = (r, g, b)
            # Glow: quadratisch abklingend
            glow_t = 1.0 - d / glow_r
            glow_a = (glow_t * glow_t) * glow_strength * brightness
            color = blend(color, glow_color, glow_a)
            # Kern
            core_a = (1.0 - smoothstep(core_r - 0.7, core_r + 0.3, d)) * brightness
            if core_a > 0:
                color = blend(color, core_color, core_a)
            pixels[i]     = max(0, min(255, int(round(color[0]))))
            pixels[i + 1] = max(0, min(255, int(round(color[1]))))
            pixels[i + 2] = max(0, min(255, int(round(color[2]))))


# ── Generator ─────────────────────────────────────────────────────────────

def gen_icon(size: int) -> bytes:
    pixels = bytearray(size * size * 4)
    radius_corner = size * 0.225
    cx = (size - 1) / 2
    cy = (size - 1) / 2

    # ── Pass 1: Hintergrund (Rounded Rect, Verlauf, weiches rotes Glühen
    #             aus der Mitte für mehr Tiefe) ───────────────────────
    halo_r = size * 0.42
    for y in range(size):
        for x in range(size):
            # Rounded-Rect-Mask
            dx_c = max(radius_corner - x, x - (size - 1 - radius_corner), 0)
            dy_c = max(radius_corner - y, y - (size - 1 - radius_corner), 0)
            corner_dist = math.sqrt(dx_c * dx_c + dy_c * dy_c)
            bg_alpha = 1.0 - smoothstep(radius_corner - 1, radius_corner + 0.5, corner_dist)
            if bg_alpha <= 0:
                pixels[(y * size + x) * 4 + 3] = 0
                continue

            # Vertikaler Verlauf
            t = y / max(size - 1, 1)
            color = (
                lerp(BG_TOP[0], BG_BOT[0], t),
                lerp(BG_TOP[1], BG_BOT[1], t),
                lerp(BG_TOP[2], BG_BOT[2], t),
            )

            # Weiches rotes Glühen aus der Mitte (Hintergrund-Halo)
            d = math.sqrt((x - cx) ** 2 + (y - cy) ** 2)
            if d < halo_r:
                halo_t = 1.0 - d / halo_r
                halo_a = (halo_t ** 2.4) * 0.18
                color = blend(color, CENTER_GLOW, halo_a)

            i = (y * size + x) * 4
            pixels[i]     = max(0, min(255, int(round(color[0]))))
            pixels[i + 1] = max(0, min(255, int(round(color[1]))))
            pixels[i + 2] = max(0, min(255, int(round(color[2]))))
            pixels[i + 3] = int(round(bg_alpha * 255))

    # ── Pass 2 + 3 + 4: Tiefen-korrekte Sphäre + roter Kern dazwischen ──
    # Hintere Punkte zuerst, dann roter Kern, dann vordere Punkte —
    # so laufen die vorne liegenden blauen Punkte sichtbar über das
    # rote Glühen.
    dots = generate_sphere_dots(size, axis_tilt_deg=18.0)
    back_dots  = [d for d in dots if d[3] <= 0]
    front_dots = [d for d in dots if d[3] >  0]

    dot_core_r = max(0.9, size * 0.0035)
    dot_glow_r = max(2.0, size * 0.0130)

    # Pass 2: hintere Hälfte
    for (dx, dy, br, _) in back_dots:
        stamp_dot(pixels, size, dx, dy, dot_core_r, dot_glow_r, br,
                  DOT_CORE, DOT_GLOW, glow_strength=0.55)

    # Pass 3: roter Kern — größer, aber sanfter, damit Vorderpunkte
    # sich darüber abzeichnen
    center_dot_r  = size * 0.045
    center_glow_r = size * 0.135
    stamp_dot(pixels, size, cx, cy, center_dot_r, center_glow_r, 1.0,
              CENTER_HOT, CENTER_GLOW, glow_strength=0.55)

    # Pass 4: vordere Hälfte — werden über den roten Kern gemalt
    for (dx, dy, br, _) in front_dots:
        stamp_dot(pixels, size, dx, dy, dot_core_r, dot_glow_r, br,
                  DOT_CORE, DOT_GLOW, glow_strength=0.55)

    return bytes(pixels)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    out_path = sys.argv[1]
    size = int(sys.argv[2])
    print(f"generiere {size}x{size} Dot-Sphere …")
    px = gen_icon(size)
    make_png_rgba(size, size, px, out_path)
    print(f"erstellt: {out_path}")
