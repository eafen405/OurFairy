package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
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
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/** Impression loading, selectable read-only content, and recoverable failures. */
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
    ) : ImpressionBackend {
        override suspend fun read(token: String): Impression = read()
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
    fun `the page shows read-only content after a successful read`() {
        val pending = CompletableDeferred<Impression>()
        show(ScriptedImpression(read = { pending.await() }))

        compose.onNodeWithText("正在读取本人印象…").assertIsDisplayed()
        compose.onAllNodesWithTag("impression_field").assertCountEquals(0)
        compose.onAllNodesWithTag("impression_save").assertCountEquals(0)

        pending.complete(Impression("读取到的整份印象", updatedAt = 1, maxCharacters = 8000))
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.onNodeWithTag("impression_content").assertIsDisplayed().assertTextContains("读取到的整份印象")
        compose.onAllNodesWithTag("impression_field").assertCountEquals(0)
        compose.onAllNodesWithTag("impression_save").assertCountEquals(0)
    }

    @Test
    fun `an empty impression has no editing controls`() {
        show(ScriptedImpression(read = { Impression() }))
        compose.onNodeWithTag("impression_empty").assertIsDisplayed()
        compose.onAllNodesWithTag("impression_field").assertCountEquals(0)
        compose.onAllNodesWithTag("impression_save").assertCountEquals(0)
    }

    @Test
    fun `a refused read keeps its code and offers a working retry`() {
        val backend = ScriptedImpression(read = { throw IdentityRefused(503, "impression/unavailable", "try again") })
        show(backend)
        compose.onNodeWithText("impression/unavailable: try again").assertIsDisplayed()
        backend.read = { Impression("重新读取的正文") }
        compose.onNodeWithTag("impression_retry").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.onNodeWithTag("impression_content").assertTextContains("重新读取的正文")
        compose.onAllNodesWithTag("impression_save").assertCountEquals(0)
    }
}
