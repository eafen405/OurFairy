package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class RemoteChatStateTest {
    private class Backend : RemoteChatBackend {
        val events = mutableMapOf<String, MutableSharedFlow<RemoteChatProjection>>()
        val sent = mutableListOf<Triple<String, String, String>>()
        var failure: Exception? = null
        var receiptValue: ChatReceipt? = null
        var stopped = 0
        var ack = 7L
        var sendGate: CompletableDeferred<Unit>? = null
        var pageGate: CompletableDeferred<Unit>? = null
        var pageAnswer: ((throughSeq: Long, beforeSeq: Long) -> ChatHistoryPage)? = null
        override fun observe(token: String, sessionId: String): Flow<RemoteChatProjection> =
            events.getOrPut("$token/$sessionId") { MutableSharedFlow(extraBufferCapacity = 8) }
        override suspend fun page(token: String, sessionId: String, throughSeq: Long, beforeSeq: Long): ChatHistoryPage {
            pageGate?.let { withContext(NonCancellable) { it.await() } }
            return pageAnswer?.invoke(throughSeq, beforeSeq)
                ?: ChatHistoryPage(sessionId, throughSeq, 0, events = eventCoverage(0, beforeSeq - 1))
        }
        override suspend fun checkpoint(token: String, sessionId: String) = ack
        override suspend fun read(token: String, sessionId: String) = projection(sessionId)
        override suspend fun send(token: String, sessionId: String, requestId: String, text: String, uploadIds: List<String>): ChatReceipt {
            sent += Triple(sessionId, requestId, text)
            sendGate?.let { withContext(NonCancellable) { it.await() } }
            failure?.let { throw it }
            return ChatReceipt(sessionId, requestId, "user-1", 3)
        }
        override suspend fun receipt(token: String, sessionId: String, requestId: String) = receiptValue
        override suspend fun stop(token: String, sessionId: String) { stopped++ }
    }

    @Test fun `a new binding holds the reminder gate until its first projection`() = runTest {
        val backend = Backend()
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        // The observer coroutine has not been dispatched yet; an absent answer must not read as
        // "answered with nothing owed" to reception's backlog gate.
        assertTrue("a binding whose observer has not run has not answered", state.snapshot.value.isCatchingUp)
        runCurrent()
        backend.events.getValue("alice/s1").emit(projection("s1", 1))
        runCurrent()
        runCurrent()
        assertFalse("the first settled projection answers the gate", state.snapshot.value.isCatchingUp)
    }

    @Test fun `stream snapshots replace cumulative text and pure terminal state enables rich text`() = runTest {
        val backend = Backend()
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        runCurrent()
        backend.events.getValue("alice/s1").emit(projection("s1", 1, RemoteChatAttempt("a1", 1, " # hi\n")))
        runCurrent()
        assertEquals(" # hi\n", state.snapshot.value.projection?.attempt?.text)
        backend.events.getValue("alice/s1").emit(projection("s1", 2, RemoteChatAttempt("a1", 2, " # hi\n**x**")))
        runCurrent()
        assertEquals(" # hi\n**x**", state.snapshot.value.projection?.attempt?.text)
        val message = RemoteChatMessage("m1", 0, 7, null, 2, 3, " # hi\n**x**")
        backend.events.getValue("alice/s1").emit(projection("s1", 3).copy(messages = listOf(message)))
        runCurrent()
        assertNull(state.snapshot.value.projection?.attempt)
        assertEquals(" # hi\n**x**", state.snapshot.value.projection?.messages?.single()?.text)
        assertEquals(RemoteMessageFormat.MARKDOWN, remoteMessageFormat(message))
        assertEquals(RemoteMessageFormat.PLAIN, remoteAttemptFormat())
    }

    @Test fun `snapshot keeps the backend presentation order even when seq disagrees`() = runTest {
        val backend = Backend()
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        runCurrent()
        // #223's probe: first appearance is [u-first,u-second,a1] while seq order
        // is [u-second,a1,u-first]. Position names the first, and the client must
        // not re-sort by seq or by messageId.
        val messages = listOf(
            RemoteChatMessage("u-first", 0, 3, null, 1, 2, "first"),
            RemoteChatMessage("u-second", 1, 1, "r2", 1, 1, "second"),
            RemoteChatMessage("a1", 2, 2, null, 2, 2, "reply"),
        )
        backend.events.getValue("alice/s1").emit(projection("s1", 1).copy(messages = messages))
        runCurrent()
        assertEquals(
            listOf("u-first", "u-second", "a1"),
            state.snapshot.value.projection?.messages?.map { it.messageId },
        )
    }

    @Test fun `a new generation restores backend presentation order from its own positions`() = runTest {
        val backend = Backend()
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        runCurrent()
        val flow = backend.events.getValue("alice/s1")
        flow.emit(projection("s1", 1).copy(
            generation = "old",
            messages = listOf(RemoteChatMessage("old", 0, 1, null, 1, 2, "old")),
        ))
        runCurrent()
        flow.emit(projection("s1", 2).copy(
            generation = "new",
            messages = listOf(
                RemoteChatMessage("new-first", 0, 6, null, 1, 2, "first"),
                RemoteChatMessage("new-second", 1, 2, null, 2, 2, "second"),
            ),
        ))
        runCurrent()

        assertEquals(
            listOf("new-first", "new-second"),
            state.snapshot.value.projection?.messages?.map { it.messageId },
        )
        assertNull(state.snapshot.value.failure)
    }

    @Test fun `rows sharing one splice seq keep their insert order`() = runTest {
        val backend = Backend()
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        runCurrent()
        // Two messages inserted by one splice share its seq; only position says
        // which came first in the transcript.
        val messages = listOf(
            RemoteChatMessage("z-user", 0, 5, "r1", 1, 2, "first inserted"),
            RemoteChatMessage("a-user", 1, 5, "r2", 1, 2, "second inserted"),
            RemoteChatMessage("reply", 2, 6, null, 2, 2, "reply"),
        )
        backend.events.getValue("alice/s1").emit(projection("s1", 1).copy(messages = messages))
        runCurrent()
        assertEquals(
            listOf("z-user", "a-user", "reply"),
            state.snapshot.value.projection?.messages?.map { it.messageId },
        )
    }

    @Test fun `a page backfills earlier rows into their own positions`() = runTest {
        val backend = Backend()
        // The live tail carries a row that first appeared early and moved here,
        // so its seq is the newest while its place is the first.
        val moved = RemoteChatMessage("u-first", 0, 4, "r1", 1, 2, "first")
        val opening = RemoteChatProjection(
            sessionId = "s1", generation = "g1", version = 1, cursor = 4, durableThroughSeq = 4,
            messages = listOf(moved), attempt = null, replyStatus = 0, error = null,
            throughSeq = 4, fromSeq = 4, events = eventCoverage(4, 4), hasMore = true, beforeSeq = 4,
        )
        backend.pageAnswer = { _, _ ->
            ChatHistoryPage("s1", 4, 0, null, false, eventCoverage(0, 3), listOf(
                RemoteChatMessage("u-second", 1, 1, "r2", 1, 2, "second"),
                RemoteChatMessage("a1", 2, 2, null, 2, 2, "reply"),
            ))
        }
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        runCurrent()
        backend.events.getValue("alice/s1").emit(opening)
        runCurrent()

        val messages = state.snapshot.value.projection?.messages ?: error("no projection")
        assertEquals(listOf("u-first", "u-second", "a1"), messages.map { it.messageId })
        assertEquals(listOf(0L, 1L, 2L), messages.map { it.position })
        assertEquals(4L, state.snapshot.value.consumedThrough)
    }

    @Test fun `a valid older page cannot roll back a newer live row`() = runTest {
        val backend = Backend()
        backend.pageGate = CompletableDeferred()
        backend.pageAnswer = { _, _ ->
            ChatHistoryPage("s1", 3, 0, null, false, eventCoverage(0, 1),
                listOf(RemoteChatMessage("m", 0, 1, null, 2, 4, "old")))
        }
        val opening = RemoteChatProjection(
            sessionId = "s1", generation = "g1", version = 1, cursor = 3, durableThroughSeq = 3,
            messages = emptyList(), attempt = null, replyStatus = 0, error = null,
            throughSeq = 3, fromSeq = 2, events = eventCoverage(2, 3), hasMore = true, beforeSeq = 2,
        )
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        runCurrent()
        val flow = backend.events.getValue("alice/s1")
        flow.emit(opening)
        runCurrent()

        // The live row is newer by seq while the page still holds the row's own
        // place; the page must not roll the content back.
        flow.emit(opening.copy(
            version = 2, cursor = 4, durableThroughSeq = 4,
            messages = listOf(RemoteChatMessage("m", 0, 4, null, 2, 3, "new")),
            events = eventCoverage(2, 4),
        ))
        runCurrent()
        backend.pageGate?.complete(Unit)
        runCurrent()

        val messages = state.snapshot.value.projection?.messages ?: error("no projection")
        assertEquals(listOf("m"), messages.map { it.messageId })
        assertEquals(4L, messages.single().seq)
        assertEquals(3, messages.single().status)
        assertEquals("new", messages.single().text)
        assertNull(state.snapshot.value.failure)
    }

    @Test fun `a message that changes position is refused and keeps the last trusted snapshot`() = runTest {
        val backend = Backend().apply { ack = 9 }
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        runCurrent()
        val flow = backend.events.getValue("alice/s1")
        flow.emit(projection("s1", 1).copy(messages = listOf(
            RemoteChatMessage("m", 0, 2, null, 2, 2, "kept"),
        )))
        runCurrent()
        assertEquals(7L, state.snapshot.value.consumedThrough)

        // The same message arrives at a different place, with events beyond the
        // previous commit: adopting it would silently move a row the user
        // already saw, so the whole snapshot is refused.
        flow.emit(projection("s1", 2).copy(
            cursor = 9, durableThroughSeq = 9, events = eventCoverage(0, 9),
            messages = listOf(RemoteChatMessage("m", 1, 3, null, 2, 2, "moved")),
        ))
        runCurrent()

        assertNotNull(state.snapshot.value.failure)
        assertEquals(1L, state.snapshot.value.projection?.version)
        assertEquals(listOf("kept"), state.snapshot.value.projection?.messages?.map { it.text })
        assertEquals(0L, state.snapshot.value.projection?.messages?.single()?.position)
        assertEquals(7L, state.snapshot.value.consumedThrough)
    }

    @Test fun `a page that gives a second message the same position is refused`() = runTest {
        val backend = Backend().apply { ack = 4 }
        val opening = RemoteChatProjection(
            sessionId = "s1", generation = "g1", version = 1, cursor = 3, durableThroughSeq = 3,
            messages = listOf(RemoteChatMessage("live", 0, 3, null, 2, 2, "live")),
            attempt = null, replyStatus = 0, error = null,
            throughSeq = 3, fromSeq = 2, events = eventCoverage(2, 3), hasMore = true, beforeSeq = 2,
        )
        backend.pageGate = CompletableDeferred()
        backend.pageAnswer = { _, _ ->
            ChatHistoryPage("s1", 3, 0, null, false, eventCoverage(0, 1),
                listOf(RemoteChatMessage("page", 0, 1, null, 2, 2, "page")))
        }
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        runCurrent()
        backend.events.getValue("alice/s1").emit(opening)
        runCurrent()
        backend.pageGate?.complete(Unit)
        runCurrent()

        assertNotNull(state.snapshot.value.failure)
        assertEquals(1L, state.snapshot.value.projection?.version)
        assertEquals(listOf("live"), state.snapshot.value.projection?.messages?.map { it.messageId })
        assertEquals(-1L, state.snapshot.value.consumedThrough)
    }

    @Test fun `the newest Fairy output is the greatest seq, not the last row`() {
        // Position orders the transcript, so a row that settled last can sit
        // before the newest output. The reminder and the perf measurement ask
        // this one question.
        val messages = listOf(
            RemoteChatMessage("newest", 0, 9, null, 2, 2, "newest"),
            RemoteChatMessage("older", 1, 5, null, 2, 2, "older"),
            RemoteChatMessage("user", 2, 10, "r1", 1, 2, "user"),
        )
        assertEquals("newest", messages.newestFairyOutput()?.text)
        assertEquals("newest", messages.newestFairyOutput(9)?.text)
        assertNull(messages.newestFairyOutput(4))
    }

    @Test fun `a committed delivery and a still running attempt stay independent`() = runTest {
        // The delivery is the next event after the connection's fixed cut, so the
        // writer acknowledgement has to cover its sequence or the batch never settles.
        val backend = Backend().apply { ack = 8 }
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        runCurrent()
        val flow = backend.events.getValue("alice/s1")
        val delivery = RemoteChatMessage("d-1", 0, 8, null, 2, 2, DELIVERED_TEXT)
        // Same delivery, same raw coverage of seq 0..8, only the attempt text moves.
        fun committed(version: Long, attempt: RemoteChatAttempt) =
            projection("s1", version, attempt).copy(
                cursor = 8, events = eventCoverage(0, 8),
                messages = listOf(delivery),
            )

        flow.emit(projection("s1", 1, RemoteChatAttempt("a1", 1, "draft")))
        runCurrent()
        assertEquals("draft", state.snapshot.value.projection?.attempt?.text)
        flow.emit(committed(2, RemoteChatAttempt("a1", 2, "draft **bold**")))
        runCurrent()
        flow.emit(committed(3, RemoteChatAttempt("a1", 3, "draft **bold** body")))
        runCurrent()

        assertNull(state.snapshot.value.failure)
        // The delivery is one message, repeated in every later snapshot, not three.
        val view = state.snapshot.value.projection!!
        val message = view.messages.single()
        assertEquals("d-1", message.messageId)
        assertEquals(DELIVERED_TEXT, message.text)
        assertEquals(2, message.role)
        assertEquals(2, message.status)
        // The attempt keeps its own identity and only ever the newest cumulative text.
        val attempt = view.attempt!!
        assertEquals("a1", attempt.attemptId)
        assertEquals(3L, attempt.revision)
        assertEquals("draft **bold** body", attempt.text)
        assertEquals(RemoteMessageFormat.MARKDOWN, remoteMessageFormat(message))
        assertEquals(RemoteMessageFormat.PLAIN, remoteAttemptFormat())
        assertEquals(8L, state.snapshot.value.consumedThrough)
    }

    @Test fun `unknown acceptance retains request identity and explicit retry uses identical bytes`() = runTest {
        val backend = Backend().apply { failure = IdentityUnreachable(java.io.IOException("lost")) }
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        state.send("  hello\n")
        runCurrent()
        val pending = state.snapshot.value.pending!!
        assertTrue(pending.acceptanceUnknown)
        state.send("  hello\n")
        runCurrent()
        assertEquals(1, backend.sent.size)
        state.reconcile()
        runCurrent()
        assertEquals(pending.requestId, state.snapshot.value.pending?.requestId)
        backend.failure = null
        state.retryPending()
        runCurrent()
        assertEquals(2, backend.sent.size)
        assertEquals(backend.sent[0], backend.sent[1])
        assertNull(state.snapshot.value.pending)
    }

    @Test fun `retry answers whether the command was actually accepted`() = runTest {
        val backend = Backend().apply { failure = IdentityUnreachable(java.io.IOException("lost")) }
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        assertFalse("未绑定的会话无法受理重试", state.retryPending())

        state.bind("alice", "s1", 1)
        runCurrent()
        state.send("hello")
        runCurrent()
        assertTrue(state.snapshot.value.pending!!.acceptanceUnknown)

        // A lost credential still leaves the pending command on screen, but the retry is refused:
        // the panel must not report it as an accepted send.
        state.bind(null, "s1", 1)
        assertFalse("没有凭据时重试没有被受理", state.retryPending())

        state.bind("alice", "s1", 1)
        backend.failure = null
        assertTrue("真正发出的重试回答 true", state.retryPending())
        assertFalse("已经在发送中的重试不算再次受理", state.retryPending())
        runCurrent()
        assertNull(state.snapshot.value.pending)
    }

    @Test fun `late old account send result cannot change the new account projection`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val backend = Backend().apply { sendGate = gate }
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        state.send("secret")
        runCurrent()
        state.bind("bob", "s2", 2)
        runCurrent()
        runCurrent()
        gate.complete(Unit)
        runCurrent()
        assertEquals("s2", state.snapshot.value.sessionId)
        assertNull(state.snapshot.value.pending)
        assertNull(state.snapshot.value.projection)
        assertFalse(state.snapshot.value.sending)
    }

    @Test fun `closing observation never requests stop and explicit stop does`() = runTest {
        val backend = Backend()
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        runCurrent()
        state.detach()
        runCurrent()
        assertEquals(0, backend.stopped)
        state.bind("alice", "s1", 1)
        runCurrent()
        state.stop()
        runCurrent()
        assertEquals(1, backend.stopped)
    }

    @Test fun `stopReply awaits the stop of the session this state is bound to`() = runTest {
        val backend = Backend()
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        // Nothing is bound yet, so there is no session to stop.
        state.stopReply()
        assertEquals(0, backend.stopped)
        state.bind("alice", "s1", 1)
        runCurrent()

        state.stopReply()

        assertEquals(1, backend.stopped)
    }

    @Test fun `older same generation projection cannot overwrite newer content`() = runTest {
        val backend = Backend()
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        runCurrent()
        val flow = backend.events.getValue("alice/s1")
        flow.emit(projection("s1", 5, RemoteChatAttempt("a", 3, "complete prefix")))
        runCurrent()
        flow.emit(projection("s1", 4, RemoteChatAttempt("a", 2, "old")))
        runCurrent()
        assertEquals("complete prefix", state.snapshot.value.projection?.attempt?.text)
    }

    @Test fun `reopening an observer does not orphan an in flight send result`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val backend = Backend().apply {
            sendGate = gate
            failure = IdentityUnreachable(java.io.IOException("lost response"))
        }
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        state.send("original")
        runCurrent()
        state.detach()
        state.bind("alice", "s1", 1)
        runCurrent()
        runCurrent()
        gate.complete(Unit)
        runCurrent()
        assertFalse(state.snapshot.value.sending)
        assertTrue(state.snapshot.value.pending!!.acceptanceUnknown)
    }

    @Test fun `unconfirmed live messages do not resolve unknown durable acceptance`() = runTest {
        val backend = Backend().apply { failure = IdentityUnreachable(java.io.IOException("lost")) }
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        state.send("original")
        runCurrent()
        val requestId = state.snapshot.value.pending!!.requestId
        val message = RemoteChatMessage("user-1", 0, 8, requestId, 1, 1, "original")
        val flow = backend.events.getValue("alice/s1")
        flow.emit(projection("s1", 1).copy(messages = listOf(message), cursor = 8, durableThroughSeq = 7,
            events = eventCoverage(0, 8)))
        runCurrent()
        assertEquals(requestId, state.snapshot.value.pending?.requestId)
        backend.ack = 8
        flow.emit(projection("s1", 2).copy(messages = listOf(message), cursor = 8, durableThroughSeq = 8,
            events = eventCoverage(0, 8)))
        runCurrent()
        assertNull(state.snapshot.value.pending)
    }

    @Test fun `switching sessions keeps an unknown command for explicit reconciliation`() = runTest {
        val backend = Backend().apply { failure = IdentityUnreachable(java.io.IOException("lost")) }
        val state = RemoteChatState(backend, backgroundScope, MemoryChatSyncStore(), "https://fairy")
        state.bind("alice", "s1", 1)
        runCurrent()
        state.send("original")
        runCurrent()
        val requestId = state.snapshot.value.pending!!.requestId
        state.bind("alice", "s2", 1)
        runCurrent()
        assertNull(state.snapshot.value.pending)
        state.bind("alice", "s1", 1)
        runCurrent()
        runCurrent()
        assertEquals(requestId, state.snapshot.value.pending?.requestId)
        assertEquals(1, backend.sent.size)
    }

    companion object {
        /** Markdown body a committed Fairy delivery carries, byte for byte. */
        const val DELIVERED_TEXT = "# Saved\n\n**bold** body  "

        fun projection(id: String, version: Long = 0, attempt: RemoteChatAttempt? = null) =
            RemoteChatProjection(id, "g1", version, 7, 7, emptyList(), attempt, if (attempt == null) 0 else 1, null,
                7, 0, eventCoverage(0, 7))
    }
}

private class MemoryChatSyncStore : ChatSyncStore {
    private val records = mutableMapOf<ChatSyncKey, ChatSyncRecord>()
    override suspend fun load(key: ChatSyncKey) = records[key] ?: ChatSyncRecord()
    override suspend fun save(key: ChatSyncKey, record: ChatSyncRecord) { records[key] = record }
}
