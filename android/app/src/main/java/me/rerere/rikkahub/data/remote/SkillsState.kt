package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.StateFlow

/** What the skills page currently has to show. */
data class SkillsSnapshot(
    val loading: Boolean = false,
    val working: Boolean = false,
    val skills: List<SkillPoolItem> = emptyList(),
    val pending: List<PendingSkill> = emptyList(),
    val pendingCount: Int = 0,
    val reviewResults: List<SkillReviewResult> = emptyList(),
    /** Whether a read has succeeded; an empty pool after a read is different from no read yet. */
    val loaded: Boolean = false,
    override val failure: RemoteFailure? = null,
) : RemotePageState<SkillsSnapshot> {
    override fun settled(failure: RemoteFailure?, reading: Boolean?, writing: Boolean?) = copy(
        loading = reading ?: loading,
        working = writing ?: working,
        failure = failure,
    )
}

/**
 * The user's selection pool as one page knows it.
 *
 * Every read and every lifecycle write goes through [RemoteResource]'s single lane, and an
 * accepted write is followed by a fresh read rather than by trusting the request or the updated
 * item the write answered with — the page shows what the backend now derives. A failed write
 * keeps the last successfully read pool visible next to the backend's refusal.
 *
 * The review entry is the one write whose answer belongs to the caller: it opens the session the
 * backend answers with while the pool stays as it is, so it does not re-read.
 */
class SkillsState(
    private val backend: SkillsBackend,
    scope: CoroutineScope,
) {
    private val resource = RemoteResource(scope, SkillsSnapshot()) { token -> fromPool(backend.list(token)) }

    val snapshot: StateFlow<SkillsSnapshot> = resource.snapshot

    /** The snapshot one successful read publishes; every write re-reads through it. */
    private fun fromPool(pool: SkillPool) = SkillsSnapshot(
        skills = pool.skills,
        pending = pool.pending,
        pendingCount = pool.pendingCount,
        reviewResults = pool.reviewResults,
        loaded = true,
    )

    fun load(token: String) = resource.load(token)

    /**
     * Open one pending candidate's review entry: the backend appends the system-context reference
     * to the caller's primary session and answers its id, which the page uses to open the
     * conversation. The pool does not change, so this write does not re-read it.
     */
    fun openPending(token: String, versionId: Long, onOpened: (String) -> Unit) =
        resource.perform(onAccepted = onOpened) { backend.reviewOpen(token, versionId) }

    /** Toggle one skill, then re-read the pool; the backend decides the new state. */
    fun setEnabled(token: String, skillId: Long, enabled: Boolean) =
        resource.write(token) { backend.setEnabled(token, skillId, enabled) }

    /** Archive one skill the backend says this caller may manage, then re-read the pool. */
    fun archive(token: String, skillId: Long) = resource.write(token) { backend.archive(token, skillId) }

    /** Restore one archived skill the backend says this caller may manage, then re-read the pool. */
    fun restore(token: String, skillId: Long) = resource.write(token) { backend.restore(token, skillId) }
}
