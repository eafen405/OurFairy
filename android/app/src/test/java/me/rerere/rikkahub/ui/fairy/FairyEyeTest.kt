package me.rerere.rikkahub.ui.fairy

import androidx.compose.ui.geometry.Offset
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

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

    @Test
    fun `a glance in stand-by is shown now and is not replayed on waking`() {
        val motion = FairyEyeMotion(seed = 5)
        val input = FairyEyeInput().apply { asleep = true }
        repeat(120) { motion.advance(16f, FairyPresence.IDLE, input) }
        assertEquals("待机时视线静止", 0f, motion.gazeX, 0.05f)
        assertEquals("待机时视线静止", 0f, motion.gazeY, 0.05f)
        assertEquals("待机时瞳孔仍保持放大", restingPupil(asleep = true), motion.pupil, 0.01f)

        // A real output/delivery arrives while the screen dozes: the glance must be visible now.
        input.glance = Offset(1.9f, 0f)
        input.glanceMs = 700f
        input.glances = 1
        repeat(8) { motion.advance(16f, FairyPresence.IDLE, input) }
        assertTrue("待机中的视线反应必须当下可见，而不是等到醒来", motion.gazeX > 0.5f)

        // It is a transient reaction: once played it settles back into the still stand-by pose.
        repeat(140) { motion.advance(16f, FairyPresence.IDLE, input) }
        assertTrue("视线反应结束后回到待机静止", abs(motion.gazeX) < 0.2f)

        // Waking does not replay it. SPEAKING's fixations stay near the centre; a stale glance at
        // 1.9 eye units would still be pulling the gaze there at this point.
        input.asleep = false
        input.wakes = 1
        repeat(20) { motion.advance(16f, FairyPresence.SPEAKING, input) }
        assertTrue("醒来不得补播已经结算的视线", motion.gazeX < 0.9f)
    }

    @Test
    fun `stand-by without a reaction keeps the eye still`() {
        val motion = FairyEyeMotion(seed = 9)
        val input = FairyEyeInput().apply { asleep = true }
        repeat(120) { motion.advance(16f, FairyPresence.IDLE, input) }

        assertEquals("没有反应时待机视线不漂移", 0f, motion.gazeX, 0.05f)
        assertEquals("没有反应时待机视线不漂移", 0f, motion.gazeY, 0.05f)
        assertEquals("待机瞳孔保持放大", restingPupil(asleep = true), motion.pupil, 0.01f)
    }
}
