package me.rerere.rikkahub.ui.fairy

import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Outline
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp

/**
 * Console plate: a rectangle with each corner replaced by a [cut]-long
 * straight chamfer. The chamfer is the panel's shape language — it replaces
 * the rounded corner and needs no extra corner brackets to read as machined.
 * The cut shrinks on small plates so a short row never turns into an octagon.
 */
data class FairyChamferShape(private val cut: Dp = 10.dp) : Shape {
    override fun createOutline(size: Size, layoutDirection: LayoutDirection, density: Density): Outline {
        val c = with(density) { cut.toPx() }.coerceAtMost(minOf(size.width, size.height) / 3f)
        if (c <= 0f) return Outline.Rectangle(androidx.compose.ui.geometry.Rect(Offset.Zero, size))
        val w = size.width
        val h = size.height
        val path = Path().apply {
            moveTo(c, 0f)
            lineTo(w - c, 0f)
            lineTo(w, c)
            lineTo(w, h - c)
            lineTo(w - c, h)
            lineTo(c, h)
            lineTo(0f, h - c)
            lineTo(0f, c)
            close()
        }
        return Outline.Generic(path)
    }
}

/** Converts any [Outline] to a [Path], for clipping and stroking in draw phase. */
internal fun Outline.asPath(): Path = when (this) {
    is Outline.Rectangle -> Path().apply { addRect(rect) }
    is Outline.Rounded -> Path().apply { addRoundRect(roundRect) }
    is Outline.Generic -> path
}
