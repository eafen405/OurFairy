package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.fail
import org.junit.Test

class ChatSyncStoreTest {
    private class Store : ChatSyncStore {
        private val records = mutableMapOf<ChatSyncKey, ChatSyncRecord>()
        override suspend fun load(key: ChatSyncKey) = records[key] ?: ChatSyncRecord()
        override suspend fun save(key: ChatSyncKey, record: ChatSyncRecord) { records[key] = record }
    }

    @Test fun `the durable record key has one canonical form`() {
        assertEquals(ChatSyncKey("https://fairy", 1, "s"), chatSyncKey("https://fairy/", 1, "s"))
        try {
            ChatSyncKey("https://fairy/", 1, "s")
            fail("an unnormalized endpoint must not build a second key shape")
        } catch (_: IllegalArgumentException) {
            // The constructor is the fence; chatSyncKey is the only normalizer.
        }
    }

    /**
     * The consume rule itself does not need a runtime: it reads the claimed episode from the
     * durable record and writes the retirement there. Runtime callers add their cache under the
     * same rule; the no-runtime caller is this ledger-only path.
     */
    @Test fun `the ledger retires a claimed episode without a live runtime`() = runTest {
        val store = Store()
        val key = chatSyncKey("https://fairy/", 1, "s")
        store.save(key, ChatSyncRecord(0, true, notificationThrough = 1,
            notificationEpisodeId = "s/1", notificationOwed = true))

        store.consumeReminder(key)

        val consumed = store.load(key)
        assertFalse(consumed.notificationOwed)
        assertEquals("s/1", consumed.notificationEpisodeId)
        // A second settlement of the same episode changes nothing and cannot replay it.
        assertEquals(consumed, store.consumeReminder(key))
    }
}
