package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableSharedFlow
import me.rerere.rikkahub.data.remote.ChatReceipt
import me.rerere.rikkahub.data.remote.ChatSyncKey
import me.rerere.rikkahub.data.remote.ChatSyncRecord
import me.rerere.rikkahub.data.remote.ChatSyncStore
import me.rerere.rikkahub.data.remote.IdentityUnreachable
import me.rerere.rikkahub.data.remote.RemoteActivity
import me.rerere.rikkahub.data.remote.RemoteChatBackend
import me.rerere.rikkahub.data.remote.RemoteChatProjection
import me.rerere.rikkahub.data.remote.RemoteChatState
import me.rerere.rikkahub.ui.fairy.FairyAppTheme
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The panel's retry report: `onSendAccepted` is a fact ("this send was accepted"), not an
 * optimistic signal. The state is the one that knows whether it took the retry; the panel must
 * forward the request id only when it did.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemoteChatPanelRetryTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val backend = object : RemoteChatBackend {
        override fun observe(token: String, sessionId: String) =
            MutableSharedFlow<RemoteChatProjection>(replay = 1).apply {
                tryEmit(RemoteChatProjection(sessionId, activity = RemoteActivity(status = 1)))
            }
        override suspend fun checkpoint(token: String, sessionId: String) = 0L
        override suspend fun page(token: String, sessionId: String, throughSeq: Long, beforeSeq: Long) =
            error("not used")
        override suspend fun read(token: String, sessionId: String) = error("not used")
        override suspend fun send(
            token: String,
            sessionId: String,
            requestId: String,
            text: String,
            uploadIds: List<String>,
        ): ChatReceipt = throw IdentityUnreachable(IOException("lost"))
        override suspend fun receipt(token: String, sessionId: String, requestId: String): ChatReceipt? = null
        override suspend fun stop(token: String, sessionId: String) = Unit
    }
    private val store = object : ChatSyncStore {
        override suspend fun load(key: ChatSyncKey) = ChatSyncRecord(-1, true)
        override suspend fun save(key: ChatSyncKey, record: ChatSyncRecord) = Unit
    }
    private val state by lazy { RemoteChatState(backend, scope, store, "https://fairy.test") }

    @After fun close() { scope.cancel() }

    @Test fun `a refused retry is not reported and an accepted one is`() {
        val reported = mutableListOf<String>()
        state.bind("test", "main", 2)
        compose.setContent {
            FairyAppTheme {
                RemoteChatPanel(
                    state = state,
                    onReconnect = {},
                    onSendAccepted = { reported += it },
                )
            }
        }
        compose.waitForIdle()

        val requestId = compose.runOnIdle { state.send("hello") }!!
        compose.waitUntil { state.snapshot.value.pending?.acceptanceUnknown == true }
        compose.onNodeWithText("待确认发送").assertExists()

        // The credential is gone but the persisted pending command (and its UI) remains: the
        // retry is refused by the state, so the panel must not report an accepted send.
        compose.runOnIdle { state.bind(null, "main", 2) }
        compose.waitForIdle()
        compose.onNodeWithText("重试原请求").performClick()
        compose.waitForIdle()
        assertTrue("未绑定时不得上报受理，实际 $reported", reported.isEmpty())
        compose.onNodeWithText("待确认发送").assertExists()

        // With the credential back the state takes the retry; the panel reports the same id.
        compose.runOnIdle { state.bind("test", "main", 2) }
        compose.waitForIdle()
        compose.onNodeWithText("重试原请求").performClick()
        compose.waitForIdle()
        assertEquals(listOf(requestId), reported)
    }
}
