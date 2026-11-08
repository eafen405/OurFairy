package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The page stand-in for the shared machine: a payload, a failure, and two busy marks. The machine
 * may replace the failure and the marks; it may never know what the payload means.
 */
private data class TestSnapshot(
    val loading: Boolean = false,
    val working: Boolean = false,
    val payload: String? = null,
    override val failure: RemoteFailure? = null,
) : RemotePageState<TestSnapshot> {
    override fun settled(failure: RemoteFailure?, reading: Boolean?, writing: Boolean?) = copy(
        loading = reading ?: loading,
        working = writing ?: working,
        failure = failure,
    )
}

/**
 * The one machine every remote page runs on: one lane, a read that publishes the page's own
 * snapshot, an accepted write followed by a fresh read rather than by trusting the echo, and a
 * refusal that keeps the last read payload next to the backend's own code.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class RemoteResourceTest {

    @Test
    fun `a read publishes the page's own snapshot`() = runTest {
        val resource = RemoteResource(this, TestSnapshot(), read = { token -> TestSnapshot(payload = "read $token") })

        resource.load("token-abc")
        advanceUntilIdle()

        assertEquals("read token-abc", resource.snapshot.value.payload)
        assertFalse(resource.snapshot.value.loading)
        assertNull(resource.snapshot.value.failure)
    }

    @Test
    fun `load marks the page busy before its read is launched`() = runTest {
        val held = CompletableDeferred<TestSnapshot>()
        val resource = RemoteResource(this, TestSnapshot(), read = { held.await() })

        resource.load("token-abc")

        assertTrue("the loading mark is set before the launch, not inside the lane", resource.snapshot.value.loading)

        held.complete(TestSnapshot(payload = "read"))
        advanceUntilIdle()

        assertFalse(resource.snapshot.value.loading)
        assertEquals("read", resource.snapshot.value.payload)
    }

    @Test
    fun `a re-read keeps the payload visible while it reads`() = runTest {
        var read: suspend (String) -> TestSnapshot = { TestSnapshot(payload = "first") }
        val resource = RemoteResource(this, TestSnapshot(), read = { read(it) })
        resource.load("token-abc")
        advanceUntilIdle()

        val held = CompletableDeferred<TestSnapshot>()
        read = { held.await() }
        resource.load("token-abc")

        assertEquals("the page keeps what it last read while reading again", "first", resource.snapshot.value.payload)

        held.complete(TestSnapshot(payload = "second"))
        advanceUntilIdle()
        assertEquals("second", resource.snapshot.value.payload)
    }

    @Test
    fun `one write at a time`() = runTest {
        val first = CompletableDeferred<Unit>()
        val entered = mutableListOf<String>()
        val resource = RemoteResource(this, TestSnapshot(), read = { TestSnapshot(payload = "fresh") })
        resource.load("token-abc")
        advanceUntilIdle()

        resource.write("token-abc") {
            entered += "first"
            first.await()
        }
        resource.write("token-abc") { entered += "second" }
        advanceUntilIdle()

        assertEquals("one write at a time", listOf("first"), entered)

        first.complete(Unit)
        advanceUntilIdle()
        assertEquals(listOf("first", "second"), entered)
    }

    @Test
    fun `an accepted write is followed by a fresh read, not by its own answer`() = runTest {
        var reads = 0
        var workingWhileWriting = false
        val resource = RemoteResource(this, TestSnapshot(), read = {
            reads += 1
            TestSnapshot(payload = "read $reads")
        })
        resource.load("token-abc")
        advanceUntilIdle()

        var accepted: String? = null
        resource.write("token-abc", onAccepted = { accepted = it }) {
            workingWhileWriting = resource.snapshot.value.working
            "the write's own answer"
        }
        advanceUntilIdle()

        assertEquals("the caller sees the accepted answer", "the write's own answer", accepted)
        assertTrue("the working mark is set before the operation runs", workingWhileWriting)
        assertEquals("the write is followed by a fresh read", 2, reads)
        assertEquals("the fresh read, not the echo, is what the page shows", "read 2", resource.snapshot.value.payload)
        assertFalse(resource.snapshot.value.working)
        assertNull(resource.snapshot.value.failure)
    }

    @Test
    fun `a refused write keeps the payload and the backend's code without re-reading`() = runTest {
        var reads = 0
        var accepted = false
        val resource = RemoteResource(this, TestSnapshot(), read = {
            reads += 1
            TestSnapshot(payload = "last read")
        })
        resource.load("token-abc")
        advanceUntilIdle()

        resource.write<Unit>("token-abc", onAccepted = { accepted = true }) {
            throw IdentityRefused(409, "skills/archived", "skill \"alpha\" is archived")
        }
        advanceUntilIdle()

        val snapshot = resource.snapshot.value
        assertEquals("last read", snapshot.payload)
        assertEquals("skills/archived", snapshot.failure?.code)
        assertEquals("skill \"alpha\" is archived", snapshot.failure?.message)
        assertFalse("a refusal is not an accepted write", accepted)
        assertEquals("a refused write does not re-read", 1, reads)
        assertFalse(snapshot.working)
    }

    @Test
    fun `an unreachable write becomes an unreachable failure and keeps the payload`() = runTest {
        val resource = RemoteResource(this, TestSnapshot(), read = { TestSnapshot(payload = "last read") })
        resource.load("token-abc")
        advanceUntilIdle()

        resource.write<Unit>("token-abc") { throw IdentityUnreachable(java.io.IOException("down")) }
        advanceUntilIdle()

        val snapshot = resource.snapshot.value
        assertEquals("last read", snapshot.payload)
        assertTrue(snapshot.failure?.unreachable == true)
        assertEquals("an unreachable failure has no code of its own", "", snapshot.failure?.code)
        assertFalse(snapshot.working)
    }

    @Test
    fun `an accepted write still reports itself when the fresh read fails`() = runTest {
        var reads = 0
        val resource = RemoteResource(this, TestSnapshot(), read = {
            reads += 1
            if (reads == 1) TestSnapshot(payload = "before") else throw IdentityUnreachable(java.io.IOException("gone"))
        })
        resource.load("token-abc")
        advanceUntilIdle()

        var accepted: String? = null
        resource.write("token-abc", onAccepted = { accepted = it }) { "stored" }
        advanceUntilIdle()

        assertEquals("the backend stored the write, so the caller hears about it", "stored", accepted)
        assertEquals(2, reads)
        assertEquals("a failed re-read is a reporting problem, not a lost payload", "before", resource.snapshot.value.payload)
        assertTrue(resource.snapshot.value.failure?.unreachable == true)
        assertFalse(resource.snapshot.value.working)
    }

    @Test
    fun `perform hands the answer to the caller and does not re-read`() = runTest {
        var reads = 0
        val resource = RemoteResource(this, TestSnapshot(), read = {
            reads += 1
            TestSnapshot(payload = "pool")
        })
        resource.load("token-abc")
        advanceUntilIdle()

        var opened: String? = null
        resource.perform(onAccepted = { opened = it }) { "session-1" }
        advanceUntilIdle()

        assertEquals("session-1", opened)
        assertEquals("the answer is the caller's, so this write does not re-read", 1, reads)
        assertEquals("pool", resource.snapshot.value.payload)
        assertFalse(resource.snapshot.value.working)
        assertNull(resource.snapshot.value.failure)
    }

    @Test
    fun `a refused perform keeps the payload and reports the code`() = runTest {
        var reads = 0
        val resource = RemoteResource(this, TestSnapshot(), read = {
            reads += 1
            TestSnapshot(payload = "pool")
        })
        resource.load("token-abc")
        advanceUntilIdle()

        var accepted = false
        resource.perform<Unit>(onAccepted = { accepted = true }) {
            throw IdentityRefused(404, "skills/not-found", "skill version 41 is not visible to this user")
        }
        advanceUntilIdle()

        assertFalse("a refusal is not an accepted write", accepted)
        assertEquals("skills/not-found", resource.snapshot.value.failure?.code)
        assertEquals("pool", resource.snapshot.value.payload)
        assertEquals("a refused perform does not re-read", 1, reads)
        assertFalse(resource.snapshot.value.working)
    }

    @Test
    fun `a cancelled read is not reported as a failure`() = runTest {
        var attempts = 0
        val resource = RemoteResource(this, TestSnapshot(), read = {
            attempts += 1
            if (attempts == 1) throw CancellationException("cancelled") else TestSnapshot(payload = "second attempt")
        })

        resource.load("token-abc")
        advanceUntilIdle()

        assertNull("cancellation is not a reporting failure", resource.snapshot.value.failure)

        resource.load("token-abc")
        advanceUntilIdle()

        assertEquals("the lane is usable after a cancellation", "second attempt", resource.snapshot.value.payload)
    }
}
