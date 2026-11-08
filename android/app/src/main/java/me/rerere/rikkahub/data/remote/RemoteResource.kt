package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Why a remote page must report a failure as itself.
 *
 * [unreachable] has no code and no message of its own: the page renders it with the same
 * localized "backend could not be reached" text the sign-in pages use. A refusal keeps the
 * backend's code and message verbatim, so the page can show the backend's own reason
 * (`skills/archived`, `gateway/route-in-use`, …) instead of a generic error.
 */
data class RemoteFailure(
    val unreachable: Boolean = false,
    val code: String = "",
    val message: String = "",
)

/**
 * What one remote page currently has to show.
 *
 * The shared [RemoteResource] may only replace the failure and the two busy marks; the payload a
 * page derives for itself always stays on screen. Implementations keep their own snapshot type,
 * so what a read publishes and how a page names its payload stay with the page.
 */
interface RemotePageState<S : RemotePageState<S>> {
    val failure: RemoteFailure?

    /**
     * The same page with its [failure] replaced, plus either busy mark replaced when given.
     * A `null` mark leaves that mark as it is. The payload is never touched.
     */
    fun settled(failure: RemoteFailure?, reading: Boolean? = null, writing: Boolean? = null): S
}

/**
 * One remote resource's single authority over what its page may show.
 *
 * Reads and writes share one lane: a read issued while a write is landing cannot publish a
 * snapshot older than the write it followed, and two writes cannot race each other into
 * contradictory configurations. An accepted write is followed by a fresh read rather than by
 * trusting the request or the item the write answered with — the page shows what the backend now
 * derives. A failure keeps the last successfully read payload visible next to the backend's own
 * refusal, and only [IdentityRefused] / [IdentityUnreachable] are reported: a cancellation is a
 * cancellation and keeps propagating.
 */
class RemoteResource<S : RemotePageState<S>>(
    private val scope: CoroutineScope,
    initial: S,
    /** One fresh read, published as this page's own snapshot. */
    private val read: suspend (token: String) -> S,
) {
    private val mutable = MutableStateFlow(initial)
    val snapshot: StateFlow<S> = mutable.asStateFlow()

    /** One read or write at a time; the page may tap while a previous one lands. */
    private val lane = Mutex()

    fun load(token: String) {
        // The loading mark appears before the lane is joined, so a retry tapped while a write is
        // landing still shows immediately that a read is coming. A write already in flight keeps
        // its own mark; clearing that is the write's business, not this read's.
        mutable.value = mutable.value.settled(failure = null, reading = true)
        scope.launch {
            lane.withLock {
                reread(token, reading = false)
            }
        }
    }

    /**
     * One write followed by a fresh read.
     *
     * [onAccepted] runs once the backend has accepted the write, with the answer it gave. It runs
     * after the follow-up read is attempted but regardless of whether that read succeeded: a
     * failed read is a reporting problem, not a reason to pretend the write was lost. A refusal
     * is reported as itself and neither re-reads nor calls [onAccepted].
     */
    fun <R> write(token: String, onAccepted: (R) -> Unit = {}, operation: suspend () -> R) {
        submit(
            operation = operation,
            onAccepted = onAccepted,
            freshRead = { reread(token, writing = false) },
        )
    }

    /**
     * One write whose answer belongs to the caller.
     *
     * The page's own snapshot cannot change from this write, so it is not re-read; the caller
     * consumes the answer itself (the skills review entry, which opens the session it answers
     * with while the pool stays as it is).
     */
    fun <R> perform(onAccepted: (R) -> Unit = {}, operation: suspend () -> R) {
        submit(
            operation = operation,
            onAccepted = onAccepted,
            freshRead = { mutable.value = mutable.value.settled(failure = null, writing = false) },
        )
    }

    private fun <R> submit(
        operation: suspend () -> R,
        onAccepted: (R) -> Unit,
        freshRead: suspend () -> Unit,
    ) {
        scope.launch {
            lane.withLock {
                // The working mark is set once this write owns the lane, not when it was
                // requested: a queued write must not make the page look busy before its turn.
                mutable.value = mutable.value.settled(failure = null, writing = true)
                val result = try {
                    operation()
                } catch (refused: IdentityRefused) {
                    mutable.value = mutable.value.settled(failure = refused.remoteFailure(), writing = false)
                    return@withLock
                } catch (unreachable: IdentityUnreachable) {
                    mutable.value = mutable.value.settled(failure = RemoteFailure(unreachable = true), writing = false)
                    return@withLock
                }
                freshRead()
                onAccepted(result)
            }
        }
    }

    /**
     * Read and publish. A failed read keeps the payload on screen, clears the mark the caller
     * owns, and reports the failure; an accepted read replaces the whole snapshot.
     */
    private suspend fun reread(token: String, reading: Boolean? = null, writing: Boolean? = null) {
        try {
            mutable.value = read(token)
        } catch (refused: IdentityRefused) {
            mutable.value = mutable.value.settled(
                failure = refused.remoteFailure(),
                reading = reading,
                writing = writing,
            )
        } catch (unreachable: IdentityUnreachable) {
            mutable.value = mutable.value.settled(
                failure = RemoteFailure(unreachable = true),
                reading = reading,
                writing = writing,
            )
        }
    }

    private fun IdentityRefused.remoteFailure() = RemoteFailure(code = code, message = message.orEmpty())
}
