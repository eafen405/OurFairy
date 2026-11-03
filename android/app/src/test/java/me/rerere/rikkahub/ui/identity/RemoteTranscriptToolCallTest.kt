package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import me.rerere.rikkahub.data.datastore.DisplayPreferences
import me.rerere.rikkahub.data.datastore.LocalDisplayPreferences
import me.rerere.rikkahub.data.remote.RemoteChatAttempt
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
 * #292: one step is one action. Collapsed, it shows only the newest tool it requested; the arrow
 * reveals the rest in request order. #213's text form and order stay the same.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemoteTranscriptToolCallTest {
    @get:Rule val compose = createComposeRule()

    private val question = RemoteChatMessage("u1", 0, 2, role = 1, status = 2, text = "帮我看看仓库")
    private val toolStep = RemoteChatMessage("a1", 1, 4, role = 2, status = 2, text = "",
        tools = listOf("bash", "read"))

    // The live row's tools arrive one at a time, so its attempt is driven from a mutable list.
    private var liveTools by mutableStateOf<List<String>>(emptyList())

    private fun show(messages: List<RemoteChatMessage>, attempt: RemoteChatAttempt? = null) {
        compose.setContent {
            CompositionLocalProvider(LocalDisplayPreferences provides DisplayPreferences()) {
                FairyAppTheme {
                    CompositionLocalProvider(LocalAgoraMotionPolicy provides AgoraMotionPolicy(true)) {
                        RemoteTranscript(
                            messages = messages,
                            generation = "g",
                            attempt = attempt,
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

    private fun showStreaming(messages: List<RemoteChatMessage>) {
        compose.setContent {
            CompositionLocalProvider(LocalDisplayPreferences provides DisplayPreferences()) {
                FairyAppTheme {
                    CompositionLocalProvider(LocalAgoraMotionPolicy provides AgoraMotionPolicy(true)) {
                        RemoteTranscript(
                            messages = messages,
                            generation = "g",
                            attempt = RemoteChatAttempt(
                                attemptId = "a", revision = 0, text = "正在读取。", tools = liveTools),
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

    private fun expand() {
        compose.onNodeWithContentDescription("展开工具调用").performClick()
        compose.waitForIdle()
    }

    private fun collapse() {
        compose.onNodeWithContentDescription("收起工具调用").performClick()
        compose.waitForIdle()
    }

    // The message column merges its semantics, so an individual tool line is only its own node
    // in the unmerged tree.
    private fun top(text: String) = compose.onNodeWithText(text, useUnmergedTree = true)
        .fetchSemanticsNode().boundsInRoot.top

    @Test fun `a step with several tools starts collapsed on the latest name`() {
        show(listOf(question, toolStep))

        compose.onNodeWithText("调用工具 · read", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("调用工具 · bash", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithContentDescription("展开工具调用").assertExists()
    }

    @Test fun `expanding a step reveals every tool in request order`() {
        show(listOf(question, toolStep))

        expand()

        compose.onNodeWithText("调用工具 · bash", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("调用工具 · read", useUnmergedTree = true).assertExists()
        assertTrue("bash is requested first, so it must render above read", top("调用工具 · bash") < top("调用工具 · read"))
        compose.onNodeWithContentDescription("收起工具调用").assertExists()
    }

    @Test fun `collapsing a step hides the earlier names again`() {
        show(listOf(question, toolStep))
        expand()

        collapse()

        compose.onNodeWithText("调用工具 · read", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("调用工具 · bash", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithContentDescription("展开工具调用").assertExists()
    }

    @Test fun `a step with one tool shows it and no control`() {
        val singleTool = toolStep.copy(messageId = "a2", position = 2, seq = 6, tools = listOf("bash"))
        show(listOf(question, singleTool))

        compose.onNodeWithText("调用工具 · bash", useUnmergedTree = true).assertExists()
        compose.onNodeWithContentDescription("展开工具调用").assertDoesNotExist()
        compose.onNodeWithContentDescription("收起工具调用").assertDoesNotExist()
    }

    @Test fun `a streaming step keeps its newest tool collapsed as the list grows`() {
        liveTools = listOf("bash")
        showStreaming(listOf(question))

        compose.onNodeWithText("调用工具 · bash", useUnmergedTree = true).assertExists()
        compose.onNodeWithContentDescription("展开工具调用").assertDoesNotExist()

        compose.runOnIdle { liveTools = listOf("bash", "read") }
        compose.waitForIdle()

        compose.onNodeWithText("调用工具 · read", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("调用工具 · bash", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithContentDescription("展开工具调用").assertExists()
    }

    @Test fun `a step still streaming shows the tool it has already requested`() {
        // The live row has no committed message yet; the name comes from the attempt.
        show(listOf(question), attempt = RemoteChatAttempt(
            attemptId = "a", revision = 0, text = "正在读取。", tools = listOf("bash")))

        compose.onNodeWithText("调用工具 · bash", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("正在读取。").assertExists()
    }

    @Test fun `the tool entry stays while the next step streams`() {
        show(listOf(question, toolStep), attempt = RemoteChatAttempt(
            attemptId = "a", revision = 0, text = "正在整理结果。"))

        compose.onNodeWithText("调用工具 · read", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("调用工具 · bash", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithText("正在整理结果。").assertExists()
    }

    @Test fun `the expand control does not open the message menu`() {
        val settled = toolStep.copy(text = "整理完成。")
        show(listOf(question, settled))

        compose.onNodeWithContentDescription("展开工具调用").performTouchInput { longClick() }
        compose.waitForIdle()

        compose.onNodeWithText("复制").assertDoesNotExist()
        compose.onNodeWithText("查看全文").assertDoesNotExist()
    }
}
