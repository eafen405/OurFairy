package me.rerere.rikkahub.ui.fairy

import android.app.Application
import me.rerere.rikkahub.Screen
import me.rerere.rikkahub.ui.destination.DestinationRestore
import me.rerere.rikkahub.ui.destination.FairyDestinations
import me.rerere.rikkahub.ui.destination.UNKNOWN_LANDING
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * The stored last location is the catalog's restore policy, written and read.
 *
 * [FairyLastLocation] holds only the two preferences and the file name; which
 * page is remembered and which stack it reopens come from [FairyDestinations].
 * These cases pin the hand-off: a page the catalog says is resumable really is
 * written, and reading the file back produces the catalog's stack.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35])
class FairyLastLocationTest {

    private val application = RuntimeEnvironment.getApplication()

    /** What the file holds, read without going through the class under test. */
    private fun stored(): Pair<String?, String?> {
        val prefs = application.getSharedPreferences("fairy_last_location", Application.MODE_PRIVATE)
        return prefs.getString("route", null) to prefs.getString("conversation", null)
    }

    private fun location(): FairyLastLocation = FairyLastLocation(application)

    @Test
    fun `the impression page is remembered where it stands`() {
        location().record(Screen.Impression)

        assertEquals("impression" to null, stored())
        assertEquals(
            "a remembered impression reopens home, settings, impression",
            listOf(Screen.Home, Screen.Settings, Screen.Impression),
            location().restoredStack(),
        )
    }

    @Test
    fun `every destination the catalog can resume is written and read back to the same stack`() {
        // The expectation is written out rather than computed from the catalog: a
        // test that asks the functions under test what to expect proves only that
        // they agree with themselves.
        val resumable = listOf(
            Triple(Screen.Home, "home", listOf(Screen.Home)),
            Triple(Screen.Settings, "settings", listOf(Screen.Home, Screen.Settings)),
            Triple(Screen.Gateway, "gateway", listOf(Screen.Home, Screen.Settings, Screen.Gateway)),
            Triple(Screen.Impression, "impression", listOf(Screen.Home, Screen.Settings, Screen.Impression)),
            Triple(Screen.Conversation("main"), "conversation", listOf(Screen.Home, Screen.Conversation("main"))),
        )
        for ((screen, route, stack) in resumable) {
            location().record(screen)
            assertEquals("recording $screen stores its own route", route, stored().first)
            assertEquals("$screen reopens the stack the product enters it through", stack, location().restoredStack())
        }
        assertEquals(
            "every destination the catalog calls resumable has a row above",
            FairyDestinations.entries.filter { it.restore != DestinationRestore.Never }.map { it.route }.toSet(),
            resumable.map { it.second }.toSet(),
        )
    }

    @Test
    fun `a destination that is never resumed leaves the file untouched`() {
        location().record(Screen.Settings)
        val before = stored()

        location().record(Screen.SignIn)
        assertEquals("signing in is not a place to return to", before, stored())

        location().record(Screen.Register)
        assertEquals("nor is registering", before, stored())
    }

    @Test
    fun `a file this product never wrote lands on the console`() {
        val prefs = application.getSharedPreferences("fairy_last_location", Application.MODE_PRIVATE)
        prefs.edit().putString("route", "moved_away").putString("conversation", "main").apply()

        assertEquals(UNKNOWN_LANDING, location().restoredStack())
    }

    @Test
    fun `a stored session-list location from the previous version lands on the console`() {
        // The session list used to be a destination stored as "sessions". An
        // upgrade still finds that name in the file; it is no longer a place, so
        // the cold start opens the console instead of crashing or forcing the
        // overlay open.
        val prefs = application.getSharedPreferences("fairy_last_location", Application.MODE_PRIVATE)
        prefs.edit().putString("route", "sessions").putString("conversation", "main").apply()

        assertEquals(listOf(Screen.Home), location().restoredStack())
    }

    @Test
    fun `a bookmarked conversation without an id lands on the console`() {
        val prefs = application.getSharedPreferences("fairy_last_location", Application.MODE_PRIVATE)
        prefs.edit().putString("route", "conversation").putString("conversation", "  ").apply()

        assertEquals(UNKNOWN_LANDING, location().restoredStack())
    }
}
