package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/**
 * What the sessions page is currently showing.
 *
 * [selectedId] is this phone's own choice of which session the user is standing
 * in. It is not ownership and not history: it is a convenience pointer that the
 * backend is free to disagree with, and it is worthless without the credential
 * that fetched it.
 */
data class SessionsSnapshot(
    val sessions: List<OwnedSession> = emptyList(),
    val primarySessionId: String? = null,
    val selectedId: String? = null,
    /**
     * The session just archived while it was this snapshot's current one, or
     * null.
     *
     * This is the archive-follow rule's whole public answer: [OwnedSessionState.archive]
     * publishes the archived id only when the reader was standing in that session
     * and the archive was adopted; [selectedId] then names where the selection
     * moved (the account's main session). A page that is showing this very id
     * may follow [selectedId]; a target that was never listed, has expired, is
     * not this account's, or whose archive was refused publishes nothing here,
     * so it stays unavailable instead of being mistaken for an archive.
     *
     * It describes one archive, not a list read: an explicit selection move
     * (`bind`, `select`, `read`, `create`, `returnToPrimary`) or a later archive
     * releases it, while a refresh, a rename or a restore preserves it — the
     * archive is still the reader's last decision even if a title check happens
     * to re-read the list first.
     */
    val archivedSelectionId: String? = null,
    val loading: Boolean = false,
    val failure: String? = null,
) {
    companion object {
        /**
         * Marks "the backend could not be reached", which carries no message of
         * its own to show. The page renders it with the same localized
         * `identity_unreachable` text the sign-in pages already use, so the state
         * stays a plain value with no dependency on resources.
         */
        const val UNREACHABLE: String = "identity-unreachable"

        /**
         * The backend refused a title that has no visible characters once
         * normalized. Recognised by code so the drawer can word it in the
         * reader's language instead of showing the backend's English message.
         */
        const val EMPTY_TITLE: String = "sessions/empty-title"
    }
}

/**
 * The archived view: this account's archived sessions, as the backend listed
 * them, and nothing else.
 *
 * It is deliberately not a [SessionsSnapshot]. [RemoteReceiveState] treats the
 * visible list as the set of chats allowed to exist — every id it does not find
 * there is detached and the selection is repointed — so pointing that list at
 * archived rows would tear down the conversation the user is in and the
 * notification backlog the moment they browsed the archive. This flow is read
 * by the drawer alone, shares the credential and the request guard with the
 * default list, and never touches the receiver's visible set.
 *
 * There is no [primarySessionId] and no selection: the primary can never be
 * archived, so an archived row cannot be the standing default.
 */
data class ArchivedSessions(
    val sessions: List<OwnedSession> = emptyList(),
    val loading: Boolean = false,
    val failure: String? = null,
)

/** Which of the two lists an action belongs to; it decides where progress and refusals show. */
enum class SessionView { Default, Archived }

/**
 * The sessions one account is allowed to see, held only as long as that account
 * is the current one.
 *
 * The rule enforced here is the same one [AccountSession] enforces for the
 * account itself: a list that was asked for as Alice must never appear after the
 * app has become Bob's, even if Alice's answer was already on its way. So
 * [bind] retires every attempt made under the previous credential by moving an
 * epoch forward, and an answer is adopted only while its own epoch is still
 * current. Cancellation is not the guarantee — the bytes may already be on the
 * way — the epoch is.
 *
 * [snapshot] is the single authoritative view of this state and it is a
 * [StateFlow], so the page that renders it recomposes on its own; there is no
 * second copy and no polling. [RemoteReceiveState] republishes this very flow
 * rather than copying it. The archived view is [archived], a flow of its own for
 * the reason [ArchivedSessions] gives: it is a list the receiver must never bind.
 *
 * There is no second identity here: [bind] takes the credential it is allowed
 * to act as, and it takes no identity of its own to disagree with
 * [AccountSession].
 */
class OwnedSessionState(
    private val backend: SessionBackend,
    private val scope: CoroutineScope,
) {

    private val _snapshot = MutableStateFlow(SessionsSnapshot())

    /** The one authoritative snapshot; the page collects this and nothing else. */
    val snapshot: StateFlow<SessionsSnapshot> = _snapshot.asStateFlow()

    private val _archived = MutableStateFlow(ArchivedSessions())

    /**
     * The archived view, a flow of its own.
     *
     * Only the drawer reads it. It is never the list [RemoteReceiveState] binds,
     * because that list is the set of chats allowed to exist (see
     * [ArchivedSessions]).
     */
    val archived: StateFlow<ArchivedSessions> = _archived.asStateFlow()

    /**
     * Retired by every [bind], so an answer asked for under a previous
     * credential is recognisable when it lands. Read and written only on the
     * scope's own dispatcher, which is why no lock is needed.
     */
    private var epoch = 0L
    private var bound: String? = null

    /**
     * Attach the credential this state may act as, discarding whatever the
     * previous one was allowed to see.
     *
     * Called whenever the account changes — a new sign-in, a sign-out, a restore
     * that lands on a different identity — so both lists and the selection are
     * gone the instant the account is, not when the next list happens to arrive.
     */
    fun bind(credential: String?) {
        if (credential == bound) return
        bound = credential
        epoch += 1
        _snapshot.value = SessionsSnapshot()
        _archived.value = ArchivedSessions()
    }

    fun refresh() = request { token, current ->
        val listed = backend.list(token)
        current.copy(
            sessions = listed.sessions,
            primarySessionId = listed.primarySessionId ?: current.primarySessionId,
            // A selection this account's own list does not contain is not a
            // selection it may keep; main is the standing default.
            selectedId = current.selectedId?.takeIf { chosen ->
                listed.sessions.any { owned -> owned.id == chosen }
            } ?: listed.primarySessionId,
        )
    }

    fun create() = request { token, current ->
        current.joined(backend.create(token), stand = true)
    }

    fun select(sessionId: String) = request { token, current ->
        current.joined(backend.select(token, sessionId), stand = true)
    }

    /** Return to the account's permanent main session. */
    fun returnToPrimary() = request { token, current ->
        current.joined(backend.primary(token), stand = true)
    }

    fun read(sessionId: String) = request { token, current ->
        current.joined(backend.read(token, sessionId), stand = true)
    }

    /**
     * Rename one session.
     *
     * The backend answers with the very row the list would return, so that row
     * is folded here instead of a second list read: the drawer and the
     * conversation's title bar show the title the list would show, and one tap
     * costs one request. [stand] is false — renaming a session does not move the
     * user into it.
     */
    fun rename(sessionId: String, title: String) = request { token, current ->
        current.joined(backend.rename(token, sessionId, title), stand = false)
    }

    /**
     * Archive one session — the product's delete.
     *
     * The backend keeps the log and messages; the session leaves the default
     * list, so this snapshot drops the row by the same rule the backend applied.
     * A selection that was standing in the archived session moves to the
     * account's main session, because the row it named is gone, and that move is
     * published as [SessionsSnapshot.archivedSelectionId] — the explicit fact a
     * page follows. Archiving any other session publishes no follow: the reader
     * keeps standing where they were. The primary session never reaches here:
     * the drawer has no delete entry for it and the backend refuses it, which
     * this method leaves as the backend answered.
     */
    fun archive(sessionId: String) = request { token, current ->
        val standing = current.selectedId ?: current.primarySessionId
        val archived = backend.archive(token, sessionId)
        val next = current.selectedId?.takeIf { it != archived.id } ?: current.primarySessionId
        current.copy(
            sessions = current.sessions.filterNot { it.id == archived.id },
            selectedId = next,
            // Only an adopted archive of the session the reader was standing in
            // is a follow, and only when it moved the selection somewhere else.
            archivedSelectionId = archived.id.takeIf { standing == archived.id && next != archived.id },
        )
    }

    /**
     * Fold one session the backend named into the snapshot.
     *
     * A session the backend has just named is one this account owns, so it joins
     * the list even when no list has arrived yet — that is what makes a first
     * create or a first return-to-main show up instead of leaving the page
     * looking empty. [stand] marks it as the session the user is now in, and
     * main is recorded only the first time one is seen: an ordinary create or
     * choice must not move the account's permanent main.
     */
    private fun SessionsSnapshot.joined(named: OwnedSession, stand: Boolean) = copy(
        sessions = if (sessions.any { it.id == named.id }) {
            sessions.map { if (it.id == named.id) named else it }
        } else {
            sessions + named
        },
        primarySessionId = primarySessionId ?: named.id.takeIf { named.primary },
        selectedId = if (stand) named.id else selectedId,
        // A session the reader moved into is an explicit decision that
        // supersedes the archive follow. A rename or a restore names a row
        // without moving the reader, so it leaves the follow in place.
        archivedSelectionId = if (stand) null else archivedSelectionId,
    )

    /**
     * Read the archived view.
     *
     * One list read against the same path and the same credential, asking the
     * backend's other question. It fills [archived] and nothing else: the
     * default list — the one the receiver binds — is not touched, so browsing
     * the archive cannot disturb the open conversation or its backlog.
     */
    fun refreshArchived() = act(SessionView.Archived, { token -> backend.list(token, archived = true) }) { listed ->
        _archived.value = _archived.value.copy(sessions = listed.sessions)
    }

    /**
     * Restore one archived session.
     *
     * The backend answers the very row the default list would return, so it is
     * folded there instead of a second list read, and the same answer is what
     * takes the row out of the archived view. Both land under one epoch check,
     * so a sign-out in flight adopts neither. [stand] is false — restoring a
     * session does not move the user into it.
     */
    fun restore(sessionId: String) = act(SessionView.Archived, { token -> backend.restore(token, sessionId) }) { restored ->
        _archived.value = _archived.value.copy(
            sessions = _archived.value.sessions.filterNot { it.id == restored.id },
        )
        _snapshot.value = _snapshot.value.joined(restored, stand = false)
    }

    /**
     * Run one request as the currently bound account, if there still is one.
     *
     * The answer is folded into the snapshot at the moment it lands rather than
     * when it was asked for, so the page always shows the newest settled state.
     *
     * [view] names the flow whose progress and refusal the reader sees: an action
     * taken in the archived view reports there and never flickers the default
     * list. One action at a time across both views: a button that is disabled by
     * `loading` can still be tapped again before the page has recomposed, so the
     * guard is also checked here, where it cannot be raced. [bind] installs fresh
     * snapshots, so a new account is never blocked by a request that belonged to
     * the previous one.
     */
    private fun <A> act(view: SessionView, operation: suspend (String) -> A, adopt: (A) -> Unit) {
        val token = bound ?: return
        if (_snapshot.value.loading || _archived.value.loading) return
        val started = epoch
        if (view == SessionView.Default) {
            _snapshot.value = _snapshot.value.copy(loading = true, failure = null)
        } else {
            _archived.value = _archived.value.copy(loading = true, failure = null)
        }
        scope.launch {
            val answered = try {
                operation(token)
            } catch (refused: IdentityRefused) {
                if (started == epoch) settle(view, refused.described())
                return@launch
            } catch (unreachable: IdentityUnreachable) {
                // Being unable to reach the backend is still something to say:
                // clearing the loading flag alone left the page looking as if
                // the tap had done nothing at all.
                if (started == epoch) settle(view, SessionsSnapshot.UNREACHABLE)
                return@launch
            }
            if (started == epoch) {
                adopt(answered)
                settle(view, null)
            }
        }
    }

    private fun request(operation: suspend (String, SessionsSnapshot) -> SessionsSnapshot) =
        act(SessionView.Default, { token -> operation(token, _snapshot.value) }) { next ->
            _snapshot.value = next
        }

    private fun settle(view: SessionView, failure: String?) {
        if (view == SessionView.Default) {
            _snapshot.value = _snapshot.value.copy(loading = false, failure = failure)
        } else {
            _archived.value = _archived.value.copy(loading = false, failure = failure)
        }
    }

    /**
     * What the page shows for one refusal: the backend's own message, except the
     * one it has no reader-facing text for. That code is passed through so the
     * drawer can word it, exactly as [SessionsSnapshot.UNREACHABLE] is.
     */
    private fun IdentityRefused.described(): String =
        if (code == SessionsSnapshot.EMPTY_TITLE) SessionsSnapshot.EMPTY_TITLE else message ?: code
}
