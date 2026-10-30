package me.rerere.rikkahub.ui.destination

import me.rerere.rikkahub.Screen
import me.rerere.rikkahub.ui.identity.IdentityScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The destination catalog's public answers, read the way a caller reads them.
 *
 * Every case is a product rule the ticket states — who may compose a page, where
 * a cold start lands, which page is assembled — never how the table stores it.
 */
class FairyDestinationsTest {

    private val agent = IdentityScope(signedIn = true, isAdmin = false)
    private val phaethon = IdentityScope(signedIn = true, isAdmin = true)
    private val staleAdmin = IdentityScope(signedIn = false, isAdmin = true)

    /** A destination and the identities the product says may compose it. */
    private data class Admission(
        val screen: Screen,
        val visitor: Boolean,
        val agent: Boolean,
        val phaethon: Boolean,
        val staleAdmin: Boolean,
    )

    private val admissions = listOf(
        // A signed-out scope that still wears the admin flag is still a visitor:
        // the flag never admits an administrator's page, and never blocks a
        // credential page.
        Admission(Screen.SignIn, visitor = true, agent = false, phaethon = false, staleAdmin = true),
        Admission(Screen.Register, visitor = true, agent = false, phaethon = false, staleAdmin = true),
        Admission(Screen.Home, visitor = false, agent = true, phaethon = true, staleAdmin = false),
        Admission(Screen.Conversation("s-1"), visitor = false, agent = true, phaethon = true, staleAdmin = false),
        Admission(Screen.Settings, visitor = false, agent = true, phaethon = true, staleAdmin = false),
        Admission(Screen.Gateway, visitor = false, agent = false, phaethon = true, staleAdmin = false),
        Admission(Screen.Impression, visitor = false, agent = true, phaethon = true, staleAdmin = false),
    )

    @Test
    fun `every destination admits exactly the identities the product names`() {
        for (case in admissions) {
            val expectations = listOf(
                Triple("a visitor", IdentityScope.SignedOut, case.visitor),
                Triple("an agent", agent, case.agent),
                Triple("Phaethon", phaethon, case.phaethon),
                Triple("a signed-out scope that still wears the admin flag", staleAdmin, case.staleAdmin),
            )
            for ((who, identity, expected) in expectations) {
                assertEquals(
                    "$who at ${case.screen.route()}",
                    expected,
                    FairyDestinations.mayCompose(case.screen, identity),
                )
            }
        }
    }

    @Test
    fun `the admission matrix names every destination`() {
        assertEquals(
            "a destination with no row here would escape the matrix",
            FairyDestinations.entries.map { it.route }.toSet(),
            admissions.map { it.screen.route() }.toSet(),
        )
        assertEquals("one row per destination", FairyDestinations.entries.size, admissions.size)
    }

    @Test
    fun `the gateway opens for the administrator alone`() {
        assertEquals(false, FairyDestinations.mayCompose(Screen.Gateway, agent))
        assertEquals(true, FairyDestinations.mayCompose(Screen.Gateway, phaethon))
    }

    @Test
    fun `an empty stack composes nothing`() {
        assertEquals(false, FairyDestinations.mayCompose(null, phaethon))
    }

    /** A destination and the stack, or the absence of one, a cold start gives it. */
    private data class Restore(
        val screen: Screen,
        val conversation: String? = null,
        /** Null means the destination is never a place to return to. */
        val stack: List<Screen>?,
    )

    private val restores = listOf(
        Restore(Screen.SignIn, stack = null),
        Restore(Screen.Register, stack = null),
        Restore(Screen.Home, stack = listOf(Screen.Home)),
        Restore(Screen.Settings, stack = listOf(Screen.Home, Screen.Settings)),
        Restore(
            Screen.Conversation("s-1"),
            conversation = "s-1",
            stack = listOf(Screen.Home, Screen.Conversation("s-1")),
        ),
        Restore(Screen.Gateway, stack = listOf(Screen.Home, Screen.Settings, Screen.Gateway)),
        Restore(Screen.Impression, stack = listOf(Screen.Home, Screen.Settings, Screen.Impression)),
    )

    @Test
    fun `every destination declares the stack a cold start returns to it`() {
        for (case in restores) {
            val destination = FairyDestinations.destinationOf(case.screen)
            val resumed = FairyDestinations.resumedStack(destination.route, case.conversation)
            if (case.stack == null) {
                assertEquals(
                    "${destination.route} is never a return address",
                    DestinationRestore.Never,
                    destination.restore,
                )
                assertNull("${destination.route} is not written", FairyDestinations.restingPlaceOf(case.screen))
                assertEquals("a stored ${destination.route} lands on the console", UNKNOWN_LANDING, resumed)
            } else {
                assertEquals("${destination.route} resumes its declared stack", case.stack, resumed)
                assertEquals(
                    "${destination.route} resumes to a stack ending on itself",
                    destination.route,
                    case.stack.last().route(),
                )
                assertEquals(
                    "${destination.route} is written under the same name it resumes",
                    destination,
                    FairyDestinations.destinationOf(case.stack.last()),
                )
            }
        }
        assertEquals(
            "every destination has one restore row",
            FairyDestinations.entries.map { it.route }.toSet(),
            restores.map { it.screen.route() }.toSet(),
        )
        assertEquals(restores.size, FairyDestinations.entries.size)
    }

    @Test
    fun `a bookmarked conversation keeps its id, and a missing one lands on the console`() {
        assertEquals(
            listOf(Screen.Home, Screen.Conversation("s-9")),
            FairyDestinations.resumedStack(FairyDestinations.CONVERSATION_ROUTE, "s-9"),
        )
        for (coordinate in listOf(null, "", "   ")) {
            assertEquals(
                "a conversation without a usable id has no page to open",
                UNKNOWN_LANDING,
                FairyDestinations.resumedStack(FairyDestinations.CONVERSATION_ROUTE, coordinate),
            )
        }
    }

    @Test
    fun `stored coordinates that name no page land on the console`() {
        for (stored in listOf("moved_away", "")) {
            assertEquals(
                "a stored '$stored' is not a place to return to",
                UNKNOWN_LANDING,
                FairyDestinations.resumedStack(stored, null),
            )
        }
        assertEquals("nothing stored at all", UNKNOWN_LANDING, FairyDestinations.resumedStack(null, null))
    }

    @Test
    fun `a conversation is stored under its route and its own id`() {
        assertEquals(
            DestinationRestingPlace(route = "conversation", conversation = "main"),
            FairyDestinations.restingPlaceOf(Screen.Conversation("main")),
        )
        assertEquals(
            DestinationRestingPlace(route = "impression"),
            FairyDestinations.restingPlaceOf(Screen.Impression),
        )
        assertNull("the sign-in page is never a place to return to", FairyDestinations.restingPlaceOf(Screen.SignIn))
        assertNull("nor is registration", FairyDestinations.restingPlaceOf(Screen.Register))
    }

    @Test
    fun `every screen resolves to a destination the table enumerates`() {
        val routes = FairyDestinations.entries.map { it.route }
        assertEquals("a stored name identifies exactly one destination", routes.size, routes.toSet().size)

        // This is the assertion that catches a screen whose destination exists
        // but was left out of the enumeration: `destinationOf` would still answer,
        // while a cold start could never be handed the name it stores.
        val screens = allScreens()
        for (screen in screens) {
            val destination = FairyDestinations.destinationOf(screen)
            assertTrue(
                "${screen.route()} is not enumerated in entries, so no stored name reaches it",
                FairyDestinations.entries.any { it === destination },
            )
            assertEquals(
                "${screen.route()}'s destination stores the name the screen reports",
                destination.route,
                FairyDestinations.routeOf(screen),
            )
        }
        assertEquals(
            "every declared destination is reachable from a screen",
            routes.toSet(),
            screens.map(FairyDestinations::routeOf).toSet(),
        )
        assertEquals("the product has seven destinations", 7, routes.size)
    }

    /**
     * One sample of every [Screen] subtype.
     *
     * This list is not the completeness guard — `destinationOf`'s exhaustive
     * `when` is, because a new subtype fails to compile there — but it is the
     * list the enumeration claim above reads.
     */
    private fun allScreens(): List<Screen> = listOf(
        Screen.SignIn,
        Screen.Register,
        Screen.Home,
        Screen.Conversation("s-1"),
        Screen.Settings,
        Screen.Gateway,
        Screen.Impression,
    )

    @Test
    fun `no resume stack passes through a destination that is never resumed`() {
        val never = FairyDestinations.entries.filter { it.restore == DestinationRestore.Never }.map { it.route }
        assertEquals(
            "the credential pages are the destinations that are never resumed",
            listOf("sign_in", "register"),
            never,
        )
        for (case in restores) {
            for (screen in case.stack.orEmpty()) {
                assertEquals(
                    "${case.screen.route()} must not resume through ${screen.route()}, which is never resumed",
                    false,
                    never.contains(screen.route()),
                )
            }
        }
    }

    @Test
    fun `a navigation entry names its destination but never conflates two instances`() {
        val first = FairyDestinations.contentKeyOf(Screen.Conversation("first"))
        val second = FairyDestinations.contentKeyOf(Screen.Conversation("second"))
        assertTrue("two conversations must not share saved state", first != second)
        assertEquals(first, FairyDestinations.contentKeyOf(Screen.Conversation("first")))
        assertEquals("home:Home", FairyDestinations.contentKeyOf(Screen.Home))
    }
}

/** The stored name of [this] screen, as the catalog declares it. */
private fun Screen.route(): String = FairyDestinations.routeOf(this)
