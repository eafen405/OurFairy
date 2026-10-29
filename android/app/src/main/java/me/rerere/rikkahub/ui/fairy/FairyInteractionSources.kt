package me.rerere.rikkahub.ui.fairy

import me.rerere.rikkahub.data.remote.RemoteChatSnapshot
import me.rerere.rikkahub.data.remote.SessionsSnapshot

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
 * Read one session's [RemoteChatSnapshot] as the facts Fairy 互动 answers 当前表现 from.
 *
 * `activity` is the snapshot's own getter, which is where "is this established?" is answered: a
 * session that is not connected and initialised, or whose committed prefix does not cover the
 * frame's cursor, answers unknown there. Copying that answer is the whole of the trust rule on
 * this side — the module never inspects raw events, so it cannot turn unknown into quiet.
 */
internal fun RemoteChatSnapshot.fairyFacts(): FairyRemoteFacts = FairyRemoteFacts(
    connected = connected,
    connecting = connecting,
    activityStatus = activity.status,
    activityReasons = activity.reasons,
    transcript = projection?.let { FairyTranscript(it.messages.size, it.attempt?.text) },
)
