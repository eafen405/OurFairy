package me.rerere.rikkahub.data.remote

import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.InetSocketAddress
import java.util.concurrent.TimeUnit

/**
 * The bill transport, against a real HTTP server on loopback.
 *
 * #322's page reads the one address #319 published: `GET /bill`, a live
 * credential and nothing else. The double is the JDK's own [HttpServer] for the
 * reason [RemoteSpeechApiTest] uses it — what is under test is the wire: that
 * the read is a bodyless `GET` carrying the Bearer credential, that the three
 * totals and the 30-day series decode in both units, that a zero day arrives as
 * a present zero rather than being dropped, and that the backend's own refusal
 * code survives to the page instead of becoming a zero bill.
 */
class RemoteBillApiTest {

    private lateinit var server: HttpServer
    private lateinit var api: RemoteBillApi

    private var status = 200
    private var response = "{}"
    private var method = ""
    private var requestPath = ""
    private var authorization: String? = null
    private var requestBody = ""

    @Before
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange ->
            method = exchange.requestMethod
            requestPath = exchange.requestURI.path
            authorization = exchange.requestHeaders.getFirst("Authorization")
            requestBody = exchange.requestBody.readBytes().toString(Charsets.UTF_8)
            val bytes = response.toByteArray(Charsets.UTF_8)
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
        api = RemoteBillApi(
            baseUrl = "http://127.0.0.1:${server.address.port}",
            client = OkHttpClient.Builder().callTimeout(5, TimeUnit.SECONDS).build(),
        )
    }

    @After
    fun stop() {
        server.stop(0)
    }

    /** The wire's own Denny for each token figure this file uses, fixed by hand. */
    private val DENNY_BY_TOKENS = mapOf(
        0 to 0.0, 1_500 to 0.5, 2_000 to 0.7, 3_000 to 1.0,
        60_000 to 20.0, 600_000 to 200.0,
    )

    /** One day on the wire, in both units, with the Denny the backend would send. */
    private fun day(index: Int, tokens: Int): String {
        val buckets = if (tokens == 0) {
            """{"inputTokens":0,"cacheReadTokens":0,"cacheWriteTokens":0,"outputTokens":0}"""
        } else {
            // The whole figure sits in one bucket: the test cares about the sum,
            // not about how a provider split it.
            """{"inputTokens":$tokens,"cacheReadTokens":0,"cacheWriteTokens":0,"outputTokens":0}"""
        }
        // The Denny figure is a literal, like every other wire figure here: the
        // client decodes it and must never derive it, so a test that derived it
        // would be testing a conversion the product does not have.
        val denny = DENNY_BY_TOKENS[tokens] ?: error("no fixture Denny for $tokens tokens")
        return """{"day":"2026-10-${(index + 1).toString().padStart(2, '0')}","tokens":$buckets,"denny":$denny}"""
    }

    /**
     * One full answer: today is 2000 tokens (0.7 Denny), this month 60000 (20.0),
     * all time 600000 (200.0). The series is 30 days, zero except its last, so a
     * decoded zero day and a decoded spent day are both observable by hand.
     */
    private fun document(): String {
        val days = (0 until 30).joinToString(",") { index ->
            day(index, if (index == 29) 2000 else 0)
        }
        return """{"ok":true,"bill":{
            "today":{"tokens":{"inputTokens":1200,"cacheReadTokens":300,"cacheWriteTokens":200,"outputTokens":300},"denny":0.7},
            "month":{"tokens":{"inputTokens":60000,"cacheReadTokens":0,"cacheWriteTokens":0,"outputTokens":0},"denny":20.0},
            "allTime":{"tokens":{"inputTokens":600000,"cacheReadTokens":0,"cacheWriteTokens":0,"outputTokens":0},"denny":200.0},
            "days":[$days]}}"""
    }

    @Test
    fun `the bill is one authenticated GET carrying three totals and thirty days in both units`() = runTest {
        response = document()

        val bill = api.read("token-abc")

        assertEquals("a read names no subject and carries no document", "GET", method)
        assertEquals("/bill", requestPath)
        assertEquals("Bearer token-abc", authorization)
        assertEquals("a bill read has no body", "", requestBody)
        assertEquals("every bucket is counted", 2000L, bill.today.tokens.total)
        assertEquals("today in Denny", 0.7, bill.today.denny, 0.0001)
        assertEquals(60000L, bill.month.tokens.total)
        assertEquals(20.0, bill.month.denny, 0.0001)
        assertEquals(600000L, bill.allTime.tokens.total)
        assertEquals(200.0, bill.allTime.denny, 0.0001)
        assertEquals("the series is exactly thirty local days", 30, bill.days.size)
        assertEquals("the days decode in the order they arrive", "2026-10-01", bill.days.first().day)
        assertEquals(2000L, bill.days.last().tokens.total)
        assertEquals(0.7, bill.days.last().denny, 0.0001)
    }

    @Test
    fun `a day with no spend is present at zero rather than dropped`() = runTest {
        response = document()

        val bill = api.read("token-abc")

        assertEquals("a zero day is a bar with no height, not a missing day", 29, bill.days.count { it.tokens.total == 0L })
        assertEquals("2026-10-01", bill.days.first().day)
        assertEquals(0L, bill.days.first().tokens.total)
        assertEquals(0.0, bill.days.first().denny, 0.0001)
    }

    @Test
    fun `the backend's refusal code survives to the caller`() = runTest {
        status = 401
        response = """{"ok":false,"error":{"code":"bill/unauthorized","message":"present a live session credential"}}"""

        val refused = refused { api.read("token-abc") }

        assertEquals(401, refused.status)
        assertEquals("bill/unauthorized", refused.code)
        assertEquals("present a live session credential", refused.message)
    }

    @Test
    fun `an untrusted authority is refused as the backend names it`() = runTest {
        status = 403
        response = """{"ok":false,"error":{"code":"bill/forbidden-authority","message":"untrusted Host or Origin"}}"""

        val refused = refused { api.read("token-abc") }

        assertEquals(403, refused.status)
        assertEquals("bill/forbidden-authority", refused.code)
    }

    @Test
    fun `a failed aggregate is a failure and never a zero bill`() = runTest {
        // The backend reports a failed snapshot as `bill/internal`; a client that
        // adopted the body anyway would read a bill of zeros as "nothing spent".
        status = 500
        response = """{"ok":false,"error":{"code":"bill/internal","message":"the bill failed to compute"}}"""

        val refused = refused { api.read("token-abc") }

        assertEquals(500, refused.status)
        assertEquals("bill/internal", refused.code)
    }

    @Test
    fun `an unreadable document is unreachable rather than empty`() = runTest {
        status = 200
        response = "<html>not a bill</html>"

        val unreachable = try {
            api.read("token-abc")
            throw AssertionError("an unreadable document was adopted as a bill")
        } catch (unreachable: IdentityUnreachable) {
            unreachable
        }

        assertTrue(unreachable is IdentityUnreachable)
    }

    @Test
    fun `fields this client does not know yet do not break the read`() = runTest {
        status = 200
        response = """{"ok":true,"bill":{
            "today":{"tokens":{"inputTokens":3000,"cacheReadTokens":0,"cacheWriteTokens":0,"outputTokens":0},"denny":1.0,"extra":true},
            "month":{"tokens":{"inputTokens":3000,"cacheReadTokens":0,"cacheWriteTokens":0,"outputTokens":0},"denny":1.0},
            "allTime":{"tokens":{"inputTokens":3000,"cacheReadTokens":0,"cacheWriteTokens":0,"outputTokens":0},"denny":1.0},
            "days":[],"future":{"rate":3000}}}"""

        val bill = api.read("token-abc")

        assertEquals(3000L, bill.today.tokens.total)
        assertEquals(1.0, bill.today.denny, 0.0001)
    }

    /** A refusal the call must raise, from a suspending call under [runTest]. */
    private suspend inline fun refused(block: suspend () -> Unit): IdentityRefused =
        try {
            block()
            throw AssertionError("the call answered instead of refusing")
        } catch (refused: IdentityRefused) {
            refused
        }
}
