#!/usr/bin/env python3
"""
Generiert das Tray-Icon (Template-PNG) für die macOS-Menüleiste.

Stilistisch: kleine horizontale Pille — passt visuell zur Bildschirm-Pille
der App. Template-Image (schwarz auf transparent) → macOS färbt sie
automatisch passend zum Hell-/Dunkelmodus.

Nutzung:
    python3 scripts/gen-tray-icon.py src/renderer/trayIconTemplate.png 22
    python3 scripts/gen-tray-icon.py src/renderer/trayIconTemplate@2x.png 44
"""

import struct
import sys
import zlib


def chunk(typ: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(typ + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", crc)


def make_png(width: int, height: int, pixels: bytes, out: str) -> None:
    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 4, 0, 0, 0)

    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw.extend(pixels[y * width * 2 : (y + 1) * width * 2])
    idat = zlib.compress(bytes(raw), 9)

    with open(out, "wb") as f:
        f.write(sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b""))


def gen_pill_pixels(size: int) -> bytes:
    """Horizontale Pille, zentriert. Maße proportional zur Bildgröße."""
    pixels = bytearray(size * size * 2)
    cx = (size - 1) / 2
    cy = (size - 1) / 2
    # Pille: 75 % der Breite, 35 % der Höhe → wirkt schlank wie die UI-Pille
    rx = size * 0.38
    ry = size * 0.18
    flat_half = rx - ry  # gerade Strecken zwischen den Halbkreisen

    for y in range(size):
        for x in range(size):
            dx = abs(x - cx)
            dy = abs(y - cy)
            if dx <= flat_half:
                inside = dy <= ry
                # weicher Rand: 1 px Antialiasing
                d = ry - dy
            else:
                ex = dx - flat_half
                dist = (ex * ex + dy * dy) ** 0.5
                inside = dist <= ry
                d = ry - dist
            if inside:
                alpha = 255 if d >= 1 else int(255 * d)
                pixels[(y * size + x) * 2] = 0
                pixels[(y * size + x) * 2 + 1] = alpha
    return bytes(pixels)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    out_path = sys.argv[1]
    size = int(sys.argv[2])
    make_png(size, size, gen_pill_pixels(size), out_path)
    print(f"erstellt: {out_path} ({size}x{size})")
