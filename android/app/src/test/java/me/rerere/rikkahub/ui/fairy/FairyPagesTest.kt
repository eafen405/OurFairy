package me.rerere.rikkahub.ui.fairy

import android.app.Application
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.graphics.asAndroidBitmap
import java.io.File
import java.time.Duration
import android.graphics.Bitmap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking
import me.rerere.rikkahub.Screen
import me.rerere.rikkahub.data.datastore.DisplayPreferences
import me.rerere.rikkahub.data.remote.*
import me.rerere.rikkahub.data.datastore.LocalDisplayPreferences
import me.rerere.rikkahub.ui.identity.IdentitySignInPage
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
    @get:Rule val compose = createComposeRule()
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
    private val sessions = object : SessionBackend {
        override suspend fun list(token: String) = listedSessions
        override suspend fun read(token: String, sessionId: String): OwnedSession {
            if (sessionId == "missing") throw IdentityRefused(404, "session/not-found", "会话已不存在")
            return OwnedSession(sessionId, primary = sessionId == listedSessions.primarySessionId)
        }
        override suspend fun select(token: String, sessionId: String) = read(token, sessionId)
        override suspend fun primary(token: String) = OwnedSession("main", primary = true)
        override suspend fun create(token: String) = createdSession
    }
    private val updates = mutableMapOf<String, MutableStateFlow<RemoteChatProjection>>()
    private val backend = object : RemoteChatBackend {
        override fun observe(token: String, sessionId: String) = updates.getOrPut(sessionId) {
            MutableStateFlow(RemoteChatProjection(sessionId, activity = RemoteActivity(status = 1)))
        }
        override suspend fun checkpoint(token: String, sessionId: String) = updates.getValue(sessionId).value.cursor
        override suspend fun page(token: String, sessionId: String, throughSeq: Long, beforeSeq: Long) = error("not used")
        override suspend fun read(token: String, sessionId: String) = error("not used")
        override suspend fun send(token: String, sessionId: String, requestId: String, text: String, uploadIds: List<String>) = error("not used")
        override suspend fun receipt(token: String, sessionId: String, requestId: String): ChatReceipt? = null
        override suspend fun stop(token: String, sessionId: String) = Unit
    }
    private val store = object : ChatSyncStore {
        override suspend fun load(key: ChatSyncKey) = ChatSyncRecord(-1, true)
        override suspend fun save(key: ChatSyncKey, record: ChatSyncRecord) = Unit
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

    private fun home(onOpen: (Screen) -> Unit) {
        show { FairyConsolePage(onOpen, account, receive) }
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

    @Test fun `home displays and opens the recently selected session`() {
        var destination: Screen? = null
        home { destination = it }
        compose.waitUntil { !receive.owned.snapshot.value.loading }
        compose.runOnIdle { receive.owned.select("other") }
        compose.waitUntil { receive.owned.snapshot.value.selectedId == "other" }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        screenshot("home-selected")

        // The console still reports the opaque current-session id; the drawer is
        // where the ticket replaces it with the session's title.
        compose.onNodeWithText("other").assertIsDisplayed()
        compose.onNodeWithText("进入会话").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(Screen.Conversation("other"), destination) }
    }

    @Test fun `home without an enterable session opens the session list`() {
        listedSessions = OwnedSessions(emptyList(), null)
        var destination: Screen? = null
        home { destination = it }

        compose.onNodeWithText("—").assertIsDisplayed()
        compose.onNodeWithText("0").assertIsDisplayed()
        compose.onNodeWithText("进入会话").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(Screen.Sessions, destination) }
    }

    @Test fun `home opens all sessions directly with their real count`() {
        var destination by mutableStateOf<Screen>(Screen.Home)
        show {
            when (val target = destination) {
                Screen.Home -> FairyConsolePage({ destination = it }, account, receive)
                Screen.Sessions -> FairyConversationPage(
                    null, { destination = Screen.Home }, receive,
                    onOpenConversation = { destination = Screen.Conversation(it) }, onSettings = {},
                )
                is Screen.Conversation -> FairyConversationPage(
                    target.sessionId, { destination = Screen.Home }, receive,
                    onOpenConversation = { destination = Screen.Conversation(it) }, onSettings = {},
                )
                else -> error("Unexpected destination: $target")
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
        compose.onNodeWithText("主会话标题").assertIsDisplayed()
        compose.onNodeWithText("另一个会话").assertIsDisplayed()
        compose.onNodeWithText("主会话").assertIsDisplayed()
        compose.onNodeWithText("会话 1").assertDoesNotExist()
        compose.onNodeWithText("会话 2").assertDoesNotExist()
        compose.onNodeWithText("main").assertDoesNotExist()
        compose.onNodeWithText("other").assertDoesNotExist()
        compose.runOnIdle { assertEquals(Screen.Sessions, destination) }
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
        compose.onAllNodesWithText("主会话标题").assertCountEquals(1)
        compose.onAllNodesWithText("新会话").assertCountEquals(1)
        compose.onAllNodesWithText("unnamed-7f3a9c1b").assertCountEquals(0)
    }

    @Test
    @Config(qualifiers = "zh-rCN-w320dp-h640dp")
    fun `home keeps long content bounded and actions reachable on narrow screens`() {
        RuntimeEnvironment.setFontScale(1.3f)
        val longName = "长用户名".repeat(12)
        val longSession = "session-" + "0123456789abcdef".repeat(4)
        user = IdentityUser(2, longName)
        listedSessions = OwnedSessions(
            listOf(OwnedSession("main", primary = true), OwnedSession(longSession)), "main",
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
        assertBounded(longSession)
        compose.onNodeWithText("全部会话").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("设置").performScrollTo().assertIsDisplayed()
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
                Screen.Home -> FairyConsolePage({ destination = it }, account, receive)
                else -> FairySettingsPage(
                    {}, {}, account, backend = identityBackend, onBack = { destination = Screen.Home },
                )
            }
        }
        compose.onNodeWithText("agent-two").assertIsDisplayed()
        compose.onNodeWithText("#2").assertIsDisplayed()
        compose.onNodeWithText("AGENT").assertIsDisplayed()
        compose.onNodeWithText("main").assertIsDisplayed()
        screenshot("home")
        compose.onNodeWithText("设置").performScrollTo().performClick()
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

    private fun conversation(initial: String = "main") {
        var target by mutableStateOf(initial)
        show {
            FairyConversationPage(target, {}, receive,
                onOpenConversation = { target = it }, onSettings = {})
        }
    }

    @Test fun `home opens the current conversation with a visible composer`() {
        var destination by mutableStateOf<Screen>(Screen.Home)
        show {
            when (val target = destination) {
                is Screen.Conversation -> FairyConversationPage(
                    target.sessionId, {}, receive,
                    onOpenConversation = { destination = Screen.Conversation(it) }, onSettings = {},
                )
                else -> FairyConsolePage({ destination = it }, account, receive)
            }
        }
        compose.onNodeWithText("进入会话").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.runOnIdle { assertEquals(Screen.Conversation("main"), destination) }
        compose.onNodeWithContentDescription("切换会话").assertIsDisplayed()
        compose.onNodeWithContentDescription("发送消息").assertIsDisplayed()
    }

    @Test fun `selected session can still be opened from the session list`() {
        conversation()
        compose.onNodeWithText("发送消息…").performTextInput("保留草稿")
        compose.onNodeWithContentDescription("切换会话").performClick()
        compose.mainClock.advanceTimeBy(500)
        screenshot("sessions")
        compose.onNodeWithText("主会话").assertIsDisplayed().assertIsEnabled().performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithContentDescription("发送消息").assertIsDisplayed()
        compose.onNodeWithText("主会话").assertIsNotDisplayed()
        compose.onNodeWithText("保留草稿").assertIsDisplayed()
        compose.runOnIdle { assertEquals("main", receive.owned.snapshot.value.selectedId) }
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
            FairyConversationPage(target, {}, receive,
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
        compose.onAllNodesWithText("复用会话").assertCountEquals(1)
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
            FairyConversationPage(target, {}, receive,
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

        compose.onNodeWithText("空洞深潜系统").assertIsDisplayed()
        compose.onAllNodesWithText("登录").onFirst().assertIsDisplayed()
        screenshot("sign-in")
    }
}
