package me.rerere.rikkahub.ui.destination

import androidx.compose.runtime.Composable
import me.rerere.rikkahub.Screen
import me.rerere.rikkahub.ui.fairy.FairyConsolePage
import me.rerere.rikkahub.ui.fairy.FairySettingsPage
import me.rerere.rikkahub.ui.identity.GatewayPage
import me.rerere.rikkahub.ui.identity.IdentityScope
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
 * stored name, who may compose it, where a cold start returns to it, and — for
 * the destinations this catalog assembles — its page.
 *
 * The table holds each fact once. Which destination a [Screen] is comes from an
 * exhaustive `when`, so a new screen fails to compile until it is registered;
 * nothing is discovered by reflection or registered at runtime.
 *
 * Page assembly is still split this ticket: the console, settings, gateway and
 * impression are built here, and the credential and session pages by the legacy
 * `entryProvider {}` arms in `RouteActivity` until #264 moves them and deletes
 * that path.
 */
object FairyDestinations {

    /** The route a conversation is stored under; its id is the second coordinate. */
    const val CONVERSATION_ROUTE = "conversation"

    private val signIn = FairyDestination(
        route = "sign_in",
        access = DestinationAccess.Visitors,
        restore = DestinationRestore.Never,
    )

    private val register = FairyDestination(
        route = "register",
        access = DestinationAccess.Visitors,
        restore = DestinationRestore.Never,
    )

    private val home = FairyDestination(
        route = "home",
        access = DestinationAccess.SignedIn,
        restore = DestinationRestore.Resume(listOf(Screen.Home)),
    ) {
        FairyConsolePage(onOpen = actions.push)
    }

    private val sessions = FairyDestination(
        route = "sessions",
        access = DestinationAccess.SignedIn,
        restore = DestinationRestore.Resume(listOf(Screen.Home, Screen.Sessions)),
    )

    private val conversation = FairyDestination(
        route = CONVERSATION_ROUTE,
        access = DestinationAccess.SignedIn,
        restore = DestinationRestore.ResumeConversation(listOf(Screen.Home)),
    )

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
        GatewayPage(onBack = actions.pop, session = session)
    }

    private val impression = FairyDestination(
        route = "impression",
        access = DestinationAccess.SignedIn,
        restore = DestinationRestore.Resume(listOf(Screen.Home, Screen.Settings, Screen.Impression)),
    ) {
        ImpressionPage(onBack = actions.pop, session = session)
    }

    /** Every destination the product has, in the order the table declares them. */
    val entries: List<FairyDestination> = listOf(
        signIn, register, home, sessions, conversation, settings, gateway, impression,
    )

    /**
     * The destination [screen] is.
     *
     * The `when` is exhaustive over [Screen]: a new subtype is a compile error
     * here until it names its route, which is what makes "declared once" hold
     * without a runtime scan.
     */
    fun destinationOf(screen: Screen): FairyDestination = entryNamed(routeOf(screen))

    /** The destination the top of the stack is, or null for an empty stack. */
    fun destinationOrNull(screen: Screen?): FairyDestination? = screen?.let(::destinationOf)

    /**
     * Whether this catalog composes [screen]'s page today.
     *
     * False means the legacy `entryProvider {}` arms in `RouteActivity` still
     * build it; #264 removes those arms, at which point this answers true for
     * every screen and the temporary branch goes with them.
     */
    fun assembles(screen: Screen): Boolean = destinationOf(screen).page != null

    /** Who may compose [screen]; an empty stack (`null`) composes nothing. */
    fun mayCompose(screen: Screen?, identity: IdentityScope): Boolean =
        destinationOrNull(screen)?.access?.admits(identity) ?: false

    /**
     * The name a run stores for [screen].
     *
     * Never renamed: an upgrade reads the names already written by the version
     * before it, so a destination that outlives a rename keeps its first name.
     */
    fun routeOf(screen: Screen): String = when (screen) {
        Screen.SignIn -> signIn.route
        Screen.Register -> register.route
        Screen.Home -> home.route
        Screen.Sessions -> sessions.route
        is Screen.Conversation -> conversation.route
        Screen.Settings -> settings.route
        Screen.Gateway -> gateway.route
        Screen.Impression -> impression.route
    }

    /**
     * The `contentKey` a navigation entry for [screen] carries.
     *
     * It must be Bundle-storable — the saveable-state decorator keeps one state
     * per key — and must tell instances apart, so two conversations share the
     * page but never its saved state.
     */
    fun contentKeyOf(screen: Screen): String = routeOf(screen) + ":" + screen

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
        val destination = entries.firstOrNull { it.route == route } ?: return UNKNOWN_LANDING
        return when (val restore = destination.restore) {
            DestinationRestore.Never -> UNKNOWN_LANDING
            is DestinationRestore.Resume -> restore.stack
            is DestinationRestore.ResumeConversation -> conversation
                ?.takeIf { it.isNotBlank() }
                ?.let { restore.prefix + Screen.Conversation(it) }
                ?: UNKNOWN_LANDING
        }
    }

    private fun entryNamed(route: String): FairyDestination = entries.first { it.route == route }
}

/** Render this destination's page with the scope its host assembled. */
@Composable
fun FairyDestination.Content(scope: DestinationPageScope) {
    val page = page ?: error("$route is still assembled by the legacy route path")
    page.invoke(scope)
}
