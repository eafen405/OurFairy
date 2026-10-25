package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.ExperimentalCoroutinesApi
import org.junit.Assert.assertEquals
import org.junit.Test

/** THROWAWAY PROBE: drives the current production RemoteChatState, not a merger copy. */
@OptIn(ExperimentalCoroutinesApi::class)
class RecoveryOrderingProbe {
    private class Store : ChatSyncStore {
        override suspend fun load(key: ChatSyncKey) = ChatSyncRecord()
        override suspend fun save(key: ChatSyncKey, record: ChatSyncRecord) = Unit
    }

    private class Backend(
        private val opening: RemoteChatProjection,
        private val pages: List<ChatHistoryPage>,
    ) : RemoteChatBackend {
        val live = MutableSharedFlow<RemoteChatProjection>(extraBufferCapacity = 8)
        var pageGate: CompletableDeferred<Unit>? = null
        override fun observe(token: String, sessionId: String): Flow<RemoteChatProjection> =
            kotlinx.coroutines.flow.flow {
                emit(opening)
                emitAll(live)
            }
        override suspend fun page(token: String, sessionId: String, throughSeq: Long, beforeSeq: Long): ChatHistoryPage {
            pageGate?.await()
            return pages.single { it.throughSeq == throughSeq && it.beforeSeq == beforeSeq }
        }
        override suspend fun checkpoint(token: String, sessionId: String): Long = 100
        override suspend fun read(token: String, sessionId: String) = opening
        override suspend fun send(token: String, sessionId: String, requestId: String, text: String, uploadIds: List<String>) =
            error("not used")
        override suspend fun receipt(token: String, sessionId: String, requestId: String) = null
        override suspend fun stop(token: String, sessionId: String) = Unit
    }

    @Test
    fun `current Android reorders the backend first-appearance fixture`() = runTest {
        val first = RemoteChatMessage("u-first", 3, role = 1, status = 2, text = "first")
        val second = RemoteChatMessage("u-second", 1, role = 1, status = 2, text = "second")
        val assistant = RemoteChatMessage("a1", 2, role = 2, status = 2, text = "reply")
        val opening = RemoteChatProjection(
            sessionId = "s", generation = "g", version = 1, cursor = 3,
            durableThroughSeq = 3, messages = listOf(first, second, assistant),
            throughSeq = 3, fromSeq = 0, events = eventCoverage(0, 3),
        )
        val state = RemoteChatState(Backend(opening, emptyList()), backgroundScope, Store(), "https://fairy")

        state.bind("token", "s", 1)
        runCurrent()
        (state.snapshot.value.projection?.messages ?: error("no opening")) .also { messages ->
            println("PROBE backend-order=" + listOf("u-first", "u-second", "a1"))
            println("PROBE android-order=" + messages.map { it.messageId })
            assertEquals(listOf("u-second", "a1", "u-first"), messages.map { it.messageId })
        }
        state.detach()
    }

    @Test
    fun `valid older page cannot roll back a newer live reposition`() = runTest {
        val oldPageMessage = RemoteChatMessage("m", 1, role = 2, status = 4, text = "old")
        val opening = RemoteChatProjection(
            sessionId = "s", generation = "g", version = 1, cursor = 3,
            durableThroughSeq = 3, messages = emptyList(), throughSeq = 3, fromSeq = 2,
            events = eventCoverage(2, 3), hasMore = true, beforeSeq = 2,
        )
        val page = ChatHistoryPage(
            sessionId = "s", throughSeq = 3, fromSeq = 0, beforeSeq = null, hasMore = false,
            events = eventCoverage(0, 1), messages = listOf(oldPageMessage),
        )
        val backend = Backend(opening, listOf(page)).apply { pageGate = CompletableDeferred() }
        val state = RemoteChatState(backend, backgroundScope, Store(), "https://fairy")
        state.bind("token", "s", 1)
        runCurrent()

        val liveMessage = RemoteChatMessage("m", 4, role = 2, status = 3, text = "new")
        backend.live.emit(opening.copy(
            version = 2, cursor = 4, durableThroughSeq = 4,
            messages = listOf(liveMessage), events = eventCoverage(2, 4),
        ))
        runCurrent()
        backend.pageGate?.complete(Unit)
        runCurrent()

        val messages = state.snapshot.value.projection?.messages ?: error("no recovered projection")
        println("PROBE stale-page-result=" + messages.map { "${it.messageId}:seq=${it.seq},status=${it.status},text=${it.text}" })
        assertEquals(listOf("m"), messages.map { it.messageId })
        assertEquals(4, messages.single().seq)
        assertEquals(3, messages.single().status)
        assertEquals("new", messages.single().text)
        state.detach()
    }
}
