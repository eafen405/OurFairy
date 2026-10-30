package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.withContext
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A backend that answers only when the test says so, and that deliberately
 * ignores cancellation.
 *
 * Ignoring cancellation is the honest half of the double. Cancelling a request
 * whose answer has already left the backend is something the phone cannot
 * actually do — the bytes are on their way regardless — so a fake that stops
 * cooperating on cancellation would let a cancelled-but-already-arrived answer
 * slip through untested. Here the answer always arrives, and only the generation
 * check can stop it from being applied.
 */
@OptIn(ExperimentalCoroutinesApi::class)
private class DeferredBackend : SessionBackend {

    val gate = CompletableDeferred<Unit>()
    val seenTokens = mutableListOf<String>()

    override suspend fun list(token: String, archived: Boolean): OwnedSessions {
        await(token)
        return OwnedSessions(
            sessions = listOf(OwnedSession(id = "s-$token", owner = "user:$token", primary = true)),
            primarySessionId = "s-$token",
        )
    }

    override suspend fun create(token: String): OwnedSession {
        await(token)
        // A first session is the account's main, which is exactly the case that
        // must show up on the page without waiting for a list.
        return OwnedSession(id = "new-$token", owner = "user:$token", primary = true)
    }

    override suspend fun select(token: String, sessionId: String): OwnedSession {
        await(token)
        return OwnedSession(id = sessionId, owner = "user:$token")
    }

    override suspend fun primary(token: String): OwnedSession {
        await(token)
        return OwnedSession(id = "s-$token", owner = "user:$token", primary = true)
    }

    override suspend fun read(token: String, sessionId: String): OwnedSession {
        await(token)
        return OwnedSession(id = sessionId, owner = "user:$token")
    }

    override suspend fun rename(token: String, sessionId: String, title: String): OwnedSession {
        await(token)
        return OwnedSession(
            id = sessionId,
            owner = "user:$token",
            title = title,
            titleSource = OwnedSessionTitleSource.USER,
        )
    }

    override suspend fun archive(token: String, sessionId: String): OwnedSession {
        await(token)
        return OwnedSession(id = sessionId, owner = "user:$token")
    }

    override suspend fun restore(token: String, sessionId: String): OwnedSession {
        await(token)
        return OwnedSession(id = sessionId, owner = "user:$token")
    }

    private suspend fun await(token: String) {
        seenTokens += token
        withContext(NonCancellable) { gate.await() }
    }
}

@OptIn(ExperimentalCoroutinesApi::class)
class OwnedSessionStateTest {

    @Test
    fun `the list shows what the backend said`() = runTest {
        val backend = DeferredBackend()
        val state = OwnedSessionState(backend, this)
        backend.gate.complete(Unit)

        state.bind("alice")
        state.refresh()
        advanceUntilIdle()

        assertEquals(listOf("s-alice"), state.snapshot.value.sessions.map { it.id })
        assertEquals("s-alice", state.snapshot.value.primarySessionId)
    }

    @Test
    fun `a snapshot names the row an id points at`() {
        val snapshot = SessionsSnapshot(
            sessions = listOf(
                OwnedSession(id = "main", primary = true),
                OwnedSession(id = "other", title = "另一个会话"),
            ),
            selectedId = "other",
        )

        assertEquals("另一个会话", snapshot.session("other")?.displayTitle)
        assertEquals("main", snapshot.session("main")?.id)
        assertNull(snapshot.session("missing"))
        assertNull(snapshot.session(null))
    }

    @Test
    fun `choosing a session shows that one as the current session`() = runTest {
        val backend = DeferredBackend()
        val state = OwnedSessionState(backend, this)
        backend.gate.complete(Unit)

        state.bind("alice")
        state.select("s-2")
        advanceUntilIdle()

        assertEquals("s-2", state.snapshot.value.selectedId)
    }

    @Test
    fun `returning to the main session does not change which one the account owns`() = runTest {
        val backend = DeferredBackend()
        val state = OwnedSessionState(backend, this)
        backend.gate.complete(Unit)

        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        state.select("s-2")
        advanceUntilIdle()

        state.returnToPrimary()
        advanceUntilIdle()

        assertEquals("s-alice", state.snapshot.value.primarySessionId)
        assertEquals("s-alice", state.snapshot.value.selectedId)
    }

    @Test
    fun `a list that arrives after the account changed is not shown to the new account`() = runTest {
        val backend = DeferredBackend()
        val state = OwnedSessionState(backend, this)

        state.bind("alice")
        state.refresh()
        advanceUntilIdle()

        // Alice is signed out and Bob signs in while Alice's list is still in
        // flight. The page is empty at once…
        state.bind("bob")
        assertEquals(emptyList<OwnedSession>(), state.snapshot.value.sessions)
        assertNull(state.snapshot.value.selectedId)

        // …and Alice's answer, which the backend sends anyway, changes nothing.
        backend.gate.complete(Unit)
        advanceUntilIdle()

        assertEquals(emptyList<OwnedSession>(), state.snapshot.value.sessions)
        assertNull(state.snapshot.value.primarySessionId)
        assertNull(state.snapshot.value.selectedId)
    }

    @Test
    fun `a selection made as one account is gone once another signs in`() = runTest {
        val backend = DeferredBackend()
        val state = OwnedSessionState(backend, this)
        backend.gate.complete(Unit)

        state.bind("alice")
        state.select("s-secret")
        advanceUntilIdle()
        assertEquals("s-secret", state.snapshot.value.selectedId)

        state.bind("bob")
        state.refresh()
        advanceUntilIdle()

        // Alice's choice is gone: Bob stands in his own main, and nothing of
        // hers is left anywhere on the page.
        assertEquals("s-bob", state.snapshot.value.selectedId)
        assertEquals(listOf("s-bob"), state.snapshot.value.sessions.map { it.id })
        assertTrue("s-secret" !in state.snapshot.value.sessions.map { it.id })
    }

    @Test
    fun `signing out empties the page and refuses to ask for anything`() = runTest {
        val backend = DeferredBackend()
        val state = OwnedSessionState(backend, this)
        backend.gate.complete(Unit)

        state.bind("alice")
        state.refresh()
        advanceUntilIdle()

        state.bind(null)
        state.refresh()
        state.create()
        advanceUntilIdle()

        assertEquals(emptyList<OwnedSession>(), state.snapshot.value.sessions)
        assertNull(state.snapshot.value.selectedId)
        // One credential, used as itself: nothing was ever asked for as a user.
        assertEquals(listOf("alice"), backend.seenTokens)
    }

    @Test
    fun `a selection the account's own list does not contain is not kept`() = runTest {
        val backend = DeferredBackend()
        val state = OwnedSessionState(backend, this)
        backend.gate.complete(Unit)

        state.bind("alice")
        state.select("s-elsewhere")
        advanceUntilIdle()

        state.refresh()
        advanceUntilIdle()

        assertTrue("s-elsewhere" !in state.snapshot.value.sessions.map { it.id })
        assertEquals("s-alice", state.snapshot.value.selectedId)
    }

    @Test
    fun `a first create shows the new session and records the account's first main`() = runTest {
        val backend = DeferredBackend()
        val state = OwnedSessionState(backend, this)
        backend.gate.complete(Unit)

        state.bind("alice")
        state.create()
        advanceUntilIdle()

        assertEquals(listOf("new-alice"), state.snapshot.value.sessions.map { it.id })
        assertEquals("new-alice", state.snapshot.value.primarySessionId)
        assertEquals("new-alice", state.snapshot.value.selectedId)
    }

    @Test
    fun `returning to a main the page never listed shows it and stands in it`() = runTest {
        val backend = DeferredBackend()
        val state = OwnedSessionState(backend, this)
        backend.gate.complete(Unit)

        state.bind("alice")
        state.returnToPrimary()
        advanceUntilIdle()

        assertEquals(listOf("s-alice"), state.snapshot.value.sessions.map { it.id })
        assertEquals("s-alice", state.snapshot.value.primarySessionId)
        assertEquals("s-alice", state.snapshot.value.selectedId)
    }

    @Test
    fun `an ordinary choice leaves the account's main where it was`() = runTest {
        val backend = DeferredBackend()
        val state = OwnedSessionState(backend, this)
        backend.gate.complete(Unit)

        state.bind("alice")
        state.returnToPrimary()
        advanceUntilIdle()
        state.create()
        advanceUntilIdle()

        assertEquals("s-alice", state.snapshot.value.primarySessionId)
        assertEquals("new-alice", state.snapshot.value.selectedId)
        assertEquals(listOf("s-alice", "new-alice"), state.snapshot.value.sessions.map { it.id })
    }

    @Test
    fun `create that returns a listed empty session neither adds a row nor moves main`() = runTest {
        val listed = OwnedSession(id = "s-alice", owner = "user:alice", primary = true)
        val empty = OwnedSession(id = "s-empty", owner = "user:alice")
        val backend = object : SessionBackend {
            override suspend fun list(token: String, archived: Boolean) = OwnedSessions(listOf(listed, empty), "s-alice")
            override suspend fun create(token: String) = empty
            override suspend fun select(token: String, sessionId: String) = empty
            override suspend fun primary(token: String) = listed
            override suspend fun read(token: String, sessionId: String) = empty
            override suspend fun rename(token: String, sessionId: String, title: String) = error("not used")
            override suspend fun archive(token: String, sessionId: String) = empty
            override suspend fun restore(token: String, sessionId: String) = error("not used")
        }
        val state = OwnedSessionState(backend, this)

        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        assertEquals(listOf("s-alice", "s-empty"), state.snapshot.value.sessions.map { it.id })

        // #220: the backend answers create with the empty session it already
        // listed, so the page must stand in it without a second row.
        state.create()
        advanceUntilIdle()
        assertEquals(listOf("s-alice", "s-empty"), state.snapshot.value.sessions.map { it.id })
        assertEquals("s-empty", state.snapshot.value.selectedId)
        assertEquals("s-alice", state.snapshot.value.primarySessionId)
    }

    @Test
    fun `a rename shows the row the backend answered without moving the selection`() = runTest {
        val backend = DeferredBackend()
        val state = OwnedSessionState(backend, this)
        backend.gate.complete(Unit)

        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        val selected = state.snapshot.value.selectedId

        // The answer is the row the list would return; the page adopts it as the
        // one source, so the drawer and the title bar cannot disagree.
        state.rename("s-alice", "我的会话")
        advanceUntilIdle()

        val row = state.snapshot.value.sessions.single()
        assertEquals("我的会话", row.title)
        assertEquals(OwnedSessionTitleSource.USER, row.titleSource)
        assertEquals(selected, state.snapshot.value.selectedId)
        assertEquals(null, state.snapshot.value.failure)
    }

    @Test
    fun `an empty title keeps its own code so the drawer can word it`() = runTest {
        val backend = object : SessionBackend {
            override suspend fun list(token: String, archived: Boolean) = OwnedSessions(emptyList(), null)
            override suspend fun create(token: String) = error("not used")
            override suspend fun select(token: String, sessionId: String) = error("not used")
            override suspend fun primary(token: String) = error("not used")
            override suspend fun read(token: String, sessionId: String) = error("not used")
            override suspend fun rename(token: String, sessionId: String, title: String): OwnedSession =
                throw IdentityRefused(
                    status = 400,
                    code = SessionsSnapshot.EMPTY_TITLE,
                    message = "the title has no visible characters once normalized",
                )
            override suspend fun archive(token: String, sessionId: String) = error("not used")
            override suspend fun restore(token: String, sessionId: String) = error("not used")
        }
        val state = OwnedSessionState(backend, this)

        state.bind("alice")
        state.rename("s-alice", "  ")
        advanceUntilIdle()

        // Not the backend's English message: the code is the one refusal the page
        // words itself, exactly as it words an unreachable backend.
        assertEquals(SessionsSnapshot.EMPTY_TITLE, state.snapshot.value.failure)
        assertEquals(false, state.snapshot.value.loading)
    }

    @Test
    fun `archiving drops the row and moves a selection standing in it to main`() = runTest {
        val main = OwnedSession(id = "s-alice", owner = "user:alice", primary = true)
        val other = OwnedSession(id = "s-other", owner = "user:alice")
        val backend = object : SessionBackend {
            override suspend fun list(token: String, archived: Boolean) = OwnedSessions(listOf(main, other), main.id)
            override suspend fun create(token: String) = error("not used")
            override suspend fun select(token: String, sessionId: String) = other
            override suspend fun primary(token: String) = main
            override suspend fun read(token: String, sessionId: String) = other
            override suspend fun archive(token: String, sessionId: String) = other
            override suspend fun restore(token: String, sessionId: String) = error("not used")
            override suspend fun rename(token: String, sessionId: String, title: String) = error("not used")
        }
        val state = OwnedSessionState(backend, this)
        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        state.select("s-other")
        advanceUntilIdle()
        assertEquals("s-other", state.snapshot.value.selectedId)

        state.archive("s-other")
        advanceUntilIdle()

        assertEquals(listOf("s-alice"), state.snapshot.value.sessions.map { it.id })
        assertEquals("s-alice", state.snapshot.value.selectedId)
        assertEquals("s-alice", state.snapshot.value.primarySessionId)
        // The archive names the session the reader was standing in, and the page
        // follows that explicit fact rather than comparing the list itself.
        assertEquals("s-other", state.snapshot.value.archivedSelectionId)
    }

    @Test
    fun `a refused archive leaves the list and the selection untouched`() = runTest {
        val main = OwnedSession(id = "s-alice", owner = "user:alice", primary = true)
        val other = OwnedSession(id = "s-other", owner = "user:alice")
        val backend = object : SessionBackend {
            override suspend fun list(token: String, archived: Boolean) = OwnedSessions(listOf(main, other), main.id)
            override suspend fun create(token: String) = error("not used")
            override suspend fun select(token: String, sessionId: String) = other
            override suspend fun primary(token: String) = main
            override suspend fun read(token: String, sessionId: String) = other
            override suspend fun archive(token: String, sessionId: String): OwnedSession =
                throw IdentityRefused(409, "sessions/primary-not-archivable", "the primary session is never archived")
            override suspend fun restore(token: String, sessionId: String) = error("not used")
            override suspend fun rename(token: String, sessionId: String, title: String) = error("not used")
        }
        val state = OwnedSessionState(backend, this)
        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        state.select("s-other")
        advanceUntilIdle()

        state.archive("s-alice")
        advanceUntilIdle()

        assertEquals(listOf("s-alice", "s-other"), state.snapshot.value.sessions.map { it.id })
        assertEquals("s-other", state.snapshot.value.selectedId)
        assertEquals("the primary session is never archived", state.snapshot.value.failure)
        // A refusal is not an archive: nothing to follow.
        assertNull(state.snapshot.value.archivedSelectionId)
    }

    @Test
    fun `archiving a session the reader is not standing in is not a follow`() = runTest {
        val main = OwnedSession(id = "s-alice", owner = "user:alice", primary = true)
        val other = OwnedSession(id = "s-other", owner = "user:alice")
        val third = OwnedSession(id = "s-third", owner = "user:alice")
        val state = OwnedSessionState(RowsBackend(listOf(main, other, third), main.id), this)
        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        state.select("s-other")
        advanceUntilIdle()

        state.archive("s-third")
        advanceUntilIdle()

        // The reader keeps standing where they were; the row that left was not
        // the one the page is in, so there is nothing for a page to follow.
        assertEquals(listOf("s-alice", "s-other"), state.snapshot.value.sessions.map { it.id })
        assertEquals("s-other", state.snapshot.value.selectedId)
        assertNull(state.snapshot.value.archivedSelectionId)
    }

    @Test
    fun `a read, a create, a choice or a return to main after an archive clears the follow`() = runTest {
        val main = OwnedSession(id = "s-alice", owner = "user:alice", primary = true)
        val other = OwnedSession(id = "s-other", owner = "user:alice")
        val third = OwnedSession(id = "s-third", owner = "user:alice")
        val fourth = OwnedSession(id = "s-fourth", owner = "user:alice")
        val backend = RowsBackend(listOf(main, other, third, fourth), main.id)
        backend.created = OwnedSession(id = "s-new", owner = "user:alice")
        val state = OwnedSessionState(backend, this)
        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        state.select("s-other")
        advanceUntilIdle()

        state.archive("s-other")
        advanceUntilIdle()
        assertEquals("s-other", state.snapshot.value.archivedSelectionId)

        state.read("s-third")
        advanceUntilIdle()
        assertNull(state.snapshot.value.archivedSelectionId)
        assertEquals("s-third", state.snapshot.value.selectedId)

        state.archive("s-third")
        advanceUntilIdle()
        assertEquals("s-third", state.snapshot.value.archivedSelectionId)

        // Creating stands in the new session, which is an explicit decision that
        // supersedes the archive's move to main.
        state.create()
        advanceUntilIdle()
        assertNull(state.snapshot.value.archivedSelectionId)
        assertEquals("s-new", state.snapshot.value.selectedId)

        state.select("s-fourth")
        advanceUntilIdle()
        state.archive("s-fourth")
        advanceUntilIdle()
        assertEquals("s-fourth", state.snapshot.value.archivedSelectionId)

        state.returnToPrimary()
        advanceUntilIdle()
        assertNull(state.snapshot.value.archivedSelectionId)
        assertEquals("s-alice", state.snapshot.value.selectedId)
    }

    @Test
    fun `the page that followed consumes the archive fact`() = runTest {
        val main = OwnedSession(id = "s-alice", owner = "user:alice", primary = true)
        val other = OwnedSession(id = "s-other", owner = "user:alice")
        val state = OwnedSessionState(RowsBackend(listOf(main, other), main.id), this)
        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        state.select("s-other")
        advanceUntilIdle()
        state.archive("s-other")
        advanceUntilIdle()
        assertEquals("s-other", state.snapshot.value.archivedSelectionId)

        state.clearArchiveFollow()

        // The page acted on the one archive; the fact is not a latch that a later
        // restore or list read could still answer to.
        assertNull(state.snapshot.value.archivedSelectionId)
        assertEquals("s-alice", state.snapshot.value.selectedId)
        assertEquals(listOf("s-alice"), state.snapshot.value.sessions.map { it.id })
        assertEquals("s-alice", state.snapshot.value.primarySessionId)
    }

    @Test
    fun `restoring the session the follow names clears it`() = runTest {
        val main = OwnedSession(id = "s-alice", owner = "user:alice", primary = true)
        val other = OwnedSession(id = "s-other", owner = "user:alice")
        val state = OwnedSessionState(RowsBackend(listOf(main, other), main.id), this)
        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        state.select("s-other")
        advanceUntilIdle()
        state.archive("s-other")
        advanceUntilIdle()
        assertEquals("s-other", state.snapshot.value.archivedSelectionId)

        state.restore("s-other")
        advanceUntilIdle()

        // The row is back in the default list: it is no longer an archived move a
        // page should follow. The selection still does not move into it.
        assertNull(state.snapshot.value.archivedSelectionId)
        assertEquals("s-alice", state.snapshot.value.selectedId)
        assertEquals(listOf("s-alice", "s-other"), state.snapshot.value.sessions.map { it.id })
    }

    @Test
    fun `restoring another session keeps the archive follow`() = runTest {
        val main = OwnedSession(id = "s-alice", owner = "user:alice", primary = true)
        val other = OwnedSession(id = "s-other", owner = "user:alice")
        val old = OwnedSession(id = "s-old", owner = "user:alice", title = "旧会话")
        val state = OwnedSessionState(RowsBackend(listOf(main, other), main.id, archived = listOf(old)), this)
        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        state.select("s-other")
        advanceUntilIdle()
        state.archive("s-other")
        advanceUntilIdle()
        assertEquals("s-other", state.snapshot.value.archivedSelectionId)

        state.restore("s-old")
        advanceUntilIdle()

        // A different row coming back does not touch the archive the page is
        // still following.
        assertEquals("s-other", state.snapshot.value.archivedSelectionId)
        assertEquals(listOf("s-alice", "s-old"), state.snapshot.value.sessions.map { it.id })
    }

    @Test
    fun `binding another account clears the archive follow`() = runTest {
        val main = OwnedSession(id = "s-alice", owner = "user:alice", primary = true)
        val other = OwnedSession(id = "s-other", owner = "user:alice")
        val state = OwnedSessionState(RowsBackend(listOf(main, other), main.id), this)
        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        state.select("s-other")
        advanceUntilIdle()
        state.archive("s-other")
        advanceUntilIdle()
        assertEquals("s-other", state.snapshot.value.archivedSelectionId)

        state.bind("bob")

        assertNull(state.snapshot.value.archivedSelectionId)
        assertNull(state.snapshot.value.selectedId)
        assertEquals(emptyList<OwnedSession>(), state.snapshot.value.sessions)
    }

    @Test
    fun `a refresh or a rename after the archive keeps the follow until the page moves`() = runTest {
        val main = OwnedSession(id = "s-alice", owner = "user:alice", primary = true)
        val other = OwnedSession(id = "s-other", owner = "user:alice")
        val state = OwnedSessionState(RowsBackend(listOf(main, other), main.id), this)
        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        state.select("s-other")
        advanceUntilIdle()
        state.archive("s-other")
        advanceUntilIdle()
        assertEquals("s-other", state.snapshot.value.archivedSelectionId)

        // A title refresh can re-read the list between the archive and the page
        // observing it. That is not the reader moving: the follow stays.
        state.refresh()
        advanceUntilIdle()
        assertEquals("s-other", state.snapshot.value.archivedSelectionId)
        assertEquals("s-alice", state.snapshot.value.selectedId)

        // Naming a row does not move the reader either.
        state.rename("s-alice", "主会话")
        advanceUntilIdle()
        assertEquals("s-other", state.snapshot.value.archivedSelectionId)
        assertEquals("s-alice", state.snapshot.value.selectedId)
    }

    /** A backend whose list is the rows it still owns, answering each action by id. */
    private class RowsBackend(
        initial: List<OwnedSession>,
        private val mainId: String,
        archived: List<OwnedSession> = emptyList(),
    ) : SessionBackend {
        private var rows = initial
        private val archivedRows = archived.toMutableList()
        var refusedArchive: IdentityRefused? = null

        /** The row [create] answers and adds; null keeps create unused. */
        var created: OwnedSession? = null

        override suspend fun list(token: String, archived: Boolean) =
            if (archived) OwnedSessions(archivedRows.toList(), null) else OwnedSessions(rows, mainId)

        override suspend fun create(token: String): OwnedSession {
            val row = created ?: error("not used")
            rows = rows + row
            return row
        }
        override suspend fun select(token: String, sessionId: String) = read(token, sessionId)
        override suspend fun primary(token: String) = rows.first { it.id == mainId }
        override suspend fun read(token: String, sessionId: String) =
            (rows + archivedRows).first { it.id == sessionId }

        override suspend fun rename(token: String, sessionId: String, title: String): OwnedSession {
            val renamed = (rows + archivedRows).first { it.id == sessionId }
                .copy(title = title, titleSource = OwnedSessionTitleSource.USER)
            rows = rows.map { if (it.id == sessionId) renamed else it }
            val archived = archivedRows.indexOfFirst { it.id == sessionId }
            if (archived >= 0) archivedRows[archived] = renamed
            return renamed
        }

        override suspend fun archive(token: String, sessionId: String): OwnedSession {
            refusedArchive?.let { throw it }
            val row = rows.first { it.id == sessionId }
            rows = rows.filterNot { it.id == sessionId }
            archivedRows += row
            return row
        }

        override suspend fun restore(token: String, sessionId: String): OwnedSession {
            val row = archivedRows.first { it.id == sessionId }
            archivedRows.removeAll { it.id == sessionId }
            rows = rows + row
            return row
        }
    }

    /** A backend whose two views answer different rows, as the real one does. */
    private class TwoViewBackend(
        private val main: OwnedSession,
        private val active: List<OwnedSession>,
        private val archivedRows: List<OwnedSession>,
    ) : SessionBackend {
        var restores = 0
        var archivedRefused: IdentityRefused? = null
        var restoreRefused: IdentityRefused? = null
        val archivedQuestions = mutableListOf<Boolean>()

        override suspend fun list(token: String, archived: Boolean): OwnedSessions {
            archivedQuestions += archived
            return if (archived) {
                OwnedSessions(archivedRows, null)
            } else {
                OwnedSessions(active, main.id)
            }
        }

        override suspend fun create(token: String) = error("not used")
        override suspend fun select(token: String, sessionId: String) = error("not used")
        override suspend fun primary(token: String) = main
        override suspend fun read(token: String, sessionId: String) = archivedRows.first { it.id == sessionId }
        override suspend fun rename(token: String, sessionId: String, title: String) = error("not used")
        override suspend fun archive(token: String, sessionId: String) = error("not used")

        override suspend fun restore(token: String, sessionId: String): OwnedSession {
            restores += 1
            restoreRefused?.let { throw it }
            return archivedRows.first { it.id == sessionId }
        }
    }

    @Test
    fun `the archived view is a list of its own and leaves the default list alone`() = runTest {
        val main = OwnedSession(id = "s-alice", owner = "user:alice", primary = true)
        val other = OwnedSession(id = "s-other", owner = "user:alice")
        val old = OwnedSession(id = "s-old", owner = "user:alice", title = "旧会话")
        val backend = TwoViewBackend(main, listOf(main, other), listOf(old))
        val state = OwnedSessionState(backend, this)

        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        state.refreshArchived()
        advanceUntilIdle()

        // Browsing the archive is one more list read, and the default list — the
        // set the receiver treats as the chats allowed to exist — is untouched.
        assertEquals(listOf("s-alice", "s-other"), state.snapshot.value.sessions.map { it.id })
        assertEquals("s-alice", state.snapshot.value.selectedId)
        assertEquals(listOf("s-old"), state.archived.value.sessions.map { it.id })
        assertEquals(listOf(false, true), backend.archivedQuestions)
        assertEquals(false, state.archived.value.loading)
    }

    @Test
    fun `restoring takes the row out of the archived view and back into the default list`() = runTest {
        val main = OwnedSession(id = "s-alice", owner = "user:alice", primary = true)
        val other = OwnedSession(id = "s-other", owner = "user:alice")
        val old = OwnedSession(id = "s-old", owner = "user:alice", title = "旧会话")
        val backend = TwoViewBackend(main, listOf(main, other), listOf(old))
        val state = OwnedSessionState(backend, this)

        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        state.refreshArchived()
        advanceUntilIdle()
        assertEquals(listOf("s-old"), state.archived.value.sessions.map { it.id })

        state.restore("s-old")
        advanceUntilIdle()

        // One request, and the answer is the row the list would return: it is
        // folded into the default list instead of a second list read.
        assertEquals(1, backend.restores)
        assertEquals(emptyList<String>(), state.archived.value.sessions.map { it.id })
        assertEquals(listOf("s-alice", "s-other", "s-old"), state.snapshot.value.sessions.map { it.id })
        assertEquals("旧会话", state.snapshot.value.sessions.last().title)
        // Restoring does not move the user into the session they restored.
        assertEquals("s-alice", state.snapshot.value.selectedId)
        assertEquals(false, state.archived.value.loading)
    }

    @Test
    fun `a refused restore leaves both views untouched and keeps the backend's code`() = runTest {
        val main = OwnedSession(id = "s-alice", owner = "user:alice", primary = true)
        val other = OwnedSession(id = "s-other", owner = "user:alice")
        val old = OwnedSession(id = "s-old", owner = "user:alice", title = "旧会话")
        val backend = TwoViewBackend(main, listOf(main, other), listOf(old))
        backend.restoreRefused = IdentityRefused(409, "sessions/not-archived", "that session is not in your archive")
        val state = OwnedSessionState(backend, this)

        state.bind("alice")
        state.refresh()
        advanceUntilIdle()
        state.refreshArchived()
        advanceUntilIdle()

        state.restore("s-old")
        advanceUntilIdle()

        assertEquals(listOf("s-old"), state.archived.value.sessions.map { it.id })
        assertEquals(listOf("s-alice", "s-other"), state.snapshot.value.sessions.map { it.id })
        // The refusal is said where the action was taken, not on the other list.
        // A refusal reads as the backend's own message, exactly as the archive
        // refusal above does; the code is only the fallback when none was sent.
        assertEquals("that session is not in your archive", state.archived.value.failure)
        assertNull(state.snapshot.value.failure)
        assertEquals(false, state.archived.value.loading)
    }

    @Test
    fun `an archived view asked for as one account is never shown to the next`() = runTest {
        val gate = CompletableDeferred<Unit>()
        val backend = object : SessionBackend {
            override suspend fun list(token: String, archived: Boolean): OwnedSessions {
                withContext(NonCancellable) { gate.await() }
                return OwnedSessions(
                    listOf(OwnedSession(id = "old-$token", owner = "user:$token", title = "旧会话")),
                    null,
                )
            }
            override suspend fun create(token: String) = error("not used")
            override suspend fun select(token: String, sessionId: String) = error("not used")
            override suspend fun primary(token: String) = error("not used")
            override suspend fun read(token: String, sessionId: String) = error("not used")
            override suspend fun rename(token: String, sessionId: String, title: String) = error("not used")
            override suspend fun archive(token: String, sessionId: String) = error("not used")
            override suspend fun restore(token: String, sessionId: String) = error("not used")
        }
        val state = OwnedSessionState(backend, this)

        state.bind("alice")
        state.refreshArchived()
        advanceUntilIdle()

        // Bob signs in while Alice's archived list is still on its way.
        state.bind("bob")
        assertEquals(emptyList<OwnedSession>(), state.archived.value.sessions)
        gate.complete(Unit)
        advanceUntilIdle()

        assertEquals(emptyList<OwnedSession>(), state.archived.value.sessions)
    }
}
