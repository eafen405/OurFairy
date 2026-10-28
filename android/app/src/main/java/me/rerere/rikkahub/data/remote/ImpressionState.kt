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
 * backend's code and message verbatim, which is how the page can show the
 * backend's own reason rather than a generic failure.
 */
data class ImpressionFailure(
    val unreachable: Boolean = false,
    val code: String = "",
    val message: String = "",
)

/** What the impression page currently has to show. */
data class ImpressionSnapshot(
    val loading: Boolean = false,
    /** The last successfully read impression; null means no read has succeeded yet. */
    val impression: Impression? = null,
    val failure: ImpressionFailure? = null,
)

/**
 * The user's impression as one page knows it.
 *
 * One authority: every read goes through here and every answer becomes
 * [snapshot]. Reads are serialized, so a retry cannot race the read it follows.
 *
 * [ImpressionSnapshot.impression] is null until a read actually succeeds, so
 * the page shows nothing of the impression until the backend has actually
 * handed one over.
 */
class ImpressionState(
    private val backend: ImpressionBackend,
    private val scope: CoroutineScope,
) {
    private val mutable = MutableStateFlow(ImpressionSnapshot())
    val snapshot: StateFlow<ImpressionSnapshot> = mutable.asStateFlow()

    /** One read at a time; the page may tap while a previous one lands. */
    private val reads = Mutex()

    fun load(token: String) {
        mutable.value = mutable.value.copy(loading = true, failure = null)
        scope.launch {
            reads.withLock {
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

    private fun IdentityRefused.failure() = ImpressionFailure(code = code, message = message.orEmpty())
}
