package me.rerere.rikkahub.ui.fairy

import android.app.Application
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
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
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlin.math.abs
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FairyPagesTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var user = IdentityUser(2, "代理人")
    private var listedSessions = OwnedSessions(
        listOf(OwnedSession("main", primary = true), OwnedSession("other")), "main",
    )
    private val sessions = object : SessionBackend {
        override suspend fun list(token: String) = listedSessions
        override suspend fun read(token: String, sessionId: String): OwnedSession {
            if (sessionId == "missing") throw IdentityRefused(404, "session/not-found", "会话已不存在")
            return OwnedSession(sessionId, primary = sessionId == listedSessions.primarySessionId)
        }
        override suspend fun select(token: String, sessionId: String) = read(token, sessionId)
        override suspend fun primary(token: String) = OwnedSession("main", primary = true)
        override suspend fun create(token: String) = OwnedSession("created")
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
    private val account = AccountSession(object : IdentityBackend {
        override suspend fun session(token: String) = user
        override suspend fun signIn(name: String, password: String) = SignedIn("test", session("test"))
        override suspend fun register(inviteCode: String, name: String, password: String) = error("not used")
        override suspend fun createInvite(token: String) = error("not used")
        override suspend fun signOut(token: String) = Unit
    }, InMemoryCredentialStore("test"), receive::bindIdentity)

    @After fun close() { scope.cancel() }

    private fun show(content: @Composable () -> Unit) {
        compose.mainClock.autoAdvance = false
        runBlocking { account.restore() }
        compose.setContent {
            CompositionLocalProvider(LocalDisplayPreferences provides DisplayPreferences()) {
                FairyAppTheme {
                    ProvideAgoraMotionPolicy(appReduceMotion = true, content = content)
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

    @Test fun `home displays and opens the recently selected session`() {
        var destination: Screen? = null
        home { destination = it }
        compose.waitUntil { !receive.owned.snapshot.value.loading }
        compose.runOnIdle { receive.owned.select("other") }
        compose.waitUntil { receive.owned.snapshot.value.selectedId == "other" }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        screenshot("home-selected")

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
        compose.onNodeWithText("主会话").assertIsDisplayed()
        compose.onNodeWithText("other").assertIsDisplayed()
        compose.runOnIdle { assertEquals(Screen.Sessions, destination) }
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
                else -> FairySettingsPage({}, {}, account, onBack = { destination = Screen.Home })
            }
        }
        compose.onNodeWithText("代理人").assertIsDisplayed()
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
        compose.onNodeWithText("other").performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.runOnIdle { assertEquals("other", receive.owned.snapshot.value.selectedId) }
        compose.onNodeWithContentDescription("切换会话").performClick()
        compose.mainClock.advanceTimeBy(500)
        compose.onNodeWithText("新建会话").performClick()
        compose.mainClock.advanceTimeBy(600)
        compose.runOnIdle { assertEquals("created", receive.owned.snapshot.value.selectedId) }
        compose.onNodeWithContentDescription("发送消息").assertIsDisplayed()
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
            messages = listOf(RemoteChatMessage("history", 0, role = 1, status = 2, text = "你好，Fairy")),
            activity = RemoteActivity(1),
        ))
        conversation()
        val before = compose.onNodeWithContentDescription("发送消息").fetchSemanticsNode().boundsInRoot
        val viewport = compose.onNodeWithTag("conversation-messages").fetchSemanticsNode().boundsInRoot
        screenshot("conversation")
        compose.runOnIdle {
            val stream = updates.getValue("main")
            stream.value = stream.value.copy(version = 1, replyStatus = 1, activity = RemoteActivity(2, listOf(1)))
        }
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithText("正在思考…").assertIsDisplayed()
        val during = compose.onNodeWithContentDescription("停止回复").fetchSemanticsNode().boundsInRoot
        assertEquals(before.top, during.top)
        assertEquals(viewport, compose.onNodeWithTag("conversation-messages").fetchSemanticsNode().boundsInRoot)
        screenshot("thinking")
        compose.runOnIdle {
            val stream = updates.getValue("main")
            stream.value = stream.value.copy(version = 2, replyStatus = 0, activity = RemoteActivity(1))
        }
        compose.mainClock.advanceTimeBy(600)
        compose.onNodeWithText("正在思考…").assertDoesNotExist()
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
                RemoteChatMessage("fairy", 0, role = 2, status = 2, text = fairyBody),
                RemoteChatMessage("user", 1, role = 1, status = 2, text = userBody),
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
}
