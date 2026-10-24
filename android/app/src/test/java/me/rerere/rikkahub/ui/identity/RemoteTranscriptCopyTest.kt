package me.rerere.rikkahub.ui.identity

import android.app.Application
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.test.core.app.ApplicationProvider
import me.rerere.rikkahub.data.datastore.DisplayPreferences
import me.rerere.rikkahub.data.datastore.LocalDisplayPreferences
import me.rerere.rikkahub.data.remote.RemoteChatMessage
import me.rerere.rikkahub.ui.fairy.FairyAppTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowToast

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemoteTranscriptCopyTest {
    @get:Rule val compose = createComposeRule()
    private var live by mutableStateOf<String?>(null)

    private fun show(messages: List<RemoteChatMessage>) {
        compose.setContent {
            CompositionLocalProvider(LocalDisplayPreferences provides DisplayPreferences()) {
                FairyAppTheme {
                    RemoteTranscript(
                        messages = messages,
                        attemptText = live,
                        attemptKey = "g" to "a",
                        downloadEnabled = false,
                        onDownload = { _, _ -> },
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
        }
        compose.waitForIdle()
    }

    private fun clipboard() = ApplicationProvider.getApplicationContext<Application>()
        .getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    private fun clipboardText() = clipboard().primaryClip?.getItemAt(0)?.text?.toString()

    private fun longPress(text: String) {
        compose.onNodeWithText(text).performTouchInput { longClick() }
        compose.waitForIdle()
    }

    @Test fun `settled fairy message copies its raw body`() {
        val body = "Fairy 的完整回复。"
        show(listOf(RemoteChatMessage("fairy", 1, role = 2, status = 2, text = body)))

        longPress(body)
        compose.onNodeWithText("复制").performClick()
        compose.waitForIdle()

        assertEquals(body, clipboardText())
        assertEquals("已复制", ShadowToast.getTextOfLatestToast())
    }

    @Test fun `user message copies its raw body`() {
        val body = "用户的这行话。"
        show(listOf(RemoteChatMessage("user", 1, role = 1, status = 2, text = body)))

        longPress(body)
        compose.onNodeWithText("复制").performClick()
        compose.waitForIdle()

        assertEquals(body, clipboardText())
        assertEquals("已复制", ShadowToast.getTextOfLatestToast())
    }

    @Test fun `streaming row copies the text that has arrived`() {
        live = "流式已到的正文。"
        show(emptyList())

        longPress("流式已到的正文。")
        compose.onNodeWithText("查看全文").assertDoesNotExist()
        compose.onNodeWithText("复制").performClick()
        compose.waitForIdle()

        assertEquals("流式已到的正文。", clipboardText())
        assertEquals("已复制", ShadowToast.getTextOfLatestToast())
    }

    @Test fun `an open streaming menu copies the latest arrived text`() {
        live = "第一段。"
        show(emptyList())

        longPress("第一段。")
        compose.runOnIdle { live = "第一段。\n第二段。" }
        compose.waitForIdle()
        compose.onNodeWithText("复制").performClick()
        compose.waitForIdle()

        assertEquals("第一段。\n第二段。", clipboardText())
    }

    @Test fun `viewing the full settled message keeps the existing dialog`() {
        val body = "需要展开的完整回复。"
        show(listOf(RemoteChatMessage("fairy", 1, role = 2, status = 2, text = body)))

        longPress(body)
        compose.onNodeWithText("查看全文").performClick()
        compose.waitForIdle()

        compose.onNodeWithText("查看全文").assertDoesNotExist()
        compose.onNodeWithText("关闭").assertExists().performClick()
        compose.waitForIdle()
        compose.onNodeWithText("关闭").assertDoesNotExist()
    }
}
