package me.rerere.rikkahub

import android.app.Application
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import me.rerere.rikkahub.data.remote.AccountSession
import me.rerere.rikkahub.data.remote.AgentSummary
import me.rerere.rikkahub.data.remote.ChatHistoryPage
import me.rerere.rikkahub.data.remote.ChatReceipt
import me.rerere.rikkahub.data.remote.CredentialStore
import me.rerere.rikkahub.data.remote.IdentityBackend
import me.rerere.rikkahub.data.remote.IdentityUser
import me.rerere.rikkahub.data.remote.Impression
import me.rerere.rikkahub.data.remote.ImpressionBackend
import me.rerere.rikkahub.data.remote.OwnedSession
import me.rerere.rikkahub.data.remote.OwnedSessions
import me.rerere.rikkahub.data.remote.RemoteChatBackend
import me.rerere.rikkahub.data.remote.RemoteChatProjection
import me.rerere.rikkahub.data.remote.SessionBackend
import me.rerere.rikkahub.data.remote.SignedIn
import me.rerere.rikkahub.di.appModule
import me.rerere.rikkahub.di.identityModule
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import org.koin.dsl.module
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * A cold start of the real [RouteActivity] over the production modules, with the
 * last location a previous run stored.
 *
 * The console, settings, gateway and impression are assembled by
 * [me.rerere.rikkahub.ui.destination.FairyDestinations]; these cases prove the
 * Activity actually opens the stack that catalog declares, rather than a stack a
 * test hand-built. Everything the account would reach over the network is a fake,
 * and [CountingHttp] fails the run if any request escapes.
 */
private object CountingHttp {
    /** Every host a real request would have gone to. */
    val hosts = mutableListOf<String>()

    fun client(): OkHttpClient = OkHttpClient.Builder()
        .addInterceptor { chain ->
            hosts += chain.request().url.host
            error("a cold start must not reach the network: ${chain.request().url}")
        }
        .build()
}

/** A credential the device already holds, so the start is a returning user's. */
private class StoredCredential(private val token: String?) : CredentialStore {
    override suspend fun load(): String? = token
    override suspend fun save(token: String) = Unit
    override suspend fun clear() = Unit
}

private class AccountBackend : IdentityBackend {
    override suspend fun session(token: String) = IdentityUser(shortId = 2, name = "agent-two")
    override suspend fun signIn(name: String, password: String) = SignedIn("token", session("token"))
    override suspend fun register(inviteCode: String, name: String, password: String) = error("not used")
    override suspend fun createInvite(token: String) = error("not used")
    override suspend fun agents(token: String) = listOf(AgentSummary(2, "agent-two"))
    override suspend fun signOut(token: String) = Unit
}

private class SessionsBackend : SessionBackend {
    override suspend fun list(token: String, archived: Boolean) = OwnedSessions(emptyList(), null)
    override suspend fun create(token: String) = error("not used")
    override suspend fun select(token: String, sessionId: String) = error("not used")
    override suspend fun primary(token: String) = error("not used")
    override suspend fun read(token: String, sessionId: String) = error("not used")
    override suspend fun rename(token: String, sessionId: String, title: String) = error("not used")
    override suspend fun archive(token: String, sessionId: String) = error("not used")
    override suspend fun restore(token: String, sessionId: String) = error("not used")
}

private class UnopenedChatBackend : RemoteChatBackend {
    override fun observe(token: String, sessionId: String): Flow<RemoteChatProjection> = flowOf()
    override suspend fun checkpoint(token: String, sessionId: String) = error("not used")
    override suspend fun page(token: String, sessionId: String, throughSeq: Long, beforeSeq: Long): ChatHistoryPage =
        error("not used")
    override suspend fun read(token: String, sessionId: String) = error("not used")
    override suspend fun send(
        token: String,
        sessionId: String,
        requestId: String,
        text: String,
        uploadIds: List<String>,
    ) = error("not used")
    override suspend fun receipt(token: String, sessionId: String, requestId: String): ChatReceipt? = null
    override suspend fun stop(token: String, sessionId: String) = Unit
}

private class OwnImpression : ImpressionBackend {
    override suspend fun read(token: String) = Impression(content = "a remembered impression")
    override suspend fun edit(token: String, content: String) = Unit
}

/**
 * The production modules with the account and the network replaced, seeded with
 * the last location [route] a previous run would have written.
 *
 * The seed is written here rather than in a test body because the Activity reads
 * it as it composes; and Koin is stopped first because Robolectric runs every
 * test of a class in one process, where the previous test's Koin is still up.
 */
open class SeededColdStartApplication(
    private val route: String,
    private val conversation: String? = null,
) : Application() {
    override fun onCreate() {
        super.onCreate()
        stopKoin()
        getSharedPreferences("fairy_last_location", MODE_PRIVATE).edit()
            .putString("route", route)
            .putString("conversation", conversation)
            .apply()
        startKoin {
            androidContext(this@SeededColdStartApplication)
            modules(
                appModule,
                identityModule,
                module {
                    single { CountingHttp.client() }
                    single<CredentialStore> { StoredCredential("token") }
                    single<IdentityBackend> { AccountBackend() }
                    single<SessionBackend> { SessionsBackend() }
                    single<RemoteChatBackend> { UnopenedChatBackend() }
                    single<ImpressionBackend> { OwnImpression() }
                },
            )
        }
    }
}

/** A returning user whose last accepted destination was the settings page. */
class SettingsColdStartApplication : SeededColdStartApplication("settings")

/** A returning user who was standing on their own impression page. */
class ImpressionColdStartApplication : SeededColdStartApplication("impression")

/**
 * A returning user whose previous version left the session-list destination in
 * the file. The list is no longer a destination; the upgrade falls back to the
 * console.
 */
class SessionsColdStartApplication : SeededColdStartApplication("sessions", "main")

@RunWith(RobolectricTestRunner::class)
@Config(application = SettingsColdStartApplication::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SettingsColdStartTest {
    @get:Rule val compose = createAndroidComposeRule<RouteActivity>()

    @Test
    fun `a stored settings location reopens the settings page`() {
        compose.mainClock.autoAdvance = false
        // The CRT bookend plays before the page is reachable.
        repeat(8) { compose.mainClock.advanceTimeBy(1_000); compose.waitForIdle() }
        compose.onNodeWithText("退出登录").assertIsDisplayed()
        assertEquals("a cold start must not reach the network", emptyList<String>(), CountingHttp.hosts)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(application = ImpressionColdStartApplication::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ImpressionColdStartTest {
    @get:Rule val compose = createAndroidComposeRule<RouteActivity>()

    @Test
    fun `a stored impression location reopens the impression page`() {
        compose.mainClock.autoAdvance = false
        repeat(8) { compose.mainClock.advanceTimeBy(1_000); compose.waitForIdle() }
        compose.onNodeWithText(compose.activity.getString(R.string.impression_explain)).assertIsDisplayed()
        assertEquals("a cold start must not reach the network", emptyList<String>(), CountingHttp.hosts)
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(application = SessionsColdStartApplication::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SessionsColdStartTest {
    @get:Rule val compose = createAndroidComposeRule<RouteActivity>()

    @Test
    fun `a stored session-list location lands on the console without opening the list`() {
        compose.mainClock.autoAdvance = false
        // The CRT bookend plays before the page is reachable.
        repeat(8) { compose.mainClock.advanceTimeBy(1_000); compose.waitForIdle() }

        // The console is the page: it offers both ways on but shows no
        // conversation error, and the list stays closed.
        compose.onNodeWithText("进入会话").assertIsDisplayed()
        compose.onNodeWithText("全部会话").assertIsDisplayed()
        compose.onNodeWithText("会话不可用").assertDoesNotExist()
        // The list is the console's overlay. Its sheet may be composed behind
        // the closed drawer, but it must not be on screen at a cold start.
        compose.onNodeWithContentDescription("关闭会话列表").assertIsNotDisplayed()
        assertEquals("a cold start must not reach the network", emptyList<String>(), CountingHttp.hosts)
    }
}
