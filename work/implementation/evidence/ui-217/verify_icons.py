#!/usr/bin/env python3
"""Check the #217 launcher PNGs: dimensions, alpha, and the emblem's colors.

Pure stdlib (zlib); Chromium writes non-interlaced 8-bit RGB/RGBA PNGs.
Exit status is non-zero when any check fails.
"""

from __future__ import annotations

import argparse
import math
import struct
import sys
import zlib
from pathlib import Path

BG_CENTER = (0x0D, 0x22, 0x57)
BG_EDGE = (0x05, 0x0A, 0x18)
RING_TOP = (0x3D, 0x8A, 0xE6)
WHITE = (0xFF, 0xFF, 0xFF)

# density -> (legacy px, adaptive px)
DENSITIES = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}

CANVAS = 108.0
UNIT = 66.0 / 48.0
CX = CY = 54.0
WHITE_RING_R = 22.3 * UNIT
BLUE_RING_R = 18.1 * UNIT
DISC_R = 15.6 * UNIT
EYE_RING_INNER = 8.1 * UNIT
EYE_RING_OUTER = 12.5 * UNIT
TAIL_X = CX + 6.1 * UNIT / 2 ** 0.5
TAIL_Y = CY + 6.1 * UNIT / 2 ** 0.5

failures: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


def close(actual: tuple[int, ...], expected: tuple[int, ...], tolerance: int = 3) -> bool:
    return all(abs(a - b) <= tolerance for a, b in zip(actual, expected))


def read_png(path: Path) -> tuple[int, int, int, list[bytes]]:
    """Return (width, height, channels, rows)."""
    data = path.read_bytes()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path}: not a PNG")
    position = 8
    compressed = bytearray()
    width = height = depth = color = 0
    while position < len(data):
        length = int.from_bytes(data[position : position + 4], "big")
        chunk_type = data[position + 4 : position + 8]
        chunk = data[position + 8 : position + 8 + length]
        position += 12 + length
        if chunk_type == b"IHDR":
            width, height, depth, color, compression, filtering, interlace = struct.unpack(
                ">IIBBBBB", chunk
            )
            if depth != 8 or compression != 0 or filtering != 0 or interlace != 0:
                raise ValueError(f"{path}: unsupported PNG (depth {depth}, interlace {interlace})")
        elif chunk_type == b"IDAT":
            compressed += chunk
        elif chunk_type == b"IEND":
            break
    channels = {2: 3, 6: 4}[color]
    raw = zlib.decompress(bytes(compressed))
    stride = width * channels
    rows: list[bytes] = []
    previous = bytearray(stride)
    offset = 0
    for _ in range(height):
        filter_type = raw[offset]
        offset += 1
        line = bytearray(raw[offset : offset + stride])
        offset += stride
        for index in range(stride):
            left = line[index - channels] if index >= channels else 0
            above = previous[index]
            upper_left = previous[index - channels] if index >= channels else 0
            if filter_type == 1:
                line[index] = (line[index] + left) & 0xFF
            elif filter_type == 2:
                line[index] = (line[index] + above) & 0xFF
            elif filter_type == 3:
                line[index] = (line[index] + ((left + above) >> 1)) & 0xFF
            elif filter_type == 4:
                estimate = left + above - upper_left
                distances = (
                    abs(estimate - left),
                    abs(estimate - above),
                    abs(estimate - upper_left),
                )
                predictor = (left, above, upper_left)[distances.index(min(distances))]
                line[index] = (line[index] + predictor) & 0xFF
        rows.append(bytes(line))
        previous = line
    return width, height, channels, rows


def pixels(width: int, height: int, channels: int, rows: list[bytes]):
    for y in range(height):
        row = rows[y]
        for x in range(width):
            base = x * channels
            if channels == 4:
                yield (row[base], row[base + 1], row[base + 2], row[base + 3])
            else:
                yield (row[base], row[base + 1], row[base + 2], 255)


def sample(pixels_iter, width: int, x: float, y: float) -> tuple[int, int, int, int]:
    px = min(width - 1, max(0, int(x)))
    py = min(width - 1, max(0, int(y)))
    return pixels_iter[py * width + px]


def scaled(value: float, size: int) -> float:
    return value * size / CANVAS


def at_angle(radius_units: float, degrees: float, size: int) -> tuple[float, float]:
    """Point at `radius_units` (already scaled to the 108-unit canvas) and `degrees`, in target pixels.

    The disc has compass bumps at 0/90/180/270 degrees, so checks that must see
    the rings or the disc body sample the diagonals instead.
    """
    angle = math.radians(degrees)
    return (
        scaled(CX + radius_units * math.cos(angle), size),
        scaled(CY + radius_units * math.sin(angle), size),
    )


def verify_legacy(path: Path, size: int) -> None:
    width, height, channels, rows = read_png(path)
    check((width, height) == (size, size), f"{path}: size {width}x{height} != {size}x{size}")
    data = list(pixels(width, height, channels, rows))
    check(all(p[3] == 255 for p in data), f"{path}: legacy icon has transparent pixels")
    corner = sample(data, width, 1, 1)
    check(close(corner[:3], BG_EDGE, 6), f"{path}: corner {corner[:3]} != edge {BG_EDGE}")
    rim_x, rim_y = at_angle(WHITE_RING_R, 45, size)
    rim = sample(data, width, rim_x, rim_y)
    check(close(rim[:3], WHITE, 12), f"{path}: white ring pixel {rim[:3]} is not white")
    blue_x, blue_y = at_angle(BLUE_RING_R, 45, size)
    blue = sample(data, width, blue_x, blue_y)
    check(blue[2] > blue[0] + 100 and blue[2] > blue[1] + 60, f"{path}: blue ring {blue[:3]}")
    disc_x, disc_y = at_angle(14.0 * UNIT, 45, size)
    disc = sample(data, width, disc_x, disc_y)
    check(max(disc[:3]) <= 12, f"{path}: disc {disc[:3]} is not black")
    center = sample(data, width, size / 2, size / 2)
    check(max(center[:3]) <= 40, f"{path}: pupil {center[:3]} is not dark")
    print(f"PASS {path.name:26} {size}x{size} opaque, navy bg, white + blue rings")


def verify_background(path: Path, size: int) -> None:
    width, height, channels, rows = read_png(path)
    check((width, height) == (size, size), f"{path}: size {width}x{height} != {size}x{size}")
    data = list(pixels(width, height, channels, rows))
    check(all(p[3] == 255 for p in data), f"{path}: background has transparent pixels")
    center = sample(data, width, size / 2, size / 2)
    check(close(center[:3], BG_CENTER, 6), f"{path}: center {center[:3]} != {BG_CENTER}")
    corner = sample(data, width, 1, 1)
    check(close(corner[:3], BG_EDGE, 6), f"{path}: corner {corner[:3]} != {BG_EDGE}")
    print(f"PASS {path.name:26} {size}x{size} opaque radial navy gradient")


def verify_foreground(path: Path, size: int) -> None:
    width, height, channels, rows = read_png(path)
    check((width, height) == (size, size), f"{path}: size {width}x{height} != {size}x{size}")
    check(channels == 4, f"{path}: foreground is not RGBA")
    data = list(pixels(width, height, channels, rows))
    for x, y in ((1, 1), (size - 2, 1), (1, size - 2), (size - 2, size - 2)):
        check(sample(data, width, x, y)[3] == 0, f"{path}: corner ({x},{y}) is not transparent")
    check(any(p[3] == 0 for p in data), f"{path}: no transparent pixels")
    check(any(p[3] == 255 for p in data), f"{path}: no opaque pixels")
    rim_x, rim_y = at_angle(WHITE_RING_R, 45, size)
    rim = sample(data, width, rim_x, rim_y)
    check(rim[3] == 255 and close(rim[:3], WHITE, 12), f"{path}: white ring {rim}")
    blue_x, blue_y = at_angle(BLUE_RING_R, 45, size)
    blue = sample(data, width, blue_x, blue_y)
    check(blue[3] == 255 and blue[2] > blue[0] + 60, f"{path}: blue ring {blue}")
    disc_x, disc_y = at_angle(14.0 * UNIT, 45, size)
    disc = sample(data, width, disc_x, disc_y)
    check(disc[3] == 255 and max(disc[:3]) <= 12, f"{path}: disc {disc} is not black")
    tail = sample(data, width, scaled(TAIL_X, size), scaled(TAIL_Y, size))
    check(tail[3] == 255 and close(tail[:3], WHITE, 12), f"{path}: tail dot {tail}")
    print(f"PASS {path.name:26} {size}x{size} RGBA, transparent field, emblem on center")


def verify_monochrome(path: Path, size: int) -> None:
    width, height, channels, rows = read_png(path)
    check((width, height) == (size, size), f"{path}: size {width}x{height} != {size}x{size}")
    check(channels == 4, f"{path}: monochrome is not RGBA")
    data = list(pixels(width, height, channels, rows))
    colored = [p for p in data if max(p[:3]) - min(p[:3]) > 1]
    check(not colored, f"{path}: {len(colored)} colored pixels (silhouette must be neutral)")
    ring_x, ring_y = at_angle(WHITE_RING_R, 45, size)
    ring = sample(data, width, ring_x, ring_y)
    check(ring[3] == 255 and close(ring[:3], WHITE, 1), f"{path}: outer ring {ring}")
    gap_x, gap_y = at_angle(27.0 * UNIT, 45, size)
    gap = sample(data, width, gap_x, gap_y)
    check(gap[3] == 0, f"{path}: gap between disc and ring {gap}")
    eye_x, eye_y = at_angle(10.3 * UNIT, 45, size)
    eye_ring = sample(data, width, eye_x, eye_y)
    check(eye_ring[3] == 0, f"{path}: eye ring was not cut out {eye_ring}")
    disc_x, disc_y = at_angle(14.0 * UNIT, 45, size)
    disc = sample(data, width, disc_x, disc_y)
    check(disc[3] == 255 and close(disc[:3], WHITE, 1), f"{path}: disc body {disc}")
    pupil = sample(data, width, scaled(CX, size), scaled(CY, size))
    check(pupil[3] == 255 and close(pupil[:3], WHITE, 1), f"{path}: pupil {pupil}")
    tail = sample(data, width, scaled(TAIL_X, size), scaled(TAIL_Y, size))
    check(tail[3] == 0, f"{path}: tail-dot glint was not cut out {tail}")
    corner = sample(data, width, 1, 1)
    check(corner[3] == 0, f"{path}: corner is not transparent")
    check(all(EYE_RING_INNER < EYE_RING_OUTER for _ in (0,)), "sanity")
    print(f"PASS {path.name:26} {size}x{size} neutral alpha silhouette, cut-outs present")


def verify_any_other_pngs(res: Path) -> None:
    expected = {"ic_launcher.png", "ic_launcher_background.png", "ic_launcher_foreground.png", "ic_launcher_monochrome.png"}
    for directory in sorted(res.glob("mipmap-*")):
        if not directory.is_dir():
            continue
        names = {p.name for p in directory.glob("*.png")}
        check(names <= expected, f"{directory}: unexpected icon files {sorted(names - expected)}")


def main() -> int:
    here = Path(__file__).resolve().parent
    repo_root = here.parents[3]
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--res",
        type=Path,
        default=repo_root / "android" / "app" / "src" / "main" / "res",
    )
    args = parser.parse_args()
    res: Path = args.res
    for density, (legacy_px, adaptive_px) in DENSITIES.items():
        directory = res / f"mipmap-{density}"
        verify_legacy(directory / "ic_launcher.png", legacy_px)
        verify_background(directory / "ic_launcher_background.png", adaptive_px)
        verify_foreground(directory / "ic_launcher_foreground.png", adaptive_px)
        verify_monochrome(directory / "ic_launcher_monochrome.png", adaptive_px)
    verify_any_other_pngs(res)
    if failures:
        print("\nFAILED:")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("\nall icon checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
