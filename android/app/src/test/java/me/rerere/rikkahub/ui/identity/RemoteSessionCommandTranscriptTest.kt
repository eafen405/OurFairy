package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import me.rerere.rikkahub.data.remote.RemoteChatMessage
import me.rerere.rikkahub.data.remote.RemoteSessionCommandError
import me.rerere.rikkahub.ui.fairy.FairyAppTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemoteSessionCommandTranscriptTest {
    @get:Rule val compose = createComposeRule()

    @Test fun `command system row displays every outcome and reset is one boundary beside old history`() {
        val old = RemoteChatMessage("old", 0, 0, role = 1, status = 2, text = "old history")
        val command = RemoteChatMessage("command:op", 1, 1, "request", 3, 1, "", kind = 3,
            commandId = "op", command = 1, commandStatus = 1)
        val rows = mutableStateOf(listOf(old, command))
        compose.setContent { FairyAppTheme {
            RemoteTranscript(rows.value, "g", null, false, { _, _ -> }, modifier = Modifier.fillMaxSize())
        } }
        compose.onNodeWithText("正在压缩上下文…").assertExists()
        for ((status, label) in listOf(2 to "已压缩", 3 to "当前无需压缩", 4 to "上下文已重置", 5 to "命令失败：执行中断")) {
            compose.runOnIdle {
                rows.value = listOf(old, command.copy(seq = status.toLong(), command = if (status == 4) 2 else 1,
                    status = if (status == 5) 4 else 2, commandStatus = status,
                    commandError = if (status == 5) RemoteSessionCommandError(1, "执行中断") else null))
            }
            compose.onNodeWithText(label).assertExists()
            compose.onAllNodesWithTag("session-command", useUnmergedTree = true).assertCountEquals(1)
            compose.onNodeWithText("old history").assertExists()
            compose.onAllNodesWithText("你", useUnmergedTree = true).assertCountEquals(1)
            compose.onNodeWithText("Fairy", useUnmergedTree = true).assertDoesNotExist()
        }
    }
}
