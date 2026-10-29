package me.rerere.rikkahub.data.remote

import kotlinx.serialization.Serializable

/**
 * One durable record's key, in its canonical form.
 *
 * The endpoint is stored without a trailing slash. Rejecting a trailing slash here is what makes
 * [chatSyncKey] the only normalizer: a caller cannot quietly build a second key shape that the
 * session runtime and the reminder scan would disagree about.
 */
data class ChatSyncKey(val endpoint: String, val userShortId: Int, val sessionId: String) {
    init {
        require(!endpoint.endsWith('/')) { "记录键的 endpoint 必须以无尾斜杠的形式传入" }
    }
}

/**
 * The key a durable record is read and written with.
 *
 * Reception reads reminder debt from the ledger by these keys while each session reads and writes
 * its own record by them; [ChatSyncKey] refuses an unnormalized endpoint, so this function is the
 * only way to turn a configured endpoint into a key and the two sides cannot disagree about it.
 */
internal fun chatSyncKey(endpoint: String, userShortId: Int, sessionId: String) =
    ChatSyncKey(endpoint.trimEnd('/'), userShortId, sessionId)

@Serializable
data class StoredChatSend(val requestId: String, val text: String, val uploadIds: List<String> = emptyList())

/** Consumption bookkeeping only; history must still reload after process recreation. */
@Serializable
data class ChatSyncRecord(
    val consumedThrough: Long = -1,
    val initialized: Boolean = false,
    val pending: StoredChatSend? = null,
    /** Null establishes a notification baseline; separate from sync and read positions. */
    val notificationThrough: Long? = null,
    /** The episode this record has already claimed, so a later fact never claims it twice. */
    val notificationEpisodeId: String? = null,
    /**
     * A claimed episode the reminder has not published yet. The session only records what it
     * owes; reception sees every session and publishes the backlog once.
     */
    val notificationOwed: Boolean = false,
)

interface ChatSyncStore {
    suspend fun load(key: ChatSyncKey): ChatSyncRecord

    suspend fun save(key: ChatSyncKey, record: ChatSyncRecord)
}

/**
 * Retire the episode [key] owes, reading through to the durable record.
 *
 * This is the single rule for what "consumed" writes, so the runtime path (which also updates its
 * cache under its record lock) and the no-runtime path cannot disagree. Consuming before the
 * notification attempt means a crash can lose one sound, but cannot replay that episode.
 */
internal suspend fun ChatSyncStore.consumeReminder(key: ChatSyncKey): ChatSyncRecord {
    val record = load(key)
    val next = if (record.notificationOwed) record.copy(notificationOwed = false) else record
    if (next != record) save(key, next)
    return next
}
