package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** The Android boundary a skill reminder is published through. */
interface SkillsNotificationPlatform : RemoteForegroundPlatform {
    /**
     * Publish one merged skill reminder.
     *
     * The endpoint and account are part of the opened destination: the notification must land on
     * the skills page of the account that produced it, not the one that happens to be signed in.
     */
    fun publishSkills(endpoint: String, userShortId: Int, preview: String)
}

/**
 * The client half of #298's reminder-once rule.
 *
 * The backend has no push channel. `/skills/list` carries the current pending set and a bounded
 * view of recently decided candidates; this class compares those two sets with the account's
 * durable ledger and publishes one merged local notification per newly observed set. The ledger is
 * written before the publication attempt, so a crash may lose one sound but can never replay it.
 * A notification suppressed by the foreground or by the user's switch is recorded too: the page's
 * badge remains the in-app surface, and the reminder is not replayed on the next background move.
 */
class SkillsReviewNotifier(
    private val backend: SkillsBackend,
    private val ledger: SkillsReviewLedger,
    private val platform: SkillsNotificationPlatform?,
    private val endpoint: String,
    private val notificationsEnabled: () -> Boolean,
    private val scope: CoroutineScope,
) {
    private val mutex = Mutex()

    /** Observe the current account in the background; failures leave the ledger untouched. */
    fun observe(token: String, userShortId: Int) {
        scope.launch { observeNow(token, userShortId) }
    }

    /**
     * One read/compare/publish pass.
     *
     * `reviewResults` reports a common decision to its proposer; a personal decision is made in
     * the owner's own conversation and is not a reminder. The pending set is filtered to the
     * candidates a background reminder is for: a personal candidate only when the background
     * engine created it (source type 2), and a common proposal only when this caller may decide it
     * (Phaethon; the proposer sees an empty `nextActions`). An explicit or install candidate the
     * user just created is in the page but never produces this reminder. Both sets are bounded by
     * the backend, so one pass costs one list read and a bounded compare.
     */
    suspend fun observeNow(token: String, userShortId: Int) {
        mutex.withLock {
            val pool = backend.list(token)
            val pending = pool.pending.filter(::reviewsOrBackground).map { it.versionId }.distinct().sorted()
            val decided = pool.reviewResults
                .filter { it.proposer && (it.status == SkillVersionStatus.APPROVED || it.status == SkillVersionStatus.REJECTED) }
                .map { it.versionId }
                .distinct()
                .sorted()
            val key = SkillsReviewKey(endpoint.trimEnd('/'), userShortId)
            val record = ledger.load(key)
            val knownPending = record.pending.toSet()
            val knownDecided = record.decided.toSet()
            val freshPending = pending.filter { it !in knownPending }
            val freshDecided = decided.filter { it !in knownDecided }
            if (freshPending.isEmpty() && freshDecided.isEmpty()) return
            // Consumed before the attempt: the same sets never publish twice.
            ledger.save(key, SkillsReviewRecord(
                pending = pending.takeLast(MAX_TRACKED),
                decided = decided.takeLast(MAX_TRACKED),
            ))
            if (!notificationsEnabled()) return
            val target = platform ?: return
            if (target.isForeground()) return
            target.publishSkills(key.endpoint, userShortId, previewOf(pool, freshPending, freshDecided))
        }
    }

    /** One merged, bounded reminder for the newly observed sets. */
    private fun previewOf(pool: SkillPool, freshPending: List<Long>, freshDecided: List<Long>): String {
        val parts = mutableListOf<String>()
        if (freshPending.isNotEmpty()) parts += "有 ${pool.pending.count(::reviewsOrBackground)} 个技能候选等待审核"
        if (freshDecided.isNotEmpty()) {
            val decided = pool.reviewResults.filter { it.versionId in freshDecided }
            if (decided.size == 1) {
                val result = decided.single()
                val verdict = if (result.status == SkillVersionStatus.APPROVED) "已通过" else "被拒绝"
                parts += "技能「${result.name}」审核$verdict"
            } else {
                parts += "技能审核结果：${freshDecided.size} 项"
            }
        }
        return parts.joinToString("；").take(MAX_PREVIEW_CHARACTERS)
    }

    /**
     * Whether one pending candidate is what the merged background reminder announces.
     *
     * A personal candidate reminds only when the background learning engine created it
     * (`sourceType == 2`); an explicit, installed, evolved or rolled-back one was the user's own
     * action. A common candidate is a proposal, and only the caller who may decide it
     * (`nextActions` non-empty, i.e. Phaethon) gets the reminder; its proposer reads it without
     * this prompt. The backend owns both facts, so the client derives no reviewer from the token.
     */
    private fun reviewsOrBackground(pending: PendingSkill): Boolean =
        if (pending.scope == SkillScope.COMMON) pending.nextActions.isNotEmpty()
        else pending.sourceType == SOURCE_TYPE_BACKGROUND

    private companion object {
        /** How many version ids one record keeps; the backend's views are far smaller. */
        const val MAX_TRACKED = 200

        /** The backend's `SOURCE_TYPE.background`: the only personal source a reminder names. */
        const val SOURCE_TYPE_BACKGROUND = 2

        /** One notification line, bounded like the chat preview. */
        const val MAX_PREVIEW_CHARACTERS = 160
    }
}
