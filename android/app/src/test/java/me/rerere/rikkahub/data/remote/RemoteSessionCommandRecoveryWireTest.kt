package me.rerere.rikkahub.data.remote

import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.Collections
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import org.junit.Assert.*
import org.junit.Test

class RemoteSessionCommandRecoveryWireTest {
    @Test fun `expired status credential retains unknown clear identity through login`() = recoveryCase(401, false)

    @Test fun `expired status credential retains unknown clear identity through restart`() = recoveryCase(401, true)

    @Test fun `other status refusals do not establish an operation outcome`() {
        for (status in listOf(403, 404, 409)) recoveryCase(status, true)
    }

    private fun recoveryCase(refusal: Int, restart: Boolean) = runTest {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val executor = Executors.newCachedThreadPool()
        val endpoint = "http://127.0.0.1:${server.address.port}"
        val key = ChatSyncKey(endpoint, 1, "main")
        val released = CountDownLatch(1)
        val refused = CompletableDeferred<Unit>()
        val executed = Collections.synchronizedList(mutableListOf<String>())
        val queried = Collections.synchronizedList(mutableListOf<String>())
        var stored = ChatSyncRecord()
        val store = object : ChatSyncStore {
            override suspend fun load(key: ChatSyncKey) = stored
            override suspend fun save(key: ChatSyncKey, record: ChatSyncRecord) { stored = record }
        }
        server.createContext("/") { exchange ->
            try {
                val body = exchange.requestBody.readBytes().toString(Charsets.UTF_8)
                val path = exchange.requestURI.path
                if (path == "/chat/observe") {
                    exchange.responseHeaders.add("Content-Type", "text/event-stream")
                    exchange.sendResponseHeaders(200, 0)
                    released.await(20, TimeUnit.SECONDS)
                } else {
                    val id = Json.parseToJsonElement(body).jsonObject["requestId"]!!.jsonPrimitive.content
                    val fresh = exchange.requestHeaders.getFirst("Authorization") == "Bearer fresh-fixture"
                    val (status, response) = when (path) {
                        "/chat/commands/execute" -> {
                            executed += id
                            // The server completed clear, but its response was lost after headers.
                            200 to "{"
                        }
                        "/chat/commands/status" -> {
                            queried += id
                            if (fresh) 200 to """{"ok":true,"command":{"sessionId":"main","requestId":"$id","commandId":"original-clear","command":2,"status":4,"acceptedSeq":0,"completedSeq":2}}"""
                            else refusal to """{"ok":false,"error":{"code":"identity/refused","message":"fixture credential expired"}}"""
                        }
                        else -> error("unexpected request $path")
                    }
                    val bytes = response.toByteArray()
                    exchange.sendResponseHeaders(status, bytes.size.toLong())
                    exchange.responseBody.use { it.write(bytes) }
                    if (path == "/chat/commands/status" && !fresh) refused.complete(Unit)
                }
            } finally { exchange.close() }
        }
        server.executor = executor
        server.start()
        val client = OkHttpClient.Builder().callTimeout(10, TimeUnit.SECONDS).build()
        val api = RemoteChatApi(endpoint, client)
        val state = RemoteChatState(api, backgroundScope, store, endpoint)
        var restored: RemoteChatState? = null
        try {
            state.bind("expired-fixture", "main", 1)
            state.snapshot.first { it.storageReady }
            val id = state.send("/clear")!!
            refused.await()
            val unknown = state.snapshot.first { it.sessionCommand?.resolving == false }.sessionCommand!!
            assertEquals(id, store.load(key).pendingCommand?.requestId)
            assertEquals(id, unknown.request.requestId)
            assertFalse(unknown.terminal)
            assertFalse(unknown.failed)
            assertFalse(unknown.rejected)
            if (restart) {
                val persisted = Json.encodeToString(store.load(key))
                state.detach()
                val reloaded = object : ChatSyncStore {
                    var record = Json.decodeFromString<ChatSyncRecord>(persisted)
                    override suspend fun load(key: ChatSyncKey) = record
                    override suspend fun save(key: ChatSyncKey, record: ChatSyncRecord) { this.record = record }
                }
                restored = RemoteChatState(api, backgroundScope, reloaded, endpoint)
                restored.bind("fresh-fixture", "main", 1)
                assertEquals(4, restored.snapshot.first { it.sessionCommand?.terminal == true }.sessionCommand?.status)
                assertNull(reloaded.load(key).pendingCommand)
            } else {
                state.bind("fresh-fixture", "main", 1)
                assertEquals(4, state.snapshot.first { it.sessionCommand?.terminal == true }.sessionCommand?.status)
                assertNull(store.load(key).pendingCommand)
            }
            assertEquals(listOf(id), executed.toList())
            assertEquals(listOf(id, id), queried.toList())
        } finally {
            state.detach()
            restored?.detach()
            released.countDown()
            server.stop(0)
            executor.shutdownNow()
            assertTrue(executor.awaitTermination(10, TimeUnit.SECONDS))
            client.dispatcher.executorService.shutdown()
            client.connectionPool.evictAll()
        }
    }
}
