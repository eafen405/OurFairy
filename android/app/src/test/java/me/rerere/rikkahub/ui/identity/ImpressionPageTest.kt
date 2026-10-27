package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import me.rerere.rikkahub.data.datastore.DisplayPreferences
import me.rerere.rikkahub.data.datastore.LocalDisplayPreferences
import me.rerere.rikkahub.data.remote.AccountSession
import me.rerere.rikkahub.data.remote.AgentSummary
import me.rerere.rikkahub.data.remote.IdentityBackend
import me.rerere.rikkahub.data.remote.IdentityRefused
import me.rerere.rikkahub.data.remote.IdentityUser
import me.rerere.rikkahub.data.remote.Impression
import me.rerere.rikkahub.data.remote.ImpressionBackend
import me.rerere.rikkahub.data.remote.InMemoryCredentialStore
import me.rerere.rikkahub.data.remote.SignedIn
import me.rerere.rikkahub.ui.fairy.FairyAppTheme
import me.rerere.rikkahub.ui.fairy.ProvideAgoraMotionPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The reader's own view of the read-before-edit rule: the multi-line field and
 * save button do not exist until a read has succeeded, and a refused save keeps
 * both the draft and the backend's own code visible.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ImpressionPageTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val user = IdentityUser(2, "agent-two")
    private val identityBackend = object : IdentityBackend {
        override suspend fun session(token: String) = user
        override suspend fun signIn(name: String, password: String) = SignedIn("test", user)
        override suspend fun register(inviteCode: String, name: String, password: String) = error("not used")
        override suspend fun createInvite(token: String) = error("not used")
        override suspend fun agents(token: String): List<AgentSummary> = emptyList()
        override suspend fun signOut(token: String) = Unit
    }
    private val account = AccountSession(identityBackend, InMemoryCredentialStore("test"))

    @After
    fun close() {
        scope.cancel()
    }

    private class ScriptedImpression(
        var read: suspend () -> Impression,
        var edit: suspend (String) -> Unit = {},
    ) : ImpressionBackend {
        val edits = mutableListOf<String>()
        override suspend fun read(token: String): Impression = read()
        override suspend fun edit(token: String, content: String) {
            edits += content
            edit(content)
        }
    }

    private fun show(backend: ImpressionBackend) {
        compose.mainClock.autoAdvance = false
        runBlocking { account.restore() }
        compose.setContent {
            CompositionLocalProvider(LocalDisplayPreferences provides DisplayPreferences()) {
                FairyAppTheme {
                    ProvideAgoraMotionPolicy(appReduceMotion = true) {
                        ImpressionPage(onBack = {}, session = account, backend = backend)
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
    }

    @Test
    fun `the editor does not exist until a read succeeds`() {
        val pending = CompletableDeferred<Impression>()
        show(ScriptedImpression(read = { pending.await() }))

        compose.onNodeWithText("正在读取本人印象…").assertIsDisplayed()
        compose.onAllNodesWithTag("impression_field").assertCountEquals(0)
        compose.onAllNodesWithTag("impression_save").assertCountEquals(0)

        pending.complete(Impression("读取到的整份印象", updatedAt = 1, maxCharacters = 8000))
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.onNodeWithTag("impression_field").assertIsDisplayed().assertTextContains("读取到的整份印象")
        compose.onNodeWithTag("impression_save").assertIsEnabled()
    }

    @Test
    fun `the whole draft is submitted and the counter counts Unicode characters`() {
        val backend = ScriptedImpression(read = { Impression("", updatedAt = null, maxCharacters = 8000) })
        show(backend)

        compose.onNodeWithTag("impression_field").performTextInput("海")
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.onNodeWithText("1 / 8000 字符").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("impression_save").performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        assertEquals(listOf("海"), backend.edits)
    }

    @Test
    fun `a refused save keeps the draft and the backend's code on screen`() {
        val backend = ScriptedImpression(
            read = { Impression("旧正文", updatedAt = 1, maxCharacters = 8000) },
            edit = { throw IdentityRefused(400, "impression/too-long", "the impression is 8001 Unicode characters; the limit is 8000") },
        )
        show(backend)

        compose.onNodeWithTag("impression_field").performTextInput("未保存的草稿")
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.onNodeWithTag("impression_save").performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.onNodeWithText("impression/too-long: the impression is 8001 Unicode characters; the limit is 8000").assertIsDisplayed()
        compose.onNodeWithTag("impression_field").assertTextContains("未保存的草稿", substring = true)
    }
}
