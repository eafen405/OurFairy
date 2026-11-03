package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * A failure the impression page must report as itself.
 *
 * [unreachable] has no code and no message of its own; a refusal keeps the
 * backend's code and message verbatim, which is how the page can show
 * `impression/too-long` rather than a generic failure.
 */
data class ImpressionFailure(
    val unreachable: Boolean = false,
    val code: String = "",
    val message: String = "",
)

/** What the impression page currently has to show. */
data class ImpressionSnapshot(
    val loading: Boolean = false,
    val working: Boolean = false,
    /** The last successfully read impression; null means no read has succeeded yet. */
    val impression: Impression? = null,
    val failure: ImpressionFailure? = null,
)

/**
 * The user's impression as one page knows it.
 *
 * One authority: every read and every write goes through here and every answer
 * becomes [snapshot]. Writes are serialized, and a successful write is followed
 * by a fresh read rather than by trusting the request that was sent.
 *
 * [ImpressionSnapshot.impression] is null until a read actually succeeds. The
 * page keeps editing disabled while it is null, which is the client half of the
 * backend's read-before-edit rule. A failed write never replaces what was
 * already read, so the draft and the backend's refusal stay visible together.
 */
class ImpressionState(
    private val backend: ImpressionBackend,
    private val scope: CoroutineScope,
) {
    private val mutable = MutableStateFlow(ImpressionSnapshot())
    val snapshot: StateFlow<ImpressionSnapshot> = mutable.asStateFlow()

    /** One read or write at a time; the page may tap while a previous one lands. */
    private val writes = Mutex()

    fun load(token: String) {
        mutable.value = mutable.value.copy(loading = true, failure = null)
        scope.launch {
            writes.withLock {
                try {
                    val impression = backend.read(token)
                    mutable.value = ImpressionSnapshot(impression = impression)
                } catch (refused: IdentityRefused) {
                    mutable.value = mutable.value.copy(loading = false, failure = refused.failure())
                } catch (unreachable: IdentityUnreachable) {
                    mutable.value = mutable.value.copy(loading = false, failure = ImpressionFailure(unreachable = true))
                }
            }
        }
    }

    /** Replace the whole body; a successful write is followed by a fresh read. */
    fun save(token: String, content: String, onSaved: () -> Unit = {}) {
        scope.launch {
            writes.withLock {
                mutable.value = mutable.value.copy(working = true, failure = null)
                var accepted = false
                try {
                    backend.edit(token, content)
                    accepted = true
                    freshRead(token)
                } catch (refused: IdentityRefused) {
                    mutable.value = mutable.value.copy(working = false, failure = refused.failure())
                } catch (unreachable: IdentityUnreachable) {
                    mutable.value = mutable.value.copy(working = false, failure = ImpressionFailure(unreachable = true))
                }
                // The write was accepted even if the read-back failed; the page
                // reports the read problem without pretending the write did not land.
                if (accepted) onSaved()
            }
        }
    }

    private suspend fun freshRead(token: String) {
        try {
            val impression = backend.read(token)
            mutable.value = ImpressionSnapshot(impression = impression)
        } catch (refused: IdentityRefused) {
            mutable.value = mutable.value.copy(working = false, failure = refused.failure())
        } catch (unreachable: IdentityUnreachable) {
            mutable.value = mutable.value.copy(working = false, failure = ImpressionFailure(unreachable = true))
        }
    }

    private fun IdentityRefused.failure() = ImpressionFailure(code = code, message = message.orEmpty())
}
