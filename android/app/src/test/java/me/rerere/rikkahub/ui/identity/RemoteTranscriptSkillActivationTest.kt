package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import me.rerere.rikkahub.data.datastore.DisplayPreferences
import me.rerere.rikkahub.data.datastore.LocalDisplayPreferences
import me.rerere.rikkahub.data.remote.RemoteChatMessage
import me.rerere.rikkahub.ui.fairy.AgoraMotionPolicy
import me.rerere.rikkahub.ui.fairy.FairyAppTheme
import me.rerere.rikkahub.ui.fairy.LocalAgoraMotionPolicy
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * A role-3 activation row is a quiet system line, never a user bubble or a Fairy message.
 * The legacy notification preview and role-2 filters are covered by RemoteChatStateTest.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemoteTranscriptSkillActivationTest {
    @get:Rule val compose = createComposeRule()

    private val question = RemoteChatMessage("u1", 0, 2, role = 1, status = 2, text = "帮我加载 PDF 技能")
    private val activation = RemoteChatMessage(
        messageId = "skill-activation:call-1",
        position = 1,
        seq = 7,
        requestId = null,
        role = 3,
        status = 2,
        text = "加载了skill:pdf",
        kind = 1,
        toolCallId = "call-1",
    )

    private fun show(messages: List<RemoteChatMessage>) {
        compose.setContent {
            CompositionLocalProvider(LocalDisplayPreferences provides DisplayPreferences()) {
                FairyAppTheme {
                    CompositionLocalProvider(LocalAgoraMotionPolicy provides AgoraMotionPolicy(true)) {
                        RemoteTranscript(
                            messages = messages,
                            generation = "g",
                            attempt = null,
                            downloadEnabled = false,
                            onDownload = { _, _ -> },
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(500)
        compose.waitForIdle()
    }

    @Test
    fun `the activation is a quiet line without a user or Fairy heading`() {
        show(listOf(question, activation))

        compose.onNodeWithText("加载了skill:pdf", useUnmergedTree = true).assertExists()
        compose.onAllNodesWithTag("skill-activation", useUnmergedTree = true).fetchSemanticsNodes().let {
            assertEquals("one activation line", 1, it.size)
        }
        // Only the user's own message carries the "你" heading; the activation row adds none.
        compose.onNodeWithText("你", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Fairy", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun `a kind-2 row is reserved and renders nothing until the review ticket`() {
        val review = activation.copy(messageId = "skill-review:call-2", kind = 2, text = "审核材料")
        show(listOf(question, review))

        compose.onNodeWithText("审核材料", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag("skill-activation", useUnmergedTree = true).assertDoesNotExist()
    }
}
