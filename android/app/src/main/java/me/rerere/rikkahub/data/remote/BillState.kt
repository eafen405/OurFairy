package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * A failure the bill page must report as itself.
 *
 * [unreachable] has no code; a refusal keeps the backend's code and message
 * verbatim, which is how `bill/unauthorized` or `bill/internal` reaches the page
 * instead of becoming a generic error.
 */
data class BillFailure(
    val unreachable: Boolean = false,
    val code: String = "",
    val message: String = "",
)

/** What the bill page currently has to show. */
data class BillSnapshot(
    val loading: Boolean = false,
    /**
     * The last successfully read bill; null means no read has succeeded yet.
     *
     * A failure leaves this as it was — and since a first read starts from null,
     * a failed first read leaves nothing to render as a bill, so "could not
     * compute" can never be mistaken for "nothing was spent".
     */
    val bill: Bill? = null,
    val failure: BillFailure? = null,
)

/**
 * The bill as one page knows it.
 *
 * One authority: every read goes through here and every answer becomes
 * [snapshot]. Reads are serialized so a retry cannot land before the read it
 * replaced, and a fresh read clears the failure it supersedes.
 *
 * There is no poll and no re-read on a timer: the bill is one aggregate over the
 * whole deployment, and a page that re-read it while the user watched would spend
 * more electricity to answer a question the user asked once.
 */
class BillState(
    private val backend: BillBackend,
    private val scope: CoroutineScope,
) {
    private val mutable = MutableStateFlow(BillSnapshot())
    val snapshot: StateFlow<BillSnapshot> = mutable.asStateFlow()

    /** One read at a time; the page may tap retry while a previous read lands. */
    private val reads = Mutex()

    fun load(token: String) {
        // Loading does not clear the bill: a re-read keeps what was last read
        // visible under a loading mark rather than blanking a page the user is
        // reading, and a failure keeps it for the same reason.
        mutable.value = mutable.value.copy(loading = true, failure = null)
        scope.launch {
            reads.withLock {
                try {
                    mutable.value = BillSnapshot(bill = backend.read(token))
                } catch (refused: IdentityRefused) {
                    mutable.value = mutable.value.copy(loading = false, failure = refused.failure())
                } catch (unreachable: IdentityUnreachable) {
                    mutable.value = mutable.value.copy(loading = false, failure = BillFailure(unreachable = true))
                }
            }
        }
    }

    private fun IdentityRefused.failure() = BillFailure(code = code, message = message.orEmpty())
}
