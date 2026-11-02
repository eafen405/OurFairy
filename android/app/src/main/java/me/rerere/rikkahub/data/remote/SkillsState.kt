package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * A failure the skills page must report as itself.
 *
 * [unreachable] has no code; a refusal keeps the backend's code and message verbatim, which is how
 * `skills/not-found` or `skills/archived` reaches the page rather than becoming a generic error.
 */
data class SkillsFailure(
    val unreachable: Boolean = false,
    val code: String = "",
    val message: String = "",
)

/** What the skills page currently has to show. */
data class SkillsSnapshot(
    val loading: Boolean = false,
    val working: Boolean = false,
    val skills: List<SkillPoolItem> = emptyList(),
    val pending: List<PendingSkill> = emptyList(),
    val pendingCount: Int = 0,
    /** Whether a read has succeeded; an empty pool after a read is different from no read yet. */
    val loaded: Boolean = false,
    val failure: SkillsFailure? = null,
)

/**
 * The user's selection pool as one page knows it.
 *
 * One authority: every read and every preference write goes through here. Writes are serialized,
 * and an accepted write is followed by a fresh read rather than by trusting the request or the
 * updated item the write answered with — the page shows what the backend now derives. A failed
 * write keeps the last successfully read pool visible next to the backend's refusal.
 */
class SkillsState(
    private val backend: SkillsBackend,
    private val scope: CoroutineScope,
) {
    private val mutable = MutableStateFlow(SkillsSnapshot())
    val snapshot: StateFlow<SkillsSnapshot> = mutable.asStateFlow()

    /** One read or write at a time; the page may tap while a previous one lands. */
    private val writes = Mutex()

    fun load(token: String) {
        mutable.value = mutable.value.copy(loading = true, failure = null)
        scope.launch {
            writes.withLock {
                try {
                    val pool = backend.list(token)
                    mutable.value = SkillsSnapshot(
                        skills = pool.skills,
                        pending = pool.pending,
                        pendingCount = pool.pendingCount,
                        loaded = true,
                    )
                } catch (refused: IdentityRefused) {
                    mutable.value = mutable.value.copy(loading = false, failure = refused.failure())
                } catch (unreachable: IdentityUnreachable) {
                    mutable.value = mutable.value.copy(loading = false, failure = SkillsFailure(unreachable = true))
                }
            }
        }
    }

    /**
     * Open one pending candidate's review entry: the backend appends the system-context reference to
     * the caller's primary session and answers its id, which the page uses to open the conversation.
     * The pool does not change, so this write does not re-read it.
     */
    fun openPending(token: String, versionId: Long, onOpened: (String) -> Unit) {
        scope.launch {
            writes.withLock {
                mutable.value = mutable.value.copy(working = true, failure = null)
                try {
                    val sessionId = backend.reviewOpen(token, versionId)
                    mutable.value = mutable.value.copy(working = false)
                    onOpened(sessionId)
                } catch (refused: IdentityRefused) {
                    mutable.value = mutable.value.copy(working = false, failure = refused.failure())
                } catch (unreachable: IdentityUnreachable) {
                    mutable.value = mutable.value.copy(working = false, failure = SkillsFailure(unreachable = true))
                }
            }
        }
    }

    /** Toggle one skill, then re-read the pool; the backend decides the new state. */
    fun setEnabled(token: String, skillId: Long, enabled: Boolean) {
        scope.launch {
            writes.withLock {
                mutable.value = mutable.value.copy(working = true, failure = null)
                try {
                    backend.setEnabled(token, skillId, enabled)
                } catch (refused: IdentityRefused) {
                    mutable.value = mutable.value.copy(working = false, failure = refused.failure())
                    return@withLock
                } catch (unreachable: IdentityUnreachable) {
                    mutable.value = mutable.value.copy(working = false, failure = SkillsFailure(unreachable = true))
                    return@withLock
                }
                try {
                    val pool = backend.list(token)
                    mutable.value = SkillsSnapshot(
                        skills = pool.skills,
                        pending = pool.pending,
                        pendingCount = pool.pendingCount,
                        loaded = true,
                    )
                } catch (refused: IdentityRefused) {
                    mutable.value = mutable.value.copy(working = false, failure = refused.failure())
                } catch (unreachable: IdentityUnreachable) {
                    mutable.value = mutable.value.copy(working = false, failure = SkillsFailure(unreachable = true))
                }
            }
        }
    }

    private fun IdentityRefused.failure() = SkillsFailure(code = code, message = message.orEmpty())
}
