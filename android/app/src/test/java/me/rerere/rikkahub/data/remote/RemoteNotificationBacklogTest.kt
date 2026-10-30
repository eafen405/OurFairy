package me.rerere.rikkahub.data.remote

import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Test

/**
 * A reconnect that catches up several sessions publishes one reminder, not one per session.
 * Each session records the episode it owes in its own durable record; reception sees every
 * session and decides once, so the backlog has an owner.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RemoteNotificationBacklogTest {
    private class Store : ChatSyncStore {
        private val records = mutableMapOf<ChatSyncKey, ChatSyncRecord>()
        override suspend fun load(key: ChatSyncKey) = records[key] ?: ChatSyncRecord(0, true, notificationThrough = 0)
        fun seed(key: ChatSyncKey, record: ChatSyncRecord) { records[key] = record }
        override suspend fun save(key: ChatSyncKey, record: ChatSyncRecord) { records[key] = record }
    }

    /**
     * Records whether the reminder was suppressed, so a later reconnect cannot replay it.
     * [failNextPublish] models the platform refusing the attempt after the durable record was
     * consumed: the sound for that episode is lost, and only that episode.
     */
    private class Platform : RemoteNotificationPlatform {
        var foreground = false
        var enabled = true
        var failNextPublish = false
        var publishAttempts = 0
        val alerts = mutableListOf<Pair<ChatSyncKey, String>>()
        override fun isForeground() = foreground
        override fun publish(key: ChatSyncKey, preview: String) {
            publishAttempts += 1
            if (foreground || !enabled) throw AssertionError("a suppressed reminder was published")
            if (failNextPublish) {
                failNextPublish = false
                throw IOException("notification channel refused the reminder")
            }
            alerts += key to preview
        }
    }

    private class Sessions(ids: List<String> = listOf("main")) : SessionBackend {
        private var ids = ids
        fun setIds(next: List<String>) { ids = next }
        override suspend fun list(token: String, archived: Boolean) = OwnedSessions(
            ids.map { OwnedSession("$token-$it", primary = it == ids.first()) },
            "$token-${ids.first()}",
        )
        override suspend fun read(token: String, sessionId: String) = OwnedSession(sessionId)
        override suspend fun rename(token: String, sessionId: String, title: String) = error("not used")
        override suspend fun select(token: String, sessionId: String) = read(token, sessionId)
        override suspend fun create(token: String) = error("not used")
        override suspend fun primary(token: String) = OwnedSession("$token-${ids.first()}", primary = true)
        override suspend fun archive(token: String, sessionId: String) = read(token, sessionId)
        override suspend fun restore(token: String, sessionId: String) = error("not used")
    }

    private class Chats : RemoteChatBackend {
        val updates = mutableMapOf<String, MutableSharedFlow<RemoteChatProjection>>()
        var gate: CompletableDeferred<Unit>? = null
        override fun observe(token: String, sessionId: String) =
            updates.getOrPut(sessionId) { MutableSharedFlow(extraBufferCapacity = 10) }
        override suspend fun checkpoint(token: String, sessionId: String): Long {
            gate?.let { withContext(NonCancellable) { it.await() } }
            return 100L
        }
        override suspend fun page(token: String, sessionId: String, throughSeq: Long, beforeSeq: Long) =
            ChatHistoryPage(sessionId, throughSeq, 0, events = eventCoverage(0, beforeSeq - 1))
        override suspend fun read(token: String, sessionId: String) = error("not used")
        override suspend fun send(token: String, sessionId: String, requestId: String, text: String, uploadIds: List<String>) = error("not used")
        override suspend fun receipt(token: String, sessionId: String, requestId: String): ChatReceipt? = null
        override suspend fun stop(token: String, sessionId: String) = error("reception never stops backend work")
    }

    private fun delivery(sessionId: String, seq: Long) = deliveryProjection(seq).copy(
        sessionId = sessionId,
        activity = RemoteActivity(status = 1, episodeId = "$sessionId/$seq", throughSeq = seq,
            completed = RemoteCompletedActivity("$sessionId/$seq", seq, seq, seq),
            delivery = RemoteActivityDelivery("$sessionId/$seq", seq)),
    )

    private inner class Harness {
        val store = Store()
        val platform = Platform()
        val chats = Chats()
    }

    private fun TestScope.receiver(harness: Harness, sessions: SessionBackend = Sessions()) =
        RemoteReceiveState(sessions, backgroundScope, { settle ->
            RemoteChatState(harness.chats, backgroundScope, harness.store, "https://fairy", settleReminders = settle)
        }, harness.platform, { harness.platform.enabled }, harness.store, "https://fairy")

    @Test fun `three staggered reconnects publish one merged reminder`() = runTest {
        val harness = Harness()
        val receiver = receiver(harness, Sessions(listOf("main", "other", "third")))
        receiver.bind("alice", 1); runCurrent()
        val main = harness.chats.updates.getValue("alice-main")
        val other = harness.chats.updates.getValue("alice-other")
        val third = harness.chats.updates.getValue("alice-third")
        // Each session reconnects on its own schedule. The first one to answer must not spend
        // the reminder before the others have said whether they owe anything: `syncing` alone
        // stayed false for a session that had not received its opening frame yet, so the old
        // aggregation published once per arriving session (three notifications, not one).
        main.emit(delivery("alice-main", 1)); runCurrent()
        assertTrue(
            "a session that has not answered yet still holds the merged reminder",
            harness.platform.alerts.isEmpty(),
        )
        other.emit(delivery("alice-other", 2)); runCurrent()
        assertTrue("the second arrival must not publish on its own", harness.platform.alerts.isEmpty())
        third.emit(delivery("alice-third", 3)); runCurrent()
        assertEquals(1, harness.platform.alerts.size)
        // The merge opens the account's primary session, which is also where it lands for the user.
        assertEquals("alice-main", harness.platform.alerts.single().first.sessionId)
        // Every session consumed its backlog, so nothing is replayed on the next attempt.
        for (id in listOf("main", "other", "third")) {
            assertFalse(harness.store.load(ChatSyncKey("https://fairy", 1, "alice-$id")).notificationOwed)
        }
        // The same episode seen again is not a second backlog.
        main.emit(delivery("alice-main", 1).copy(version = 2)); runCurrent()
        assertEquals(1, harness.platform.alerts.size)
    }

    @Test fun `a backlog the application already saw in front is consumed without a reminder`() = runTest {
        val harness = Harness()
        harness.platform.foreground = true
        val receiver = receiver(harness)
        receiver.bind("alice", 1); runCurrent()
        val main = harness.chats.updates.getValue("alice-main")
        main.emit(delivery("alice-main", 1)); runCurrent()
        assertTrue(harness.platform.alerts.isEmpty())
        assertFalse(harness.store.load(ChatSyncKey("https://fairy", 1, "alice-main")).notificationOwed)
        // Leaving the app later must not replay the episode it was present for.
        harness.platform.foreground = false
        receiver.stateForSession("alice-main")!!.retrySync(); runCurrent()
        assertTrue(harness.platform.alerts.isEmpty())
    }

    @Test fun `a reminder still owed by the record is published after the process restarts`() = runTest {
        val harness = Harness()
        val key = ChatSyncKey("https://fairy", 1, "alice-main")
        // The previous run claimed the episode and died before the panel: the record still owes it.
        harness.store.seed(key, ChatSyncRecord(0, true, notificationThrough = 1,
            notificationEpisodeId = "alice-main/1", notificationOwed = true))
        val receiver = receiver(harness)
        receiver.bind("alice", 1); runCurrent()
        harness.chats.updates.getValue("alice-main").emit(delivery("alice-main", 1)); runCurrent()
        assertEquals(listOf("alice-main"), harness.platform.alerts.map { it.first.sessionId })
        assertFalse(harness.store.load(key).notificationOwed)
    }

    /**
     * The ledger is the reminder's authority, not whichever runtime happens to be live.
     *
     * The session settles here holding a record that owes nothing, and only afterwards does the
     * ledger gain an owed episode — which is what a previous run, or any other writer, looks like
     * from this one. Walking the live runtimes would answer "nothing owed" from their cached copy
     * and the episode would be stranded; reading the ledger answers with what is actually owed.
     */
    @Test fun `debt the ledger records is settled even when the live runtime never saw it`() = runTest {
        val harness = Harness()
        val receiver = receiver(harness)
        receiver.bind("alice", 1); runCurrent()
        val key = ChatSyncKey("https://fairy", 1, "alice-main")
        // A quiet settlement: the session answers, and claims nothing, so its record owes nothing.
        harness.chats.updates.getValue("alice-main").emit(
            deliveryProjection(1).copy(sessionId = "alice-main", activity = RemoteActivity()),
        ); runCurrent()
        assertTrue("the quiet settlement owes nothing", harness.store.load(key).notificationOwed.not())
        assertTrue(harness.platform.alerts.isEmpty())

        // A record this run did not write: the episode was claimed before the process restarted.
        harness.store.seed(key, ChatSyncRecord(0, true, notificationThrough = 1,
            notificationEpisodeId = "alice-main/1", notificationOwed = true))
        // The account's list is what names the session keys, so asking it again is what makes the
        // debt discoverable. Nothing about the runtime changed, and nothing had to.
        receiver.owned.refresh(); runCurrent()

        assertEquals(1, harness.platform.alerts.size)
        assertEquals("alice-main", harness.platform.alerts.single().first.sessionId)
        assertEquals("Fairy 已完成本次活动", harness.platform.alerts.single().second)
        assertFalse("the settled debt is retired in the ledger", harness.store.load(key).notificationOwed)
    }

    /** Debt is read for the account's own session keys; a record outside them is not published. */
    @Test fun `a record for a session this account does not list is never published`() = runTest {
        val harness = Harness()
        harness.store.seed(ChatSyncKey("https://fairy", 1, "alice-archived"), ChatSyncRecord(0, true,
            notificationThrough = 1, notificationEpisodeId = "alice-archived/1", notificationOwed = true))
        val receiver = receiver(harness)
        receiver.bind("alice", 1); runCurrent()
        harness.chats.updates.getValue("alice-main").emit(
            deliveryProjection(1).copy(sessionId = "alice-main", activity = RemoteActivity()),
        ); runCurrent()
        receiver.owned.refresh(); runCurrent()

        assertTrue("a session outside the account's list has no reminder", harness.platform.alerts.isEmpty())
        assertTrue("and its record is left exactly as it was",
            harness.store.load(ChatSyncKey("https://fairy", 1, "alice-archived")).notificationOwed)
    }

    /**
     * A live runtime names the record it commits; reception does not rebuild the key from its own
     * fallback endpoint while that runtime exists. A mismatch must not hide the owed episode.
     */
    @Test fun `a live runtime's own key names its debt`() = runTest {
        val harness = Harness()
        val key = ChatSyncKey("https://elsewhere", 1, "alice-main")
        harness.store.seed(key, ChatSyncRecord(0, true, notificationThrough = 1,
            notificationEpisodeId = "alice-main/1", notificationOwed = true))
        val receiver = RemoteReceiveState(
            Sessions(), backgroundScope,
            { settle -> RemoteChatState(harness.chats, backgroundScope, harness.store, "https://elsewhere", settleReminders = settle) },
            harness.platform, { harness.platform.enabled }, harness.store, "https://fallback",
        )
        receiver.bind("alice", 1); runCurrent()
        harness.chats.updates.getValue("alice-main").emit(
            deliveryProjection(1).copy(sessionId = "alice-main", activity = RemoteActivity()),
        ); runCurrent()

        assertEquals(1, harness.platform.alerts.size)
        assertEquals("alice-main", harness.platform.alerts.single().first.sessionId)
        assertFalse("the runtime's record is retired", harness.store.load(key).notificationOwed)
        assertTrue("the fallback endpoint has no record to spend",
            harness.store.load(ChatSyncKey("https://fallback", 1, "alice-main")).notificationOwed.not())
    }

    /**
     * The no-runtime branch is reached the only way production can reach it: the session leaves
     * the list while its record is being read. Settlement still spends the ledger's debt and the
     * preview falls back because the runtime that could have supplied one is gone.
     */
    @Test fun `a session removed during the scan settles its debt without a runtime`() = runTest {
        val harness = Harness()
        // Other is read first, so main can leave the list before the scan reaches its record.
        val sessions = Sessions(listOf("other", "main"))
        val key = ChatSyncKey("https://fairy", 1, "alice-main")
        harness.store.seed(key, ChatSyncRecord(0, true, notificationThrough = 1,
            notificationEpisodeId = "alice-main/1", notificationOwed = true))
        val loadGate = CompletableDeferred<Unit>()
        var gateConsumed = false
        // Only the receiver's ledger read is gated; the runtime keeps using the same store directly,
        // so the scan can be suspended without freezing the session that is being observed.
        val gated = object : ChatSyncStore {
            override suspend fun load(key: ChatSyncKey): ChatSyncRecord {
                if (!gateConsumed) { gateConsumed = true; loadGate.await() }
                return harness.store.load(key)
            }
            override suspend fun save(key: ChatSyncKey, record: ChatSyncRecord) = harness.store.save(key, record)
        }
        val receiver = RemoteReceiveState(
            sessions, backgroundScope,
            { settle -> RemoteChatState(harness.chats, backgroundScope, harness.store, "https://fairy", settleReminders = settle) },
            harness.platform, { harness.platform.enabled }, gated, "https://fairy",
        )
        receiver.bind("alice", 1); runCurrent()
        harness.chats.updates.getValue("alice-main").emit(
            deliveryProjection(1).copy(sessionId = "alice-main", activity = RemoteActivity()),
        ); runCurrent()
        harness.chats.updates.getValue("alice-other").emit(
            deliveryProjection(1).copy(sessionId = "alice-other", activity = RemoteActivity()),
        ); runCurrent()
        assertTrue("the scan reached the ledger and is waiting on the first record", gateConsumed)
        assertTrue("nothing is published before the record is read", harness.platform.alerts.isEmpty())

        sessions.setIds(listOf("other"))
        receiver.owned.refresh(); runCurrent()
        loadGate.complete(Unit); runCurrent()

        assertEquals(1, harness.platform.alerts.size)
        assertEquals("alice-main", harness.platform.alerts.single().first.sessionId)
        assertEquals("Fairy 已完成本次活动", harness.platform.alerts.single().second)
        assertFalse("the ledger's debt is retired without a runtime", harness.store.load(key).notificationOwed)
    }

    /**
     * A stopped observation must not spend debt it is no longer allowed to publish.
     *
     * The ledger is readable whether or not reception is observing, so a list refresh after the
     * receiver stopped would otherwise retire an episode silently — the reminder would disappear
     * with no notification, and resuming would have nothing left to publish. The debt stays put
     * until observation resumes and a session answers; only then is it consumed and published.
     */
    @Test fun `a stopped observation leaves the ledger's debt for the resumed one`() = runTest {
        val harness = Harness()
        val key = ChatSyncKey("https://fairy", 1, "alice-main")
        harness.store.seed(key, ChatSyncRecord(0, true, notificationThrough = 1,
            notificationEpisodeId = "alice-main/1", notificationOwed = true))
        val receiver = receiver(harness)
        receiver.bind("alice", 1); runCurrent()
        receiver.stopObservation(); runCurrent()
        // Background reception being off only stops observing; it must not settle the backlog.
        receiver.owned.refresh(); runCurrent()
        assertTrue("a stopped observation publishes nothing", harness.platform.alerts.isEmpty())
        assertTrue("and does not spend the debt", harness.store.load(key).notificationOwed)

        receiver.resumeObservation(); runCurrent()
        harness.chats.updates.getValue("alice-main").emit(
            deliveryProjection(1).copy(sessionId = "alice-main", activity = RemoteActivity()),
        ); runCurrent()
        assertEquals(1, harness.platform.alerts.size)
        assertEquals("alice-main", harness.platform.alerts.single().first.sessionId)
        assertFalse("the resumed observation retires the debt", harness.store.load(key).notificationOwed)
    }

    @Test fun `the reminder preview is the newest output by seq, not the last position`() = runTest {
        val harness = Harness()
        val receiver = receiver(harness)
        receiver.bind("alice", 1); runCurrent()
        // Position is first appearance, so the newest output can sit before a row
        // that first appeared earlier and settled later. The preview names the
        // newest by seq.
        harness.chats.updates.getValue("alice-main").emit(
            delivery("alice-main", 9).copy(
                version = 2,
                messages = listOf(
                    RemoteChatMessage("delivery9", 0, 9, role = 2, status = 2, text = "delivered9"),
                    RemoteChatMessage("older", 1, 5, role = 2, status = 2, text = "delivered5"),
                ),
            ),
        ); runCurrent()

        assertEquals("delivered9", harness.platform.alerts.single().second)
    }

    @Test fun `a refused publication after consumption loses one sound and is not replayed`() = runTest {
        val harness = Harness()
        val receiver = receiver(harness)
        receiver.bind("alice", 1); runCurrent()
        val key = ChatSyncKey("https://fairy", 1, "alice-main")
        harness.platform.failNextPublish = true
        harness.chats.updates.getValue("alice-main").emit(delivery("alice-main", 1)); runCurrent()

        // The record was consumed before the attempt, which is exactly the trade: a crash or a
        // refusal here may miss this one sound, but must not replay it on the retry.
        assertEquals(1, harness.platform.publishAttempts)
        assertTrue(harness.platform.alerts.isEmpty())
        assertFalse(harness.store.load(key).notificationOwed)
        assertEquals("alice-main/1", harness.store.load(key).notificationEpisodeId)

        advanceUntilIdle()
        assertEquals(1, harness.platform.publishAttempts)
        assertTrue(harness.platform.alerts.isEmpty())
    }
}
