package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

/**
 * One account owns each session runtime. The page shares these instances with reception.
 *
 * [owned] is the account's list and the actions on it, and it is the very state this receiver
 * binds and watches — the page drives it directly, and there is no copy here that a collector
 * could lag behind. Whose list it is is decided by [bind], which the identity publisher calls in
 * the turn it publishes the account (see [bindIdentity]) — the previous account's list and chats
 * are retired before a collector can observe the new identity.
 *
 * Reception also owns the reminder: a session records the episode it owes in its own durable
 * record, and this module sees every session, so a backlog is published as one reminder rather
 * than one per session.
 */
class RemoteReceiveState(
    backend: SessionBackend,
    private val scope: CoroutineScope,
    private val chatFactory: (settleReminders: Boolean) -> RemoteChatState,
    private val notifications: RemoteNotificationPlatform? = null,
    private val notificationsEnabled: () -> Boolean = { true },
    /**
     * The durable ledger the reminder is read from and consumed in.
     *
     * Reception discovers debt here by the account's session keys rather than by asking each live
     * runtime what it holds, so whether a reminder can be settled no longer depends on that
     * session's runtime existing. Required whenever [notifications] is set: a receiver that
     * publishes reminders without the ledger could only publish by walking runtimes again.
     */
    private val ledger: ChatSyncStore? = null,
    /** The endpoint the ledger keys are scoped by; must be the one the sessions were built with. */
    private val endpoint: String? = null,
) {
    init {
        require(notifications == null || (ledger != null && endpoint != null)) {
            "接收发布提醒时必须提供持久记录（ledger）与其 endpoint"
        }
    }

    /**
     * The account's own session list and the actions on it.
     *
     * Exposed as the very state [bind] binds and this receiver watches, so the page that renders
     * and drives it acts on the same instance reception does; there is no receiver-level copy of
     * its list or of its five requests.
     */
    val owned: OwnedSessionState = OwnedSessionState(backend, scope)

    private val mutableSelected = MutableStateFlow<RemoteChatState?>(null)

    /** The observable pointer to the selected runtime; [bind] retires it with the list. */
    val selectedChat: StateFlow<RemoteChatState?> = mutableSelected.asStateFlow()

    private val mutableRuntimes = MutableStateFlow<Map<String, RemoteChatState>>(emptyMap())

    /**
     * The runtime each listed session has, as a map a page can follow.
     *
     * [stateForSession] answers the same question for one id in one read; this flow is what makes
     * that answer observable, so a page that presents a session can re-read it when the runtime
     * appears or is retired instead of depending on which collector the list happened to notify
     * first. It is keyed by session id because that is how a page names what it presents. Each
     * value belongs to that one session: the interaction module and the pages read only the
     * session they are presenting, and nothing here derives an account-level activity summary.
     */
    val runtimes: StateFlow<Map<String, RemoteChatState>> = mutableRuntimes.asStateFlow()
    private var token: String? = null
    private var userShortId: Int? = null
    private var epoch = 0L
    private var observing = true
    private var publishing: Job? = null
    private var titleRefresh: Job? = null
    private var titleDirty = false

    init {
        scope.launch {
            owned.snapshot.collect { listed ->
                val allowed = listed.sessions.map { it.id }.toSet()
                val removed = mutableRuntimes.value.keys.filter { it !in allowed }
                removed.forEach { id ->
                    val gone = mutableRuntimes.value[id]
                    mutableRuntimes.value = mutableRuntimes.value - id
                    gone?.detach()
                }
                if (token != null && userShortId != null) {
                    listed.sessions.forEach { session ->
                        val chat = mutableRuntimes.value[session.id]
                            ?: chatFactory(notifications != null).also {
                                mutableRuntimes.value = mutableRuntimes.value + (session.id to it)
                            }
                        if (observing) chat.bind(token, session.id, userShortId)
                        chat.onSettled(::publishBacklog)
                        chat.onTitle(::refreshTitles)
                    }
                }
                mutableSelected.value = mutableRuntimes.value[listed.selectedId]
                // The list is what names the account's session keys, so it is also the first
                // moment debt that a previous run recorded becomes discoverable. A backlog owed
                // by sessions that have not answered yet is held by the catch-up gate below.
                if (removed.isNotEmpty() || listed.sessions.isNotEmpty()) publishBacklog()
            }
        }
    }

    /**
     * Take up the identity that was just published, or drop the previous one.
     *
     * The publisher calls this synchronously with the identity it carries (null on sign-out), so
     * [OwnedSessionState.bind] has already retired every answer asked for under the previous
     * credential before the new identity can be collected.
     */
    fun bindIdentity(identity: SignedIn?) = bind(identity?.token, identity?.user?.shortId)

    fun bind(token: String?, userShortId: Int?) {
        if (token == this.token && userShortId == this.userShortId) return
        epoch++
        titleRefresh?.cancel()
        titleRefresh = null
        titleDirty = false
        mutableRuntimes.value.values.forEach { it.detach() }
        mutableRuntimes.value = emptyMap()
        mutableSelected.value = null
        this.token = token
        this.userShortId = userShortId
        owned.bind(token)
        if (token != null && userShortId != null) owned.refresh()
    }

    private fun refreshTitles(sessionId: String, title: String) {
        val listed = owned.snapshot.value.session(sessionId) ?: return
        if (listed.title == title) return
        titleDirty = true
        if (titleRefresh?.isActive == true) return
        titleRefresh = scope.launch {
            while (titleDirty) {
                titleDirty = false
                val idle = kotlinx.coroutines.withTimeoutOrNull(30_000) {
                    owned.snapshot.first { !it.loading }
                    owned.archived.first { !it.loading }
                }
                if (idle == null) return@launch
                owned.refresh()
                kotlinx.coroutines.withTimeoutOrNull(30_000) {
                    owned.snapshot.first { !it.loading }
                }
            }
        }
    }

    fun stateForSession(sessionId: String): RemoteChatState? = mutableRuntimes.value[sessionId]

    /**
     * Stop one listed session's reply and wait for the backend to accept it.
     *
     * The drawer acts on rows it may not have selected, so this is keyed by the
     * row's own id rather than by whatever session is currently open. A session
     * with no runtime, or one that is idle, makes this a no-op — the backend's
     * stop is itself a no-op when nothing is running.
     */
    suspend fun stopReply(sessionId: String) {
        mutableRuntimes.value[sessionId]?.stopReply()
    }

    /** Open a route target through the account's authenticated session read. */
    suspend fun openSession(sessionId: String): Boolean {
        if (token == null || userShortId == null) return false
        val started = epoch
        owned.snapshot.first { !it.loading }
        if (epoch != started) return false
        owned.read(sessionId)
        val settled = owned.snapshot.first { !it.loading }
        return epoch == started && settled.failure == null && settled.selectedId == sessionId
    }

    fun stopObservation() {
        observing = false
        mutableRuntimes.value.values.forEach { it.detach() }
    }

    fun resumeObservation() {
        observing = true
        mutableRuntimes.value.forEach { (sessionId, chat) -> chat.bind(token, sessionId, userShortId) }
    }

    /**
     * Publish only once no observed session is still catching up: a session mid-recovery has not
     * said whether it owes anything, so publishing earlier would spend the reminder on whichever
     * sessions answered first — one reminder per arriving session. A session whose attempt failed
     * has answered too: it owes nothing on that connection, so it stops holding the backlog and a
     * permanently unreachable session cannot keep another session's reminder waiting.
     *
     * The debt itself is read from the ledger by the account's session keys. A live runtime is
     * asked only what it observed — never whether anything is owed — so a debt written by a
     * previous run cannot hide behind a runtime's cached copy, and the preview does not require
     * that runtime to have existed when the debt was recorded.
     *
     * The catch-up gate still names the live runtimes because reception creates one for every
     * listed session before it can publish. If a later optimization releases runtimes, it must
     * replace this gate with the listed-session answer first: an absent session has not answered.
     */
    private fun publishBacklog() {
        val platform = notifications ?: return
        val ledger = ledger ?: return
        val endpoint = endpoint ?: return
        // Observation is the only state in which settlement may spend a reminder. A list refresh
        // can arrive after observation stopped (background reception off), and reading the ledger
        // then would retire debt the stopped receiver is not allowed to publish.
        if (!observing) return
        if (publishing?.isActive == true) return
        if (mutableRuntimes.value.values.any { it.snapshot.value.isCatchingUp }) return
        val started = epoch
        val account = userShortId ?: return
        publishing = scope.launch {
            try {
                val owed = owedRecords(ledger, endpoint, account)
                // Ask again after the awaited disk work: the account, the observation and the app
                // may have moved while the records were read.
                if (owed.isEmpty() || started != epoch || !observing) return@launch
                // Consumed before the attempt: a crash here may miss the sound, but cannot replay it.
                owed.forEach { consume(it) }
                if (started != epoch || !observing || !notificationsEnabled() || platform.isForeground()) return@launch
                // One reminder for the account's whole backlog. It opens the primary session when
                // that one owes something, so a merge still lands where the user reads.
                val primary = owned.snapshot.value.primarySessionId
                val target = owed.minWithOrNull(compareBy({ it.key.sessionId != primary }, { it.key.sessionId }))
                    ?: return@launch
                platform.publish(target.key, target.preview)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                // The records were consumed before the attempt, so this attempt's sound is lost
                // rather than replayed; the retry only publishes what a later settlement owes.
                scope.launch { delay(RETRY_MILLIS); publishBacklog() }
            } finally {
                publishing = null
            }
        }
    }

    /**
     * The account's session keys that the ledger says owe a reminder.
     *
     * The listed sessions are the keys: reception already treats that list as the set of sessions
     * allowed to exist. The preview is this observation's newest Fairy output when a runtime has
     * one, and the generic fallback otherwise — a process that restarted has no projection to read
     * and must not have to persist a second copy of the body to say something useful.
     */
    private suspend fun owedRecords(ledger: ChatSyncStore, endpoint: String, account: Int): List<Owed> =
        owned.snapshot.value.sessions.mapNotNull { session ->
            val key = chatSyncKey(endpoint, account, session.id)
            val record = ledger.load(key)
            // The episode identity only answers "is anything owed"; session ids stay opaque.
            if (record.notificationEpisodeId == null || !record.notificationOwed) return@mapNotNull null
            val preview = mutableRuntimes.value[session.id]?.snapshot?.value?.projection?.messages
                ?.newestFairyOutput(record.consumedThrough)?.text
                ?.take(160)?.ifBlank { null } ?: GENERIC_PREVIEW
            Owed(key, preview)
        }

    /**
     * Retire the debt through the session's own runtime when it has one, so the write lands under
     * the lock that runtime commits records with; otherwise use the same store rule directly,
     * where no runtime exists to race.
     */
    private suspend fun consume(owed: Owed) {
        val chat = mutableRuntimes.value[owed.key.sessionId]
        if (chat != null) {
            chat.consumeReminder(owed.key)
            return
        }
        val ledger = ledger ?: return
        ledger.consumeReminder(owed.key)
    }

    private class Owed(val key: ChatSyncKey, val preview: String)

    private companion object {
        const val RETRY_MILLIS = 1_000L

        /** What a reminder says when no observation of this run has a body to quote. */
        const val GENERIC_PREVIEW = "Fairy 已完成本次活动"
    }
}
