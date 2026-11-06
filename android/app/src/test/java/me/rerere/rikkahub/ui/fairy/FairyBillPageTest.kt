package me.rerere.rikkahub.ui.fairy

import android.app.Application
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import me.rerere.rikkahub.data.datastore.DisplayPreferences
import me.rerere.rikkahub.data.datastore.LocalDisplayPreferences
import me.rerere.rikkahub.data.remote.AccountSession
import me.rerere.rikkahub.data.remote.AgentSummary
import me.rerere.rikkahub.data.remote.Bill
import me.rerere.rikkahub.data.remote.BillBackend
import me.rerere.rikkahub.data.remote.BillDay
import me.rerere.rikkahub.data.remote.BillTotal
import me.rerere.rikkahub.data.remote.BillTokens
import me.rerere.rikkahub.data.remote.IdentityBackend
import me.rerere.rikkahub.data.remote.IdentityRefused
import me.rerere.rikkahub.data.remote.IdentityUnreachable
import me.rerere.rikkahub.data.remote.IdentityUser
import me.rerere.rikkahub.data.remote.InMemoryCredentialStore
import me.rerere.rikkahub.data.remote.SignedIn
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * #322: the bill page as the reader sees it.
 *
 * The page is assembled directly with a fake backend, the way
 * [me.rerere.rikkahub.ui.identity.RemoteTranscriptTokenUsageTest] assembles the
 * transcript: what is asserted is visible text and the chart's own bar count,
 * never the page's internal state. The expected figures are hand-written against
 * the wire shape #319 published — 2000 tokens is 0.7 Denny at the narrative rate
 * — so a page that re-derived or re-rounded the backend's own numbers would
 * disagree with the assertions.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class FairyBillPageTest {
    @get:Rule val compose = createComposeRule()

    /** One bill: today 2000 tokens, this month 60000, all time 600000; the last day carries today. */
    private fun bill(
        today: Long = 2000,
        month: Long = 60000,
        allTime: Long = 600000,
        days: Int = 30,
    ) = Bill(
        today = BillTotal(BillTokens(inputTokens = today), denny = dennyOf(today)),
        month = BillTotal(BillTokens(inputTokens = month), denny = dennyOf(month)),
        allTime = BillTotal(BillTokens(inputTokens = allTime), denny = dennyOf(allTime)),
        days = (0 until days).map { index ->
            BillDay(
                day = "2026-10-${(index + 1).toString().padStart(2, '0')}",
                tokens = BillTokens(inputTokens = if (index == days - 1) today else 0),
                denny = if (index == days - 1) dennyOf(today) else 0.0,
            )
        },
    )

    /** The Denny the backend sends for each token figure this file uses, fixed by hand. */
    private fun dennyOf(tokens: Long): Double = DENNY_BY_TOKENS[tokens.toInt()]
        ?: error("no fixture Denny for $tokens tokens")

    /** A gate a test holds closed to observe the page while its read is in flight. */
    private var gate: CompletableDeferred<Unit>? = null

    private val backend = object : BillBackend {
        var answer: suspend () -> Bill = { bill() }
        var reads = 0

        override suspend fun read(token: String): Bill {
            reads += 1
            gate?.await()
            return answer()
        }
    }

    private val identityBackend = object : IdentityBackend {
        override suspend fun session(token: String) = IdentityUser(2, "agent-two")
        override suspend fun signIn(name: String, password: String) = SignedIn("test", session("test"))
        override suspend fun register(inviteCode: String, name: String, password: String) = error("not used")
        override suspend fun createInvite(token: String) = error("not used")
        override suspend fun agents(token: String): List<AgentSummary> = emptyList()
        override suspend fun signOut(token: String) = Unit
    }

    /**
     * Assemble the page over an account that is (or is not) signed in, then settle it.
     *
     * The credential is restored after the content is set so the page observes the
     * same identity flow production has: signed out first, then the stored
     * credential arrives.
     */
    private fun open(signedIn: Boolean = true, onBack: () -> Unit = {}) {
        val account = AccountSession(
            identityBackend,
            InMemoryCredentialStore(if (signedIn) "test" else null),
            {},
        )
        compose.setContent {
            CompositionLocalProvider(LocalDisplayPreferences provides DisplayPreferences()) {
                FairyAppTheme {
                    CompositionLocalProvider(LocalAgoraMotionPolicy provides AgoraMotionPolicy(true)) {
                        FairyBillPage(onBack = onBack, session = account, backend = backend)
                    }
                }
            }
        }
        runBlocking { account.restore() }
        settle()
    }

    private fun settle() {
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
    }

    @Test
    fun `the three totals each show Denny and tokens`() {
        open()

        for (label in listOf("今日", "本月", "历史以来")) {
            compose.onAllNodesWithText(label, useUnmergedTree = true).fetchSemanticsNodes().let {
                assertEquals("$label has its own total row", 1, it.size)
            }
        }
        // Both units for every total, at the backend's own figures: 2000/60000/600000.
        for (text in listOf("0.7 丁尼", "2,000", "20.0 丁尼", "60,000", "200.0 丁尼", "600,000")) {
            compose.onAllNodesWithText(text, useUnmergedTree = true).fetchSemanticsNodes().let {
                assertEquals("the bill shows $text", 1, it.size)
            }
        }
    }

    @Test
    fun `the chart draws one bar per day, including the days with no spend`() {
        open()

        compose.onNodeWithTag("bill-chart", useUnmergedTree = true).assertExists()
        // The description is derived from the same list the canvas walks, so a
        // skipped zero day would change it. The expected number is the wire's.
        compose.onNodeWithContentDescription("最近 30 天走势，共 30 根柱子", useUnmergedTree = true).assertExists()
    }

    @Test
    fun `an all-zero bill is a readable zero, not a failure and not prose`() {
        backend.answer = { bill(today = 0, month = 0, allTime = 0) }
        open()

        // The zeroes are the state: three totals at zero Denny and zero count, with the
        // flat series still drawn. The page adds no sentence about it.
        compose.onNodeWithTag("bill-totals", useUnmergedTree = true).assertExists()
        compose.onAllNodesWithText("0.0 丁尼", useUnmergedTree = true).fetchSemanticsNodes().let {
            assertEquals("all three totals read zero Denny", 3, it.size)
        }
        // Empty is not an error, and it is not an unread page either.
        compose.onAllNodesWithTag("bill-failure", useUnmergedTree = true).assertCountEquals(0)
        compose.onAllNodesWithTag("bill-loading", useUnmergedTree = true).assertCountEquals(0)
        compose.onNodeWithContentDescription("最近 30 天走势，共 30 根柱子", useUnmergedTree = true).assertExists()
    }

    @Test
    fun `a failed aggregate shows the failure and no figures at all`() {
        backend.answer = { throw IdentityRefused(500, "bill/internal", "the bill failed to compute") }
        open()

        compose.onNodeWithTag("bill-failure", useUnmergedTree = true).assertExists()
        compose.onNodeWithText("bill/internal: the bill failed to compute", useUnmergedTree = true).assertExists()
        // A page that fell back to zeros would print these.
        compose.onAllNodesWithTag("bill-totals", useUnmergedTree = true).assertCountEquals(0)
        compose.onAllNodesWithTag("bill-chart", useUnmergedTree = true).assertCountEquals(0)
        compose.onAllNodesWithText("0.0 丁尼", useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun `a lost connection is reported as unreachable, never as a zero bill`() {
        backend.answer = { throw IdentityUnreachable(java.io.IOException("down")) }
        open()

        compose.onNodeWithText("无法连接服务端。", useUnmergedTree = true).assertExists()
        compose.onAllNodesWithTag("bill-totals", useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun `a failed read offers a retry that reads again and shows the bill`() {
        backend.answer = { throw IdentityUnreachable(java.io.IOException("down")) }
        open()
        compose.onAllNodesWithTag("bill-totals", useUnmergedTree = true).assertCountEquals(0)

        backend.answer = { bill() }
        compose.onNodeWithTag("bill-retry", useUnmergedTree = true).performClick()
        settle()

        compose.onNodeWithText("0.7 丁尼", useUnmergedTree = true).assertExists()
        compose.onAllNodesWithTag("bill-failure", useUnmergedTree = true).assertCountEquals(0)
        compose.runOnIdle { assertEquals("the retry is a real second read", 2, backend.reads) }
    }

    @Test
    fun `the page says it is reading and shows no figures while the read is in flight`() {
        gate = CompletableDeferred()
        open()

        compose.onNodeWithTag("bill-loading", useUnmergedTree = true).assertExists()
        compose.onAllNodesWithTag("bill-totals", useUnmergedTree = true).assertCountEquals(0)
        // A page that drew a zero chart while loading would answer "nothing spent" to a
        // question that has not been answered yet.
        compose.onAllNodesWithTag("bill-chart", useUnmergedTree = true).assertCountEquals(0)
        compose.runOnIdle { assertEquals(1, backend.reads) }

        gate?.complete(Unit)
        settle()
        compose.onNodeWithText("0.7 丁尼", useUnmergedTree = true).assertExists()
    }

    @Test
    fun `a signed-out page asks the backend nothing and says so`() {
        open(signedIn = false)

        compose.onNodeWithText("请先登录后再查看账单。", useUnmergedTree = true).assertExists()
        compose.runOnIdle { assertEquals("no credential, no read", 0, backend.reads) }
    }

    @Test
    fun `the back arrow closes the page`() {
        var backs = 0
        open(onBack = { backs++ })

        compose.onNodeWithContentDescription("返回", useUnmergedTree = true).performClick()
        compose.runOnIdle { assertEquals(1, backs) }
    }

    @Test
    fun `the page states the caveats the bill is known to have`() {
        open()

        // The spec's 已知的口径缺口: auxiliary calls and crashed turns are not billed.
        // The page says so rather than letting the numbers look complete.
        compose.onNodeWithText(
            "标题生成等辅助调用不产生账单，进程被终止时未完成的回合也不计入。",
            useUnmergedTree = true,
        ).assertExists()
    }

    @Test
    fun `the series the backend sent is drawn as sent, never padded to thirty`() {
        // The backend promises 30 days; the page must not invent the difference, so the
        // bar count is the wire's own. This pins the one number the page is tempted to
        // assume instead of reading.
        backend.answer = { bill(days = 0) }
        open()

        compose.onNodeWithContentDescription("最近 30 天走势，共 0 根柱子", useUnmergedTree = true).assertExists()
    }
}

/** The Denny the backend sends for each token figure this file uses, fixed by hand. */
private val DENNY_BY_TOKENS: Map<Int, Double> = mapOf(
    0 to 0.0, 750 to 0.3, 900 to 0.3, 1_200 to 0.4, 1_500 to 0.5,
    2_000 to 0.7, 3_000 to 1.0, 60_000 to 20.0, 600_000 to 200.0,
)
