package me.rerere.rikkahub.data.remote

import kotlinx.serialization.Serializable

enum class RemoteSessionCommand(val code: Int, val text: String) {
    COMPACT(1, "/compact"),
    CLEAR(2, "/clear");

    companion object {
        fun candidates(draft: String): List<RemoteSessionCommand> {
            val prefix = draft.trim()
            return if (prefix.isEmpty()) emptyList() else entries.filter { it.text.startsWith(prefix) }
        }
        fun match(draft: String) = candidates(draft).singleOrNull { it.text == draft.trim() }
    }
}

@Serializable
data class StoredSessionCommand(val requestId: String, val command: Int, val text: String)

data class PendingSessionCommand(
    val request: StoredSessionCommand,
    val status: Int? = null,
    val resolving: Boolean = false,
    val failure: String? = null,
    val rejected: Boolean = false,
) {
    val failed: Boolean get() = rejected || status == 5
    val terminal: Boolean get() = rejected || (status ?: 1) >= 2
}

@Serializable
data class RemoteSessionCommandError(val code: Int, val message: String)

/** Wire status: 1 running, 2 compacted, 3 unnecessary, 4 reset, 5 failed. */
@Serializable
data class RemoteSessionCommandSnapshot(
    val sessionId: String,
    val requestId: String,
    val commandId: String,
    val command: Int,
    val status: Int,
    val acceptedSeq: Long,
    val completedSeq: Long? = null,
    val error: RemoteSessionCommandError? = null,
)

/** Command execution has its own result lifecycle, separate from a chat send receipt. */
interface RemoteSessionCommandBackend {
    suspend fun executeCommand(token: String, sessionId: String, requestId: String, command: Int): RemoteSessionCommandSnapshot
    suspend fun commandStatus(token: String, sessionId: String, requestId: String): RemoteSessionCommandSnapshot?
}
