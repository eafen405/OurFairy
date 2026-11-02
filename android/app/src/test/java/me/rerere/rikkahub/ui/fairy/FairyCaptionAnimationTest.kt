package me.rerere.rikkahub.ui.fairy

import android.app.Application
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * #291: the stand-by dialog box leaves the console with the same translation it
 * arrives with. Its height grows and shrinks over frames instead of being
 * inserted and deleted in one, so the info card and buttons below travel with
 * it.
 *
 * The seam is [FairyCaptionSlot]: the dialog box is its content, and the marker
 * below stands in for the card and buttons whose travel the reader sees. The
 * console page mounts exactly this slot between its screen and its card.
 *
 * The clock is paused and every [advance] is one frame: a state write from the
 * test reaches composition one frame later ([WRITE_FRAME_MS]), so each phase
 * samples the transition by the time elapsed *since its own first frame*.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FairyCaptionAnimationTest {
    @get:Rule val compose = createComposeRule()

    /** One segment, so no segment gives way to the next during the frames under test. */
    private val line = FairyLine(id = 1, segments = listOf("主人，我正在待机。"))

    /** The caption the test shows and settles, as the console page does. */
    private class Caption {
        var line by mutableStateOf<FairyLine?>(null)
    }

    private fun show(reduceMotion: Boolean, caption: Caption) {
        compose.mainClock.autoAdvance = false
        compose.setContent {
            FairyAppTheme {
                ProvideAgoraMotionPolicy(appReduceMotion = reduceMotion) {
                    Column(Modifier.fillMaxWidth()) {
                        FairyCaptionSlot(
                            line = caption.line,
                            onFinished = {},
                            modifier = Modifier.testTag("fairy-caption"),
                        )
                        Box(Modifier.fillMaxWidth().height(40.dp).testTag("below"))
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
    }

    /** One frame, [ms] after the previous one. */
    private fun advance(ms: Long) {
        compose.mainClock.advanceTimeBy(ms)
        compose.waitForIdle()
    }

    /**
     * The frame a test-driven state write is first composed on, plus the frame
     * the slot's own transition starts on. The second frame after the write is
     * the transition's zero: its height is still the old one there.
     */
    private fun framesAfterWrite(count: Int = 2) {
        repeat(count) { advance(WRITE_FRAME_MS) }
    }

    /**
     * The marker's top edge: where the content below the dialog box sits. Every
     * assertion below is about this number moving gradually (or not at all).
     */
    private fun markerTop(): Float =
        compose.onNodeWithTag("below").fetchSemanticsNode().boundsInRoot.top

    @Test fun `the caption grows and shrinks over frames and the content below follows`() {
        val caption = Caption()
        show(reduceMotion = false, caption)
        val base = markerTop()

        // Appearance: the panel is composed on the first frame after the line
        // and its height grows over the transition, carrying the marker down.
        compose.runOnIdle { caption.line = line }
        framesAfterWrite()
        compose.onNodeWithTag("fairy-caption").assertExists()
        advance(100)
        val arriving = markerTop()
        advance(FAIRY_CAPTION_TRANSITION_MS.toLong())
        val extended = markerTop()
        assertTrue(
            "待机对话框出现时下方内容应逐帧下移: base=$base arriving=$arriving extended=$extended",
            arriving > base + 5f && arriving < extended - 5f,
        )
        assertTrue("待机对话框应撑开自己的高度: extended=$extended", extended > base + 20f)

        // Disappearance: the settled line stays composed while the panel
        // shrinks, and the marker travels back up frame by frame. Before #291
        // this was an instant removal that snapped the card and buttons back.
        compose.runOnIdle { caption.line = null }
        framesAfterWrite()
        compose.onNodeWithTag("fairy-caption").assertExists()
        compose.onNodeWithText(line.segments[0]).assertExists()
        advance(100)
        val leaving = markerTop()
        assertTrue(
            "待机对话框消失时下方内容应逐帧上移，而不是瞬移: base=$base extended=$extended leaving=$leaving",
            leaving < extended - 5f && leaving > base + 5f,
        )
        advance(FAIRY_CAPTION_TRANSITION_MS.toLong())
        assertEquals("消失动画结束后下方内容归位", base, markerTop(), 0.5f)
        compose.onNodeWithTag("fairy-caption").assertDoesNotExist()
    }

    @Test fun `reduced motion inserts and removes the caption in one frame`() {
        val caption = Caption()
        show(reduceMotion = true, caption)
        val base = markerTop()

        compose.runOnIdle { caption.line = line }
        framesAfterWrite()
        advance(50)
        val immediate = markerTop()
        advance(FAIRY_CAPTION_TRANSITION_MS.toLong())
        val settled = markerTop()
        assertTrue("Reduced Motion 下对话框仍占位: base=$base settled=$settled", settled > base + 20f)
        assertEquals("Reduced Motion 下对话框出现即完成，不逐帧撑开", settled, immediate, 0.5f)

        compose.runOnIdle { caption.line = null }
        framesAfterWrite()
        advance(50)
        assertEquals("Reduced Motion 下对话框立即让出位置", base, markerTop(), 0.5f)
        compose.onNodeWithTag("fairy-caption").assertDoesNotExist()
    }

    private companion object {
        /** The frame duration the paused test clock uses. */
        const val WRITE_FRAME_MS = 16L
    }
}
