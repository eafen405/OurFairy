package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/**
 * Why the page must not offer to edit or delete a route right now, or null when
 * it may.
 *
 * [IN_USE] is the backend's own reason — a running reply still uses the route —
 * and it wins over read-only deployment policy because it is the fact that would
 * answer a write with `gateway/route-in-use`. The page disables the controls and
 * shows the reason instead of inviting a request the backend will refuse.
 */
enum class GatewayRouteLock { IN_USE, READ_ONLY }

fun GatewayRoute.lock(editable: GatewayEditable): GatewayRouteLock? = when {
    inUse -> GatewayRouteLock.IN_USE
    !editable.routes -> GatewayRouteLock.READ_ONLY
    else -> null
}

/** What the gateway page currently has to show. */
data class GatewaySnapshot(
    val loading: Boolean = false,
    val working: Boolean = false,
    val config: GatewayConfig? = null,
    override val failure: RemoteFailure? = null,
) : RemotePageState<GatewaySnapshot> {
    override fun settled(failure: RemoteFailure?, reading: Boolean?, writing: Boolean?) = copy(
        loading = reading ?: loading,
        working = writing ?: working,
        failure = failure,
    )
}

/**
 * The gateway configuration as one page knows it.
 *
 * Every read and every write goes through [RemoteResource]'s single lane: two taps cannot race
 * each other into contradictory configurations, and a successful write is followed by a fresh
 * read rather than by trusting the echoed value — the page then shows what the backend actually
 * stored, including the `saved` flags and the current `inUse` state.
 *
 * A failed write never replaces what was already read: the configuration stays on screen with the
 * refusal beside it, which is what lets the user retry after a running reply ends.
 */
class GatewayState(
    private val backend: GatewayBackend,
    scope: CoroutineScope,
) {
    private val resource = RemoteResource(scope, GatewaySnapshot()) { token ->
        GatewaySnapshot(config = backend.read(token))
    }

    val snapshot: StateFlow<GatewaySnapshot> = resource.snapshot

    fun load(token: String) = resource.load(token)

    fun select(token: String, selection: GatewaySelection) =
        resource.write(token) { backend.select(token, selection) }

    /**
     * Save one route. [onSaved] runs once the backend has accepted the route: a follow-up read
     * that fails is reported beside the configuration, but it cannot un-store the route, so the
     * editor may still close over it.
     */
    fun saveRoute(token: String, route: GatewayRouteDraft, onSaved: () -> Unit = {}) =
        resource.write(token, onAccepted = { onSaved() }) { backend.saveRoute(token, route) }

    fun deleteRoute(token: String, provider: String) =
        resource.write(token) { backend.deleteRoute(token, provider) }

    fun saveAsr(token: String, asr: GatewayAsrDraft) = resource.write(token) { backend.saveAsr(token, asr) }

    fun saveCompaction(token: String, compaction: GatewayCompactionDraft) =
        resource.write(token) { backend.saveCompaction(token, compaction) }

    fun saveMaintenance(token: String, maintenance: GatewayMaintenanceDraft) =
        resource.write(token) { backend.saveMaintenance(token, maintenance) }
}
