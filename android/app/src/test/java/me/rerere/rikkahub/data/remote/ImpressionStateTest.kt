package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the impression page may claim while it reads and writes.
 *
 * The fake backend is a scripted [ImpressionBackend]: the assertions are about
 * the page's authority — that no impression exists before a successful read,
 * that a refusal keeps the backend's own code and leaves the last read body
 * visible, and that an accepted write is followed by a fresh read rather than
 * by trusting the sent text.
 */
@OptIn(ExperimentalCoroutinesApi::class)
private class ScriptedImpression(
    var read: suspend () -> Impression = { Impression(content = "服务端正文", updatedAt = 7, maxCharacters = 8000) },
    var edit: suspend (String) -> Unit = {},
) : ImpressionBackend {
    val edits = mutableListOf<String>()
    var reads = 0

    override suspend fun read(token: String): Impression {
        reads += 1
        return read()
    }

    override suspend fun edit(token: String, content: String) {
        edits += content
        edit(content)
    }
}

class ImpressionStateTest {

    @Test
    fun `a read publishes the backend's impression and opens editing`() = runTest {
        val backend = ScriptedImpression(read = { Impression("本人印象", updatedAt = 11, maxCharacters = 8000) })
        val state = ImpressionState(backend, this)

        state.load("token-abc")
        advanceUntilIdle()

        val snapshot = state.snapshot.value
        assertFalse(snapshot.loading)
        assertNull(snapshot.failure)
        assertEquals("本人印象", snapshot.impression?.content)
        assertEquals(11L, snapshot.impression?.updatedAt)
        assertEquals(8000, snapshot.impression?.maxCharacters)
    }

    @Test
    fun `a failed read leaves no impression to edit`() = runTest {
        val backend = ScriptedImpression(read = { throw IdentityUnreachable(java.io.IOException("down")) })
        val state = ImpressionState(backend, this)

        state.load("token-abc")
        advanceUntilIdle()

        assertNull("an unread impression must not become an empty editable one", state.snapshot.value.impression)
        assertTrue(state.snapshot.value.failure?.unreachable == true)
    }

    @Test
    fun `a refused save keeps the read body and the backend's own code`() = runTest {
        val backend = ScriptedImpression(
            edit = { throw IdentityRefused(400, "impression/too-long", "the impression is 8001 Unicode characters; the limit is 8000") },
        )
        val state = ImpressionState(backend, this)
        state.load("token-abc")
        advanceUntilIdle()

        state.save("token-abc", "海".repeat(8001))
        advanceUntilIdle()

        val snapshot = state.snapshot.value
        assertEquals("a refused write never replaces what was read", "服务端正文", snapshot.impression?.content)
        assertEquals("impression/too-long", snapshot.failure?.code)
        assertTrue(snapshot.failure?.message.orEmpty().contains("8001"))
        assertEquals(1, backend.edits.size)
        assertEquals("the whole draft reached the backend; it was not clipped here", "海".repeat(8001), backend.edits.single())
    }

    @Test
    fun `an accepted save is followed by a fresh read`() = runTest {
        var current = Impression("旧的整份正文", updatedAt = 7, maxCharacters = 8000)
        val backend = ScriptedImpression(
            read = { current },
            edit = { content -> current = Impression(content, updatedAt = 8, maxCharacters = 8000) },
        )
        val state = ImpressionState(backend, this)
        state.load("token-abc")
        advanceUntilIdle()

        state.save("token-abc", "新的整份正文")
        advanceUntilIdle()

        assertEquals(listOf("新的整份正文"), backend.edits)
        assertEquals("the page shows what the backend stored", "新的整份正文", state.snapshot.value.impression?.content)
        assertEquals(8L, state.snapshot.value.impression?.updatedAt)
        assertEquals("one initial read plus one read-back", 2, backend.reads)
        assertNull(state.snapshot.value.failure)
    }
}
