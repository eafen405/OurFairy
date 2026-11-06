package me.rerere.rikkahub.data.remote

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.InetSocketAddress
import java.util.Collections
import java.util.concurrent.TimeUnit

/**
 * The impression wire, against a real HTTP server on loopback.
 *
 * The expected documents are JSON literals from the backend contract, not
 * re-encoded through the client's own types: a test that composed the body with
 * the implementation would agree with a wrong body. The assertions are about
 * the bytes that cross the wire — the path, the Bearer credential, the document
 * the read sends, and the backend's refusal codes surviving to the page.
 */
class ImpressionApiTest {

    private data class Recorded(
        val method: String,
        val path: String,
        val authorization: String?,
        val body: String,
    )

    private lateinit var server: HttpServer
    private lateinit var api: ImpressionApi
    private val recorded = Collections.synchronizedList(mutableListOf<Recorded>())
    private var replyStatus = 200
    private var replyBody = "{}"

    private val baseUrl: String get() = "http://127.0.0.1:${server.address.port}"

    @Before
    fun start() {
        recorded.clear()
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange -> handle(exchange) }
        server.executor = null
        server.start()
        api = ImpressionApi(
            baseUrl = baseUrl,
            client = OkHttpClient.Builder().callTimeout(10, TimeUnit.SECONDS).build(),
        )
    }

    @After
    fun stop() {
        runCatching { server.stop(0) }
    }

    private fun handle(exchange: HttpExchange) {
        val body = exchange.requestBody.readBytes().toString(Charsets.UTF_8)
        recorded += Recorded(
            method = exchange.requestMethod,
            path = exchange.requestURI.path,
            authorization = exchange.requestHeaders.getFirst("Authorization"),
            body = body,
        )
        val bytes = replyBody.toByteArray(Charsets.UTF_8)
        exchange.responseHeaders.add("Content-Type", "application/json")
        exchange.sendResponseHeaders(replyStatus, bytes.size.toLong())
        exchange.responseBody.use { it.write(bytes) }
    }

    private fun reply(status: Int, body: String) {
        replyStatus = status
        replyBody = body
    }

    private fun assertJson(expected: String, actual: String) {
        assertEquals(Json.parseToJsonElement(expected), Json.parseToJsonElement(actual))
    }

    private fun only(): Recorded {
        assertEquals("exactly one request", 1, recorded.size)
        return recorded.single()
    }

    @Test
    fun `read posts the credential and decodes the whole impression`() = runTest {
        reply(200, READ)

        val impression = api.read("token-abc")

        val request = only()
        assertEquals("POST", request.method)
        assertEquals("/impression/read", request.path)
        assertEquals("Bearer token-abc", request.authorization)
        assertJson("{}", request.body)
        assertTrue("no user selector may cross this wire", !request.body.contains("shortId"))
        assertEquals("整份印象正文", impression.content)
        assertEquals(1_761_600_000_000L, impression.updatedAt)
        assertEquals(8000, impression.maxCharacters)
    }

    @Test
    fun `a refusal keeps the backend code and message`() = runTest {
        reply(401, """{"ok":false,"error":{"code":"impression/unauthorized","message":"present a live session credential"}}""")

        val refusal = refused { api.read("token-abc") }

        assertEquals(401, refusal.status)
        assertEquals("impression/unauthorized", refusal.code)
        assertEquals("present a live session credential", refusal.message)
    }

    @Test
    fun `a 200 body that says ok false is still a refusal`() = runTest {
        reply(200, """{"ok":false,"error":{"code":"impression/unauthorized","message":"present a live session credential"}}""")

        val refusal = refused { api.read("token-abc") }

        assertEquals("impression/unauthorized", refusal.code)
        assertEquals("present a live session credential", refusal.message)
    }

    @Test
    fun `a read that carries no impression is unreachable`() = runTest {
        reply(200, """{"ok":true}""")

        val unreachable = runCatching { api.read("token-abc") }.exceptionOrNull()

        assertTrue(
            "an accepted read without an impression is not an impression to show",
            unreachable is IdentityUnreachable,
        )
    }

    private suspend inline fun refused(block: suspend () -> Unit): IdentityRefused =
        try {
            block()
            throw AssertionError("the call answered instead of refusing")
        } catch (refused: IdentityRefused) {
            refused
        }

    private companion object {
        const val READ = """
        {"ok":true,"impression":{"content":"整份印象正文","updatedAt":1761600000000,"maxCharacters":8000}}
        """
    }
}
