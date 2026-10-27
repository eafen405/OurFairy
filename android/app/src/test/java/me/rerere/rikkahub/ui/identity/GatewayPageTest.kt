package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
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
import me.rerere.rikkahub.data.remote.GatewayAsr
import me.rerere.rikkahub.data.remote.GatewayAsrDraft
import me.rerere.rikkahub.data.remote.GatewayBackend
import me.rerere.rikkahub.data.remote.GatewayCompaction
import me.rerere.rikkahub.data.remote.GatewayCompactionDraft
import me.rerere.rikkahub.data.remote.GatewayConfig
import me.rerere.rikkahub.data.remote.GatewayCredential
import me.rerere.rikkahub.data.remote.GatewayEditable
import me.rerere.rikkahub.data.remote.GatewayRoute
import me.rerere.rikkahub.data.remote.GatewayRouteDraft
import me.rerere.rikkahub.data.remote.GatewayRouteModel
import me.rerere.rikkahub.data.remote.GatewaySaved
import me.rerere.rikkahub.data.remote.GatewaySelection
import me.rerere.rikkahub.data.remote.GatewaySelectionSaved
import me.rerere.rikkahub.data.remote.IdentityBackend
import me.rerere.rikkahub.data.remote.IdentityRefused
import me.rerere.rikkahub.data.remote.IdentityUser
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
 * The phone page's view of the compaction threshold: its own context group,
 * nested under automatic compaction, editing K tokens over one draft, refusing
 * an invalid draft locally and keeping a server refusal visible.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class GatewayPageTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val user = IdentityUser(1, "phaethon", isAdmin = true)
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

    private inner class ScriptedGateway(
        var read: suspend () -> GatewayConfig = { gatewayConfig() },
        var saveCompaction: suspend (GatewayCompactionDraft) -> GatewayCompaction = {
            GatewayCompaction(it.thresholdTokens)
        },
    ) : GatewayBackend {
        val savedCompactions = mutableListOf<GatewayCompactionDraft>()

        override suspend fun read(token: String): GatewayConfig = read()

        override suspend fun select(token: String, selection: GatewaySelection) =
            GatewaySelectionSaved(selection, applies = "next-turn")

        override suspend fun saveRoute(token: String, route: GatewayRouteDraft): GatewayRoute =
            error("not used")

        override suspend fun deleteRoute(token: String, provider: String) = Unit

        override suspend fun saveAsr(token: String, asr: GatewayAsrDraft): GatewayAsr = error("not used")

        override suspend fun saveCompaction(token: String, compaction: GatewayCompactionDraft): GatewayCompaction {
            savedCompactions += compaction
            return saveCompaction(compaction)
        }
    }

    private fun gatewayConfig(
        compaction: GatewayCompaction? = GatewayCompaction(500_000),
        savedCompaction: Boolean = false,
    ) = GatewayConfig(
        selection = GatewaySelection("minimax-cn", "MiniMax-M3.1-Flash", reasoningEffort = "max"),
        routes = listOf(
            GatewayRoute(
                provider = "minimax-cn",
                displayName = "MiniMax",
                models = listOf(GatewayRouteModel(id = "MiniMax-M3.1-Flash", name = "MiniMax M3.1 Flash")),
                credential = GatewayCredential(ref = "MINIMAX_CN_API_KEY", configured = true, writable = true),
            ),
        ),
        asr = GatewayAsr(credential = GatewayCredential(ref = "VOICE_API_KEY")),
        compaction = compaction,
        editable = GatewayEditable(selection = true, routes = true, asr = true, compaction = true),
        saved = GatewaySaved(selection = false, routes = false, asr = false, compaction = savedCompaction),
    )

    private fun show(backend: GatewayBackend) {
        compose.mainClock.autoAdvance = false
        runBlocking { account.restore() }
        compose.setContent {
            CompositionLocalProvider(LocalDisplayPreferences provides DisplayPreferences()) {
                FairyAppTheme {
                    ProvideAgoraMotionPolicy(appReduceMotion = true) {
                        GatewayPage(onBack = {}, session = account, backend = backend)
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(1_000)
        compose.mainClock.autoAdvance = true
        compose.waitForIdle()
    }

    private fun click(text: String) {
        compose.onNodeWithText(text).performScrollTo().performClick()
        compose.waitForIdle()
    }

    private fun openThreshold() {
        click("上下文")
        click("自动压缩")
    }

    @Test
    fun `the threshold is its own context group, nested under automatic compaction, not the model group`() {
        show(ScriptedGateway())

        compose.onAllNodesWithTag("gateway_compaction_input").assertCountEquals(0)

        // The model group opens on its own and never shows the deployment
        // threshold; the context group opens independently while it stays open.
        click("共用模型")
        compose.onNodeWithText("共用模型选择").performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithTag("gateway_compaction_input").assertCountEquals(0)

        click("上下文")
        compose.onNodeWithText("自动压缩").performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithTag("gateway_compaction_input").assertCountEquals(0)
        compose.onNodeWithText("共用模型选择").performScrollTo().assertIsDisplayed()

        click("自动压缩")
        compose.onNodeWithTag("gateway_compaction_input").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("自动压缩触发阈值").assertIsDisplayed()
        compose.onNodeWithText("范围：100–900 K token").assertIsDisplayed()
    }

    @Test
    fun `an out-of-range K draft is kept verbatim, reported, and cannot be submitted`() {
        val backend = ScriptedGateway()
        show(backend)
        openThreshold()

        val field = compose.onNodeWithTag("gateway_compaction_input").performScrollTo()
        field.performTextClearance()
        field.performTextInput("950")
        compose.waitForIdle()

        compose.onNodeWithText("请输入 100 到 900 K token 之间的值。").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("gateway_compaction_input").assertTextContains("950")
        compose.onNodeWithTag("gateway_compaction_save").assertIsNotEnabled()
        assertEquals("an invalid draft must never reach the backend", emptyList<GatewayCompactionDraft>(), backend.savedCompactions)
    }

    @Test
    fun `a valid K draft is saved as whole tokens and the stored value is re-read`() {
        var current = gatewayConfig()
        val backend = ScriptedGateway(
            read = { current },
            saveCompaction = { draft ->
                current = current.copy(
                    compaction = GatewayCompaction(draft.thresholdTokens),
                    saved = current.saved.copy(compaction = true),
                )
                GatewayCompaction(draft.thresholdTokens)
            },
        )
        show(backend)
        openThreshold()

        val field = compose.onNodeWithTag("gateway_compaction_input").performScrollTo()
        field.performTextClearance()
        field.performTextInput("700")
        compose.waitForIdle()
        compose.onNodeWithTag("gateway_compaction_save").performScrollTo().assertIsEnabled().performClick()
        compose.waitForIdle()

        assertEquals("the draft is posted in whole tokens", listOf(GatewayCompactionDraft(700_000)), backend.savedCompactions)
        compose.onNodeWithTag("gateway_compaction_input").assertTextContains("700")
        compose.onNodeWithText("已保存").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun `a pending save disables the draft and the save button`() {
        val pending = CompletableDeferred<GatewayCompaction>()
        val backend = ScriptedGateway(saveCompaction = { pending.await() })
        show(backend)
        openThreshold()

        val field = compose.onNodeWithTag("gateway_compaction_input").performScrollTo()
        field.performTextClearance()
        field.performTextInput("700")
        compose.waitForIdle()
        compose.onNodeWithTag("gateway_compaction_save").performScrollTo().performClick()
        compose.waitForIdle()

        compose.onNodeWithTag("gateway_compaction_input").assertIsNotEnabled()
        compose.onNodeWithTag("gateway_compaction_save").assertIsNotEnabled()

        pending.complete(GatewayCompaction(700_000))
        compose.waitForIdle()
        compose.onNodeWithTag("gateway_compaction_input").assertIsEnabled()
    }

    @Test
    fun `a refused save keeps the draft and shows the backend's code`() {
        val backend = ScriptedGateway(
            saveCompaction = {
                throw IdentityRefused(
                    400,
                    "gateway/invalid-compaction",
                    "thresholdTokens must be a whole number from 100000 to 900000, inclusive",
                )
            },
        )
        show(backend)
        openThreshold()

        val field = compose.onNodeWithTag("gateway_compaction_input").performScrollTo()
        field.performTextClearance()
        field.performTextInput("800")
        compose.waitForIdle()
        compose.onNodeWithTag("gateway_compaction_save").performScrollTo().performClick()
        compose.waitForIdle()

        compose.onNodeWithText(
            "gateway/invalid-compaction: thresholdTokens must be a whole number from 100000 to 900000, inclusive",
        ).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("gateway_compaction_input").assertTextContains("800")
    }
}
