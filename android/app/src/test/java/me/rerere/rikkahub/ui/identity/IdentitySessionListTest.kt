package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import me.rerere.rikkahub.data.remote.OwnedSession
import me.rerere.rikkahub.data.remote.OwnedSessionState
import me.rerere.rikkahub.data.remote.OwnedSessions
import me.rerere.rikkahub.data.remote.SessionBackend
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * The drawer's delete entry: deleting a conversation is archiving it, and it is
 * confirmed first.
 *
 * The checks are the ticket's client half: the primary session has no entry, the
 * dialog says this is an archive, that it is restorable and that a running reply
 * is stopped first, cancelling changes nothing anywhere, and confirming stops
 * the row's own reply before it is archived.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
class IdentitySessionListTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    /** Every stop and archive the flow asked for, in the order it asked. */
    private val events = mutableListOf<String>()

    private val main = OwnedSession("main", primary = true, title = "主会话标题")
    private val other = OwnedSession("other", title = "另一个会话")
    private val backend = object : SessionBackend {
        var listed = listOf(main, other)
        val archived = mutableListOf<String>()
        override suspend fun list(token: String) = OwnedSessions(listed, main.id)
        override suspend fun read(token: String, sessionId: String) = listed.first { it.id == sessionId }
        override suspend fun select(token: String, sessionId: String) = read(token, sessionId)
        override suspend fun primary(token: String) = main
        override suspend fun create(token: String) = error("not used")
        override suspend fun archive(token: String, sessionId: String): OwnedSession {
            archived += sessionId
            events += "archive:$sessionId"
            listed = listed.filterNot { it.id == sessionId }
            return other
        }
        override suspend fun rename(token: String, sessionId: String, title: String) = error("not used")
    }
    private val state = OwnedSessionState(backend, scope)

    @After fun close() { scope.cancel() }

    private fun show() {
        state.bind("token")
        state.refresh()
        compose.setContent {
            IdentitySessionList(
                state = state,
                onOpen = {},
                onClose = {},
                onHome = {},
                onSettings = {},
                stopReply = { id -> events += "stop:$id" },
            )
        }
        compose.waitUntil(5_000) { !state.snapshot.value.loading }
    }

    @Test
    fun `the primary row has no delete entry and every other row has one`() {
        show()

        compose.onNodeWithText("主会话").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("删除会话").assertCountEquals(1)
        compose.onNodeWithContentDescription("删除会话").assertIsDisplayed()
    }

    @Test
    fun `confirming names the archive, the restore and the stopped reply, then stops before archiving`() {
        show()
        compose.onNodeWithContentDescription("删除会话").performClick()

        compose.onNodeWithText("删除会话").assertIsDisplayed()
        compose.onNodeWithText("这是归档", substring = true).assertIsDisplayed()
        compose.onNodeWithText("恢复", substring = true).assertIsDisplayed()
        compose.onNodeWithText("先停止当前回复", substring = true).assertIsDisplayed()

        compose.onNodeWithText("归档").performClick()
        compose.waitUntil(5_000) { state.snapshot.value.sessions.none { it.id == "other" } }

        assertEquals(listOf("stop:other", "archive:other"), events)
        assertEquals(listOf("other"), backend.archived)
        assertEquals(listOf("main"), state.snapshot.value.sessions.map { it.id })
    }

    @Test
    fun `cancelling changes nothing anywhere`() {
        show()
        compose.onNodeWithContentDescription("删除会话").performClick()

        compose.onNodeWithText("取消").performClick()
        compose.waitForIdle()

        assertEquals(emptyList<String>(), events)
        assertEquals(emptyList<String>(), backend.archived)
        assertEquals(listOf("main", "other"), state.snapshot.value.sessions.map { it.id })
        compose.onNodeWithText("删除会话").assertDoesNotExist()
    }
}
