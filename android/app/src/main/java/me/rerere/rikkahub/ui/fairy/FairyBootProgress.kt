package me.rerere.rikkahub.ui.fairy

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.FloatState
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.roundToInt
import kotlin.math.sin

/**
 * One draw-phase clock (0..1, one turn per [periodMs]) shared by the boot
 * plate and the aged overlay. It only writes a draw-phase state, so frames
 * redraw without recomposing. The loop runs only while [running]: the boot
 * sequence must not leave a perpetual animation behind, or every screen that
 * waits for compose idleness would never settle. Reduced Motion never runs it.
 */
@Composable
internal fun rememberFairyPhase(running: Boolean, periodMs: Long = 12_000L): FloatState {
    val state = remember { mutableFloatStateOf(0f) }
    val motion = LocalAgoraMotionPolicy.current.allowContinuousMotion
    LaunchedEffect(running, motion) {
        if (!running || !motion) return@LaunchedEffect
        val start = withFrameMillis { it }
        while (true) {
            val now = withFrameMillis { it }
            state.floatValue = ((now - start) % periodMs) / periodMs.toFloat()
        }
    }
    return state
}

/**
 * The boot bar under the wordmark: a recessed rail with a phosphor fill, a
 * 20-division scale, a slow sweep highlight, uneven scale light and a few
 * dead pixels. [progress] and [phase] are read during draw, so the bar
 * animates without recomposing the page. At rest just short of full the fill
 * holds 99 % and lets the leading edge breathe.
 */
internal fun DrawScope.drawHddBar(
    progress: Float,
    phase: Float,
    fault: Boolean,
    top: Float,
    left: Float,
    width: Float,
    height: Float,
    track: Color,
    edge: Color,
    accent: Color,
) {
    if (width <= 0f || height <= 0f) return
    // Mechanical readout: whole percent, so the fill steps instead of gliding.
    var p = (progress.coerceIn(0f, 1f) * 100f).roundToInt() / 100f
    if (p >= 0.99f && p < 1f) p = 0.99f
    val corner = CornerRadius(2.dp.toPx())
    val inset = 1.5.dp.toPx()
    val innerLeft = left + inset
    val innerTop = top + inset
    val innerWidth = width - inset * 2f
    val innerHeight = height - inset * 2f
    val filled = innerWidth * p
    val cells = 20

    // The rail is a milled channel: dark under the top lip, lighter at the floor.
    drawRoundRect(
        Brush.verticalGradient(
            0f to Color.Black.copy(alpha = 0.55f),
            0.45f to track,
            1f to Color.Black.copy(alpha = 0.25f),
            startY = top,
            endY = top + height,
        ),
        Offset(left, top),
        Size(width, height),
        corner,
    )

    // Fill in twenty cells, each at its own phosphor strength.
    for (i in 0 until cells) {
        val cellStart = innerWidth * i / cells
        if (cellStart >= filled) break
        val cellWidth = minOf(innerWidth / cells, filled - cellStart)
        val x = innerLeft + cellStart
        val uneven = 0.74f + 0.26f * (((i * 37) % 11) / 10f)
        clipRect(x, innerTop, x + cellWidth, innerTop + innerHeight) {
            drawRect(
                Brush.verticalGradient(
                    0f to accent.copy(alpha = 0.52f * uneven),
                    0.4f to accent.copy(alpha = 0.95f * uneven),
                    0.75f to accent.copy(alpha = 0.66f * uneven),
                    1f to accent.copy(alpha = 0.9f * uneven),
                    startY = innerTop,
                    endY = innerTop + innerHeight,
                ),
                Offset(x, innerTop),
                Size(cellWidth, innerHeight),
            )
            var band = innerTop
            val step = 3.dp.toPx()
            while (band < innerTop + innerHeight) {
                drawRect(Color.Black.copy(alpha = 0.10f), Offset(x, band), Size(cellWidth, 1f))
                band += step
            }
        }
    }

    // Top shadow inside the channel, and the lit floor above the bottom lip.
    clipRect(left, top, left + width, top + height) {
        drawRect(
            Brush.verticalGradient(
                0f to Color.Black.copy(alpha = 0.45f),
                1f to Color.Transparent,
                startY = top,
                endY = top + height * 0.45f,
            ),
            Offset(left, top),
            Size(width, height * 0.45f),
        )
        drawRect(Color.White.copy(alpha = 0.05f), Offset(left + 2f, top + height - 2f), Size(width - 4f, 1f))
    }

    // Scale: 20 divisions, every fifth one longer; light is not even.
    repeat(19) { i ->
        val division = i + 1
        val x = left + width * division / 20f
        val tall = division % 5 == 0
        val tickHeight = if (tall) height * 0.38f else height * 0.22f
        val overFill = x < innerLeft + filled
        val tick = if (overFill) Color.Black.copy(alpha = 0.30f) else edge.copy(alpha = 0.22f)
        drawRect(tick, Offset(x, top + height - tickHeight), Size(1f, tickHeight))
    }

    if (filled > 0f) {
        // Leading edge: a hot 1.5 px line with a short falloff that breathes at 99 %.
        val edgeX = innerLeft + filled
        val breath = 0.55f + 0.45f * (0.5f + 0.5f * sin(2.0 * PI * phase * 3.0).toFloat())
        drawRect(accent.copy(alpha = 0.95f), Offset(edgeX - 1.5f, innerTop), Size(1.5f, innerHeight))
        drawRect(accent.copy(alpha = 0.16f * breath), Offset(edgeX - 1.5f, top), Size(7.dp.toPx(), height))
    }

    // Slow sweep across the rail; parked at a fixed spot when motion is off.
    val band = width * 0.16f
    val sweepX = left - band + ((phase * 0.9f) % 1f) * (width + band)
    clipRect(left, top, left + width, top + height) {
        drawRect(
            Brush.horizontalGradient(
                0f to Color.Transparent,
                0.5f to Color.White.copy(alpha = 0.055f),
                1f to Color.Transparent,
                startX = sweepX,
                endX = sweepX + band,
            ),
            Offset(sweepX, top),
            Size(band, height),
        )
    }

    // Wear: a few dark dropouts that move between frames.
    val seed = (phase * 1000f).toInt()
    repeat(3) { i ->
        val hash = (seed / 37 + i * 53) % 97
        if (hash < 12) {
            val x = left + width * (hash / 97f)
            drawRect(track.copy(alpha = 0.6f), Offset(x, top + height * 0.22f), Size(2f, height * 0.56f))
        }
    }

    // A 1 dp worn frame around the channel, heavier along the bottom.
    drawRoundRect(
        edge.copy(alpha = if (fault) 0.6f else 0.5f),
        Offset(left, top),
        Size(width, height),
        corner,
        style = Stroke(1f),
    )
    drawRect(Color.Black.copy(alpha = 0.55f), Offset(left + 2f, top + height - 1f), Size(width - 4f, 1f))
}

/**
 * The rail on its own, for pages that carry their own title. [progress] and
 * [phase] are read during draw, so the fill moves without recomposing the page.
 */
@Composable
fun FairyBootRail(
    progress: () -> Float,
    phase: () -> Float,
    modifier: Modifier = Modifier,
    fault: Boolean = false,
    height: Dp = 16.dp,
) {
    val tokens = LocalFairyTokens.current
    Canvas(modifier.fillMaxWidth().height(height)) {
        drawHddBar(
            progress = progress(),
            phase = phase(),
            fault = fault,
            top = 1f,
            left = 1f,
            width = size.width - 2f,
            height = size.height - 2f,
            track = tokens.screenEdge,
            edge = tokens.hairline,
            accent = if (fault) tokens.danger else tokens.signal,
        )
    }
}
