package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/** What the impression page currently has to show. */
data class ImpressionSnapshot(
    val loading: Boolean = false,
    /** The last successfully read impression; null means no read has succeeded yet. */
    val impression: Impression? = null,
    override val failure: RemoteFailure? = null,
) : RemotePageState<ImpressionSnapshot> {
    override fun settled(failure: RemoteFailure?, reading: Boolean?, writing: Boolean?) =
        copy(loading = reading ?: loading, failure = failure)
}

/**
 * The user's impression as one page knows it.
 *
 * Reads go through [RemoteResource]'s single lane like every other remote page. The page is
 * read-only, so it has no write mark and never enters a writing operation: a failed read keeps the
 * last successfully read impression visible next to the backend's failure, and
 * [ImpressionSnapshot.impression] stays null until a read actually succeeds.
 */
class ImpressionState(
    private val backend: ImpressionBackend,
    scope: CoroutineScope,
) {
    private val resource = RemoteResource(scope, ImpressionSnapshot()) { token ->
        ImpressionSnapshot(impression = backend.read(token))
    }

    val snapshot: StateFlow<ImpressionSnapshot> = resource.snapshot

    fun load(token: String) = resource.load(token)
}
