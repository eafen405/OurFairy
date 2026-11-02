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
 * The skills wire, against a real HTTP server on loopback.
 *
 * The expected documents are JSON literals from the backend contract, not re-encoded through the
 * client's own types. The assertions cover the paths, the Bearer credential, the document each
 * operation sends, the numeric enums the page renders, and the backend's own refusal codes.
 */
class SkillsApiTest {

    private data class Recorded(
        val method: String,
        val path: String,
        val authorization: String?,
        val body: String,
    )

    private lateinit var server: HttpServer
    private lateinit var api: SkillsApi
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
        api = SkillsApi(
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

    private fun only(): Recorded {
        assertEquals("exactly one request", 1, recorded.size)
        return recorded.single()
    }

    @Test
    fun `list decodes the derived pool, states, scopes and action scopes`() = runTest {
        reply(200, LIST)

        val pool = api.list("token-abc")

        val request = only()
        assertEquals("POST", request.method)
        assertEquals("/skills/list", request.path)
        assertEquals("Bearer token-abc", request.authorization)
        assertEquals("{}", request.body.trim())
        val common = pool.skills.single { it.scope == SkillScope.COMMON }
        assertEquals(2, common.scope)
        assertEquals(SkillPoolState.SHADOWED, common.state)
        assertEquals(SkillShadower(7, "shadow-demo"), common.shadowedBy)
        assertEquals(SkillActionTarget.OWNER, common.actions.toggle)
        assertEquals(SkillActionTarget.EVERYONE, common.actions.archive)
        assertEquals(false, common.pendingRevision)
        assertTrue("the pending area is carried even when empty", pool.pending.isEmpty() && pool.pendingCount == 0)
        val personal = pool.skills.single { it.scope == SkillScope.PERSONAL }
        assertEquals(SkillPoolState.IN_CATALOG, personal.state)
        assertEquals(true, personal.enabled)
    }

    @Test
    fun `setEnabled posts only the skill id and preference and answers the backend's item`() = runTest {
        reply(200, PREFERENCE)

        val item = api.setEnabled("token-abc", 4, true)

        val request = only()
        assertEquals("/skills/preference", request.path)
        assertEquals("Bearer token-abc", request.authorization)
        assertEquals(Json.parseToJsonElement("""{"skillId":4,"enabled":true}"""), Json.parseToJsonElement(request.body))
        assertEquals(SkillPoolState.IN_CATALOG, item.state)
        assertEquals(true, item.enabled)
    }

    @Test
    fun `detail posts the skill id and decodes the bounded item`() = runTest {
        reply(200, PREFERENCE)

        val item = api.detail("token-abc", 4)

        val request = only()
        assertEquals("/skills/detail", request.path)
        assertEquals(Json.parseToJsonElement("""{"skillId":4}"""), Json.parseToJsonElement(request.body))
        assertEquals("demo-skill", item.name)
    }

    @Test
    fun `a refusal keeps the backend's own code and message`() = runTest {
        reply(409, """{"ok":false,"error":{"code":"skills/archived","message":"skill \"demo\" is archived"}}""")

        val refusal = refused { api.setEnabled("token-abc", 4, true) }

        assertEquals(409, refusal.status)
        assertEquals("skills/archived", refusal.code)
        assertEquals("skill \"demo\" is archived", refusal.message)
    }

    @Test
    fun `a 200 body that says ok false is still a refusal`() = runTest {
        reply(200, """{"ok":false,"error":{"code":"skills/not-found","message":"skill 4 is not visible to this user"}}""")

        val refusal = refused { api.detail("token-abc", 4) }

        assertEquals("skills/not-found", refusal.code)
        assertTrue("the backend detail survives", refusal.message.orEmpty().contains("not visible"))
    }

    private suspend inline fun refused(block: suspend () -> Unit): IdentityRefused =
        try {
            block()
            throw AssertionError("the call answered instead of refusing")
        } catch (refused: IdentityRefused) {
            refused
        }

    private companion object {
        const val LIST = """
        {"ok":true,"skills":[
          {"skillId":4,"name":"demo-skill","description":"Demo.","scope":1,"state":1,"enabled":true,
           "currentVersionId":9,"pendingRevision":false,
           "actions":{"toggle":1,"archive":1,"restore":1}},
          {"skillId":5,"name":"demo-skill","description":"Common.","scope":2,"state":2,"enabled":true,
           "currentVersionId":10,"pendingRevision":false,
           "shadowedBy":{"skillId":7,"name":"shadow-demo"},
           "actions":{"toggle":1,"archive":2,"restore":2}}
        ],"pending":[],"pendingCount":0}
        """

        const val PREFERENCE = """
        {"ok":true,"skill":{"skillId":4,"name":"demo-skill","description":"Demo.","scope":1,"state":1,
         "enabled":true,"currentVersionId":9,"pendingRevision":false,
         "actions":{"toggle":1,"archive":1,"restore":1}}}
        """
    }
}
