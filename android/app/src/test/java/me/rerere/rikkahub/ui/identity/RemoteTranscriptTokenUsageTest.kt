package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithText
import me.rerere.rikkahub.data.datastore.DisplayPreferences
import me.rerere.rikkahub.data.datastore.LocalDisplayPreferences
import me.rerere.rikkahub.data.remote.RemoteChatMessage
import me.rerere.rikkahub.data.remote.RemoteChatUsage
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
 * #323: a finished reply carries the turn's settled token spend as one quiet line under it.
 *
 * The line is a settlement the backend hands over, never a figure this client derives: it appears
 * only where a `usage` object is present, and it reports the three buckets separately so the reader
 * can tell where the spend went. It is asserted through the transcript's visible text, because the
 * reader's view is what the ticket promises.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemoteTranscriptTokenUsageTest {
    @get:Rule val compose = createComposeRule()

    private val question = RemoteChatMessage("u1", 0, 2, role = 1, status = 2, text = "帮我算一下")

    private fun reply(
        id: String,
        position: Long,
        seq: Long,
        status: Int = 2,
        text: String = "ok",
        usage: RemoteChatUsage? = null,
        turn: Int = 1,
    ) = RemoteChatMessage(
        messageId = id, position = position, seq = seq, requestId = null,
        role = 2, status = status, text = text, turn = turn, usage = usage,
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
    fun `a settled reply shows its input cache and output tokens`() {
        show(listOf(question, reply("a1", 1, 2, usage = RemoteChatUsage(input = 10, cache = 4, output = 2))))

        compose.onNodeWithText("输入 10 · 缓存 4 · 输出 2 token", useUnmergedTree = true).assertExists()
    }

    @Test
    fun `an unreported cache bucket is left out instead of shown as zero`() {
        show(listOf(question, reply("a1", 1, 2, usage = RemoteChatUsage(input = 10, output = 2))))

        compose.onNodeWithText("输入 10 · 输出 2 token", useUnmergedTree = true).assertExists()
        // Neither a 0 nor a dash: both would present an unreported figure as a measured one.
        compose.onNodeWithText("输入 10 · 缓存 0 · 输出 2 token", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithText("输入 10 · 缓存 — · 输出 2 token", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test
    fun `a reply with no reported usage shows no line at all`() {
        show(listOf(question, reply("a1", 1, 2, usage = null)))

        compose.onAllNodesWithTag("token-usage", useUnmergedTree = true).fetchSemanticsNodes().let {
            assertEquals("a reply that reported no usage must carry no readout", 0, it.size)
        }
        compose.onNodeWithText("ok", useUnmergedTree = true).assertExists()
    }

    @Test
    fun `the user's own message never carries a readout`() {
        // The backend puts the turn's spend on a Fairy row. Even if a snapshot put one on a user
        // row, the readout belongs under a reply, so the row's role has to hold this line back.
        show(
            listOf(
                question.copy(usage = RemoteChatUsage(input = 10, cache = 4, output = 2)),
                reply("a1", 1, 2),
            ),
        )

        compose.onAllNodesWithTag("token-usage", useUnmergedTree = true).fetchSemanticsNodes().let {
            assertEquals("a user message is not a reply", 0, it.size)
        }
    }

    @Test
    fun `an interrupted reply still reports what the turn already spent`() {
        show(
            listOf(
                question,
                reply("a1", 1, 2, status = 3, usage = RemoteChatUsage(input = 10, cache = 4, output = 2)),
            ),
        )

        compose.onNodeWithText("输入 10 · 缓存 4 · 输出 2 token", useUnmergedTree = true).assertExists()
        // The readout is a sibling of the status line, not a replacement for it.
        compose.onNodeWithText("已停止", useUnmergedTree = true).assertExists()
    }

    @Test
    fun `a failed reply still reports the partial spend it settled`() {
        show(
            listOf(
                question,
                reply("a1", 1, 2, status = 4, usage = RemoteChatUsage(input = 7, output = 1)),
            ),
        )

        compose.onNodeWithText("输入 7 · 输出 1 token", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("回复失败", useUnmergedTree = true).assertExists()
    }

    @Test
    fun `a multi-step turn carries one readout, on its last reply`() {
        // The turn's steps are separate rows but one interaction: the backend settles the spend on
        // the last Fairy row only, and the transcript must not add a second reading of its own.
        show(
            listOf(
                question,
                reply("a1", 1, 3, text = "", turn = 1),
                reply("a2", 2, 4, text = "", turn = 1),
                reply(
                    "a3", 3, 5, turn = 1,
                    usage = RemoteChatUsage(input = 30, cache = 9, output = 6),
                ),
            ),
        )

        compose.onNodeWithText("输入 30 · 缓存 9 · 输出 6 token", useUnmergedTree = true).assertExists()
        compose.onAllNodesWithTag("token-usage", useUnmergedTree = true).fetchSemanticsNodes().let {
            assertEquals("one interaction reports its bill once", 1, it.size)
        }
    }

    @Test
    fun `a derived display row never carries the readout`() {
        val activation = RemoteChatMessage(
            messageId = "skill-activation:call-1", position = 1, seq = 3,
            requestId = null, role = 3, status = 2, text = "加载了skill:pdf", kind = 1,
            toolCallId = "call-1",
            usage = RemoteChatUsage(input = 10, cache = 4, output = 2),
        )
        show(listOf(question, activation))

        compose.onAllNodesWithTag("token-usage", useUnmergedTree = true).fetchSemanticsNodes().let {
            assertEquals("a derived row is not a reply", 0, it.size)
        }
        compose.onNodeWithText("加载了skill:pdf", useUnmergedTree = true).assertExists()
    }
}
