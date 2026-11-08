package me.rerere.rikkahub

import android.app.Application
import android.content.Intent
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleRegistry
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.compose.ui.test.assertIsDisplayed
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
import me.rerere.rikkahub.data.remote.OwnedSession
import me.rerere.rikkahub.data.remote.OwnedSessions
import me.rerere.rikkahub.data.remote.RemoteActivity
import me.rerere.rikkahub.data.remote.RemoteChatBackend
import me.rerere.rikkahub.data.remote.RemoteChatProjection
import me.rerere.rikkahub.data.remote.SessionBackend
import me.rerere.rikkahub.data.remote.SignedIn
import me.rerere.rikkahub.data.remote.SkillPool
import me.rerere.rikkahub.data.remote.SkillPoolItem
import me.rerere.rikkahub.data.remote.SkillsBackend
import me.rerere.rikkahub.di.appModule
import me.rerere.rikkahub.di.identityModule
import me.rerere.rikkahub.service.AndroidRemoteNotifications
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
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
 * A remote notification opened against the real [RouteActivity].
 *
 * The account and endpoint admission lives in `openRemoteNotification` /
 * `openSkillsNotification` (`ui/identity/RemoteNotificationNavigation.kt`); what
 * only the Activity can show is that a delivered intent reaches it at the right
 * moment — after the cold start has settled, or queued until it has — and that
 * the destination it lands on actually opens. Nothing here reaches the network.
 *
 * The app must report itself foreground for the chat to bind at all: reception
 * only observes sessions while the process is at least started, and Robolectric
 * never delivers that transition by itself.
 */
private class NotificationCredential : CredentialStore {
    override suspend fun load(): String? = "token"
    override suspend fun save(token: String) = Unit
    override suspend fun clear() = Unit
}

private class NotificationAccount : IdentityBackend {
    override suspend fun session(token: String) = IdentityUser(shortId = 2, name = "agent-two")
    override suspend fun signIn(name: String, password: String) = SignedIn("token", session("token"))
    override suspend fun register(inviteCode: String, name: String, password: String) = error("not used")
    override suspend fun createInvite(token: String) = error("not used")
    override suspend fun agents(token: String) = listOf(AgentSummary(2, "agent-two"))
    override suspend fun signOut(token: String) = Unit
}

/** One owned session, so a notification naming it can actually be admitted. */
private class NotificationSessions : SessionBackend {
    override suspend fun list(token: String, archived: Boolean) =
        OwnedSessions(listOf(OwnedSession("s2", primary = true, title = "被提醒的会话")), "s2")

    override suspend fun read(token: String, sessionId: String) = OwnedSession(sessionId, title = "被提醒的会话")
    override suspend fun select(token: String, sessionId: String) = read(token, sessionId)
    override suspend fun primary(token: String) = OwnedSession("s2", primary = true)
    override suspend fun create(token: String) = error("not used")
    override suspend fun rename(token: String, sessionId: String, title: String) = error("not used")
    override suspend fun archive(token: String, sessionId: String) = error("not used")
    override suspend fun restore(token: String, sessionId: String) = error("not used")
}

/** The skills page's own backend; the reminder observation must not reach the blocked network. */
private class QuietSkills : SkillsBackend {
    override suspend fun list(token: String) = SkillPool()
    override suspend fun detail(token: String, skillId: Long): SkillPoolItem = error("not used")
    override suspend fun setEnabled(token: String, skillId: Long, enabled: Boolean): SkillPoolItem = error("not used")
    override suspend fun reviewOpen(token: String, versionId: Long): String = error("not used")
    override suspend fun archive(token: String, skillId: Long): SkillPoolItem = error("not used")
    override suspend fun restore(token: String, skillId: Long): SkillPoolItem = error("not used")
}

/** A quiet session: it is open, and it is not doing anything. */
private class NotificationChat : RemoteChatBackend {
    private val updates = mutableMapOf<String, MutableStateFlow<RemoteChatProjection>>()

    override fun observe(token: String, sessionId: String): Flow<RemoteChatProjection> =
        updates.getOrPut(sessionId) {
            MutableStateFlow(RemoteChatProjection(sessionId, activity = RemoteActivity(status = 1)))
        }

    override suspend fun checkpoint(token: String, sessionId: String): Long =
        updates.getValue(sessionId).value.cursor

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

/** The production modules with the account and the network replaced, seeded at the settings page. */
open class NotificationColdStartApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Robolectric runs every test of a class in one process, where the
        // previous test's Koin is still up.
        stopKoin()
        getSharedPreferences("fairy_last_location", MODE_PRIVATE).edit()
            .putString("route", "settings")
            .apply()
        startKoin {
            androidContext(this@NotificationColdStartApplication)
            modules(
                appModule,
                identityModule,
                module {
                    single {
                        OkHttpClient.Builder()
                            .addInterceptor { chain ->
                                error("a notification must not reach the network: ${chain.request().url}")
                            }
                            .build()
                    }
                    single<CredentialStore> { NotificationCredential() }
                    single<IdentityBackend> { NotificationAccount() }
                    single<SessionBackend> { NotificationSessions() }
                    single<RemoteChatBackend> { NotificationChat() }
                    single<SkillsBackend> { QuietSkills() }
                },
            )
        }
    }
}

@RunWith(RobolectricTestRunner::class)
@Config(application = NotificationColdStartApplication::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class NotificationColdStartTest {
    @get:Rule val compose = createAndroidComposeRule<RouteActivity>()

    /** The intent the receiver posts, aimed at the account this device is signed in as. */
    private fun notification(sessionId: String): Intent = Intent(AndroidRemoteNotifications.ACTION_OPEN_REMOTE)
        .putExtra(AndroidRemoteNotifications.EXTRA_ENDPOINT, BuildConfig.IDENTITY_ENDPOINT)
        .putExtra(AndroidRemoteNotifications.EXTRA_ACCOUNT, 2)
        .putExtra(AndroidRemoteNotifications.EXTRA_SESSION, sessionId)

    /** The skills reminder intent, aimed at the same account. */
    private fun skillsNotification(): Intent = Intent(AndroidRemoteNotifications.ACTION_OPEN_SKILLS)
        .putExtra(AndroidRemoteNotifications.EXTRA_ENDPOINT, BuildConfig.IDENTITY_ENDPOINT)
        .putExtra(AndroidRemoteNotifications.EXTRA_ACCOUNT, 2)

    /**
     * Report the app as foreground.
     *
     * Reception only observes sessions while the process is at least started
     * (`RemoteReceiveController.reconcile`), and Robolectric never delivers that
     * transition itself. Without it the chat is created but never bound, which is
     * the state a user reading a conversation would never be in.
     */
    private fun foreground() {
        val lifecycle = ProcessLifecycleOwner.get().lifecycle as LifecycleRegistry
        lifecycle.handleLifecycleEvent(Lifecycle.Event.ON_START)
    }

    /** Let the cold start settle and the CRT bookend play. */
    private fun settle() {
        repeat(8) { compose.mainClock.advanceTimeBy(1_000); compose.waitForIdle() }
    }

    @Test
    fun `a notification delivered after the account settles opens its conversation`() {
        compose.mainClock.autoAdvance = false
        foreground()
        settle()
        compose.onNodeWithText("退出登录").assertIsDisplayed()

        compose.runOnUiThread { compose.activity.handleIntent(notification("s2")) }
        repeat(6) { compose.mainClock.advanceTimeBy(1_000); compose.waitForIdle() }

        // The conversation is open, not merely routed to: the composer is there
        // and the page's "cannot open this conversation" fallback is not.
        compose.onNodeWithContentDescription("发送消息").assertIsDisplayed()
        compose.onNodeWithText("暂时无法打开此会话").assertDoesNotExist()
    }

    @Test
    fun `a skills reminder opens the skills page for its own account`() {
        compose.mainClock.autoAdvance = false
        foreground()
        settle()
        compose.onNodeWithText("退出登录").assertIsDisplayed()

        compose.runOnUiThread { compose.activity.handleIntent(skillsNotification()) }
        repeat(6) { compose.mainClock.advanceTimeBy(1_000); compose.waitForIdle() }

        compose.onNodeWithText("还没有可用的已审核技能。").assertIsDisplayed()
        compose.onNodeWithContentDescription("发送消息").assertDoesNotExist()
    }

    @Test
    fun `a skills reminder for another account is ignored`() {
        compose.mainClock.autoAdvance = false
        foreground()
        settle()

        compose.runOnUiThread {
            compose.activity.handleIntent(
                Intent(AndroidRemoteNotifications.ACTION_OPEN_SKILLS)
                    .putExtra(AndroidRemoteNotifications.EXTRA_ENDPOINT, BuildConfig.IDENTITY_ENDPOINT)
                    .putExtra(AndroidRemoteNotifications.EXTRA_ACCOUNT, 9),
            )
        }
        repeat(6) { compose.mainClock.advanceTimeBy(1_000); compose.waitForIdle() }

        compose.onNodeWithText("还没有可用的已审核技能。").assertDoesNotExist()
    }

    @Test
    fun `a skills reminder delivered before the account settles opens once it does`() {
        compose.mainClock.autoAdvance = false
        foreground()
        // Nothing has composed yet: the Activity has no back stack and the
        // identity has not settled, so this reminder can only be queued.
        compose.runOnUiThread { compose.activity.handleIntent(skillsNotification()) }

        settle()
        repeat(6) { compose.mainClock.advanceTimeBy(1_000); compose.waitForIdle() }

        compose.onNodeWithText("还没有可用的已审核技能。").assertIsDisplayed()
    }

    @Test
    fun `a notification delivered before the account settles opens once it does`() {
        compose.mainClock.autoAdvance = false
        foreground()
        // Nothing has composed yet: the Activity has no back stack and the
        // identity has not settled, so this intent can only be queued.
        compose.runOnUiThread { compose.activity.handleIntent(notification("s2")) }

        settle()
        repeat(6) { compose.mainClock.advanceTimeBy(1_000); compose.waitForIdle() }

        compose.onNodeWithContentDescription("发送消息").assertIsDisplayed()
        compose.onNodeWithText("暂时无法打开此会话").assertDoesNotExist()
    }
}
