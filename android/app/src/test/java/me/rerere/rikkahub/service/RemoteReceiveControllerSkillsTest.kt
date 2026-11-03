package me.rerere.rikkahub.service

import android.Manifest
import android.app.Application
import android.app.NotificationManager
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import me.rerere.rikkahub.data.remote.PendingSkill
import me.rerere.rikkahub.data.remote.SkillPool
import me.rerere.rikkahub.data.remote.SkillsBackend
import me.rerere.rikkahub.data.remote.SkillsReviewNotifier
import me.rerere.rikkahub.di.appModule
import me.rerere.rikkahub.di.identityModule
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.koin.android.ext.koin.androidContext
import org.koin.core.context.GlobalContext
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import org.koin.dsl.module
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadow.api.Shadow
import org.robolectric.util.ReflectionHelpers

/** The one scripted list the reminder reads; everything else is the app's own graph. */
private class ScriptedSkills : SkillsBackend {
    var pool = SkillPool()

    override suspend fun list(token: String): SkillPool = pool
    override suspend fun detail(token: String, skillId: Long) = error("not used")
    override suspend fun setEnabled(token: String, skillId: Long, enabled: Boolean) = error("not used")
    override suspend fun reviewOpen(token: String, versionId: Long) = error("not used")
    override suspend fun archive(token: String, skillId: Long) = error("not used")
    override suspend fun restore(token: String, skillId: Long) = error("not used")
}

/**
 * The production modules with only the skills list replaced.
 *
 * The reminder's gate is the real [AndroidRemoteNotifications] wired by the real `identityModule`;
 * nothing here re-states that wiring, which is the point: the test fails if the injection goes back
 * to the background-receive switch.
 */
open class SkillsReminderApplication : Application() {
    override fun onCreate() {
        super.onCreate()
        // Robolectric may keep the previous test's Koin in the same process.
        stopKoin()
        startKoin {
            androidContext(this@SkillsReminderApplication)
            modules(
                appModule,
                identityModule,
                module { single<SkillsBackend> { ScriptedSkills() } },
            )
        }
    }
}

/**
 * End-to-end wiring of the skills reminder in the production graph.
 *
 * The controller→notifier lifecycle wiring is pinned in `RemoteReceiveControllerTest`; this class
 * pins the composition that test cannot see: the reminder's only gate is
 * [AndroidRemoteNotifications.skillsNotificationsAllowed], never the background-receive switch that
 * [AndroidRemoteNotifications.enabled] carries. It runs the real notifier and the real notification
 * boundary against Robolectric's notification manager, with only the backend list scripted.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = SkillsReminderApplication::class, sdk = [35])
class RemoteReceiveControllerSkillsTest {

    private val context: Context get() = ApplicationProvider.getApplicationContext()
    private val appGraph get() = GlobalContext.get()

    private fun alertCount(manager: NotificationManager): Int = shadowOf(manager).activeNotifications.size

    /**
     * Grant the runtime notification permission the way Robolectric unit tests must.
     *
     * There is no system permission dialog here; the shadow instrumentation is the grant surface
     * and keeps it package-private, so it is reached through the public reflection helper.
     */
    private fun grantPostNotifications() {
        val activityThread = RuntimeEnvironment.getActivityThread()
        val instrumentation = activityThread.javaClass.getMethod("getInstrumentation").invoke(activityThread)
        ReflectionHelpers.callInstanceMethod<Any>(
            Shadow.extract(instrumentation),
            "grantPermissions",
            ReflectionHelpers.ClassParameter.from(
                Array<String>::class.java,
                arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            ),
        )
    }

    @Test
    fun `skills reminders follow the skills channel, not the background-receive switch`() = runBlocking {
        val backend = appGraph.get<SkillsBackend>() as ScriptedSkills
        val notifications = appGraph.get<AndroidRemoteNotifications>()
        val notifier = appGraph.get<SkillsReviewNotifier>()
        val manager = context.getSystemService(NotificationManager::class.java)

        // The default user: background reception is off, and the app is in the background.
        assertFalse("reception starts off, like a default install", notifications.enabled.value)
        grantPostNotifications()
        assertTrue("the skills channel is available in this test", notifications.skillsNotificationsAllowed())

        backend.pool = SkillPool(
            pending = listOf(PendingSkill(versionId = 41, name = "background-candidate", sourceType = 2)),
            pendingCount = 1,
        )
        notifier.observeNow("token", 7)

        assertEquals(
            "reception off must not silence the skills reminder",
            1,
            alertCount(manager),
        )
        val posted = shadowOf(manager).activeNotifications.single()
        assertEquals(AndroidRemoteNotifications.SKILLS_CHANNEL, posted.notification.channelId)
        assertTrue(
            "the reminder opens the skills page of the account that produced it: ${posted.tag}",
            posted.tag.startsWith("ourfairy://skills/") && posted.tag.endsWith("/7"),
        )

        // With reception on, the system notification switch is still the gate: no posting.
        notifications.setEnabled(true)
        shadowOf(manager).setNotificationsEnabled(false)
        assertFalse("notifications are switched off in this phase", notifications.skillsNotificationsAllowed())
        backend.pool = SkillPool(
            pending = listOf(
                PendingSkill(versionId = 41, name = "background-candidate", sourceType = 2),
                PendingSkill(versionId = 42, name = "second-candidate", sourceType = 2),
            ),
            pendingCount = 2,
        )
        notifier.observeNow("token", 7)
        assertEquals(
            "an unavailable channel publishes nothing even with reception on",
            1,
            alertCount(manager),
        )

        // Reopening the channel does not replay the set consumed while it was closed.
        shadowOf(manager).setNotificationsEnabled(true)
        notifier.observeNow("token", 7)
        assertEquals("the suppressed set is not replayed", 1, alertCount(manager))

        // A genuinely new set on another account still publishes normally.
        backend.pool = SkillPool(
            pending = listOf(
                PendingSkill(versionId = 41, name = "background-candidate", sourceType = 2),
                PendingSkill(versionId = 42, name = "second-candidate", sourceType = 2),
                PendingSkill(versionId = 43, name = "third-candidate", sourceType = 2),
            ),
            pendingCount = 3,
        )
        notifier.observeNow("token", 8)
        assertEquals("a new set publishes normally", 2, alertCount(manager))
        val tags = shadowOf(manager).activeNotifications.map { it.tag }
        assertTrue(
            "each account keeps its own notification: $tags",
            tags.any { it.endsWith("/7") } && tags.any { it.endsWith("/8") },
        )
    }
}
