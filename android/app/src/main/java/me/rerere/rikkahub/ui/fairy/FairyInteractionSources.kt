package me.rerere.rikkahub.ui.fairy

import me.rerere.rikkahub.data.remote.RemoteChatSnapshot
import me.rerere.rikkahub.data.remote.RemoteReceiveState
import me.rerere.rikkahub.data.remote.SessionsSnapshot
import me.rerere.rikkahub.data.remote.newestFairyOutput

/**
 * 当前会话: the session the reader last chose, or the account's main session when they have not
 * chosen one.
 *
 * Home reads this and presents that session's own runtime. It is deliberately not
 * `RemoteReceiveState.selectedChat`: that pointer is `runtimes[selectedId]` with no fallback, so
 * home reading it would present nothing under an account whose reader has not chosen a session
 * yet. The conversation page presents the id it was routed with instead.
 */
internal fun SessionsSnapshot.currentSessionId(): String? = selectedId ?: primarySessionId

/**
 * The facts of one session's runtime as they are right now, or null when that runtime does not
 * exist yet or currently describes another session.
 *
 * This is the one read the page host uses when a page returns to the foreground (and the one a
 * page would use for any out-of-composition read): the same session check as the composition,
 * without trusting a stale composition. The session id is the only key; the runtime itself and
 * its snapshot stay the authority.
 */
internal fun RemoteReceiveState.factsForSession(sessionId: String?): FairyRemoteFacts? {
    val runtime = sessionId?.let(::stateForSession) ?: return null
    return runtime.snapshot.value.takeIf { it.sessionId == sessionId }?.fairyFacts()
}

/**
 * Read one session's [RemoteChatSnapshot] as the facts Fairy 互动 answers 当前表现 and reactions
 * from.
 *
 * `activity` is the snapshot's own getter, which is where "is this established?" is answered: a
 * session that is not connected and initialised, or whose committed prefix does not cover the
 * frame's cursor, answers unknown there. Copying that answer is the whole of the trust rule on
 * this side — the module never inspects raw events, so it cannot turn unknown into quiet.
 *
 * The newest Fairy output is the largest Fairy `seq`, not the last transcript row: position only
 * orders presentation. Delivery and completion are copied from the same activity answer; the
 * module decides not to react while that answer is unknown. None of these keys names the projection
 * generation: a generation replay carries the same message and episode, and the module's seen keys
 * are what keep it one event.
 */
internal fun RemoteChatSnapshot.fairyFacts(): FairyRemoteFacts {
    val activity = activity
    return FairyRemoteFacts(
        connected = connected,
        connecting = connecting,
        activityStatus = activity.status,
        activityReasons = activity.reasons,
        transcript = projection?.let { FairyTranscript(it.messages.size, it.attempt?.text) },
        outputSeq = projection?.messages?.newestFairyOutput()?.seq,
        delivery = activity.delivery?.let { FairyDelivery(it.episodeId, it.seq) },
        completed = activity.completed?.let { FairyCompletion(it.episodeId, it.finishedSeq) },
    )
}
