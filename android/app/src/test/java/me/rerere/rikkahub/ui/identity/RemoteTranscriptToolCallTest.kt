package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import me.rerere.rikkahub.data.datastore.DisplayPreferences
import me.rerere.rikkahub.data.datastore.LocalDisplayPreferences
import me.rerere.rikkahub.data.remote.RemoteChatMessage
import me.rerere.rikkahub.ui.fairy.AgoraMotionPolicy
import me.rerere.rikkahub.ui.fairy.FairyAppTheme
import me.rerere.rikkahub.ui.fairy.LocalAgoraMotionPolicy
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * #213: a step that requested tools is a visible transcript entry naming the
 * tool, in the order the message requested it, before and after settling.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemoteTranscriptToolCallTest {
    @get:Rule val compose = createComposeRule()

    private val question = RemoteChatMessage("u1", 2, role = 1, status = 2, text = "帮我看看仓库")
    private val toolStep = RemoteChatMessage("a1", 4, role = 2, status = 2, text = "",
        tools = listOf("bash", "read"))

    private fun show(messages: List<RemoteChatMessage>, attempt: String? = null,
        attemptTools: List<String> = emptyList()) {
        compose.setContent {
            CompositionLocalProvider(LocalDisplayPreferences provides DisplayPreferences()) {
                FairyAppTheme {
                    CompositionLocalProvider(LocalAgoraMotionPolicy provides AgoraMotionPolicy(true)) {
                        RemoteTranscript(messages, attempt, attempt?.let { "g" to "a" }, false, { _, _ -> },
                            attemptTools = attemptTools, modifier = Modifier.fillMaxSize())
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(500)
        compose.waitForIdle()
    }

    // The message column merges its semantics, so an individual tool line is only its own node
    // in the unmerged tree.
    private fun top(text: String) = compose.onNodeWithText(text, useUnmergedTree = true)
        .fetchSemanticsNode().boundsInRoot.top

    @Test fun `a tool-call step names every tool it used`() {
        show(listOf(question, toolStep))

        compose.onNodeWithText("调用工具 · bash", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("调用工具 · read", useUnmergedTree = true).assertExists()
    }

    @Test fun `the names keep the order the message requested them`() {
        show(listOf(question, toolStep))

        assertTrue("bash is requested first, so it must render above read", top("调用工具 · bash") < top("调用工具 · read"))
    }

    @Test fun `a step still streaming shows the tool it has already requested`() {
        // The live row has no committed message yet; the name comes from the attempt.
        show(listOf(question), attempt = "正在读取。", attemptTools = listOf("bash"))

        compose.onNodeWithText("调用工具 · bash", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("正在读取。").assertExists()
    }

    @Test fun `the tool entry stays while the next step streams`() {
        show(listOf(question, toolStep), attempt = "正在整理结果。")

        compose.onNodeWithText("调用工具 · bash", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("调用工具 · read", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("正在整理结果。").assertExists()
    }
}
