package me.rerere.rikkahub.ui.destination

import androidx.compose.runtime.Composable
import me.rerere.rikkahub.Screen
import me.rerere.rikkahub.data.remote.AccountSession
import me.rerere.rikkahub.data.remote.IdentityBackend
import me.rerere.rikkahub.data.remote.RemoteReceiveState
import me.rerere.rikkahub.ui.identity.IdentityScope

/**
 * One destination: the name a run stores it under, who may compose it, where a
 * cold start returns to it, and how it is assembled.
 *
 * All four are required, so a destination cannot be declared without a policy
 * for each.
 */
class FairyDestination(
    /** The name a run stores for this destination and a later run reads back. */
    val route: String,
    /** Who may compose it. */
    val access: DestinationAccess,
    /** Whether a cold start returns to it, and to which stack. */
    val restore: DestinationRestore,
    /**
     * The page assembly for one instance of this destination.
     *
     * Takes the [Screen] because a page's assembly may depend on the instance:
     * the session list and every conversation open the same page, but a
     * conversation's page is the session its key names.
     */
    val page: @Composable DestinationPageScope.(Screen) -> Unit,
) {
    override fun toString(): String = "FairyDestination($route)"
}

/** Who may compose a destination. */
sealed interface DestinationAccess {
    /** Only a visitor may compose it: the credential pages. */
    data object Visitors : DestinationAccess

    /** Any signed-in identity may compose it. */
    data object SignedIn : DestinationAccess

    /** Only a signed-in administrator (Phaethon) may compose it. */
    data object Admin : DestinationAccess
}

/** Whether this rule admits [identity]. */
fun DestinationAccess.admits(identity: IdentityScope): Boolean = when (this) {
    DestinationAccess.Visitors -> !identity.signedIn
    DestinationAccess.SignedIn -> identity.signedIn
    DestinationAccess.Admin -> identity.signedIn && identity.isAdmin
}

/**
 * Where a cold start returns this destination to.
 *
 * Declared for every destination, so "this is not a place to return to" is a
 * decision in the table rather than an arm a `when` happens to miss.
 */
sealed interface DestinationRestore {
    /** Not a resume target: stored coordinates naming it are not a place to return to. */
    data object Never : DestinationRestore

    /** Resume exactly [stack]; its last element is the destination itself. */
    data class Resume(val stack: List<Screen>) : DestinationRestore

    /**
     * Resume the conversation named by the stored coordinate.
     *
     * A conversation's identity is not known until the stored coordinate has been
     * read, so a fixed stack cannot carry it: [prefix] is every page above the
     * conversation, and the coordinate supplies the conversation page itself.
     */
    data class ResumeConversation(val prefix: List<Screen>) : DestinationRestore
}

/** The coordinates persisted for one destination: its route and, for a conversation, its id. */
data class DestinationRestingPlace(val route: String, val conversation: String? = null)

/** What a destination page may do to the back stack. */
class DestinationActions(
    /** Push a destination on top. */
    val push: (Screen) -> Unit,
    /** Replace the top. A conversation's own switch is a replacement, not a push. */
    val replace: (Screen) -> Unit,
    /** Drop the top. */
    val pop: () -> Unit,
    /** Replace the whole stack; its last element is where the user then stands. */
    val reset: (List<Screen>) -> Unit,
    /** The credential flow finished; the host plays its bookend, this is not navigation. */
    val identityCompleted: () -> Unit,
)

/**
 * What a page is assembled with: the navigation it may drive and the account it
 * acts as, without reaching for Koin — so a page test can assemble the very same
 * page with its own fakes.
 */
class DestinationPageScope(
    val actions: DestinationActions,
    val session: AccountSession,
    val receive: RemoteReceiveState,
    val identityBackend: IdentityBackend,
)
