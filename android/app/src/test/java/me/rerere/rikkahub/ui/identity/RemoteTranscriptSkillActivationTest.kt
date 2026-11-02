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
    fun `a kind-2 row renders the backend review panel verbatim, not a bubble`() {
        val display = "技能候选 demo（个人，版本 7，哈希 abc）\n新技能，420 字符\n验证：实际执行 1，复用 0，未执行 0，失败 0"
        val review = activation.copy(messageId = "skill-review:call-2", kind = 2, text = display)
        show(listOf(question, review))

        compose.onNodeWithTag("skill-review", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("技能审核", useUnmergedTree = true).assertExists()
        compose.onNodeWithText(display, useUnmergedTree = true).assertExists()
        compose.onNodeWithText("Fairy", useUnmergedTree = true).assertDoesNotExist()
        compose.onAllNodesWithTag("skill-activation", useUnmergedTree = true).fetchSemanticsNodes().let {
            assertEquals("a review row is not an activation line", 0, it.size)
        }
    }

    @Test
    fun `a growth review row renders the backend's characters and confirmation instruction verbatim`() {
        val display = "技能候选 growth（个人，版本 9，哈希 abc）\n" +
            "相对父版本：新增 0 个，删除 0 个，修改 1 个\n" +
            "核心正文 1000 → 1110 字符（+11.0%）\n" +
            "目标收益：add two verified steps\n" +
            "验证：实际执行 1，复用 0，未执行 0，失败 0\n" +
            "✔ check: true → exit 0\n" +
            "查看全文：skill_manage inspect versionId=9 expand=skill\n" +
            "篇幅增长超过 10%，批准前请在展示后单独回复「确认增长」"
        val review = activation.copy(messageId = "skill-review:call-9", kind = 2, text = display)
        show(listOf(question, review))

        compose.onNodeWithTag("skill-review", useUnmergedTree = true).assertExists()
        compose.onNodeWithText(display, useUnmergedTree = true).assertExists()
        compose.onNodeWithText("核心正文 1000 → 1110 字符（+11.0%）", substring = true, useUnmergedTree = true).assertExists()
        compose.onNodeWithText("确认增长", substring = true, useUnmergedTree = true).assertExists()
    }
}
