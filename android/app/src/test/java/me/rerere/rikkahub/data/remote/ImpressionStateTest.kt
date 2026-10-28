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
 * What the impression page may claim while it reads.
 *
 * The fake backend is a scripted [ImpressionBackend]: the assertions are about
 * the page's authority — that no impression exists before a successful read,
 * that a failed or refused read publishes the backend's own failure and no
 * impression, and that a retry reads again.
 */
@OptIn(ExperimentalCoroutinesApi::class)
private class ScriptedImpression(
    var read: suspend () -> Impression = { Impression(content = "服务端正文", updatedAt = 7, maxCharacters = 8000) },
) : ImpressionBackend {
    var reads = 0

    override suspend fun read(token: String): Impression {
        reads += 1
        return read()
    }
}

class ImpressionStateTest {

    @Test
    fun `a read publishes the backend's impression`() = runTest {
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
    fun `a failed read leaves no impression to show`() = runTest {
        val backend = ScriptedImpression(read = { throw IdentityUnreachable(java.io.IOException("down")) })
        val state = ImpressionState(backend, this)

        state.load("token-abc")
        advanceUntilIdle()

        assertNull("an unread impression must not become an empty one", state.snapshot.value.impression)
        assertTrue(state.snapshot.value.failure?.unreachable == true)
    }

    @Test
    fun `a refused read keeps the backend's own code and shows no impression`() = runTest {
        val backend = ScriptedImpression(
            read = { throw IdentityRefused(401, "impression/unauthorized", "present a live session credential") },
        )
        val state = ImpressionState(backend, this)

        state.load("token-abc")
        advanceUntilIdle()

        val snapshot = state.snapshot.value
        assertEquals("impression/unauthorized", snapshot.failure?.code)
        assertEquals("present a live session credential", snapshot.failure?.message)
        assertNull(snapshot.impression)
        assertFalse(snapshot.loading)
    }

    @Test
    fun `a retry reads again`() = runTest {
        var attempts = 0
        val backend = ScriptedImpression(
            read = {
                attempts += 1
                if (attempts == 1) throw IdentityUnreachable(java.io.IOException("down"))
                Impression("读到的整份印象", updatedAt = 12, maxCharacters = 8000)
            },
        )
        val state = ImpressionState(backend, this)

        state.load("token-abc")
        advanceUntilIdle()
        assertNull(state.snapshot.value.impression)

        state.load("token-abc")
        advanceUntilIdle()

        assertEquals(2, backend.reads)
        assertEquals("读到的整份印象", state.snapshot.value.impression?.content)
        assertNull(state.snapshot.value.failure)
    }
}
