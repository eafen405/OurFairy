package me.rerere.rikkahub.ui.fairy

import android.app.Application
import me.rerere.rikkahub.Screen
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
        val resumable = listOf(
            Screen.Home,
            Screen.Settings,
            Screen.Gateway,
            Screen.Impression,
            Screen.Sessions,
            Screen.Conversation("main"),
        )
        for (screen in resumable) {
            location().record(screen)
            assertEquals(
                "recording $screen stores the catalog's route",
                FairyDestinations.restingPlaceOf(screen)?.route,
                stored().first,
            )
            assertEquals(
                "$screen reopens the stack the catalog declares",
                FairyDestinations.restingPlaceOf(screen)?.let {
                    FairyDestinations.resumedStack(it.route, it.conversation)
                },
                location().restoredStack(),
            )
        }
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
    fun `a bookmarked conversation without an id lands on the console`() {
        val prefs = application.getSharedPreferences("fairy_last_location", Application.MODE_PRIVATE)
        prefs.edit().putString("route", "conversation").putString("conversation", "  ").apply()

        assertEquals(UNKNOWN_LANDING, location().restoredStack())
    }
}
