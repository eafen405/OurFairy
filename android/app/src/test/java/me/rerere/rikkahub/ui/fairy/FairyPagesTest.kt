package me.rerere.rikkahub.ui.fairy

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.click
import androidx.compose.ui.geometry.isSpecified
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.geometry.Offset
import androidx.lifecycle.Lifecycle
import java.io.File
import java.time.Duration
import android.graphics.Bitmap
import android.os.SystemClock
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import me.rerere.rikkahub.Screen
import me.rerere.rikkahub.data.datastore.DisplayPreferences
import me.rerere.rikkahub.data.remote.*
import me.rerere.rikkahub.ui.destination.Content
import me.rerere.rikkahub.ui.destination.DestinationActions
import me.rerere.rikkahub.ui.destination.DestinationPageScope
import me.rerere.rikkahub.ui.destination.FairyDestinations
import me.rerere.rikkahub.data.datastore.LocalDisplayPreferences
import me.rerere.rikkahub.ui.identity.IdentitySignInPage
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.math.abs
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowSystemClock

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FairyPagesTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var user = IdentityUser(2, "agent-two")
    private var listedSessions = OwnedSessions(
        listOf(
            OwnedSession("main", primary = true, title = "主会话标题"),
            OwnedSession("other", title = "另一个会话"),
        ),
        "main",
    )
    private var createdSession = OwnedSession("created")
    /** How many times the account's list was read, so a re-read is observable. */
    private var listReads = 0
    /** When set, a session read does not answer until this completes (a page still opening). */
    private var readGate: CompletableDeferred<Unit>? = null
    private val sessions = object : SessionBackend {
        override suspend fun list(token: String, archived: Boolean): OwnedSessions {
            listReads += 1
            return listedSessions
        }
        override suspend fun read(token: String, sessionId: String): OwnedSession {
            readGate?.await()
            if (sessionId == "missing") throw IdentityRefused(404, "session/not-found", "会话已不存在")
            // The backend answers with the row the list would return, title included.
            return listedSessions.sessions.firstOrNull { it.id == sessionId }
                ?: OwnedSession(sessionId, primary = sessionId == listedSessions.primarySessionId)
        }
        override suspend fun rename(token: String, sessionId: String, title: String): OwnedSession {
            // The backend answers with the row the list would return; this fake
            // keeps its list in step so a later refresh cannot disagree with it.
            val renamed = listedSessions.sessions.first { it.id == sessionId }
                .copy(title = title.trim(), titleSource = OwnedSessionTitleSource.USER)
            listedSessions = listedSessions.copy(
                sessions = listedSessions.sessions.map { if (it.id == sessionId) renamed else it },
            )
            return renamed
        }
        override suspend fun select(token: String, sessionId: String) = read(token, sessionId)
        override suspend fun primary(token: String) = OwnedSession("main", primary = true)
        override suspend fun create(token: String) = createdSession
        override suspend fun archive(token: String, sessionId: String) = read(token, sessionId)
        override suspend fun restore(token: String, sessionId: String) = error("not used")
    }
    private val updates = mutableMapOf<String, MutableStateFlow<RemoteChatProjection>>()
    private val backend = object : RemoteChatBackend {
        override fun observe(token: String, sessionId: String) = updates.getOrPut(sessionId) {
            MutableStateFlow(RemoteChatProjection(sessionId, activity = RemoteActivity(status = 1)))
        }
        override suspend fun checkpoint(token: String, sessionId: String) = updates.getValue(sessionId).value.cursor
        override suspend fun page(token: String, sessionId: String, throughSeq: Long, beforeSeq: Long) = error("not used")
        override suspend fun read(token: String, sessionId: String) = error("not used")
        override suspend fun send(token: String, sessionId: String, requestId: String, text: String, uploadIds: List<String>) =
            ChatReceipt(sessionId, requestId, "sent-$requestId", 0)
        override suspend fun receipt(token: String, sessionId: String, requestId: String): ChatReceipt? = null
        override suspend fun stop(token: String, sessionId: String) = Unit
    }
    private val store = object : ChatSyncStore {
        override suspend fun load(key: ChatSyncKey) = ChatSyncRecord(-1, true)
        override suspend fun save(key: ChatSyncKey, record: ChatSyncRecord) = Unit
    }
    private val fairy by lazy {
        FairyInteraction(
            now = SystemClock::uptimeMillis,
            random = kotlin.random.Random(11),
            lines = FairyUiMemory(RuntimeEnvironment.getApplication()),
        )
    }
    private val receive = RemoteReceiveState(sessions, scope, {
        RemoteChatState(backend, scope, store, "https://fairy.test")
    })
    private val identityBackend = object : IdentityBackend {
        override suspend fun session(token: String) = user
        override suspend fun signIn(name: String, password: String) = SignedIn("test", session("test"))
        override suspend fun register(inviteCode: String, name: String, password: String) = error("not used")
        override suspend fun createInvite(token: String) = error("not used")
        override suspend fun agents(token: String): List<AgentSummary> = listOf(
            AgentSummary(user.shortId, user.name),
            AgentSummary(3, "agent-three"),
        )
        override suspend fun signOut(token: String) = Unit
    }
    private val account = AccountSession(identityBackend, InMemoryCredentialStore("test"), receive::bindIdentity)

    @After fun close() { scope.cancel() }

    private fun show(
        reduceMotion: Boolean = true,
        content: @Composable () -> Unit,
    ) {
        compose.mainClock.autoAdvance = false
        runBlocking { account.restore() }
        compose.setContent {
            CompositionLocalProvider(LocalDisplayPreferences provides DisplayPreferences()) {
                FairyAppTheme {
                    ProvideAgoraMotionPolicy(appReduceMotion = reduceMotion, content = content)
                }
            }
        }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
    }

    private fun screenshot(name: String) {
        val directory = System.getenv("FAIRY_UI_SCREENSHOTS")?.let(::File) ?: return
        directory.mkdirs()
        File(directory, "$name.png").outputStream().use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    /**
     * The page the user stands on, assembled by the production catalog.
     *
     * This file starts no Koin: the catalog is handed this test's own account,
     * fakes and interaction module exactly as the activity hands it the
     * container's. `push` and `replace` stand on their target; `pop` returns to
     * the console every fixture below starts from; `reset` stands on the last
     * page of its stack.
     */
    @Composable
    private fun DestinationHost(destination: Screen, onNavigate: (Screen) -> Unit) {
        val scope = DestinationPageScope(
            actions = DestinationActions(
                push = onNavigate,
                replace = onNavigate,
                pop = { onNavigate(Screen.Home) },
                reset = { stack -> onNavigate(stack.last()) },
                identityCompleted = {},
            ),
            session = account,
            receive = receive,
            identityBackend = identityBackend,
            gatewayBackend = gatewayBackend,
            impressionBackend = impressionBackend,
            fairy = fairy,
        )
        FairyDestinations.destinationOf(destination).Content(destination, scope)
    }

    /** How many times the gateway page asked its backend, so the hand-off is observable. */
    private var gatewayReads = 0

    /** How many times the impression page asked its backend. */
    private var impressionReads = 0

    /** The shared selection the gateway page reads; nothing here is editable. */
    private val gatewayBackend = object : GatewayBackend {
        override suspend fun read(token: String): GatewayConfig {
            gatewayReads += 1
            return GatewayConfig(
                selection = GatewaySelection("minimax-cn", "MiniMax-M3.1-Flash"),
                asr = GatewayAsr(credential = GatewayCredential(ref = "VOICE_API_KEY")),
            )
        }
        override suspend fun select(token: String, selection: GatewaySelection) = error("not used")
        override suspend fun saveRoute(token: String, route: GatewayRouteDraft) = error("not used")
        override suspend fun deleteRoute(token: String, provider: String) = error("not used")
        override suspend fun saveAsr(token: String, asr: GatewayAsrDraft) = error("not used")
        override suspend fun saveCompaction(token: String, compaction: GatewayCompactionDraft) = error("not used")
        override suspend fun saveMaintenance(token: String, maintenance: GatewayMaintenanceDraft) = error("not used")
    }

    /** The account's own impression, already written. */
    private val impressionBackend = object : ImpressionBackend {
        override suspend fun read(token: String): Impression {
            impressionReads += 1
            return Impression(content = "本人印象")
        }
        override suspend fun edit(token: String, content: String) = Unit
    }

    /** Show [initial], following its own navigation into this test's state. */
    private fun destination(initial: Screen, onNavigate: (Screen) -> Unit = {}) {
        var current by mutableStateOf(initial)
        show {
            DestinationHost(current) { next ->
                current = next
                onNavigate(next)
            }
        }
    }

    /**
     * The console, optionally with a test-owned eye controller.
     *
     * The eye is a page-internal seam the catalog does not carry — production
     * leaves it null and the page remembers one — so only the tests that observe
     * its output assemble the page directly.
     */
    private fun home(eye: FairyEyeController? = null, onOpen: (Screen) -> Unit) {
        if (eye == null) destination(Screen.Home, onOpen)
        else show { FairyConsolePage(onOpen, account, receive, fairy, eye = eye) }
    }

    @Test fun `the gateway composes through the catalog with no container`() {
        // The page used to reach into Koin for its backend; the catalog now hands
        // it the one its scope carries, so this test assembles it with a fake and
        // no container at all — and the fake proves the hand-off happened.
        destination(Screen.Gateway)
        compose.waitForIdle()

        compose.onNodeWithText(RuntimeEnvironment.getApplication().getString(me.rerere.rikkahub.R.string.gateway_explain))
            .assertExists()
        compose.runOnIdle { assertEquals("the gateway page read the scope's backend", 1, gatewayReads) }
    }

    @Test fun `the impression composes through the catalog with no container`() {
        destination(Screen.Impression)
        compose.waitForIdle()

        compose.onNodeWithTag("impression_field").assertExists()
        compose.runOnIdle { assertEquals("the impression page read the scope's backend", 1, impressionReads) }
    }

    @Test fun `idle line sits below the fairy screen`() {
        home {}
        compose.waitUntil { !receive.owned.snapshot.value.loading }
        // The console measures idleness with SystemClock; the Compose test clock does not move it.
        ShadowSystemClock.advanceBy(Duration.ofMillis(FIRST_LINE_MS + 1_000))
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        val screen = compose.onNodeWithTag("fairy-console-screen").fetchSemanticsNode().boundsInRoot
        val caption = compose.onNodeWithTag("fairy-caption").fetchSemanticsNode().boundsInRoot
        assertTrue(
            "待机台词气泡 top ${caption.top}px 应不小于 Fairy 屏幕下沿 ${screen.bottom}px",
            caption.top >= screen.bottom,
        )
        screenshot("home-idle-line")
    }

    /** One session's projection with the given backend activity and no reply text yet. */
    private fun activity(
        sessionId: String,
        status: Int,
        reasons: List<Int> = emptyList(),
    ) = MutableStateFlow(
        RemoteChatProjection(
            sessionId = sessionId,
            cursor = 0,
            durableThroughSeq = 0,
            events = eventCoverage(0, 0),
            activity = RemoteActivity(status, reasons),
        ),
    )

    /**
     * One live frame of the same connection: the cut (throughSeq 0) stays put, the version
     * advances, and the established activity reports one delivered output at [seq].
     */
    private fun delivered(sessionId: String, seq: Long, version: Long) = RemoteChatProjection(
        sessionId = sessionId,
        generation = "g",
        version = version,
        cursor = 0,
        durableThroughSeq = 0,
        events = eventCoverage(0, 0),
        messages = listOf(
            RemoteChatMessage("delivery$seq", seq, seq, role = 2, status = 2, text = "delivered$seq"),
        ),
        activity = RemoteActivity(
            status = 1,
            throughSeq = 0,
            delivery = RemoteActivityDelivery("$sessionId-run", seq),
            completed = RemoteCompletedActivity("$sessionId-run", 0, seq, seq),
        ),
    )

    @Test fun `home and the conversation page show a working session, never standby`() {
        updates["main"] = activity("main", 2, listOf(1))
        var destination by mutableStateOf<Screen>(Screen.Home)
        show {
            DestinationHost(destination) { destination = it }
        }
        compose.waitUntil { !receive.owned.snapshot.value.loading }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        // The page, not just the module: home must not draw the stand-by overlay for a working
        // current session, and the conversation page must render the same presence as a subtitle.
        compose.onNodeWithText("TAP TO WAKE").assertDoesNotExist()
        compose.onNodeWithText("进入会话").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.onNodeWithText("正在思考…").assertIsDisplayed()
        compose.onNodeWithTag("fairy-screen-overlay").assertIsDisplayed()
        compose.runOnIdle {
            assertEquals(FairyInteractionContext("main"), fairy.state.value.context)
            assertEquals(
                "主会话正在执行时，页面必须呈现思考而不是固定的待机",
                FairyPresence.THINKING,
                fairy.state.value.window.presence,
            )
            assertTrue(fairy.state.value.window.awaitingReply)
        }
    }

    @Test fun `home and the conversation page show unknown activity as linking, never as standby`() {
        updates["main"] = activity("main", 0)
        var destination by mutableStateOf<Screen>(Screen.Home)
        show {
            DestinationHost(destination) { destination = it }
        }
        compose.waitUntil { !receive.owned.snapshot.value.loading }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.onNodeWithText("TAP TO WAKE").assertDoesNotExist()
        compose.onNodeWithText("进入会话").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.onNodeWithText("同步中…").assertIsDisplayed()
        compose.onNodeWithText("已连接").assertDoesNotExist()
        compose.runOnIdle {
            assertEquals(
                "活动未知不能被显示成安静",
                FairyPresence.CONNECTING,
                fairy.state.value.window.presence,
            )
        }
    }

    @Test fun `home follows only the current session's visible current appearance`() {
        // Another session is working; the current one is quiet. Home must present its own session.
        updates["other"] = activity("other", 2, listOf(1))
        var destination by mutableStateOf<Screen>(Screen.Home)
        show {
            DestinationHost(destination) { destination = it }
        }
        compose.waitUntil { receive.runtimes.value.keys.containsAll(listOf("main", "other")) }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.runOnIdle {
            assertEquals(FairyPresence.IDLE, fairy.state.value.window.presence)
        }

        compose.runOnIdle { receive.owned.select("other") }
        compose.waitUntil { receive.owned.snapshot.value.selectedId == "other" }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.runOnIdle {
            assertEquals(
                "切到正在执行的会话后，首页呈现的是这个会话的思考",
                FairyPresence.THINKING,
                fairy.state.value.window.presence,
            )
        }

        // The visible claim: the page of the newly current session shows the working state, not
        // the quiet session's connected state.
        compose.onNodeWithText("进入会话").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.onNodeWithText("正在思考…").assertIsDisplayed()
        compose.onNodeWithText("已连接").assertDoesNotExist()
    }

    @Test fun `an account switch stops the old sessions from driving home`() {
        updates["main"] = activity("main", 2, listOf(1))
        home {}
        compose.waitUntil { fairy.state.value.window.presence == FairyPresence.THINKING }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        // The identity publisher's own entry: reception retires the account's sessions here.
        compose.runOnIdle { receive.bindIdentity(null) }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.runOnIdle {
            assertEquals(null, fairy.state.value.context)
            assertEquals(
                "账号切换后旧会话的事实不得继续驱动首页",
                FairyPresence.CONNECTING,
                fairy.state.value.window.presence,
            )
        }
        compose.onNodeWithText("TAP TO WAKE").assertDoesNotExist()
    }

    @Test fun `home and the conversation page render the same current appearance for one session`() {
        updates["main"] = activity("main", 2, listOf(1))
        var destination by mutableStateOf<Screen>(Screen.Home)
        show {
            DestinationHost(destination) { destination = it }
        }
        compose.waitUntil { fairy.state.value.window.presence == FairyPresence.THINKING }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.onNodeWithText("进入会话").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.runOnIdle { assertEquals(Screen.Conversation("main"), destination) }

        // The page-visible result of the same module answer: the conversation bar's subtitle and
        // the opened eye screen, not only the module's own state.
        compose.onNodeWithText("正在思考…").assertIsDisplayed()
        compose.onNodeWithTag("fairy-screen-overlay").assertIsDisplayed()
        compose.runOnIdle {
            assertEquals(FairyInteractionContext("main"), fairy.state.value.context)
            assertEquals(
                "对话页与首页对同一会话必须得到同一个当前表现",
                FairyPresence.THINKING,
                fairy.state.value.window.presence,
            )
        }
    }

    @Test fun `the conversation page renders the module's appearance while its facts are missing`() {
        // The page is the destination of a page change for a session whose runtime it has not
        // read yet. The module test fixes the rule that this frame keeps the previous page's
        // appearance; here the page must render that snapshot instead of deriving UNKNOWN.
        listedSessions = OwnedSessions(
            listOf(OwnedSession("other", primary = true, title = "另一个会话")),
            "other",
        )
        updates["main"] = activity("main", 2, listOf(1))
        val gate = CompletableDeferred<Unit>()
        readGate = gate
        show {
            FairyConversationPage("main", {}, receive, fairy, onOpenConversation = {}, onSettings = {})
        }
        // The list has arrived; the routed session's own read is held at the gate, so the page
        // stays in its opening frame with no facts.
        compose.waitUntil { receive.owned.snapshot.value.sessions.isNotEmpty() }
        compose.runOnIdle {
            fairy.show(
                FairyInteractionContext("main"),
                FairyRemoteFacts(
                    connected = true,
                    activityStatus = 2,
                    activityReasons = listOf(1),
                    transcript = FairyTranscript(0),
                ),
            )
        }
        compose.mainClock.advanceTimeBy(500)
        compose.waitForIdle()

        compose.onAllNodesWithText("正在打开会话…").onFirst().assertIsDisplayed()
        // The opened eye screen is visible because the page renders the module's awaiting-reply
        // state; a page that re-derived UNKNOWN from its missing facts would fold it.
        compose.onNodeWithTag("fairy-screen-overlay").assertIsDisplayed()
        compose.runOnIdle {
            assertEquals(FairyInteractionContext("main"), fairy.state.value.context)
            assertEquals(
                "对话页拿到事实之前应沿用上一页的当前表现",
                FairyPresence.THINKING,
                fairy.state.value.window.presence,
            )
            assertTrue(fairy.state.value.window.awaitingReply)
        }

        gate.complete(Unit)
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.onNodeWithText("正在思考…").assertIsDisplayed()
    }

    @Test fun `home dozes off and the conversation page carries the standby`() {
        var destination by mutableStateOf<Screen>(Screen.Home)
        show {
            DestinationHost(destination) { destination = it }
        }
        compose.waitUntil { !receive.owned.snapshot.value.loading }
        ShadowSystemClock.advanceBy(Duration.ofMillis(SLEEP_AT_MS + 1_000))
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.runOnIdle {
            assertTrue("首页闲置三分钟后进入待机", fairy.state.value.asleep)
            val line = fairy.state.value.caption
            assertTrue(
                "待机台词取自既有 sleepPool",
                line != null && line.id in FairyLines.sleepPool,
            )
        }
        compose.onNodeWithText("TAP TO WAKE").assertIsDisplayed()

        // A page switch without a touch on the sleeping console (the route change the app makes
        // when it follows an archived session): only then can the screen still be asleep on the
        // next page. Any touch — including the console's own buttons — wakes it first.
        compose.mainClock.autoAdvance = true
        compose.runOnIdle { destination = Screen.Conversation("main") }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false
        compose.runOnIdle {
            assertTrue("对话页继承首页的待机", fairy.state.value.asleep)
            assertNull("上一页未播完的待机台词不跨页补播", fairy.state.value.caption)
        }

        compose.onRoot().performTouchInput { click(center) }
        compose.mainClock.advanceTimeBy(500)
        compose.waitForIdle()
        compose.runOnIdle {
            assertFalse("对话页的一次触摸唤醒 module 的待机", fairy.state.value.asleep)
        }
    }

    @Test fun `an unfinished home line is settled instead of replayed after a page switch`() {
        var destination by mutableStateOf<Screen>(Screen.Home)
        show {
            DestinationHost(destination) { destination = it }
        }
        compose.waitUntil { !receive.owned.snapshot.value.loading }
        ShadowSystemClock.advanceBy(Duration.ofMillis(FIRST_LINE_MS + 1_000))
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        val unfinished = compose.runOnIdle {
            val line = fairy.state.value.caption
            assertNotNull("四十五秒后首页应有一条台词", line)
            line!!.id
        }

        compose.onNodeWithText("进入会话").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.runOnIdle { assertNull("离页时未播完的台词结算", fairy.state.value.caption) }

        compose.runOnIdle { destination = Screen.Home }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.runOnIdle { assertNull("返回首页不补播上一句", fairy.state.value.caption) }

        // The idle clock kept running while the line was on screen: the next line is due, and the
        // device memory keeps it from being the line that was just settled.
        ShadowSystemClock.advanceBy(Duration.ofMillis(120_000))
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.runOnIdle {
            val next = fairy.state.value.caption
            assertNotNull("返回后仍按待机规则出新台词", next)
            assertNotEquals("新台词不会立刻重复刚结算的一句", unfinished, next!!.id)
        }
    }

    @Test fun `home displays and opens the recently selected session`() {
        var destination: Screen? = null
        home { destination = it }
        compose.waitUntil { !receive.owned.snapshot.value.loading }
        // The console names the current session by its own row's title; the
        // opaque id is never a user-readable name.
        compose.onNodeWithTag("console-session-title").assertTextEquals("主会话标题")
        compose.onNodeWithText("main").assertDoesNotExist()
        compose.runOnIdle { receive.owned.select("other") }
        compose.waitUntil { receive.owned.snapshot.value.selectedId == "other" }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        screenshot("home-selected")

        compose.onNodeWithTag("console-session-title").assertTextEquals("另一个会话")
        compose.onNodeWithText("other").assertDoesNotExist()
        compose.onNodeWithText("进入会话").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(Screen.Conversation("other"), destination) }
    }

    @Test fun `home without an enterable session opens the shared list in place`() {
        listedSessions = OwnedSessions(emptyList(), null)
        var destination: Screen? = null
        home { destination = it }

        compose.onNodeWithTag("console-session-title").assertTextEquals("—")
        compose.onNodeWithText("0").assertIsDisplayed()
        compose.onNodeWithText("进入会话").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        // The list is an overlay on the console, not the empty-session
        // conversation destination it used to push.
        compose.onNodeWithContentDescription("关闭会话列表").assertIsDisplayed()
        compose.onNodeWithText("暂无会话").assertIsDisplayed()
        compose.runOnIdle { assertNull("打开会话列表不是导航", destination) }
    }

    @Test fun `home opens all sessions in place with their real count`() {
        var destination by mutableStateOf<Screen>(Screen.Home)
        var navigations = 0
        show {
            DestinationHost(destination) {
                destination = it
                navigations += 1
            }
        }

        compose.onNodeWithText("全部会话").performScrollTo()
        compose.onNodeWithText("2 SESSIONS").assertIsDisplayed()
        compose.onNodeWithText("全部会话").performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.onNodeWithContentDescription("关闭会话列表").assertIsDisplayed()
        // The row is named by the session's own title. The ordinal ("会话 1") and
        // the opaque id are what the drawer used to show instead, so both must be
        // gone; the main-session binding survives as a marker beside the title.
        // The console behind the list names the current session too, so the title
        // is on screen twice and both read the same row.
        compose.onNodeWithTag("console-session-title").assertTextEquals("主会话标题")
        compose.onAllNodesWithText("主会话标题").assertCountEquals(2)
        compose.onNodeWithText("另一个会话").assertIsDisplayed()
        compose.onNodeWithText("主会话").assertIsDisplayed()
        compose.onNodeWithText("会话 1").assertDoesNotExist()
        compose.onNodeWithText("会话 2").assertDoesNotExist()
        compose.onNodeWithText("main").assertDoesNotExist()
        compose.onNodeWithText("other").assertDoesNotExist()
        // Opening the list must not push the old session-list destination (or any
        // other) onto the navigation stack.
        compose.runOnIdle {
            assertEquals("打开会话列表不改变当前页面", Screen.Home, destination)
            assertEquals("打开会话列表不触发任何导航", 0, navigations)
        }
    }

    @Test fun `an untitled current session shows the list's placeholder on the console`() {
        listedSessions = OwnedSessions(
            listOf(
                OwnedSession("main", primary = true),
                OwnedSession("other", title = "另一个会话"),
            ),
            "main",
        )
        var destination: Screen? = null
        home { destination = it }
        compose.waitUntil { !receive.owned.snapshot.value.loading }

        // The console's current-session line and the list rows share one
        // placeholder rule, so the unnamed current session is named 新会话 in
        // both places and the opaque id appears in neither.
        compose.onNodeWithTag("console-session-title").assertTextEquals("新会话")
        compose.onNodeWithText("全部会话").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.onAllNodesWithText("新会话").assertCountEquals(2)
        compose.onAllNodesWithText("main").assertCountEquals(0)
        compose.runOnIdle { assertNull(destination) }
    }

    @Test fun `closing the shared list leaves the console where it was`() {
        var destination by mutableStateOf<Screen>(Screen.Home)
        var navigations = 0
        show {
            DestinationHost(destination) {
                destination = it
                navigations += 1
            }
        }
        compose.waitUntil { !receive.owned.snapshot.value.loading }

        compose.onNodeWithText("全部会话").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.onNodeWithContentDescription("关闭会话列表").performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.onNodeWithTag("console-session-title").assertTextEquals("主会话标题")
        compose.onNodeWithText("进入会话").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("全部会话").assertIsDisplayed()
        compose.runOnIdle {
            assertEquals("关闭浮层后仍在控制台", Screen.Home, destination)
            assertEquals("关闭浮层不触发任何导航", 0, navigations)
        }
    }

    @Test fun `selecting a row in the console list opens that conversation`() {
        var destination by mutableStateOf<Screen>(Screen.Home)
        show {
            DestinationHost(destination) { destination = it }
        }
        compose.waitUntil { !receive.owned.snapshot.value.loading }

        compose.onNodeWithText("全部会话").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.onNodeWithText("另一个会话").performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.runOnIdle { assertEquals(Screen.Conversation("other"), destination) }
        compose.onNodeWithContentDescription("切换会话").assertIsDisplayed()
        compose.onNodeWithContentDescription("发送消息").assertIsDisplayed()
    }

    @Test fun `an untitled session shows a placeholder, never its opaque id`() {
        listedSessions = OwnedSessions(
            listOf(
                OwnedSession("main", primary = true, title = "主会话标题"),
                OwnedSession("unnamed-7f3a9c1b"),
            ),
            "main",
        )
        conversation()
        compose.onNodeWithContentDescription("切换会话").performClick()
        compose.mainClock.advanceTimeBy(500)

        // The named row shows its title; the titled backend row is not the only
        // shape, so the unnamed one shows the placeholder rather than its id.
        // The drawer row and the bar name the open session, so its title is
        // deliberately on screen twice.
        compose.onAllNodesWithText("主会话标题").assertCountEquals(2)
        compose.onAllNodesWithText("新会话").assertCountEquals(1)
        compose.onAllNodesWithText("unnamed-7f3a9c1b").assertCountEquals(0)
    }

    @Test
    @Config(qualifiers = "zh-rCN-w320dp-h640dp")
    fun `home keeps long content bounded and actions reachable on narrow screens`() {
        RuntimeEnvironment.setFontScale(1.3f)
        val longName = "长用户名".repeat(12)
        val longTitle = "很长的会话标题" + "会占满整行需要截断".repeat(8)
        val longSession = "session-" + "0123456789abcdef".repeat(4)
        user = IdentityUser(2, longName)
        listedSessions = OwnedSessions(
            listOf(OwnedSession("main", primary = true), OwnedSession(longSession, title = longTitle)), "main",
        )
        var destination: Screen? = null
        home { destination = it }
        compose.waitUntil { !receive.owned.snapshot.value.loading }
        compose.runOnIdle { receive.owned.select(longSession) }
        compose.waitUntil { receive.owned.snapshot.value.selectedId == longSession }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.mainClock.autoAdvance = true

        val viewport = compose.onRoot().fetchSemanticsNode().boundsInRoot
        fun assertBounded(text: String) {
            val bounds = compose.onNodeWithText(text).performScrollTo().assertIsDisplayed()
                .fetchSemanticsNode().boundsInRoot
            assertTrue(
                "Text exceeds the ${viewport.width}px viewport: $bounds",
                bounds.left >= viewport.left && bounds.right <= viewport.right,
            )
        }
        assertBounded(longName)
        // The console names the session with the row's title, bounded by the card.
        compose.onNodeWithTag("console-session-title").assertTextEquals(longTitle)
        val consoleTitle = compose.onNodeWithTag("console-session-title")
            .performScrollTo().assertIsDisplayed().fetchSemanticsNode().boundsInRoot
        assertTrue(
            "Console title exceeds the ${viewport.width}px viewport: $consoleTitle",
            consoleTitle.left >= viewport.left && consoleTitle.right <= viewport.right,
        )
        // The opaque id is not the current session's name on the console.
        compose.onAllNodesWithText(longSession).assertCountEquals(0)

        // The same long title in the shared list's row is bounded too: the row
        // ellipsizes instead of pushing the list past the narrow viewport.
        compose.onNodeWithText("全部会话").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        val titled = compose.onAllNodesWithText(longTitle).fetchSemanticsNodes()
        assertEquals("控制台与列表行都显示同一个标题", 2, titled.size)
        titled.forEach { node ->
            assertTrue(
                "List/console title exceeds the ${viewport.width}px viewport: ${node.boundsInRoot}",
                node.boundsInRoot.left >= viewport.left && node.boundsInRoot.right <= viewport.right,
            )
        }
        compose.onNodeWithContentDescription("关闭会话列表").performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.onNodeWithText("全部会话").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("console-settings").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("进入会话").performScrollTo()
        screenshot("home-narrow-long")
        compose.onNodeWithText("进入会话").performClick()
        compose.runOnIdle { assertEquals(Screen.Conversation(longSession), destination) }
    }

    @Test fun `home shows a compact admin identity`() {
        user = IdentityUser(1, "法厄同", isAdmin = true)
        home {}

        compose.onNodeWithText("法厄同").assertIsDisplayed()
        compose.onNodeWithText("#1").assertIsDisplayed()
        compose.onNodeWithText("ADMIN").assertIsDisplayed()
        compose.onNodeWithText("AGENT").assertDoesNotExist()
    }

    @Test fun `home opens settings with visible account content`() {
        var destination by mutableStateOf<Screen>(Screen.Home)
        show {
            when (destination) {
                Screen.Home -> FairyConsolePage({ destination = it }, account, receive, fairy)
                else -> FairySettingsPage(
                    {}, {}, account, backend = identityBackend, onBack = { destination = Screen.Home },
                )
            }
        }
        compose.onNodeWithText("agent-two").assertIsDisplayed()
        compose.onNodeWithText("#2").assertIsDisplayed()
        compose.onNodeWithText("AGENT").assertIsDisplayed()
        compose.onNodeWithTag("console-session-title").assertTextEquals("主会话标题")
        screenshot("home")
        compose.onNodeWithTag("console-settings").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithText("账号").assertIsDisplayed()
        compose.onNodeWithText("退出登录").assertIsDisplayed()
        screenshot("settings")
    }

    @Test fun `settings exposes the current version and app update entry`() {
        show {
            FairySettingsPage(
                {}, {}, account, backend = identityBackend, onBack = {},
                updateContent = { androidx.compose.material3.Text("更新测试内容") },
            )
        }
        compose.mainClock.autoAdvance = true

        compose.onNodeWithText("当前版本 ${me.rerere.rikkahub.BuildConfig.VERSION_NAME}").assertExists()
        compose.onNodeWithText("更新").performScrollTo().performClick()
        compose.waitForIdle()

        compose.onNodeWithText("更新测试内容").assertIsDisplayed()
    }

    @Test fun `settings opens the user's own impression page`() {
        var opened = false
        show {
            FairySettingsPage(
                {}, {}, account, backend = identityBackend, onBack = {},
                onOpenImpression = { opened = true },
            )
        }
        compose.mainClock.autoAdvance = true

        compose.onNodeWithText("印象").performScrollTo().performClick()
        compose.waitForIdle()
        compose.onNodeWithText("本人印象").performScrollTo().performClick()
        compose.runOnIdle { assertTrue("the impression row opens the user's page", opened) }
    }

    @Test fun `settings shows the other agents' names when their group is opened`() {
        show { FairySettingsPage({}, {}, account, backend = identityBackend, onBack = {}) }
        compose.mainClock.autoAdvance = true

        // The account group opens first and already reads "代理人" as the role,
        // so close it before the roster title is the one node carrying that text.
        compose.onNodeWithText("账号").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("代理人").performClick()
        compose.waitForIdle()

        compose.onNodeWithText("agent-two").assertIsDisplayed()
        compose.onNodeWithText("agent-three").assertIsDisplayed()
        // Summary only: the roster shows names, never the short numbers.
        compose.onNodeWithText("#2").assertDoesNotExist()
        compose.onNodeWithText("#3").assertDoesNotExist()
        screenshot("agents")
    }

    private fun conversation(
        initial: String = "main",
        eye: FairyEyeController? = null,
        onOpen: (String) -> Unit = {},
    ) {
        var target by mutableStateOf(initial)
        show {
            FairyConversationPage(target, {}, receive, fairy, eye = eye,
                onOpenConversation = { target = it; onOpen(it) }, onSettings = {})
        }
    }

    @Test fun `sending a message asks for attention without pretending Fairy is thinking`() {
        conversation()
        compose.waitUntil { fairy.state.value.context == FairyInteractionContext("main") }
        compose.waitUntil { receive.selectedChat.value?.snapshot?.value?.storageReady == true }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.onNodeWithText("发送消息…").performTextInput("你好，Fairy")
        compose.onNodeWithContentDescription("发送消息").performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.waitForIdle()

        compose.runOnIdle {
            assertEquals(
                "发送被接受后应有一次注意反应",
                FairyReactionKind.SENT,
                fairy.state.value.reaction?.kind,
            )
            assertEquals(
                "本地发送不得把安静会话显示成后端正在思考",
                FairyPresence.IDLE,
                fairy.state.value.window.presence,
            )
        }
        compose.onNodeWithText("正在思考…").assertDoesNotExist()
    }

    @Test fun `coming back to the foreground settles what arrived while away`() {
        updates["main"] = activity("main", 1)
        conversation()
        compose.waitUntil { fairy.state.value.context == FairyInteractionContext("main") }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        compose.waitForIdle()
        // A delivery lands while the app is stopped and no page is presenting it.
        compose.runOnIdle {
            updates.getValue("main").value = delivered("main", 1, version = 1)
        }
        compose.waitUntil {
            receive.stateForSession("main")?.snapshot?.value?.activity?.status == 1
        }

        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.runOnIdle {
            assertNull(
                "回到前台不得补演离开期间到达的投递",
                fairy.state.value.reaction,
            )
            assertEquals(
                "回来时呈现的是当前事实：安静会话里的一次投递不算执行中",
                FairyPresence.IDLE,
                fairy.state.value.window.presence,
            )
        }

        // A delivery that arrives after the return is a genuine event and does react.
        compose.runOnIdle {
            updates.getValue("main").value =
                delivered("main", 2, version = 2)
        }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.runOnIdle {
            assertEquals(
                "回来之后的新投递仍然产生一次反应",
                FairyReactionKind.DELIVERY,
                fairy.state.value.reaction?.kind,
            )
        }
    }

    @Test fun `a quiet delivery shows content without pretending work under reduced motion`() {
        updates["main"] = activity("main", 1)
        conversation()
        compose.waitUntil { fairy.state.value.context == FairyInteractionContext("main") }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.runOnIdle {
            updates.getValue("main").value = delivered("main", 1, version = 1)
        }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.onNodeWithText("delivered1").assertIsDisplayed()
        compose.onNodeWithText("已连接").assertIsDisplayed()
        compose.onNodeWithText("正在思考…").assertDoesNotExist()
        compose.runOnIdle {
            assertEquals(
                "Reduced Motion 下投递仍显示当前表现为安静",
                FairyPresence.IDLE,
                fairy.state.value.window.presence,
            )
            assertEquals(
                "反应仍是 module 的答案，页面只播放",
                FairyReactionKind.DELIVERY,
                fairy.state.value.reaction?.kind,
            )
        }
    }

    @Test fun `the eye mapping plays each reaction kind once and never replays a recomposition`() {
        val eye = FairyEyeController()
        var reaction by mutableStateOf<FairyReaction?>(null)
        var recompositions by mutableStateOf(0)
        compose.setContent {
            recompositions // a live recomposition source, to prove the same reaction does not replay
            FairyEyeReactions(
                reaction = reaction,
                eye = eye,
                composer = { Offset(10f, 20f) },
                content = { Offset(30f, 40f) },
            )
        }
        compose.waitForIdle()
        assertEquals("没有反应时眼睛不动", 0, eye.glances)

        reaction = FairyReaction(1, FairyReactionKind.SENT)
        compose.waitForIdle()
        assertEquals("发送让眼睛看向输入处", 1, eye.glances)

        reaction = FairyReaction(2, FairyReactionKind.OUTPUT)
        compose.waitForIdle()
        assertEquals("新输出让眼睛看向内容", 2, eye.glances)

        reaction = FairyReaction(3, FairyReactionKind.DELIVERY)
        compose.waitForIdle()
        assertEquals("投递让眼睛看向内容", 3, eye.glances)

        reaction = FairyReaction(4, FairyReactionKind.COMPLETED)
        compose.waitForIdle()
        assertEquals("完成只眨眼，不再转眼", 3, eye.glances)
        assertEquals("完成事件眨一次眼", 1, eye.blinks)

        recompositions += 1
        compose.waitForIdle()
        assertEquals("重组不得重演同一次反应", 3, eye.glances)
        assertEquals("重组不得重演同一次眨眼", 1, eye.blinks)
    }

    @Test fun `a delivery reaches the conversation page's own eye once`() {
        // The real seam: module observation → page → injected eye. #262's evidence cites this
        // test for page wiring; the mapping test above only proves the page-side mapping itself.
        val eye = FairyEyeController()
        updates["main"] = activity("main", 1)
        conversation(eye = eye)
        compose.waitUntil { fairy.state.value.context == FairyInteractionContext("main") }
        compose.waitUntil { receive.selectedChat.value?.snapshot?.value?.storageReady == true }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.runOnIdle { assertEquals("建立基线时不演", 0, eye.glances) }

        compose.runOnIdle { updates.getValue("main").value = delivered("main", 1, version = 1) }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.runOnIdle {
            assertEquals("投递经页面的眼睛演一次", 1, eye.glances)
            assertEquals(FairyReactionKind.DELIVERY, fairy.state.value.reaction?.kind)
        }
        compose.onNodeWithText("delivered1").assertIsDisplayed()
    }

    @Test fun `dragging either fairy page moves that page's eye`() {
        var destination by mutableStateOf<Screen>(Screen.Home)
        val homeEye = FairyEyeController()
        val conversationEye = FairyEyeController()
        show {
            when (val target = destination) {
                is Screen.Conversation -> FairyConversationPage(
                    target.sessionId, {}, receive, fairy, eye = conversationEye,
                    onOpenConversation = { destination = Screen.Conversation(it) }, onSettings = {},
                )
                else -> FairyConsolePage({ destination = it }, account, receive, fairy, eye = homeEye)
            }
        }
        compose.waitUntil { !receive.owned.snapshot.value.loading }

        var homePointed = false
        compose.onRoot().performTouchInput {
            down(center)
            moveBy(Offset(40f, 20f))
        }
        compose.waitForIdle()
        compose.runOnIdle { homePointed = homeEye.pointer.isSpecified }
        compose.runOnIdle { assertTrue("首页拖动后眼睛跟随手指", homePointed) }
        compose.onRoot().performTouchInput { up() }

        compose.mainClock.autoAdvance = true
        compose.runOnIdle { destination = Screen.Conversation("main") }
        compose.waitForIdle()
        compose.mainClock.autoAdvance = false

        var conversationPointed = false
        compose.onRoot().performTouchInput {
            down(center)
            moveBy(Offset(-30f, 25f))
        }
        compose.waitForIdle()
        compose.runOnIdle { conversationPointed = conversationEye.pointer.isSpecified }
        compose.runOnIdle { assertTrue("对话页拖动后眼睛跟随手指", conversationPointed) }
        compose.onRoot().performTouchInput { up() }
        // The gesture observer is observational: the composer is still reachable afterwards.
        compose.onNodeWithContentDescription("发送消息").assertIsDisplayed()
    }

    @Test fun `a model title arriving after the reply re-reads the list and reaches the bar`() {
        show {
            FairyConversationPage("main", {}, receive, fairy, onOpenConversation = {}, onSettings = {})
        }
        compose.waitUntil { !receive.owned.snapshot.value.loading }
        compose.runOnIdle { scope.launch { receive.openSession("main") } }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.waitUntil { receive.selectedChat.value?.snapshot?.value?.sessionId == "main" }

        updates.getValue("main").value = updates.getValue("main").value.copy(replyStatus = 1, version = 1)
        compose.mainClock.advanceTimeBy(500)
        compose.waitForIdle()
        updates.getValue("main").value = updates.getValue("main").value.copy(replyStatus = 0, version = 2)
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        val afterReply = listReads

        // The model title can land after the reply has already settled. Its
        // session/title event, not the reply edge, is what refreshes the row.
        listedSessions = listedSessions.copy(
            sessions = listedSessions.sessions.map {
                if (it.id == "main") it.copy(title = "晚到的模型标题") else it
            },
        )
        updates.getValue("main").value = updates.getValue("main").value.copy(
            version = 3, cursor = 0, durableThroughSeq = 0, fromSeq = 0,
            events = listOf(kotlinx.serialization.json.Json.parseToJsonElement(
                """{"seq":0,"type":"session/title","data":{"title":"晚到的模型标题"}}""",
            ) as kotlinx.serialization.json.JsonObject),
        )
        compose.mainClock.advanceTimeBy(1_000)
        compose.runOnIdle {
            val observed = receive.selectedChat.value?.snapshot?.value
            assertEquals(null, observed?.failure)
            assertEquals(3L, observed?.projection?.version)
            assertEquals(1, observed?.projection?.events?.size)
        }
        compose.waitForIdle()
        assertEquals("a late model title must re-read the list", afterReply + 1, listReads)
        compose.onNodeWithTag("fairy-window-title").assertTextEquals("晚到的模型标题")
    }

    @Test fun `the conversation bar names the open session and follows the row it reads`() {
        show {
            FairyConversationPage("main", {}, receive, fairy, onOpenConversation = {}, onSettings = {})
        }
        compose.waitUntil { !receive.owned.snapshot.value.loading }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        // The bar names the session the reader is in; the drawer row and the bar
        // read the same OwnedSession, so one value drives both.
        compose.onNodeWithTag("fairy-window-title").assertTextEquals("主会话标题")
        // Fairy keeps her nameplate as the tag beside the status line.
        compose.onNodeWithText("Fairy").assertIsDisplayed()

        // A title can change without a rename: the model's title lands after the
        // first exchange. The row is the one source, so the bar follows it.
        compose.runOnIdle {
            listedSessions = listedSessions.copy(
                sessions = listedSessions.sessions.map {
                    if (it.id == "main") it.copy(title = "模型起的名字") else it
                },
            )
            receive.owned.refresh()
        }
        compose.waitUntil {
            receive.owned.snapshot.value.sessions.firstOrNull { it.id == "main" }?.title == "模型起的名字"
        }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.onNodeWithTag("fairy-window-title").assertTextEquals("模型起的名字")
        compose.onNodeWithText("主会话标题").assertDoesNotExist()
    }

    @Test fun `the drawer offers a rename entry on every session the reader can name`() {
        show {
            FairyConversationPage("main", {}, receive, fairy, onOpenConversation = {}, onSettings = {})
        }
        compose.waitUntil { !receive.owned.snapshot.value.loading }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.onNodeWithContentDescription("切换会话").performClick()
        compose.mainClock.advanceTimeBy(500)

        // The entry sits on the row itself: naming a session does not require
        // visiting it. Every own session is nameable — the ticket asks for
        // "任意自己的会话" and the backend accepts a rename of the primary — so
        // both rows carry the entry, and only archiving is refused for main.
        compose.onNodeWithText("另一个会话").assertIsDisplayed()
        compose.onAllNodesWithContentDescription("重命名会话").assertCountEquals(2)
        compose.onAllNodesWithContentDescription("删除会话").assertCountEquals(1)

        // The dialog itself is not driven here: an AlertDialog window never lets
        // Robolectric's paused clock go idle, and this suite runs paused. The one
        // tap's behaviour (one request, the answered row folded in) is pinned by
        // `OwnedSessionStateTest`, and the wire shape by `SessionApiTest`.
    }

    @Test fun `home opens the current conversation with a visible composer`() {
        var destination by mutableStateOf<Screen>(Screen.Home)
        show {
            DestinationHost(destination) { destination = it }
        }
        compose.onNodeWithText("进入会话").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.runOnIdle { assertEquals(Screen.Conversation("main"), destination) }
        compose.onNodeWithContentDescription("切换会话").assertIsDisplayed()
        compose.onNodeWithContentDescription("发送消息").assertIsDisplayed()
    }

    @Test fun `selecting the open session in the list neither navigates nor rebuilds`() {
        val opened = mutableListOf<String>()
        conversation(onOpen = opened::add)
        compose.waitUntil { !receive.owned.snapshot.value.loading }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.onNodeWithText("发送消息…").performTextInput("保留草稿")
        compose.onNodeWithContentDescription("切换会话").performClick()
        compose.mainClock.advanceTimeBy(500)
        screenshot("sessions")
        compose.onNodeWithText("主会话").assertIsDisplayed().assertIsEnabled().performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithContentDescription("发送消息").assertIsDisplayed()
        compose.onNodeWithText("主会话").assertIsNotDisplayed()
        compose.onNodeWithText("保留草稿").assertIsDisplayed()
        compose.runOnIdle {
            assertEquals("main", receive.owned.snapshot.value.selectedId)
            // Selecting the session the page already stands in is a close, not a
            // navigation: the page keeps its draft and its conversation.
            assertEquals("选择当前会话不得触发导航", emptyList<String>(), opened)
        }
    }

    @Test fun `drawer switches and creates conversations`() {
        conversation()
        compose.onNodeWithContentDescription("切换会话").performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithText("另一个会话").performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.runOnIdle { assertEquals("other", receive.owned.snapshot.value.selectedId) }
        compose.onNodeWithContentDescription("切换会话").performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithText("新建会话").performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.runOnIdle { assertEquals("created", receive.owned.snapshot.value.selectedId) }
        compose.onNodeWithContentDescription("发送消息").assertIsDisplayed()
    }

    @Test fun `creating an existing empty conversation enters it without adding a row`() {
        createdSession = OwnedSession("other", title = "复用会话")
        var target by mutableStateOf("main")
        show {
            FairyConversationPage(target, {}, receive, fairy,
                onOpenConversation = { target = it }, onSettings = {})
        }
        compose.waitUntil { !receive.owned.snapshot.value.loading }
        compose.onNodeWithContentDescription("切换会话").performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithText("新建会话").performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.runOnIdle {
            val snapshot = receive.owned.snapshot.value
            assertEquals("other", snapshot.selectedId)
            assertEquals("main", snapshot.primarySessionId)
            assertEquals(2, snapshot.sessions.size)
            assertTrue(
                "新建会话应复用已存在的空会话，实际多出了 ${snapshot.sessions.map { it.id }}",
                snapshot.sessions.none { it.id == "created" },
            )
            assertEquals("other", target)
        }
        compose.onNodeWithContentDescription("发送消息").assertIsDisplayed()
        compose.onNodeWithText("会话不可用").assertDoesNotExist()
        compose.onNodeWithContentDescription("切换会话").performClick()
        compose.mainClock.advanceTimeBy(500)
        // The reused session's title is on the drawer row and in the bar of the
        // conversation the create just entered.
        compose.onAllNodesWithText("复用会话").assertCountEquals(2)
    }

    @Test fun `unavailable restored conversation offers another session`() {
        conversation("missing")
        compose.onNodeWithText("会话不可用").assertIsDisplayed()
        compose.onNodeWithText("选择会话").performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithText("主会话").performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithContentDescription("发送消息").assertIsDisplayed()
    }

    @Test fun `archiving a session opened before its list row arrives follows main`() {
        listedSessions = OwnedSessions(emptyList(), "main")
        var target by mutableStateOf("other")
        show {
            FairyConversationPage(target, {}, receive, fairy,
                onOpenConversation = { target = it }, onSettings = {})
        }
        compose.waitUntil { receive.owned.snapshot.value.selectedId == "other" }
        compose.runOnIdle { receive.owned.archive("other") }
        compose.waitUntil { receive.owned.snapshot.value.selectedId == "main" }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        compose.runOnIdle { assertEquals("main", target) }
    }

    @Test fun `conversation observes thinking changes without moving the composer`() {
        updates["main"] = MutableStateFlow(RemoteChatProjection(
            sessionId = "main", cursor = 0, durableThroughSeq = 0,
            events = eventCoverage(0, 0),
            messages = listOf(RemoteChatMessage("history", 0, 0, role = 1, status = 2, text = "你好，Fairy")),
            activity = RemoteActivity(1),
        ))
        conversation()
        val viewportNode = compose.onNodeWithTag("conversation-messages")
        val before = compose.onNodeWithContentDescription("发送消息").fetchSemanticsNode().boundsInRoot
        val viewport = viewportNode.fetchSemanticsNode().boundsInRoot
        val density = viewportNode.fetchSemanticsNode().layoutInfo.density.density
        screenshot("conversation")
        compose.runOnIdle {
            val stream = updates.getValue("main")
            stream.value = stream.value.copy(version = 1, replyStatus = 1, activity = RemoteActivity(2, listOf(1)))
        }
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithText("正在思考…").assertIsDisplayed()
        val during = compose.onNodeWithContentDescription("停止回复").fetchSemanticsNode().boundsInRoot
        val after = viewportNode.fetchSemanticsNode().boundsInRoot
        val overlay = compose.onNodeWithTag("fairy-screen-overlay").fetchSemanticsNode().boundsInRoot
        assertEquals(before.top, during.top)
        assertEquals(viewport.bottom, after.bottom)
        assertEquals(FairyScreenOpenHeight.value * density, after.top - viewport.top, 0.5f)
        val firstMessage = compose.onNodeWithText("你好，Fairy").fetchSemanticsNode().boundsInRoot
        assertTrue(
            "第一条消息 top ${firstMessage.top}px 应不低于展开眼屏下沿 ${overlay.bottom}px",
            firstMessage.top >= overlay.bottom,
        )
        screenshot("thinking")
        compose.runOnIdle {
            val stream = updates.getValue("main")
            stream.value = stream.value.copy(version = 2, replyStatus = 0, activity = RemoteActivity(1))
        }
        compose.mainClock.advanceTimeBy(1_000)
        compose.onNodeWithText("正在思考…").assertDoesNotExist()
        assertEquals(viewport, viewportNode.fetchSemanticsNode().boundsInRoot)
    }

    @Test fun `empty conversation keeps the empty hint below the open screen`() {
        updates["main"] = MutableStateFlow(RemoteChatProjection(
            sessionId = "main", cursor = 0, durableThroughSeq = 0,
            events = eventCoverage(0, 0),
            activity = RemoteActivity(1),
        ))
        conversation()
        val overlay = compose.onNodeWithTag("fairy-screen-overlay").fetchSemanticsNode().boundsInRoot
        val hint = compose.onNodeWithText("此会话还没有消息。").fetchSemanticsNode()
        val top = hint.boundsInRoot.top
        assertTrue(
            "空会话提示 top ${top}px 应不低于展开眼屏下沿 ${overlay.bottom}px",
            top >= overlay.bottom,
        )
    }

    @Test fun `content stays below the eye screen while it opens`() {
        updates["main"] = MutableStateFlow(RemoteChatProjection(
            sessionId = "main", cursor = 0, durableThroughSeq = 0,
            events = eventCoverage(0, 0),
            messages = listOf(RemoteChatMessage("history", 0, 0, role = 1, status = 2, text = "你好，Fairy")),
            activity = RemoteActivity(1),
        ))
        var policy: AgoraMotionPolicy? = null
        var target by mutableStateOf("main")
        show(reduceMotion = false) {
            val resolved = LocalAgoraMotionPolicy.current
            SideEffect { policy = resolved }
            FairyConversationPage(target, {}, receive, fairy,
                onOpenConversation = { target = it }, onSettings = {})
        }
        assertFalse("该用例必须在允许空间动效的策略下运行", policy!!.reduceMotion)
        val density = compose.onNodeWithTag("conversation-messages")
            .fetchSemanticsNode().layoutInfo.density.density
        compose.runOnIdle {
            val stream = updates.getValue("main")
            stream.value = stream.value.copy(version = 1, replyStatus = 1, activity = RemoteActivity(2, listOf(1)))
        }
        var observed = 0
        val overlayHeights = mutableListOf<Float>()
        for (frame in 1..25) {
            compose.mainClock.advanceTimeBy(16)
            val overlay = compose.onAllNodesWithTag("fairy-screen-overlay").fetchSemanticsNodes().firstOrNull()
                ?: continue
            observed += 1
            overlayHeights += overlay.boundsInRoot.height
            val overlayBottom = overlay.boundsInRoot.bottom
            val messageTop = compose.onNodeWithText("你好，Fairy").fetchSemanticsNode().boundsInRoot.top
            assertTrue(
                "第 ${frame * 16}ms 帧：第一条消息 top ${messageTop}px 应不低于展开眼屏下沿 ${overlayBottom}px",
                messageTop >= overlayBottom - density,
            )
        }
        assertTrue("过渡期间应至少有一帧看到展开的眼屏", observed > 0)
        val open = FairyScreenOpenHeight.value * density
        assertTrue(
            "过渡期间应采到中间帧，实际高度 ${overlayHeights.map { it / density }}dp",
            overlayHeights.any { it > 0f && it < open - 1f },
        )
        assertEquals(open, compose.onNodeWithTag("fairy-screen-overlay").fetchSemanticsNode().boundsInRoot.height, 1f)
    }

    @Test
    @Config(qualifiers = "zh-rCN-w360dp-h800dp")
    fun `chat body keeps an even horizontal margin from the screen edge`() {
        val fairyBody = "Fairy正文：" + "正文与屏幕边缘之间保持明显留白，".repeat(5)
        val userBody = "用户正文：" + "气泡与屏幕右边缘之间保持明显留白，".repeat(5)
        updates["main"] = MutableStateFlow(RemoteChatProjection(
            sessionId = "main", cursor = 0, durableThroughSeq = 0,
            events = eventCoverage(0, 0),
            messages = listOf(
                RemoteChatMessage("fairy", 0, 0, role = 2, status = 2, text = fairyBody),
                RemoteChatMessage("user", 1, 1, role = 1, status = 2, text = userBody),
            ),
            activity = RemoteActivity(1),
        ))
        conversation()
        val fairy = compose.onAllNodesWithText("Fairy正文：", substring = true, useUnmergedTree = true)
            .onFirst().fetchSemanticsNode()
        val user = compose.onAllNodesWithText("用户正文：", substring = true, useUnmergedTree = true)
            .onFirst().fetchSemanticsNode()
        val density = fairy.layoutInfo.density.density
        val rootWidth = compose.onRoot().fetchSemanticsNode().boundsInRoot.width
        val fairyLeft = fairy.boundsInRoot.left / density
        val fairyRight = (rootWidth - fairy.boundsInRoot.right) / density
        val userRight = (rootWidth - user.boundsInRoot.right) / density
        screenshot("conversation-padding-360dp")
        assertTrue(
            "Fairy 正文左侧留白 $fairyLeft dp，应不小于 30 dp",
            fairyLeft >= 30f,
        )
        assertTrue(
            "Fairy 正文右侧留白 $fairyRight dp，应不小于 30 dp",
            fairyRight >= 30f,
        )
        assertTrue(
            "用户正文右侧留白 $userRight dp，应不小于 30 dp",
            userRight >= 30f,
        )
        assertTrue(
            "Fairy 正文左右留白 $fairyLeft / $fairyRight dp 应对称",
            abs(fairyLeft - fairyRight) <= 1f,
        )
    }

    @Test fun `sign in uses the instrument surface`() {
        show { IdentitySignInPage(onSignedIn = {}, onRegister = {}, session = account) }
        compose.mainClock.advanceTimeBy(5_000)
        compose.waitForIdle()

        compose.onNodeWithText("H.D.D.SYSTEM").assertIsDisplayed()
        compose.onAllNodesWithText("登录").onFirst().assertIsDisplayed()
        screenshot("sign-in")
    }
}
