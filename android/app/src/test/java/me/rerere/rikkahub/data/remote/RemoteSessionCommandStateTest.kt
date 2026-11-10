package me.rerere.rikkahub.data.remote

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class RemoteSessionCommandStateTest {
    private class Store : ChatSyncStore {
        private val records = mutableMapOf<ChatSyncKey, ChatSyncRecord>()
        var record: ChatSyncRecord
            get() = records[ChatSyncKey("https://fairy", 1, "main")] ?: ChatSyncRecord()
            set(value) { records[ChatSyncKey("https://fairy", 1, "main")] = value }
        var fail = false
        override suspend fun load(key: ChatSyncKey) = records[key] ?: ChatSyncRecord()
        override suspend fun save(key: ChatSyncKey, record: ChatSyncRecord) {
            if (fail) throw IOException("disk unavailable")
            records[key] = record
        }
    }
    private class Backend : RemoteChatBackend, RemoteSessionCommandBackend {
        val flow = MutableSharedFlow<RemoteChatProjection>(extraBufferCapacity = 8)
        val executed = mutableListOf<Triple<String, String, Int>>()
        val queried = mutableListOf<Pair<String, String>>()
        val sent = mutableListOf<String>()
        var answer: RemoteSessionCommandSnapshot? = null
        var failure: Exception? = IdentityUnreachable(IOException("lost response"))
        var gate: CompletableDeferred<Unit>? = null
        var statusGate: CompletableDeferred<Unit>? = null
        var onExecute: (() -> Unit)? = null
        var ack = -1L
        override suspend fun executeCommand(token: String, sessionId: String, requestId: String, command: Int): RemoteSessionCommandSnapshot {
            onExecute?.invoke()
            executed += Triple(sessionId, requestId, command)
            gate?.let { withContext(NonCancellable) { it.await() } }
            failure?.let { throw it }
            return answer ?: RemoteSessionCommandSnapshot(sessionId, requestId, "op", command, 1, 0)
        }
        override suspend fun commandStatus(token: String, sessionId: String, requestId: String): RemoteSessionCommandSnapshot? {
            queried += sessionId to requestId
            if (sessionId == "main") statusGate?.let { withContext(NonCancellable) { it.await() } }
            return answer
        }
        override fun observe(token: String, sessionId: String) = flow
        override suspend fun checkpoint(token: String, sessionId: String) = ack
        override suspend fun page(token: String, sessionId: String, throughSeq: Long, beforeSeq: Long) = error("unused")
        override suspend fun read(token: String, sessionId: String) = error("unused")
        override suspend fun send(token: String, sessionId: String, requestId: String, text: String, uploadIds: List<String>): ChatReceipt {
            sent += text
            return ChatReceipt(sessionId, requestId, "message", 0)
        }
        override suspend fun receipt(token: String, sessionId: String, requestId: String): ChatReceipt? = null
        override suspend fun stop(token: String, sessionId: String) = Unit
    }

    @Test fun `late lost execute response cannot resurrect a durably completed operation`() = runTest {
        val store = Store()
        val gate = CompletableDeferred<Unit>()
        val backend = Backend().apply { this.gate = gate; ack = 2 }
        val state = RemoteChatState(backend, backgroundScope, store, "https://fairy")
        state.bind("alice", "main", 1); runCurrent()
        val id = state.send("/clear")!!; runCurrent()
        val terminal = RemoteChatMessage("command:op", 0, 2, id, 3, 2, "上下文已重置", kind = 3,
            commandId = "op", command = 2, commandStatus = 4)
        backend.flow.emit(RemoteChatProjection("main", "g", 1, 2, 2, listOf(terminal), events = eventCoverage(0, 2)))
        runCurrent()
        gate.complete(Unit); runCurrent()
        assertEquals(4, state.snapshot.value.sessionCommand?.status)
        assertNull(state.snapshot.value.sessionCommand?.failure)
        assertNull(store.record.pendingCommand)
        assertEquals(1, state.snapshot.value.projection?.messages?.size)
        assertTrue(backend.queried.isEmpty())
    }

    @Test fun `failed local clearing after refusal keeps the original recoverable identity`() = runTest {
        val store = Store()
        val backend = Backend().apply {
            failure = IdentityRefused(409, "chat/session-busy", "wait")
            onExecute = { store.fail = true }
        }
        val state = RemoteChatState(backend, backgroundScope, store, "https://fairy")
        state.bind("alice", "main", 1); runCurrent()
        val id = state.send("/clear")!!; runCurrent()
        assertEquals(id, store.record.pendingCommand?.requestId)
        assertEquals(id, state.snapshot.value.sessionCommand?.request?.requestId)
        assertFalse(state.snapshot.value.sessionCommand!!.terminal)
        assertNotNull(state.snapshot.value.sessionCommand?.failure)
    }

    @Test fun `unknown retry queries first and reuses the saved identity`() = runTest {
        val backend = Backend()
        val state = RemoteChatState(backend, backgroundScope, Store(), "https://fairy")
        state.bind("alice", "main", 1); runCurrent()
        val id = state.send("/clear")!!; runCurrent()
        assertTrue(state.retrySessionCommand()); runCurrent()
        assertEquals(listOf(Triple("main", id, 2), Triple("main", id, 2)), backend.executed)
        assertEquals(listOf("main" to id, "main" to id), backend.queried)
    }

    @Test fun `explicit retry after a definite refusal gets a new identity and retains the command`() = runTest {
        val store = Store()
        val backend = Backend().apply { failure = IdentityRefused(409, "chat/session-busy", "请等待任务完成") }
        val state = RemoteChatState(backend, backgroundScope, store, "https://fairy")
        state.bind("alice", "main", 1); runCurrent()
        val first = state.send(" /compact ")!!; runCurrent()
        assertTrue(state.snapshot.value.sessionCommand!!.failed)
        assertEquals("请等待任务完成", state.snapshot.value.sessionCommand?.failure)
        assertNull(store.record.pendingCommand)
        assertTrue(backend.queried.isEmpty())
        backend.failure = null
        assertTrue(state.retrySessionCommand()); runCurrent()
        assertEquals(listOf(1, 1), backend.executed.map { it.third })
        assertNotEquals(first, backend.executed.last().second)
        assertEquals(" /compact ", state.snapshot.value.sessionCommand?.request?.text)
    }

    @Test fun `command storage failure prevents every network side effect and retry retains original identity`() = runTest {
        val store = Store().apply { fail = true }
        val backend = Backend()
        val state = RemoteChatState(backend, backgroundScope, store, "https://fairy")
        state.bind("alice", "main", 1); runCurrent()
        val id = state.send("/clear")!!; runCurrent()
        assertTrue(backend.executed.isEmpty())
        assertTrue(backend.queried.isEmpty())
        assertNotNull(state.snapshot.value.sessionCommand?.failure)
        store.fail = false
        state.retrySessionCommand(); runCurrent()
        assertEquals(id, backend.executed.single().second)
    }

    @Test fun `legacy consumption record still loads without a command or new query`() = runTest {
        val store = Store().apply { record = Json.decodeFromString("""{"consumedThrough":7,"initialized":true}""") }
        val backend = Backend()
        val state = RemoteChatState(backend, backgroundScope, store, "https://fairy")
        state.bind("alice", "main", 1); runCurrent()
        assertEquals(7L, state.snapshot.value.consumedThrough)
        assertNull(state.snapshot.value.sessionCommand)
        assertTrue(backend.queried.isEmpty())
    }

    @Test fun `a stalled old query cannot block recovery in the newly bound account`() = runTest {
        val store = Store()
        val gate = CompletableDeferred<Unit>()
        val backend = Backend().apply { statusGate = gate }
        val state = RemoteChatState(backend, backgroundScope, store, "https://fairy")
        state.bind("alice", "main", 1); runCurrent()
        state.send("/clear"); runCurrent()
        store.save(ChatSyncKey("https://fairy", 2, "other"), ChatSyncRecord(
            pendingCommand = StoredSessionCommand("other-request", 1, "/compact")))
        backend.answer = RemoteSessionCommandSnapshot("other", "other-request", "other-op", 1, 3, 0, 1)
        state.bind("bob", "other", 2); runCurrent()
        assertEquals(listOf("main", "other"), backend.queried.map { it.first })
        assertEquals(3, state.snapshot.value.sessionCommand?.status)
        gate.complete(Unit); runCurrent()
        assertEquals("other-request", state.snapshot.value.sessionCommand?.request?.requestId)
    }

    @Test fun `late command completion belongs to its initiating session`() = runTest {
        val store = Store()
        val gate = CompletableDeferred<Unit>()
        val backend = Backend().apply { this.gate = gate; failure = null }
        val state = RemoteChatState(backend, backgroundScope, store, "https://fairy")
        state.bind("alice", "main", 1); runCurrent()
        val id = state.send("/clear")!!; runCurrent()
        state.bind("bob", "other", 2); runCurrent()
        backend.answer = RemoteSessionCommandSnapshot("main", id, "op", 2, 4, 0, 2)
        gate.complete(Unit); runCurrent()
        assertEquals(listOf(Triple("main", id, 2)), backend.executed)
        assertEquals("other", state.snapshot.value.sessionId)
        assertNull(state.snapshot.value.sessionCommand)
    }

    @Test fun `observer command terminal waits for writer durability and keeps old history`() = runTest {
        val store = Store()
        val backend = Backend().apply { ack = 0 }
        val state = RemoteChatState(backend, backgroundScope, store, "https://fairy")
        state.bind("alice", "main", 1); runCurrent()
        val id = state.send("/clear")!!; runCurrent()
        val old = RemoteChatMessage("old", 0, 0, role = 1, status = 2, text = "old history")
        val terminal = RemoteChatMessage("command:op", 1, 2, id, 3, 2, "上下文已重置", kind = 3,
            commandId = "op", command = 2, commandStatus = 4)
        backend.flow.emit(RemoteChatProjection("main", "g", 1, 2, 0, listOf(old, terminal), events = eventCoverage(0, 2)))
        runCurrent()
        assertEquals(1, state.snapshot.value.projection?.messages?.last()?.commandStatus)
        assertNotNull(store.record.pendingCommand)
        backend.ack = 2
        state.retrySync(); runCurrent()
        assertEquals(listOf("old", "command:op"), state.snapshot.value.projection?.messages?.map { it.messageId })
        assertEquals(4, state.snapshot.value.projection?.messages?.last()?.commandStatus)
        assertEquals(4, state.snapshot.value.sessionCommand?.status)
        assertNull(store.record.pendingCommand)
        backend.ack = 0
        backend.flow.emit(RemoteChatProjection("main", "g", 2, 2, 0, listOf(old, terminal), events = eventCoverage(0, 2)))
        runCurrent()
        assertEquals(4, state.snapshot.value.projection?.messages?.last()?.commandStatus)
    }

    @Test fun `unknown clear is saved before network and restart queries original identity without executing again`() = runTest {
        val store = Store()
        val backend = Backend()
        val state = RemoteChatState(backend, backgroundScope, store, "https://fairy")
        backend.onExecute = { assertNotNull(store.record.pendingCommand) }
        state.bind("alice", "main", 1); runCurrent()
        val id = state.send("  /clear\n")!!; runCurrent()
        assertTrue(backend.sent.isEmpty())
        assertEquals(listOf(Triple("main", id, 2)), backend.executed)
        assertEquals(listOf("main" to id), backend.queried)
        assertEquals(id, state.snapshot.value.sessionCommand?.request?.requestId)
        assertEquals(2, store.record.pendingCommand?.command)
        val saved = Json.encodeToString(store.record)
        state.detach()
        val restoredStore = Store().apply { record = Json.decodeFromString(saved) }
        backend.answer = RemoteSessionCommandSnapshot("main", id, "op", 2, 4, 0, 2)
        val restored = RemoteChatState(backend, backgroundScope, restoredStore, "https://fairy")
        restored.bind("rotated", "main", 1); runCurrent()
        assertEquals(1, backend.executed.size)
        assertEquals(listOf("main" to id, "main" to id), backend.queried)
        assertEquals(4, restored.snapshot.value.sessionCommand?.status)
        assertNull(restoredStore.record.pendingCommand)
    }
}
