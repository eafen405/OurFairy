package me.rerere.rikkahub.ui.destination

import me.rerere.rikkahub.Screen
import me.rerere.rikkahub.ui.identity.IdentityScope
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The destination catalog's public answers, read the way a caller reads them.
 *
 * Every case is a product rule the ticket states — who may compose a page, where
 * a cold start lands — never how the table stores it, so these survive the second
 * ticket moving the remaining destinations into the same table.
 */
class FairyDestinationsTest {

    private val agent = IdentityScope(signedIn = true, isAdmin = false)
    private val phaethon = IdentityScope(signedIn = true, isAdmin = true)
    private val staleAdmin = IdentityScope(signedIn = false, isAdmin = true)

    /** A destination the catalog arranges, and who the product lets compose it. */
    private data class Admission(val screen: Screen, val agent: Boolean, val phaethon: Boolean)

    private val admissions = listOf(
        Admission(Screen.Home, agent = true, phaethon = true),
        Admission(Screen.Settings, agent = true, phaethon = true),
        Admission(Screen.Gateway, agent = false, phaethon = true),
        Admission(Screen.Impression, agent = true, phaethon = true),
    )

    @Test
    fun `the migrated destinations admit an agent, Phaethon, and nobody signed out`() {
        for (case in admissions) {
            assertEquals("an agent at ${case.screen.route()}", case.agent, FairyDestinations.mayCompose(case.screen, agent))
            assertEquals(
                "Phaethon at ${case.screen.route()}",
                case.phaethon,
                FairyDestinations.mayCompose(case.screen, phaethon),
            )
            assertEquals(
                "a visitor at ${case.screen.route()}",
                false,
                FairyDestinations.mayCompose(case.screen, IdentityScope.SignedOut),
            )
            assertEquals(
                "a signed-out scope that still wears the admin flag at ${case.screen.route()}",
                false,
                FairyDestinations.mayCompose(case.screen, staleAdmin),
            )
        }
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

    /** A cold start's stored coordinates, and the stack the product says they open. */
    private data class ResumeCase(val route: String, val conversation: String?, val stack: List<Screen>)

    private val resumes = listOf(
        ResumeCase("home", null, listOf(Screen.Home)),
        ResumeCase("settings", null, listOf(Screen.Home, Screen.Settings)),
        ResumeCase("gateway", null, listOf(Screen.Home, Screen.Settings, Screen.Gateway)),
        ResumeCase("impression", null, listOf(Screen.Home, Screen.Settings, Screen.Impression)),
        ResumeCase("sessions", null, listOf(Screen.Home, Screen.Sessions)),
        ResumeCase("conversation", "main", listOf(Screen.Home, Screen.Conversation("main"))),
    )

    @Test
    fun `a stored destination reopens the stack the product enters it through`() {
        for (case in resumes) {
            assertEquals(
                "a stored ${case.route}",
                case.stack,
                FairyDestinations.resumedStack(case.route, case.conversation),
            )
        }
    }

    @Test
    fun `an impression returns to settings, which is where it is entered`() {
        assertEquals(
            listOf(Screen.Home, Screen.Settings, Screen.Impression),
            FairyDestinations.resumedStack("impression", null),
        )
    }

    @Test
    fun `stored coordinates that name no page land on the console`() {
        for (stored in listOf("sign_in", "register", "moved_away", "")) {
            assertEquals(
                "a stored '$stored' is not a place to return to",
                UNKNOWN_LANDING,
                FairyDestinations.resumedStack(stored, null),
            )
        }
        assertEquals("nothing stored at all", UNKNOWN_LANDING, FairyDestinations.resumedStack(null, null))
        for (coordinate in listOf(null, "", "   ")) {
            assertEquals(
                "a conversation without a usable id has no page to open",
                UNKNOWN_LANDING,
                FairyDestinations.resumedStack("conversation", coordinate),
            )
        }
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
    fun `every destination is declared once, and its name resolves back to it`() {
        val routes = FairyDestinations.entries.map { it.route }
        assertEquals("a stored name identifies exactly one destination", routes.size, routes.toSet().size)

        val screens = listOf(
            Screen.SignIn, Screen.Register, Screen.Home, Screen.Sessions,
            Screen.Settings, Screen.Gateway, Screen.Impression, Screen.Conversation("main"),
        )
        for (screen in screens) {
            val destination = FairyDestinations.destinationOf(screen)
            assertEquals(
                "${screen.route()} resolves to its own route",
                screen.route(),
                FairyDestinations.routeOf(screen),
            )
            assertEquals(
                "${screen.route()}'s name resolves back to a declared destination",
                true,
                FairyDestinations.entries.any { it === destination },
            )
        }
        assertEquals(
            "every declared destination is reachable from a screen",
            routes.toSet(),
            screens.map(FairyDestinations::routeOf).toSet(),
        )
    }

    @Test
    fun `every resume stack ends on the destination that declares it`() {
        for (case in resumes) {
            val destination = FairyDestinations.entries.first { it.route == case.route }
            when (val restore = destination.restore) {
                DestinationRestore.Never -> throw AssertionError("${case.route} is a resume target, not Never")
                is DestinationRestore.Resume -> {
                    assertTrue("${case.route} resumes to a non-empty stack", restore.stack.isNotEmpty())
                    assertEquals(
                        "${case.route} resumes to a stack that ends on itself",
                        case.route,
                        restore.stack.last().route(),
                    )
                }
                is DestinationRestore.ResumeConversation -> {
                    assertEquals(
                        "a conversation's resume stack is its stored prefix plus the conversation",
                        case.stack,
                        restore.prefix + Screen.Conversation(case.conversation.orEmpty()),
                    )
                }
            }
        }
    }

    @Test
    fun `no resume stack passes through a destination that is never resumed`() {
        val never = FairyDestinations.entries.filter { it.restore == DestinationRestore.Never }.map { it.route }
        assertEquals(
            "the credential pages are the destinations that are never resumed",
            listOf("sign_in", "register"),
            never,
        )
        for (case in resumes) {
            for (screen in case.stack) {
                assertEquals(
                    "${case.route} must not resume through ${screen.route()}, which is never resumed",
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

    @Test
    fun `the four migrated destinations are assembled by the catalog`() {
        for (screen in admissions.map { it.screen }) {
            assertNotNull("${screen.route()} has a page in the catalog", FairyDestinations.destinationOf(screen).page)
        }
    }
}

/** The stored name of [this] screen, as the catalog declares it. */
private fun Screen.route(): String = FairyDestinations.routeOf(this)
