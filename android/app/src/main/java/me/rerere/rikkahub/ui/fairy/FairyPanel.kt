package me.rerere.rikkahub.ui.fairy

import androidx.compose.foundation.border
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * Panel bevel, lit from the upper left and falling off toward the lower right.
 * The three segments are the whole thickness: a bright lip, a faint shoulder,
 * and a nearly absent lower edge that reads as the shadow side.
 */
private fun panelBevel(): Brush = Brush.linearGradient(
    0f to Color.White.copy(alpha = 0.22f),
    0.35f to Color.White.copy(alpha = 0.09f),
    0.75f to Color.White.copy(alpha = 0.04f),
    1f to Color.White.copy(alpha = 0.02f),
)

/**
 * Fairy panel surface: a top-lit gradient in [shape] with a directional 1 dp
 * bevel and a recessed inner shade along its top edge.
 *
 * A flat fill plus a uniform outline reads as a sticker; the gradient and the
 * gradient-weighted edge are what give the plate thickness. [deep] adds the
 * inner top shade — use it for plates that sit *below* the page (readouts),
 * and leave it off for plates that sit *on* it (cards).
 */
@Composable
fun Modifier.fairyPanel(
    shape: Shape,
    color: Color? = null,
    deep: Boolean = false,
): Modifier {
    val tokens = LocalFairyTokens.current
    return drawWithCache {
        val outline = shape.createOutline(size, layoutDirection, this)
        val path = outline.asPath()
        val fill = color?.let { Brush.linearGradient(listOf(it, it)) }
            ?: Brush.verticalGradient(
                0f to tokens.panelTop,
                0.62f to tokens.panelBottom,
                1f to Color(0xFF091022),
            )
        val bevel = panelBevel()
        val lip = 1.dp.toPx()
        val innerShade = Brush.verticalGradient(
            0f to Color.Black.copy(alpha = 0.28f),
            1f to Color.Transparent,
            endY = 14.dp.toPx(),
        )
        onDrawBehind {
            drawPath(path, fill)
            if (deep) {
                clipPath(path) {
                    drawRect(innerShade, size = Size(size.width, 14.dp.toPx()))
                }
            }
            // Clipped double-width stroke: only the inner 1 dp survives.
            drawPath(path, bevel, style = Stroke(width = lip * 2f, cap = StrokeCap.Round))
        }
    }
}

/**
 * A console key with thickness: lit gradient face, bright top lip, and a
 * short darker band at the bottom edge that reads as the key's side wall.
 * [primary] is the ice key; the secondary key is a dim navy face.
 */
@Composable
fun Modifier.fairyKey(shape: Shape, primary: Boolean): Modifier {
    val tokens = LocalFairyTokens.current
    return drawWithCache {
        val path = shape.createOutline(size, layoutDirection, this).asPath()
        val face = if (primary) {
            Brush.verticalGradient(0f to Color(0xFFF7FAFF), 0.55f to Color(0xFFE2EAFF), 1f to Color(0xFFC2D4F2))
        } else {
            Brush.verticalGradient(0f to Color(0xFF1E3059), 0.6f to Color(0xFF141F3E), 1f to Color(0xFF0D1730))
        }
        val lip = Brush.verticalGradient(
            0f to Color.White.copy(alpha = if (primary) 0.95f else 0.16f),
            0.3f to Color.White.copy(alpha = if (primary) 0.45f else 0.07f),
            1f to Color.White.copy(alpha = 0.02f),
        )
        val wall = Color.Black.copy(alpha = if (primary) 0.22f else 0.38f)
        val wallHeight = if (primary) 4.dp.toPx() else 3.dp.toPx()
        val stroke = 1.dp.toPx()
        onDrawBehind {
            if (primary) {
                // A faint bleed outside the edge so the ice key sits above the page.
                drawPath(path, tokens.fairyLink.copy(alpha = 0.10f), style = Stroke(width = stroke * 6f))
            }
            drawPath(path, face)
            clipPath(path) {
                drawRect(wall, topLeft = Offset(0f, size.height - wallHeight), size = Size(size.width, wallHeight))
            }
            drawPath(path, lip, style = Stroke(width = stroke * 2f, cap = StrokeCap.Round))
        }
    }
}

/**
 * HUD corner brackets: four L-shaped [arm]-long, [stroke]-thick marks at the
 * corners of the bounds, drawn over the content in [color] (default a faint
 * fairyLink).
 */
@Composable
fun Modifier.fairyHudCorners(
    color: Color? = null,
    arm: Dp = 9.dp,
    stroke: Dp = 1.5.dp,
): Modifier {
    val tint = color ?: LocalFairyTokens.current.fairyLink.copy(alpha = 0.45f)
    return drawWithContent {
        drawContent()
        val a = arm.toPx()
        val s = stroke.toPx()
        val w = size.width
        val h = size.height
        drawRect(tint, Offset(0f, 0f), Size(a, s))
        drawRect(tint, Offset(0f, 0f), Size(s, a))
        drawRect(tint, Offset(w - a, 0f), Size(a, s))
        drawRect(tint, Offset(w - s, 0f), Size(s, a))
        drawRect(tint, Offset(0f, h - s), Size(a, s))
        drawRect(tint, Offset(0f, h - a), Size(s, a))
        drawRect(tint, Offset(w - a, h - s), Size(a, s))
        drawRect(tint, Offset(w - s, h - a), Size(s, a))
    }
}
