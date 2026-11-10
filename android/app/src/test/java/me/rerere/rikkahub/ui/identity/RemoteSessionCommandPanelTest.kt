package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import me.rerere.rikkahub.data.remote.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.text.TextLayoutResult
import me.rerere.rikkahub.ui.fairy.LocalFairyTokens
import me.rerere.rikkahub.ui.fairy.FairyAppTheme
import org.junit.After
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemoteSessionCommandPanelTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val backend = object : RemoteChatBackend, RemoteSessionCommandBackend {
        val sent = mutableListOf<String>()
        val commands = mutableListOf<Int>()
        var gate: CompletableDeferred<Unit>? = null
        var failed = false
        var outcome = 1
        var queryFailure: Exception? = null
        override fun observe(token: String, sessionId: String) = MutableSharedFlow<RemoteChatProjection>(replay = 1).apply {
            tryEmit(RemoteChatProjection(sessionId))
        }
        override suspend fun checkpoint(token: String, sessionId: String) = -1L
        override suspend fun page(token: String, sessionId: String, throughSeq: Long, beforeSeq: Long) = error("unused")
        override suspend fun read(token: String, sessionId: String) = error("unused")
        override suspend fun send(token: String, sessionId: String, requestId: String, text: String, uploadIds: List<String>): ChatReceipt {
            sent += text
            return ChatReceipt(sessionId, requestId, "message", 0)
        }
        override suspend fun receipt(token: String, sessionId: String, requestId: String): ChatReceipt? = null
        override suspend fun stop(token: String, sessionId: String) = Unit
        override suspend fun executeCommand(token: String, sessionId: String, requestId: String, command: Int): RemoteSessionCommandSnapshot {
            commands += command
            gate?.await()
            return if (failed) RemoteSessionCommandSnapshot(sessionId, requestId, "op", command, 5, 0, 1,
                RemoteSessionCommandError(2, "压缩模型不可用"))
            else RemoteSessionCommandSnapshot(sessionId, requestId, "op", command, outcome, 0,
                if (outcome >= 2) 1 else null)
        }
        override suspend fun commandStatus(token: String, sessionId: String, requestId: String): RemoteSessionCommandSnapshot? {
            queryFailure?.let { throw it }
            return null
        }
    }
    private val store = object : ChatSyncStore {
        var record = ChatSyncRecord()
        override suspend fun load(key: ChatSyncKey) = record
        override suspend fun save(key: ChatSyncKey, record: ChatSyncRecord) { this.record = record }
    }
    private val files = object : RemoteAttachmentBackend {
        override suspend fun upload(token: String, sessionId: String, file: java.io.File, name: String, mime: String) =
            RemoteAttachmentUpload("upload", name, mime, file.length(), "hash", 1, file.length(), Long.MAX_VALUE)
        override suspend fun download(token: String, sessionId: String, messageId: String, attachment: RemoteChatAttachment, destination: java.io.File) = Unit
    }
    private val state = RemoteChatState(backend, scope, store, "https://fairy.test", attachmentsBackend = files)
    @After fun close() { scope.cancel() }
    private var signal = Color.Unspecified
    private fun show() {
        state.bind("alice", "main", 1)
        compose.setContent { FairyAppTheme {
            signal = LocalFairyTokens.current.signal
            RemoteChatPanel(state, {})
        } }
        compose.waitForIdle()
    }
    private fun editor() = compose.onNode(hasSetTextAction())

    private fun editorColor(): Color {
        val layouts = mutableListOf<TextLayoutResult>()
        editor().fetchSemanticsNode().config[SemanticsActions.GetTextLayoutResult].action!!.invoke(layouts)
        return layouts.single().layoutInput.style.color
    }

    @Test fun `query failure after acceptance shows its reason and keeps editing available`() {
        backend.queryFailure = IdentityRefused(500, "chat/flush-failed", "结果尚未持久保存")
        show()
        editor().performTextInput("/compact")
        compose.onNodeWithContentDescription("发送消息").performClick()
        compose.onNodeWithText("操作结果待确认：结果尚未持久保存").assertExists()
        editor().performTextInput("later input")
        editor().assertTextContains("later input")
        compose.onNodeWithText("重试命令").assertExists()
        assertEquals(1, backend.commands.size)
    }

    @Test fun `durable HTTP reset completion explains what is retained`() {
        backend.outcome = 4
        show()
        editor().performTextInput("/clear")
        compose.onNodeWithContentDescription("发送消息").performClick()
        compose.onNodeWithText("上下文已重置").assertExists()
        compose.onNodeWithText("聊天历史、印象、长期记忆与可用技能仍保留").assertExists()
        compose.onNodeWithText("Fairy", useUnmergedTree = true).assertDoesNotExist()
        assertTrue(backend.sent.isEmpty())
    }

    @Test fun `complete command with ready attachment keeps every draft and sends nothing`() {
        show()
        val file = java.io.File.createTempFile("command-attachment", ".txt").apply { writeText("original") }
        compose.runOnIdle { state.addAttachment(state.snapshot.value.attachmentEpoch, file, "note.txt", "text/plain") }
        compose.waitUntil { state.snapshot.value.attachments.singleOrNull()?.uploadId != null }
        val original = state.snapshot.value.attachments
        editor().performTextInput(" /clear ")
        compose.onNodeWithContentDescription("发送消息").performClick()
        compose.onNodeWithText("执行命令前请先移除附件").assertExists()
        editor().assertTextContains(" /clear ")
        assertEquals(original, state.snapshot.value.attachments)
        assertTrue(backend.commands.isEmpty())
        assertTrue(backend.sent.isEmpty())
        compose.onNodeWithText("移除").performClick()
        compose.onNodeWithContentDescription("发送消息").performClick()
        compose.waitForIdle()
        assertEquals(listOf(2), backend.commands)
    }

    @Test fun `unmatched slash input and ordinary text preserve their exact chat bytes`() {
        show()
        val texts = listOf("/", "/cl", "/unknown", "/clear explanation", "talk about /compact", " /cl ")
        for (text in texts) {
            editor().performTextReplacement(text)
            compose.onNodeWithContentDescription("发送消息").performClick()
            compose.waitForIdle()
        }
        assertEquals(texts, backend.sent)
        assertTrue(backend.commands.isEmpty())
    }

    @Test fun `command failure preserves a newer draft and permits explicit retry`() {
        val gate = CompletableDeferred<Unit>()
        backend.gate = gate
        backend.failed = true
        show()
        editor().performTextInput("/compact")
        compose.onNodeWithContentDescription("发送消息").performClick()
        compose.onNodeWithText("正在压缩上下文…").assertExists()
        editor().performTextInput("later draft")
        compose.runOnIdle { gate.complete(Unit) }
        compose.waitUntil { state.snapshot.value.sessionCommand?.failed == true }
        compose.onNodeWithText("压缩模型不可用", substring = true).assertExists()
        compose.onNodeWithText("恢复命令草稿").assertIsNotEnabled()
        editor().assertTextContains("later draft")
        compose.onNodeWithText("重试命令").performClick()
        compose.waitForIdle()
        assertEquals(listOf(1, 1), backend.commands)
        editor().assertTextContains("later draft")
        editor().performTextClearance()
        compose.onNodeWithText("恢复命令草稿").performClick()
        editor().assertTextContains("/compact")
    }

    @Test fun `whole command uses signal and deleting to prefix restores normal text color`() {
        show()
        editor().performClick().performTextInput("normal")
        val normal = editorColor()
        editor().performTextReplacement(" /clear\n")
        assertEquals(signal, editorColor())
        editor().performTextReplacement("/cl")
        assertEquals(normal, editorColor())
        compose.onNodeWithText("/clear", useUnmergedTree = true).performClick()
        assertEquals(signal, editorColor())
        editor().performTextReplacement("/compact")
        assertEquals(signal, editorColor())
        editor().performTextReplacement("/clear explanation")
        assertEquals(normal, editorColor())
        compose.onAllNodes(hasText("/clear") and hasClickAction()).assertCountEquals(0)
        editor().performTextReplacement("talk about /clear")
        assertEquals(normal, editorColor())
    }

    @Test fun `prefix candidates complete without execution and keep editor focus`() {
        show()
        editor().performClick().performTextInput("/")
        compose.onNodeWithText("/compact", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("/clear", useUnmergedTree = true).assertExists()
        editor().performTextReplacement("/cl")
        compose.onNodeWithText("/compact", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithText("/clear", useUnmergedTree = true).performClick()
        editor().assertTextContains("/clear").assertIsFocused()
        assertTrue(backend.sent.isEmpty())
        assertTrue(backend.commands.isEmpty())
        compose.onNodeWithContentDescription("发送消息").performClick()
        compose.waitForIdle()
        assertEquals(listOf(2), backend.commands)
        assertTrue(backend.sent.isEmpty())
        editor().performTextInput("new draft")
        editor().assertTextContains("new draft")
    }
}
