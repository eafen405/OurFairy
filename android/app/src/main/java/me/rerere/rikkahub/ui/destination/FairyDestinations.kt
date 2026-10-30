package me.rerere.rikkahub.ui.destination

import androidx.compose.runtime.Composable
import androidx.navigation3.runtime.NavEntry
import androidx.navigation3.runtime.NavKey
import me.rerere.rikkahub.Screen
import me.rerere.rikkahub.ui.fairy.FairyConsolePage
import me.rerere.rikkahub.ui.fairy.FairyConversationPage
import me.rerere.rikkahub.ui.fairy.FairySettingsPage
import me.rerere.rikkahub.ui.identity.GatewayPage
import me.rerere.rikkahub.ui.identity.IdentityRegisterPage
import me.rerere.rikkahub.ui.identity.IdentityScope
import me.rerere.rikkahub.ui.identity.IdentitySignInPage
import me.rerere.rikkahub.ui.identity.ImpressionPage

/**
 * Where a cold start lands when the stored coordinates name nothing that can be
 * resumed: the console, which every signed-in identity may compose.
 *
 * Named, so the two cases that answer it — an unknown route, and a conversation
 * with no id — read as one product decision instead of two fall-through arms.
 */
val UNKNOWN_LANDING: List<Screen> = listOf(Screen.Home)

/**
 * The destination table: one fixed, in-process declaration of every screen's
 * stored name, who may compose it, where a cold start returns to it, and how its
 * page is assembled.
 *
 * The table holds each fact once. Which destination a [Screen] is comes from an
 * exhaustive `when`, so a new screen fails to compile until it is registered;
 * nothing is discovered by reflection or registered at runtime. Page assembly is
 * a required field, so a destination cannot be declared without one either.
 */
object FairyDestinations {

    /** The route a conversation is stored under; its id is the second coordinate. */
    const val CONVERSATION_ROUTE = "conversation"

    private val signIn = FairyDestination(
        route = "sign_in",
        access = DestinationAccess.Visitors,
        restore = DestinationRestore.Never,
    ) {
        IdentitySignInPage(
            onSignedIn = { actions.identityCompleted() },
            onRegister = { actions.reset(listOf(Screen.Register)) },
            session = session,
        )
    }

    private val register = FairyDestination(
        route = "register",
        access = DestinationAccess.Visitors,
        restore = DestinationRestore.Never,
    ) {
        IdentityRegisterPage(
            // Same power-down bookend as sign-in: both leave the identity shell
            // for the console.
            onRegistered = { actions.identityCompleted() },
            onBackToSignIn = { actions.reset(listOf(Screen.SignIn)) },
            session = session,
        )
    }

    private val home = FairyDestination(
        route = "home",
        access = DestinationAccess.SignedIn,
        restore = DestinationRestore.Resume(listOf(Screen.Home)),
    ) {
        FairyConsolePage(
            onOpen = actions.push,
            session = session,
            receive = receive,
            fairy = fairy,
        )
    }

    private val conversation = FairyDestination(
        route = CONVERSATION_ROUTE,
        access = DestinationAccess.SignedIn,
        restore = DestinationRestore.ResumeConversation(listOf(Screen.Home)),
    ) { screen ->
        conversationPage(sessionId = (screen as Screen.Conversation).sessionId)
    }

    private val settings = FairyDestination(
        route = "settings",
        access = DestinationAccess.SignedIn,
        restore = DestinationRestore.Resume(listOf(Screen.Home, Screen.Settings)),
    ) {
        FairySettingsPage(
            onOpenGateway = { actions.push(Screen.Gateway) },
            onSignedOut = { actions.reset(listOf(Screen.SignIn)) },
            session = session,
            backend = identityBackend,
            onBack = actions.pop,
            onOpenImpression = { actions.push(Screen.Impression) },
        )
    }

    private val gateway = FairyDestination(
        route = "gateway",
        access = DestinationAccess.Admin,
        restore = DestinationRestore.Resume(listOf(Screen.Home, Screen.Settings, Screen.Gateway)),
    ) {
        GatewayPage(onBack = actions.pop, session = session, backend = gatewayBackend)
    }

    private val impression = FairyDestination(
        route = "impression",
        access = DestinationAccess.SignedIn,
        restore = DestinationRestore.Resume(listOf(Screen.Home, Screen.Settings, Screen.Impression)),
    ) {
        ImpressionPage(onBack = actions.pop, session = session, backend = impressionBackend)
    }

    /** Every destination the product has, in the order the table declares them. */
    val entries: List<FairyDestination> = listOf(
        signIn, register, home, conversation, settings, gateway, impression,
    )

    /**
     * The destination [screen] is.
     *
     * This `when` is exhaustive over [Screen] and answers with the destination
     * itself, so a new subtype is a compile error here until it names one — and a
     * destination cannot be constructed without its access, its restore policy
     * and its page. That is what makes "declared once" hold without a runtime
     * scan, rather than a route string that a second list might disagree with.
     */
    fun destinationOf(screen: Screen): FairyDestination = when (screen) {
        Screen.SignIn -> signIn
        Screen.Register -> register
        Screen.Home -> home
        is Screen.Conversation -> conversation
        Screen.Settings -> settings
        Screen.Gateway -> gateway
        Screen.Impression -> impression
    }

    /** The destination the top of the stack is, or null for an empty stack. */
    fun destinationOrNull(screen: Screen?): FairyDestination? = screen?.let(::destinationOf)

    /** Who may compose [screen]; an empty stack (`null`) composes nothing. */
    fun mayCompose(screen: Screen?, identity: IdentityScope): Boolean =
        destinationOrNull(screen)?.access?.admits(identity) ?: false

    /**
     * The name a run stores for [screen].
     *
     * Never renamed: an upgrade reads the names already written by the version
     * before it, so a destination that outlives a rename keeps its first name.
     */
    fun routeOf(screen: Screen): String = destinationOf(screen).route

    /**
     * The `contentKey` a navigation entry for [screen] carries.
     *
     * It must be Bundle-storable — the saveable-state decorator keeps one state
     * per key — and must tell instances apart, so two conversations share the
     * page but never its saved state.
     */
    fun contentKeyOf(screen: Screen): String = routeOf(screen) + ":" + screen

    /**
     * The navigation entry for [screen]: its page, under a key that is the screen
     * itself and a content key that can be saved.
     *
     * The entry is built here rather than by each host, so the key, the
     * saved-state identity and the page all come from the same table.
     */
    fun entryOf(screen: Screen, scope: DestinationPageScope): NavEntry<NavKey> = NavEntry(
        key = screen,
        contentKey = contentKeyOf(screen),
        metadata = emptyMap(),
        content = { destinationOf(screen).Content(screen, scope) },
    )

    /** The coordinates to persist for [screen]; null when it is not a place to return to. */
    fun restingPlaceOf(screen: Screen): DestinationRestingPlace? {
        val destination = destinationOf(screen)
        return when (val restore = destination.restore) {
            DestinationRestore.Never -> null
            is DestinationRestore.Resume -> DestinationRestingPlace(route = destination.route)
            is DestinationRestore.ResumeConversation -> DestinationRestingPlace(
                route = destination.route,
                conversation = (screen as Screen.Conversation).sessionId,
            )
        }
    }

    /**
     * The stack a cold start opens, from the coordinates a previous run stored.
     *
     * An unknown route and a conversation with no usable id both answer
     * [UNKNOWN_LANDING] by name.
     */
    fun resumedStack(route: String?, conversation: String?): List<Screen> {
        val destination = destinationByRoute(route) ?: return UNKNOWN_LANDING
        return when (val restore = destination.restore) {
            DestinationRestore.Never -> UNKNOWN_LANDING
            is DestinationRestore.Resume -> restore.stack
            is DestinationRestore.ResumeConversation -> conversation
                ?.takeIf { it.isNotBlank() }
                ?.let { restore.prefix + Screen.Conversation(it) }
                ?: UNKNOWN_LANDING
        }
    }

    /**
     * The conversation page, for a conversation routed to a real session.
     *
     * The session list is this page's own overlay: the page opens the shared
     * `SessionListOverlay`; nothing in this catalog assembles it, opens it or
     * gives it a destination of its own.
     */
    @Composable
    private fun DestinationPageScope.conversationPage(sessionId: String) {
        FairyConversationPage(
            sessionId = sessionId,
            onBack = { actions.reset(listOf(Screen.Home)) },
            receive = receive,
            fairy = fairy,
            onOpenConversation = { id -> actions.replace(Screen.Conversation(id)) },
            onSettings = { actions.push(Screen.Settings) },
        )
    }

    /**
     * The destination stored under [route], or null for a name this version
     * does not know.
     *
     * The only route-to-destination lookup: [entries] is an enumeration, and a
     * stored name is resolved here so a rename cannot leave two answers.
     */
    private fun destinationByRoute(route: String?): FairyDestination? =
        route?.let { stored -> entries.firstOrNull { it.route == stored } }
}

/** Render this destination's page for [screen] with the scope its host assembled. */
@Composable
fun FairyDestination.Content(screen: Screen, scope: DestinationPageScope) {
    page.invoke(scope, screen)
}
