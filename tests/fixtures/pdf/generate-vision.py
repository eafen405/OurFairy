#!/usr/bin/env python3
"""Deterministically generate the PDF vision fixtures used by the ticket-18 tests.

Run from anywhere:

    python3 tests/fixtures/pdf/generate-vision.py

Only the Python standard library is used, plus the pypdf wheel vendored at
``backend/attachments/pdf/pypdf-6.21.0-py3-none-any.whl`` so the fixtures stay
reproducible without adding an environment dependency. The scan rasters are
built as raw RGB bytes here and Flate-compressed with zlib: no external
renderer is involved in producing the samples.

Geometry note: every page is 400x400 pt and every embedded raster is 400x400 px
mapped 1:1 onto the page, so ``pdftoppm -scale-to 1600`` (what the runtime uses
for ``pdf_render_pages``) yields a 1600x1600 image in which one PDF point is
exactly four pixels.

Every output is byte-for-byte stable across runs: pypdf's random document /ID
is pinned to a fixed value and zlib is called with fixed parameters, so
regenerating never produces a spurious diff.
"""

from __future__ import annotations

import sys
import zlib
from pathlib import Path

# --- vendored pypdf ---------------------------------------------------------
HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[2]
WHEEL = REPO_ROOT / "backend/attachments/pdf/pypdf-6.21.0-py3-none-any.whl"

if not WHEEL.is_file():
    raise SystemExit(f"pypdf wheel not found: {WHEEL}")

# A zipimport path must be the wheel itself, not the containing directory.
sys.path.insert(0, str(WHEEL))

from pypdf import PdfWriter  # noqa: E402
from pypdf.generic import (  # noqa: E402
    ArrayObject,
    ByteStringObject,
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    NumberObject,
)

# Fixed so repeated runs emit identical bytes (same value as generate.py).
FIXED_ID = b"0170ddfa17b0c4e4c9f0a4d8f7b6e5a4"

PAGE_WIDTH = 400
PAGE_HEIGHT = 400

# --- shared chart geometry (PDF points == raster pixels, origin bottom-left) --
BASELINE_Y = 40  # bars stand on this horizontal axis
AXIS_HEIGHT = 2  # thickness of the black axis line
BAR_WIDTH = 80
BAR_X = (40, 160, 280)  # red, green, blue
BAR_HEIGHTS = (40, 80, 120)  # red, green, blue
BAR_COLORS = ((255, 0, 0), (0, 255, 0), (0, 0, 255))  # red, green, blue
# The printed data labels of the vector chart. Heights are a fixed 4x multiple so
# the pixel geometry matches scan.pdf while the labels stay human-readable.
BAR_VALUES = ("10", "20", "30")

WHITE = (255, 255, 255)
BLACK = (0, 0, 0)


def _writer() -> PdfWriter:
    """A writer pinned to a fixed /ID so output bytes stay stable across runs."""
    writer = PdfWriter()
    writer._ID = ArrayObject([ByteStringObject(FIXED_ID), ByteStringObject(FIXED_ID)])
    return writer


def _chart_image() -> bytes:
    """The 400x400 RGB scan raster: white page, black axis, three solid bars.

    Bars are red/green/blue with heights 40/80/120 measured from the axis, so a
    reader can both name the colors and compare the relative bar heights.
    """
    row = bytes(WHITE) * PAGE_WIDTH
    pixels = bytearray(row * PAGE_HEIGHT)

    def fill(x0: int, x1: int, y0: int, y1: int, color: tuple[int, int, int]) -> None:
        """Paint the half-open rectangle in raster coordinates (y grows down)."""
        span = bytes(color) * (x1 - x0)
        for y in range(y0, y1):
            start = (y * PAGE_WIDTH + x0) * 3
            pixels[start : start + len(span)] = span

    # PDF y grows up, raster y grows down: mirror around PAGE_HEIGHT.
    for x, height, color in zip(BAR_X, BAR_HEIGHTS, BAR_COLORS):
        fill(x, x + BAR_WIDTH, PAGE_HEIGHT - BASELINE_Y - height, PAGE_HEIGHT - BASELINE_Y, color)
    # The axis sits directly under the bars, so it never eats into their height.
    fill(0, PAGE_WIDTH, PAGE_HEIGHT - BASELINE_Y, PAGE_HEIGHT - BASELINE_Y + AXIS_HEIGHT, BLACK)
    return bytes(pixels)


def _image_xobject(image: bytes) -> DecodedStreamObject:
    """A DeviceRGB 8-bit image XObject holding pre-Flate-compressed ``image``."""
    compressor = zlib.compressobj(level=9, method=zlib.DEFLATED, wbits=15, memLevel=8)
    packed = compressor.compress(image) + compressor.flush()

    stream = DecodedStreamObject()
    stream.update(
        {
            NameObject("/Type"): NameObject("/XObject"),
            NameObject("/Subtype"): NameObject("/Image"),
            NameObject("/Width"): NumberObject(PAGE_WIDTH),
            NameObject("/Height"): NumberObject(PAGE_HEIGHT),
            NameObject("/ColorSpace"): NameObject("/DeviceRGB"),
            NameObject("/BitsPerComponent"): NumberObject(8),
            NameObject("/Filter"): NameObject("/FlateDecode"),
        }
    )
    # DecodedStreamObject stores bytes verbatim, so the data is already encoded.
    stream.set_data(packed)
    return stream


def _text_ops(items: list[tuple[float, float, float, str]]) -> str:
    """Content-stream operators painting ``(x, y, size, text)`` items.

    Each item sets an absolute text matrix, because ``Td`` would accumulate
    relative to the previous line's origin.
    """
    operations = ["BT", "/F1 12 Tf"]
    for x, y, size, text in items:
        operations.extend(["/F1 %g Tf" % size, "1 0 0 1 %g %g Tm" % (x, y), "(%s) Tj" % text])
    operations.append("ET")
    return "\n".join(operations)


def _bar_ops() -> str:
    """Content-stream operators painting the same three bars as vector fills."""
    operations = ["q"]
    for color, x, height in zip(BAR_COLORS, BAR_X, BAR_HEIGHTS):
        operations.append(
            "%.3f %.3f %.3f rg" % tuple(c / 255 for c in color)
        )
        operations.append(
            "%d %d %d %d re f" % (x, BASELINE_Y, BAR_WIDTH, height)
        )
    operations.append("Q")
    operations.append("q 0 0 0 rg")
    operations.append("0 %d %d %d re f Q" % (BASELINE_Y - AXIS_HEIGHT, PAGE_WIDTH, AXIS_HEIGHT))
    return "\n".join(operations)


def _content_stream(body: str) -> DecodedStreamObject:
    stream = DecodedStreamObject()
    stream.set_data(body.encode("ascii"))
    return stream


def _add_page(
    writer: PdfWriter,
    body: str,
    *,
    image_box: tuple[float, float, float, float] | None = None,
) -> None:
    """Append a 400x400 page drawing ``body``.

    ``image_box`` as ``(x, y, width, height)`` prepends the chart raster scaled
    into that box; ``None`` adds no image at all.
    """
    page = writer.add_blank_page(PAGE_WIDTH, PAGE_HEIGHT)

    resources = DictionaryObject()
    if image_box:
        image_ref = writer._add_object(_image_xobject(_chart_image()))
        resources[NameObject("/XObject")] = DictionaryObject({NameObject("/Im1"): image_ref})
        # The raster is drawn into the unit square, scaled into image_box.
        x, y, width, height = image_box
        body = f"q {width:g} 0 0 {height:g} {x:g} {y:g} cm /Im1 Do Q\n" + body

    if body:
        # The font must be a dictionary, not a stream: a stream object makes
        # poppler reject the resource ("font resource is not a dictionary") and
        # silently render no text at all. Written inline, not as an indirect ref.
        resources[NameObject("/Font")] = DictionaryObject(
            {
                NameObject("/F1"): DictionaryObject(
                    {
                        NameObject("/Type"): NameObject("/Font"),
                        NameObject("/Subtype"): NameObject("/Type1"),
                        NameObject("/BaseFont"): NameObject("/Helvetica"),
                        NameObject("/Encoding"): NameObject("/WinAnsiEncoding"),
                    }
                )
            }
        )

    page[NameObject("/Resources")] = resources
    page[NameObject("/Contents")] = writer._add_object(_content_stream(body))


def write_scan_pdf(path: Path) -> None:
    """One page, image only: a 3-bar chart with no text layer at all.

    ``extract_text()`` returns "" so the runtime must fall back to rendering.
    """
    writer = _writer()
    _add_page(writer, "", image_box=(0, 0, PAGE_WIDTH, PAGE_HEIGHT))
    with path.open("wb") as handle:
        writer.write(handle)


def write_chart_pdf(path: Path) -> None:
    """One page, pure vector: three bars plus a title and the labels 10/20/30."""
    writer = _writer()
    items = [(150, 360, 24, "T18_CHART")]
    items += [(x + 20, 20, 12, value) for x, value in zip(BAR_X, BAR_VALUES)]
    _add_page(writer, _bar_ops() + "\n" + _text_ops(items))
    with path.open("wb") as handle:
        writer.write(handle)


def write_mixed_pdf(path: Path) -> None:
    """Two pages: ordinary text, then a raster page that also carries a caption."""
    writer = _writer()
    _add_page(writer, _text_ops([(150, 150, 12, "MIXED_TEXT_PAGE")]))
    # Image occupies the upper area so the caption below it is readable text.
    _add_page(
        writer,
        _text_ops([(60, 60, 12, "MIXED_SCAN_CAPTION")]),
        image_box=(60, 100, 280, 280),
    )
    with path.open("wb") as handle:
        writer.write(handle)


FIXTURES = (
    ("scan.pdf", write_scan_pdf),
    ("chart.pdf", write_chart_pdf),
    ("mixed.pdf", write_mixed_pdf),
)


def main() -> int:
    for name, build in FIXTURES:
        target = HERE / name
        build(target)
        print(f"{name}: {target.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
