package me.rerere.rikkahub.ui.fairy

import androidx.compose.ui.geometry.Offset
import org.junit.Assert.assertEquals
import org.junit.Test

class FairyEyeTest {
    @Test
    fun `highlight follows gaze and scales around the moving pupil`() {
        val center = Offset(120f, 80f)
        val gaze = Offset(6f, -4f)
        val unit = 3f
        val resting = fairyEyeHighlightCenter(center, unit, Offset.Zero, pupil = 1f)
        val moved = fairyEyeHighlightCenter(center, unit, gaze, pupil = 1.2f)

        val restingOffset = resting - center
        val movedOffset = moved - (center + gaze)
        assertEquals(restingOffset.x * 1.2f, movedOffset.x, 0.0001f)
        assertEquals(restingOffset.y * 1.2f, movedOffset.y, 0.0001f)
    }
}
