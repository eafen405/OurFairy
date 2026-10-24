package me.rerere.rikkahub.ui.fairy

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Matrix
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathFillType
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlin.math.tan

/** Gap between glyphs, in the glyphs' own 100-unit cap-height space. */
private const val GAP = 6f
private const val CAP = 100f
private const val RUNE_LINE_WIDTH = 20f

/**
 * One glyph in the plate's lettering. [polys] are filled shapes (holes are
 * separate opposite-wound polygons); [lines] are open polylines drawn as a
 * stroke of [lineWidth] glyph units. A glyph uses one of the two.
 */
private class Glyph(
    val advance: Float,
    val polys: List<FloatArray> = emptyList(),
    val lines: List<FloatArray> = emptyList(),
    val lineWidth: Float = RUNE_LINE_WIDTH,
)

private fun glyph(advance: Float, vararg polys: FloatArray) = Glyph(advance, polys = polys.toList())
private fun strokeGlyph(advance: Float, width: Float = RUNE_LINE_WIDTH, vararg lines: FloatArray) =
    Glyph(advance, lines = lines.toList(), lineWidth = width)
private fun poly(vararg xy: Float) = xy

private val GLYPHS: Map<Char, Glyph> = mapOf(
    // H: a high-shouldered h. The left stem is one broken line: its upper
    // segment is collinear with the lower stem and separated by a gap. The
    // shoulder meets the stem flush, with nothing poking above the crossbar.
    'H' to glyph(
        96f,
        poly(
            0f, 44f, 6f, 38f, 78f, 38f, 78f, 0f, 90f, 0f, 96f, 6f, 96f, 94f, 90f, 100f,
            78f, 100f, 78f, 56f, 22f, 56f, 22f, 100f, 6f, 100f, 0f, 94f,
        ),
        poly(0f, 6f, 6f, 0f, 22f, 0f, 22f, 28f, 6f, 28f, 0f, 22f),
    ),
    // D: a single triangle with one triangular counter.
    'D' to glyph(
        100f,
        poly(0f, 8f, 8f, 0f, 50f, 0f, 100f, 50f, 50f, 100f, 8f, 100f, 0f, 92f),
        poly(35f, 29f, 72f, 50f, 35f, 71f),
    ),
    // S: five strokes from the top right, second deleted. The lower half is
    // one rectangle with its left side removed, so every corner stays square.
    'S' to glyph(
        86f,
        poly(10f, 8f, 78f, 8f, 78f, 24f, 10f, 24f),
        poly(14f, 44f, 86f, 44f, 86f, 100f, 14f, 100f, 14f, 84f, 70f, 84f, 70f, 60f, 14f, 60f),
    ),
    // Y: an up arrow drawn in strokes. The bar stays thin; the two arms run
    // long and the shaft drops from the point.
    'Y' to Glyph(
        90f,
        polys = listOf(poly(10f, 0f, 80f, 0f, 80f, 4f, 10f, 4f)),
        lines = listOf(
            poly(45f, 4f, 0f, 45f),
            poly(45f, 4f, 90f, 45f),
            poly(45f, 4f, 45f, 100f),
        ),
        lineWidth = 18f,
    ),
    'T' to glyph(
        84f,
        poly(33f, 0f, 51f, 0f, 51f, 82f, 84f, 82f, 84f, 100f, 0f, 100f, 0f, 82f, 33f, 82f),
    ),
    'E' to glyph(
        90f,
        poly(
            0f, 0f, 90f, 0f, 90f, 18f, 18f, 18f, 18f, 41f, 72f, 41f, 72f, 59f, 18f, 59f,
            18f, 82f, 90f, 82f, 90f, 100f, 0f, 100f,
        ),
    ),
    // M: the mirror of the spring-like W.
    'M' to strokeGlyph(
        82f,
        18f,
        poly(0f, 108f, 0f, 0f, 36f, 100f, 36f, 0f, 72f, 100f, 72f, -8f),
    ),
    // Dots ride the baseline, not x-height: they read as studs in the corners.
    '.' to glyph(32f, poly(16f, 74f, 28f, 86f, 16f, 98f, 4f, 86f)),
    // W: a compressed spring. The zigzag folds continuously, and the last
    // stroke drops vertically on the right.
    'W' to strokeGlyph(
        82f,
        18f,
        poly(0f, -8f, 0f, 100f, 36f, 0f, 36f, 100f, 72f, 0f, 72f, 108f),
    ),
    // I: inverted triangle, stem, and a ground bar only as wide as the
    // triangle's top edge.
    'I' to Glyph(
        56f,
        polys = listOf(
            poly(22f, 36f, 34f, 36f, 34f, 84f, 22f, 84f),
            poly(2f, 84f, 54f, 84f, 54f, 100f, 2f, 100f),
        ),
        lines = listOf(poly(2f, 0f, 54f, 0f, 28f, 36f, 2f, 0f)),
        lineWidth = 6f,
    ),
    // V: a mirrored N with a doubled diagonal, leaning left.
    'V' to strokeGlyph(
        100f,
        4f,
        poly(0f, 0f, 20f, 100f),
        poly(80f, 0f, 100f, 100f),
        poly(20f, 100f, 80f, 0f),
        poly(35f, 100f, 83f, 20f),
    ),
    // O: two isosceles right triangles sharing the vertical hypotenuse.
    'О' to strokeGlyph(
        100f,
        14f,
        poly(50f, 0f, 0f, 50f, 50f, 100f, 100f, 50f, 50f, 0f),
        poly(50f, 14f, 50f, 86f),
    ),
    'Г' to glyph(84f, poly(0f, 0f, 84f, 0f, 84f, 18f, 18f, 18f, 18f, 100f, 0f, 100f)),
    // P: vertical stem on the left; an upper-right rectangle with its lid
    // removed, open to the top.
    'P' to glyph(
        84f,
        poly(0f, 0f, 0f, 100f, 18f, 100f, 18f, 62f, 84f, 62f, 84f, 0f, 66f, 0f, 66f, 44f, 18f, 44f, 18f, 0f),
    ),
    'И' to glyph(
        100f,
        poly(
            100f, 0f, 82f, 0f, 18f, 84f, 18f, 0f, 0f, 0f, 0f, 100f, 18f, 100f, 82f, 16f,
            82f, 100f, 100f, 100f,
        ),
    ),
    '▷' to glyph(
        100f,
        poly(0f, 0f, 100f, 50f, 0f, 100f),
        poly(26f, 26f, 26f, 74f, 64f, 50f),
    ),
    'Є' to glyph(
        90f,
        poly(
            90f, 0f, 0f, 0f, 0f, 18f, 72f, 18f, 72f, 41f, 18f, 41f, 18f, 59f, 72f, 59f,
            72f, 82f, 0f, 82f, 0f, 100f, 90f, 100f,
        ),
    ),
)

/** Space has no ink; it only advances. */
private val SPACE = Glyph(50f, emptyList())

private fun glyphFor(c: Char): Glyph = when (c) {
    ' ' -> SPACE
    'Ф' -> GLYPHS.getValue('О')
    'Ǝ' -> GLYPHS.getValue('Є')
    'Ѕ' -> GLYPHS.getValue('S')
    'У' -> GLYPHS.getValue('Y')
    'Т' -> GLYPHS.getValue('T')
    'Н' -> GLYPHS.getValue('H')
    'М' -> GLYPHS.getValue('M')
    else -> GLYPHS[c] ?: SPACE
}

/** One filled path and one stroked path per glyph; either may be absent. */
private class GlyphPaths(val fill: Path?, val line: Path?)

private fun fillPath(glyph: Glyph): Path? {
    if (glyph.polys.isEmpty()) return null
    return Path().apply {
        fillType = PathFillType.EvenOdd
        glyph.polys.forEach { xy ->
            moveTo(xy[0], xy[1])
            var i = 2
            while (i < xy.size) {
                lineTo(xy[i], xy[i + 1])
                i += 2
            }
            close()
        }
    }
}

private fun linePath(glyph: Glyph): Path? {
    if (glyph.lines.isEmpty()) return null
    return Path().apply {
        glyph.lines.forEach { xy ->
            val closed = xy.size >= 6 && xy[0] == xy[xy.size - 2] && xy[1] == xy[xy.size - 1]
            val end = if (closed) xy.size - 2 else xy.size
            moveTo(xy[0], xy[1])
            var i = 2
            while (i < end) {
                lineTo(xy[i], xy[i + 1])
                i += 2
            }
            if (closed) close()
        }
    }
}

private fun buildPaths(): Map<Char, GlyphPaths> =
    (GLYPHS.keys + listOf('Ф', 'Ǝ', 'Ѕ', 'У', 'Т', 'Н', 'М')).associateWith { c ->
        val glyph = glyphFor(c)
        GlyphPaths(fillPath(glyph), linePath(glyph))
    }

private fun lineUnits(text: String, gap: Float = GAP): Float {
    var units = 0f
    text.forEachIndexed { i, c ->
        units += glyphFor(c).advance
        if (i < text.lastIndex) units += gap
    }
    return units.coerceAtLeast(1f)
}

/** Page ink: ice at the top falling to console blue, as on the logo plate. */
private fun iceGradient() = Brush.verticalGradient(
    0f to Color(0xFFF6FBFF),
    0.45f to Color(0xFFD6E9FF),
    0.46f to Color(0xFFA6C8FF),
    1f to Color(0xFF4F7FE0),
    startY = 0f,
    endY = CAP,
)

private val OutlineColor = Color(0xFFEFF7FF)
private val StripeColor = Color.White.copy(alpha = 0.07f)
private val GlowColor = Color(0xFF7FB0FF).copy(alpha = 0.10f)
/** Rune line ink: solid ice, no plate texture. */
private val RuneInk = Color(0xFFEAF3FF)

/**
 * One line of glyphs. Widths are in the glyphs' 100-unit space.
 */
private fun DrawScope.drawHddLine(
    text: String,
    paths: Map<Char, GlyphPaths>,
    unit: Float,
    top: Float,
    x0: Float = 0f,
    outline: Float = 2.4f,
    glow: Float = 6f,
    stripes: Boolean = true,
    slantDeg: Float = 0f,
    solid: Boolean = false,
    weight: Float = 0f,
    gap: Float = GAP,
) {
    val fill = iceGradient()
    // Shear in glyph units, leaning right; translate back so the baseline
    // stays put and the advance is unchanged.
    val skew = tan(Math.toRadians(slantDeg.toDouble())).toFloat()
    var x = x0
    text.forEach { c ->
        val glyph = glyphFor(c)
        paths[c]?.let { gp ->
            withTransform({
                translate(x, top)
                scale(unit, unit, Offset.Zero)
                if (skew != 0f) {
                    transform(Matrix().apply {
                        values[Matrix.SkewX] = -skew
                        values[Matrix.TranslateX] = skew * CAP
                    })
                }
            }) {
                gp.line?.let { line ->
                    drawPath(
                        line,
                        if (solid) RuneInk else OutlineColor,
                        style = Stroke(
                            width = glyph.lineWidth + weight,
                            cap = StrokeCap.Butt,
                            join = StrokeJoin.Round,
                        ),
                    )
                }
                gp.fill?.let { path ->
                    if (solid) {
                        drawPath(path, GlowColor, style = Stroke(width = glow + weight * 2f, join = StrokeJoin.Round))
                        drawPath(path, RuneInk, style = Stroke(width = weight, join = StrokeJoin.Miter))
                        drawPath(path, RuneInk)
                    } else {
                        drawPath(path, GlowColor, style = Stroke(width = glow, join = StrokeJoin.Round))
                        clipPath(path) {
                            drawRect(fill, topLeft = Offset.Zero, size = Size(glyph.advance, CAP))
                            if (stripes) {
                                // Horizontal banding, the plate's fill texture.
                                var y = 2f
                                while (y < CAP) {
                                    drawRect(StripeColor, Offset(0f, y), Size(glyph.advance, 1.8f))
                                    y += 5.5f
                                }
                            }
                        }
                        drawPath(path, OutlineColor, style = Stroke(width = outline, join = StrokeJoin.Round))
                    }
                }
            }
        }
        x += (glyph.advance + gap) * unit
    }
}

/**
 * The console wordmark: H.D.D. SYSTEM in the plate lettering with a smaller
 * rune line beneath, both fitted to the available width.
 */
@Composable
fun FairyHddWordmark(
    modifier: Modifier = Modifier,
    main: String = "H.D.D",
    runes: String = "HФГГОW ▷ЄЄP ▷IVЄ ЅУЅТЄM",
) {
    val paths = remember { buildPaths() }
    val density = LocalDensity.current
    BoxWithConstraints(modifier.fillMaxWidth().semantics { contentDescription = main }) {
        val widthPx = with(density) { maxWidth.toPx() }
        // Inset from the page edge: the mark is a plate, not a banner.
        val sideInset = widthPx * 0.10f
        val mainWidth = widthPx - sideInset * 2f
        val mainUnit = mainWidth / lineUnits(main)
        // The rune line is a caption: smaller and heavier than the caps.
        val runeWidth = mainWidth * 0.78f
        // The rune glyphs stroke outside their advance; a wider gap is what
        // keeps neighbouring strokes from touching.
        val runeGap = 36f
        val runeUnits = lineUnits(runes, runeGap)
        val runeUnit = minOf(mainUnit * 0.26f, runeWidth / runeUnits)
        val gap = CAP * mainUnit * 0.12f
        // Room for the glow stroke so it cannot clip at the top or the sides;
        // the top carries extra so the caps clear the status bar.
        val bleed = 12f * mainUnit
        val topAir = 10f * mainUnit
        val runeX = (widthPx - runeUnits * runeUnit) / 2f - widthPx * 0.025f
        val mainTop = topAir + bleed
        val heightPx = mainTop + CAP * mainUnit + gap + CAP * runeUnit + bleed * 0.4f
        Canvas(Modifier.fillMaxWidth().height(with(density) { heightPx.toDp() })) {
            drawHddLine(main, paths, mainUnit, mainTop, x0 = sideInset, outline = 2.0f, glow = 4f)
            drawHddLine(
                runes, paths, runeUnit, mainTop + CAP * mainUnit + gap,
                x0 = runeX, glow = 4f, stripes = false, slantDeg = 10f,
                solid = true, weight = 5f, gap = runeGap,
            )
        }
    }
}
