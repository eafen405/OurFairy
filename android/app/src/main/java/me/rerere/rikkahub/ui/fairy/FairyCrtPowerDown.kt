package me.rerere.rikkahub.ui.fairy

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.unit.dp

private const val POWER_DOWN_MS = 380

/**
 * CRT power-down over [content], the bookend to [FairyCrtPowerOn]: the picture
 * squeezes to a line (62 % of the run), the line loses width and fades, then
 * [onCollapsed] is called so the host can navigate while the glass is dark.
 * Reduced Motion collapses without animating. It draws nothing when idle and
 * takes no input, so touches reach the content while the screen is live.
 */
@Composable
fun FairyCrtPowerDown(
    active: Boolean,
    onCollapsed: () -> Unit,
    modifier: Modifier = Modifier,
    content: @Composable () -> Unit,
) {
    val motion = LocalAgoraMotionPolicy.current.allowContinuousMotion
    val glow = LocalFairyTokens.current.fairyGlow
    val progress = remember { Animatable(0f) }
    val collapse by rememberUpdatedState(onCollapsed)
    LaunchedEffect(active) {
        if (!active) {
            progress.snapTo(0f)
            return@LaunchedEffect
        }
        if (!motion) {
            collapse()
            return@LaunchedEffect
        }
        progress.snapTo(0f)
        progress.animateTo(1f, tween(POWER_DOWN_MS, easing = LinearEasing))
        collapse()
        progress.snapTo(0f)
    }
    Box(modifier.fillMaxSize()) {
        Box(
            Modifier
                .fillMaxSize()
                .graphicsLayer {
                    val p = progress.value
                    if (p > 0f) {
                        val close = (p / 0.62f).coerceIn(0f, 1f)
                        val line = ((p - 0.62f) / 0.38f).coerceIn(0f, 1f)
                        scaleY = (1f - 0.975f * close * close).coerceAtLeast(0.02f)
                        scaleX = 1f - 0.10f * line
                        alpha = 1f - 0.22f * close
                        transformOrigin = TransformOrigin.Center
                    } else {
                        scaleY = 1f
                        scaleX = 1f
                        alpha = 1f
                    }
                },
        ) { content() }
        Canvas(Modifier.fillMaxSize()) {
            val p = progress.value
            if (p <= 0f) return@Canvas
            val close = (p / 0.62f).coerceIn(0f, 1f)
            drawRect(Color.Black.copy(alpha = 0.16f * close))
            // The collapsing line: a dim tube glow under a white core.
            val t = ((p - 0.55f) / 0.45f).coerceIn(0f, 1f)
            if (t <= 0f) return@Canvas
            val core = 2.dp.toPx()
            val width = size.width * (1f - 0.94f * t * t)
            val fade = (1f - t).coerceIn(0f, 1f)
            val cy = size.height / 2f
            val glowHeight = core * 18f
            drawRect(
                Brush.verticalGradient(
                    0f to Color.Transparent,
                    0.5f to glow.copy(alpha = 0.45f * fade),
                    1f to Color.Transparent,
                    startY = cy - glowHeight / 2f,
                    endY = cy + glowHeight / 2f,
                ),
                Offset((size.width - width) / 2f, cy - glowHeight / 2f),
                Size(width, glowHeight),
            )
            drawRect(
                Color.White.copy(alpha = fade),
                Offset((size.width - width) / 2f, cy - core / 2f),
                Size(width, core),
            )
        }
    }
}
