#!/usr/bin/env python3
"""Render the #217 Fairy launcher icon layers with headless Chromium.

Geometry comes from
android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyEmblem.kt
(`drawFairyEmblem`/`discPath`): the emblem is authored in a 48-unit box. On
the 108-unit adaptive canvas that box is scaled to 66 units (66dp of 108dp),
so the white outer ring's rim sits on the 66dp safe zone.

Outputs (into --res):
  mipmap-*/ic_launcher.png             48 / 72 / 96 / 144 / 192  (opaque, full bleed)
  mipmap-*/ic_launcher_background.png 108 / 162 / 216 / 324 / 432 (opaque)
  mipmap-*/ic_launcher_foreground.png 108 / 162 / 216 / 324 / 432 (transparent)
  mipmap-*/ic_launcher_monochrome.png 108 / 162 / 216 / 324 / 432 (transparent)

The SVG sources are written next to this script. Each size is screenshotted
directly at its target pixel size (`--window-size=W,H`), so nothing is
resampled afterwards.
"""

from __future__ import annotations

import argparse
import math
import subprocess
import sys
from pathlib import Path

CANVAS = 108.0
# The 48-unit emblem box maps to 66/108 of the canvas (66dp of 108dp); the
# outer ring's rim therefore touches the 66dp Adaptive Icon safe zone.
UNIT = 66.0 / 48.0
CX = CY = CANVAS / 2.0

BG_CENTER = "#0D2257"
BG_EDGE = "#050A18"
RING_TOP = "#3D8AE6"
RING_BOTTOM = "#1A35D6"
PUPIL_TOP = "#0A1830"
PUPIL_BOTTOM = "#000000"

WHITE_RING_R = 22.3 * UNIT
WHITE_RING_W = 3.4 * UNIT
BLUE_RING_R = 18.1 * UNIT
BLUE_RING_W = 5.0 * UNIT
DISC_R = 15.6 * UNIT
TIP_R = 19.0 * UNIT
TIP_HALF_BASE = 3.2 * UNIT
APEX_R = 0.4 * UNIT
EYE_RING_R = 10.3 * UNIT
EYE_RING_W = 4.4 * UNIT
PUPIL_R = 8.1 * UNIT
TAIL_R = 3.4 * UNIT
TAIL_DIST = 6.1 * UNIT

DIRECTIONS = (-90.0, 0.0, 90.0, 180.0)  # compass bumps: up, right, down, left

# density -> (legacy icon px, adaptive layer px)
DENSITIES = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}

TAIL_X = CX + TAIL_DIST / math.sqrt(2.0)
TAIL_Y = CY + TAIL_DIST / math.sqrt(2.0)


def _xy(point: tuple[float, float]) -> str:
    return f"{point[0]:.5f} {point[1]:.5f}"


def _offset(start: tuple[float, float], towards: tuple[float, float], distance: float):
    """Point `distance` away from `start` towards `towards`."""
    dx = towards[0] - start[0]
    dy = towards[1] - start[1]
    length = math.hypot(dx, dy)
    return start[0] + dx / length * distance, start[1] + dy / length * distance


def _point(radius: float, degrees: float) -> tuple[float, float]:
    angle = math.radians(degrees)
    return CX + radius * math.cos(angle), CY + radius * math.sin(angle)


def _arc(radius: float, end: tuple[float, float], sweep: float) -> str:
    large_arc = 1 if sweep > 180.0 else 0
    return f"A {radius:.5f} {radius:.5f} 0 {large_arc} 1 {_xy(end)}"


def disc_path() -> str:
    """Disc with four compass bumps (same outline as FairyEmblem.discPath)."""
    beta = math.degrees(math.atan2(TIP_HALF_BASE, DISC_R))
    parts = [f"M {_xy(_point(DISC_R, DIRECTIONS[0] - beta))}"]
    for index, direction in enumerate(DIRECTIONS):
        if index:
            sweep = direction - DIRECTIONS[index - 1] - 2.0 * beta
            parts.append(_arc(DISC_R, _point(DISC_R, direction - beta), sweep))
        base = _point(DISC_R, direction - beta)
        end = _point(DISC_R, direction + beta)
        tip = _point(TIP_R, direction)
        parts.append(f"L {_xy(_offset(tip, base, APEX_R))}")
        parts.append(f"Q {_xy(tip)} {_xy(_offset(tip, end, APEX_R))}")
        parts.append(f"L {_xy(end)}")
    # Close the rim between the left bump's end (180+beta) and the top bump's
    # start (270-beta).
    parts.append(_arc(DISC_R, _point(DISC_R, 270.0 - beta), 90.0 - 2.0 * beta))
    parts.append("Z")
    return " ".join(parts)


def circle_subpath(cx: float, cy: float, radius: float) -> str:
    return (
        f"M {cx - radius:.5f} {cy:.5f} "
        f"a {radius:.5f} {radius:.5f} 0 1 0 {2.0 * radius:.5f} 0 "
        f"a {radius:.5f} {radius:.5f} 0 1 0 {-2.0 * radius:.5f} 0 Z"
    )


def monochrome_path() -> str:
    """White-on-transparent alpha silhouette, drawn as one even-odd path.

    Cover counts: outer ring 1, gap 0, disc body 1, eye annulus 2 (hole),
    pupil 3, tail dot 4 (hole), so the system tint sees a ring, the
    disc-with-bumps, a cut-out eye ring and a white pupil with a glint.
    """
    return " ".join(
        [
            circle_subpath(CX, CY, 24.0 * UNIT),
            circle_subpath(CX, CY, 20.6 * UNIT),
            disc_path(),
            circle_subpath(CX, CY, 12.5 * UNIT),
            circle_subpath(CX, CY, 8.1 * UNIT),
            circle_subpath(TAIL_X, TAIL_Y, TAIL_R),
        ]
    )


def svg(size: int, defs: str, body: str) -> str:
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" '
        f'viewBox="0 0 {CANVAS:g} {CANVAS:g}">{defs}{body}</svg>'
    )


def background_defs() -> str:
    radius = CANVAS / 2.0 * math.sqrt(2.0)  # reach the canvas corners
    return (
        f'<defs><radialGradient id="bg" gradientUnits="userSpaceOnUse" '
        f'cx="{CX:g}" cy="{CY:g}" r="{radius:.5f}">'
        f'<stop offset="0" stop-color="{BG_CENTER}"/>'
        f'<stop offset="1" stop-color="{BG_EDGE}"/>'
        f"</radialGradient></defs>"
    )


BACKGROUND_BODY = f'<rect width="{CANVAS:g}" height="{CANVAS:g}" fill="url(#bg)"/>'


def emblem_defs() -> str:
    return (
        f"<defs>"
        f'<linearGradient id="ring" gradientUnits="userSpaceOnUse" '
        f'x1="{CX:g}" y1="{CY - BLUE_RING_R:.5f}" x2="{CX:g}" y2="{CY + BLUE_RING_R:.5f}">'
        f'<stop offset="0" stop-color="{RING_TOP}"/>'
        f'<stop offset="1" stop-color="{RING_BOTTOM}"/>'
        f"</linearGradient>"
        f'<linearGradient id="pupil" gradientUnits="userSpaceOnUse" '
        f'x1="{CX:g}" y1="{CY - PUPIL_R:.5f}" x2="{CX:g}" y2="{CY + PUPIL_R:.5f}">'
        f'<stop offset="0" stop-color="{PUPIL_TOP}"/>'
        f'<stop offset="1" stop-color="{PUPIL_BOTTOM}"/>'
        f"</linearGradient>"
        f"</defs>"
    )


def emblem_body() -> str:
    return (
        f'<circle cx="{CX:g}" cy="{CY:g}" r="{WHITE_RING_R:.5f}" fill="none" '
        f'stroke="#FFFFFF" stroke-width="{WHITE_RING_W:.5f}"/>'
        f'<circle cx="{CX:g}" cy="{CY:g}" r="{BLUE_RING_R:.5f}" fill="none" '
        f'stroke="url(#ring)" stroke-width="{BLUE_RING_W:.5f}"/>'
        f'<path d="{disc_path()}" fill="#000000"/>'
        f'<circle cx="{CX:g}" cy="{CY:g}" r="{EYE_RING_R:.5f}" fill="none" '
        f'stroke="#FFFFFF" stroke-width="{EYE_RING_W:.5f}"/>'
        f'<circle cx="{CX:g}" cy="{CY:g}" r="{PUPIL_R:.5f}" fill="url(#pupil)"/>'
        f'<circle cx="{TAIL_X:.5f}" cy="{TAIL_Y:.5f}" r="{TAIL_R:.5f}" fill="#FFFFFF"/>'
    )


def layer_svgs(size: int) -> dict[str, str]:
    return {
        "background": svg(size, background_defs(), BACKGROUND_BODY),
        "foreground": svg(size, emblem_defs(), emblem_body()),
        "monochrome": svg(
            size,
            "",
            f'<path fill="#FFFFFF" fill-rule="evenodd" d="{monochrome_path()}"/>',
        ),
        "legacy": svg(size, background_defs() + emblem_defs(), BACKGROUND_BODY + emblem_body()),
    }


def html_page(markup: str) -> str:
    return (
        '<!doctype html><html><head><meta charset="utf-8">'
        "<style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style>"
        f"</head><body>{markup}</body></html>"
    )


def render(
    chromium: str,
    scratch: Path,
    markup: str,
    out: Path,
    size: int,
    transparent: bool,
    profile: Path | None = None,
) -> None:
    page = scratch / f"{out.stem}-{size}.html"
    page.write_text(html_page(markup), encoding="utf-8")
    command = [
        chromium,
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        # Without a virtual-time budget the screenshot can capture the SVG
        # before its first paint (observed as a partially painted layer).
        "--virtual-time-budget=10000",
        f"--window-size={size},{size}",
    ]
    if profile is not None:
        command.append(f"--user-data-dir={profile}")
    if transparent:
        command.append("--default-background-color=00000000")
    command += [f"--screenshot={out}", page.resolve().as_uri()]
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def main() -> int:
    here = Path(__file__).resolve().parent
    repo_root = here.parents[3]
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--res",
        type=Path,
        default=repo_root / "android" / "app" / "src" / "main" / "res",
        help="Android res directory to write the mipmap PNGs into",
    )
    parser.add_argument("--chromium", default="chromium", help="Chromium executable")
    parser.add_argument(
        "--work",
        type=Path,
        default=Path.home() / ".cache" / "ourfairy-icons",
        help="scratch directory (Snap Chromium cannot read /tmp)",
    )
    parser.add_argument(
        "--profile",
        type=Path,
        default=None,
        help="optional --user-data-dir (headless Chromium 155 skips painting "
        "108px captures with a dedicated profile; default: no profile)",
    )
    args = parser.parse_args()

    res: Path = args.res
    if not (res / "mipmap-mdpi").is_dir():
        parser.error(f"{res} does not look like an Android res directory")

    sources = layer_svgs(int(CANVAS))
    for name, markup in sources.items():
        (here / f"{name}.svg").write_text(markup + "\n", encoding="utf-8")
        print(f"svg   {here / f'{name}.svg'}")

    scratch = args.work / "html"
    scratch.mkdir(parents=True, exist_ok=True)
    profile = args.profile
    for density, (launcher_px, adaptive_px) in DENSITIES.items():
        target = res / f"mipmap-{density}"
        for name, markup, size, transparent in (
            ("ic_launcher", sources["legacy"], launcher_px, False),
            ("ic_launcher_background", sources["background"], adaptive_px, False),
            ("ic_launcher_foreground", sources["foreground"], adaptive_px, True),
            ("ic_launcher_monochrome", sources["monochrome"], adaptive_px, True),
        ):
            sized = markup.replace(
                f'width="{CANVAS:g}" height="{CANVAS:g}"',
                f'width="{size}" height="{size}"',
                1,
            )
            out = target / f"{name}.png"
            render(args.chromium, scratch, sized, out, size, transparent, args.profile)
            print(f"png   {out} {size}x{size}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
