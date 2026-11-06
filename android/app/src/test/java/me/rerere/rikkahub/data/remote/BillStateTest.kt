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
 * What the bill page may claim while and after it reads.
 *
 * The fake backend is a scripted [BillBackend]: the assertions are about the
 * page's authority — that nothing is shown as a bill before a read succeeds, that
 * a failure is a failure rather than a bill of zeros, that a zero bill is a
 * loaded empty state, and that a retry is a second read.
 */
@OptIn(ExperimentalCoroutinesApi::class)
private class ScriptedBill(
    var read: suspend () -> Bill = { bill(today = 3000, allTime = 3000) },
) : BillBackend {
    var reads = 0

    override suspend fun read(token: String): Bill {
        reads += 1
        return read()
    }

    companion object {
        /** A bill whose whole spend is [today] tokens, with a matching 30-day series. */
        fun bill(today: Long, allTime: Long = today, days: Int = 30): Bill = Bill(
            today = BillTotal(BillTokens(inputTokens = today), denny = today / 3000.0),
            month = BillTotal(BillTokens(inputTokens = allTime), denny = allTime / 3000.0),
            allTime = BillTotal(BillTokens(inputTokens = allTime), denny = allTime / 3000.0),
            days = (0 until days).map { index ->
                BillDay(
                    day = "2026-10-${(index + 1).toString().padStart(2, '0')}",
                    tokens = BillTokens(inputTokens = if (index == days - 1) today else 0),
                    denny = if (index == days - 1) today / 3000.0 else 0.0,
                )
            },
        )
    }
}

class BillStateTest {

    @Test
    fun `a successful read publishes the bill and stops loading`() = runTest {
        val backend = ScriptedBill()
        val state = BillState(backend, this)

        state.load("token-abc")
        advanceUntilIdle()

        val snapshot = state.snapshot.value
        assertFalse(snapshot.loading)
        assertNull(snapshot.failure)
        assertEquals(3000L, snapshot.bill?.today?.tokens?.total)
        assertEquals("the wire's Denny is adopted, not recomputed", 1.0, snapshot.bill?.today?.denny ?: 0.0, 0.0001)
        assertEquals(30, snapshot.bill?.days?.size)
        assertEquals(1, backend.reads)
    }

    @Test
    fun `a failed read publishes no bill at all`() = runTest {
        // A page that kept a zero bill here would answer "nothing has been spent"
        // to a question that could not be answered — exactly what #322 forbids.
        val backend = ScriptedBill(read = { throw IdentityRefused(500, "bill/internal", "the bill failed to compute") })
        val state = BillState(backend, this)

        state.load("token-abc")
        advanceUntilIdle()

        val snapshot = state.snapshot.value
        assertNull("a failed aggregate is not a zero bill", snapshot.bill)
        assertFalse(snapshot.loading)
        assertEquals("bill/internal", snapshot.failure?.code)
        assertFalse(snapshot.failure?.unreachable ?: true)
    }

    @Test
    fun `a lost connection is reported as unreachable`() = runTest {
        val backend = ScriptedBill(read = { throw IdentityUnreachable(java.io.IOException("down")) })
        val state = BillState(backend, this)

        state.load("token-abc")
        advanceUntilIdle()

        assertNull(state.snapshot.value.bill)
        assertTrue(state.snapshot.value.failure?.unreachable == true)
    }

    @Test
    fun `a zero bill is a loaded empty state rather than a failure`() = runTest {
        val backend = ScriptedBill(read = { ScriptedBill.bill(today = 0, allTime = 0) })
        val state = BillState(backend, this)

        state.load("token-abc")
        advanceUntilIdle()

        val snapshot = state.snapshot.value
        assertNull("nothing was spent; that is not a failed read", snapshot.failure)
        assertTrue("the page can open and say so", snapshot.bill?.isEmpty == true)
        assertEquals(30, snapshot.bill?.days?.size)
    }

    @Test
    fun `a retry after a failure reads again and adopts the answer`() = runTest {
        val backend = ScriptedBill(read = { throw IdentityUnreachable(java.io.IOException("down")) })
        val state = BillState(backend, this)
        state.load("token-abc")
        advanceUntilIdle()
        assertNull(state.snapshot.value.bill)

        backend.read = { ScriptedBill.bill(today = 6000, allTime = 6000) }
        state.load("token-abc")
        advanceUntilIdle()

        assertEquals(2, backend.reads)
        assertEquals(6000L, state.snapshot.value.bill?.today?.tokens?.total)
        assertNull("a recovered read clears the failure it replaced", state.snapshot.value.failure)
    }

    @Test
    fun `a re-read is reported as loading while the last read stays readable`() = runTest {
        // A connection wobble re-reads: the page keeps what it last read under a
        // loading mark rather than blanking itself, and the mark clears when the
        // new answer lands.
        val backend = ScriptedBill()
        val state = BillState(backend, this)
        state.load("token-abc")
        advanceUntilIdle()

        state.load("token-abc")
        assertTrue("a running read is reported as loading", state.snapshot.value.loading)
        assertEquals("the last read stays readable while it runs", 3000L, state.snapshot.value.bill?.today?.tokens?.total)

        advanceUntilIdle()
        assertFalse(state.snapshot.value.loading)
        assertEquals(2, backend.reads)
    }
}
