package me.rerere.rikkahub.ui.fairy

import android.content.Context
import me.rerere.rikkahub.Screen
import me.rerere.rikkahub.ui.destination.FairyDestinations

/**
 * Stores where the user was standing, so a later cold start can return there.
 *
 * This class is only the file: it owns the preferences and the two keys, and it
 * writes or reads exactly what [FairyDestinations] says a destination's
 * coordinates are. Which pages are remembered, under which name, and which stack
 * a name reopens are the catalog's decisions.
 */
class FairyLastLocation(context: Context) {

    private val prefs = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    /**
     * Record where the user is standing.
     *
     * [FairyDestinations.restingPlaceOf] answers null for a page that is not a
     * place to return to — the credential pages — so such a page leaves the file
     * on the last place the user could actually be returned to.
     */
    fun record(screen: Screen) {
        val place = FairyDestinations.restingPlaceOf(screen) ?: return
        prefs.edit()
            .putString(KEY_ROUTE, place.route)
            .putString(KEY_CONVERSATION, place.conversation)
            .apply()
    }

    /**
     * The stack a cold start should open, as the catalog's restore policy says.
     *
     * The two stored strings are handed over verbatim: a name this version does
     * not know, and a conversation coordinate that is absent or blank, are the
     * catalog's [me.rerere.rikkahub.ui.destination.UNKNOWN_LANDING], not a
     * fallback invented here.
     */
    fun restoredStack(): List<Screen> = FairyDestinations.resumedStack(
        route = prefs.getString(KEY_ROUTE, null),
        conversation = prefs.getString(KEY_CONVERSATION, null),
    )

    private companion object {
        /** Kept from the version before the catalog: an upgrade reads this same file. */
        const val FILE = "fairy_last_location"
        const val KEY_ROUTE = "route"
        const val KEY_CONVERSATION = "conversation"
    }
}
