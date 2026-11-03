package me.rerere.rikkahub.ui.identity

import androidx.navigation3.runtime.NavKey
import me.rerere.rikkahub.Screen
import me.rerere.rikkahub.data.remote.AccountSession
import me.rerere.rikkahub.ui.destination.UNKNOWN_LANDING
import me.rerere.rikkahub.ui.fairy.FairyLastLocation

/**
 * Restore once, then replace the provisional stack using the current session
 * identity. A returning user is put back where the app was left; a visitor
 * always starts at sign-in. [lastLocation] is null in unit tests, which land on
 * the console exactly as a first run does — the catalog's [UNKNOWN_LANDING].
 */
suspend fun restoreIdentitySession(
    session: AccountSession,
    backStack: MutableList<NavKey>,
    lastLocation: FairyLastLocation? = null,
) {
    session.restore()
    backStack.clear()
    if (session.user != null) {
        backStack.addAll(lastLocation?.restoredStack() ?: UNKNOWN_LANDING)
    } else {
        backStack.add(Screen.SignIn)
    }
}
