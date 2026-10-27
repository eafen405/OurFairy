package me.rerere.rikkahub.ui.fairy

import android.graphics.Bitmap
import android.graphics.BitmapShader
import android.graphics.Shader
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.dp
import kotlin.random.Random

/**
 * The wear over the sign-in screen: a fixed grain plate, an edge vignette, a
 * slow rolling band and occasional one-frame flicker. The grain is a seeded
 * bitmap so the same dust shows on every visit; the band and flicker follow
 * the shared draw phase and stay still under Reduced Motion. It takes no
 * input, so touches reach the page underneath.
 */
@Composable
fun FairyAgedOverlay(modifier: Modifier = Modifier, phase: () -> Float) {
    val motion = LocalAgoraMotionPolicy.current.allowContinuousMotion
    val grain = remember { agedGrain() }
    Canvas(modifier) {
        drawRect(grain, Offset.Zero, size, alpha = 0.75f)

        // Vignette: the tube is bright in the middle and sags at the edges.
        drawRect(
            Brush.radialGradient(
                0.45f to Color.Transparent,
                1f to Color.Black.copy(alpha = 0.38f),
                center = Offset(size.width / 2f, size.height * 0.42f),
                radius = size.maxDimension * 0.72f,
            ),
        )
        drawRect(
            Brush.verticalGradient(
                0f to Color.Black.copy(alpha = 0.22f),
                0.18f to Color.Transparent,
                0.82f to Color.Transparent,
                1f to Color.Black.copy(alpha = 0.26f),
            ),
        )

        if (!motion) return@Canvas
        val p = phase()

        // A wide, faint band rolls down the glass once per turn.
        val bandHeight = 90.dp.toPx()
        val bandTop = -bandHeight + p * (size.height + bandHeight)
        drawRect(
            Brush.verticalGradient(
                0f to Color.Transparent,
                0.5f to Color.White.copy(alpha = 0.014f),
                1f to Color.Transparent,
                startY = bandTop,
                endY = bandTop + bandHeight,
            ),
            Offset(0f, bandTop),
            Size(size.width, bandHeight),
        )

        // Tracking faults: a couple of short, dimmer frames per turn.
        when {
            p in 0.280f..0.286f -> drawRect(Color.White.copy(alpha = 0.012f))
            p in 0.632f..0.635f -> drawRect(Color.Black.copy(alpha = 0.035f))
            p in 0.884f..0.889f -> drawRect(Color.White.copy(alpha = 0.008f))
        }
    }
}

/** Seeded dust: sparse light and dark specks on a transparent plate. */
private fun agedGrain(): ShaderBrush {
    val side = 192
    val random = Random(11)
    val pixels = IntArray(side * side)
    for (i in pixels.indices) {
        val roll = random.nextInt(1000)
        pixels[i] = when {
            roll < 28 -> Color.White.copy(alpha = 0.05f + random.nextFloat() * 0.08f).toArgb()
            roll < 54 -> Color.Black.copy(alpha = 0.05f + random.nextFloat() * 0.09f).toArgb()
            else -> 0
        }
    }
    val bitmap = Bitmap.createBitmap(pixels, side, side, Bitmap.Config.ARGB_8888)
    return ShaderBrush(BitmapShader(bitmap, Shader.TileMode.REPEAT, Shader.TileMode.REPEAT))
}
