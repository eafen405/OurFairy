package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The reminder-once rule for skill candidates and decisions.
 *
 * The backend's list is a double; the assertions are about what one observation publishes: one
 * merged notification per newly observed pending/decision set, a terminal common decision only for
 * its proposer, and a suppressed attempt still consumed so a later background move cannot replay it.
 */
private class ScriptedBackend(var pool: SkillPool) : SkillsBackend {
    var reads = 0

    override suspend fun list(token: String): SkillPool {
        reads += 1
        return pool
    }

    override suspend fun detail(token: String, skillId: Long): SkillPoolItem = error("not used")
    override suspend fun setEnabled(token: String, skillId: Long, enabled: Boolean): SkillPoolItem = error("not used")
    override suspend fun reviewOpen(token: String, versionId: Long): String = error("not used")
    override suspend fun archive(token: String, skillId: Long): SkillPoolItem = error("not used")
    override suspend fun restore(token: String, skillId: Long): SkillPoolItem = error("not used")
}

private class MemoryLedger : SkillsReviewLedger {
    val records = mutableMapOf<SkillsReviewKey, SkillsReviewRecord>()
    var writes = 0

    override suspend fun load(key: SkillsReviewKey) = records[key] ?: SkillsReviewRecord()

    override suspend fun save(key: SkillsReviewKey, record: SkillsReviewRecord) {
        writes += 1
        records[key] = record
    }
}

private class RecordingPlatform(var foreground: Boolean = false) : SkillsNotificationPlatform {
    data class Alert(val endpoint: String, val account: Int, val preview: String)

    val alerts = mutableListOf<Alert>()

    override fun isForeground() = foreground

    override fun publishSkills(endpoint: String, userShortId: Int, preview: String) {
        alerts += Alert(endpoint, userShortId, preview)
    }
}

class SkillsReviewNotifierTest {

    private val ledger = MemoryLedger()
    private val platform = RecordingPlatform()

    private fun notifier(backend: SkillsBackend, scope: kotlinx.coroutines.CoroutineScope, enabled: Boolean = true) =
        SkillsReviewNotifier(
            backend = backend,
            ledger = ledger,
            platform = platform,
            endpoint = "https://fairy.example/",
            notificationsEnabled = { enabled },
            scope = scope,
        )

    private fun result(id: Long, name: String, status: Int, proposer: Boolean) = SkillReviewResult(
        versionId = id,
        skillId = id,
        name = name,
        scope = SkillScope.COMMON,
        status = status,
        decidedAt = 1_000 + id,
        proposer = proposer,
    )

    @Test
    fun `one new pending set publishes one merged reminder and the same set never repeats`() = runTest {
        val backend = ScriptedBackend(SkillPool(
            pending = listOf(PendingSkill(versionId = 41, name = "candidate")),
            pendingCount = 1,
        ))
        val notifier = notifier(backend, this)
        notifier.observeNow("token", 2)
        assertEquals(1, platform.alerts.size)
        val alert = platform.alerts.single()
        assertEquals("https://fairy.example", alert.endpoint)
        assertEquals(2, alert.account)
        assertTrue(alert.preview.contains("1"))
        assertTrue(alert.preview.contains("待审核"))

        notifier.observeNow("token", 2)
        assertEquals("the same pending set is not re-announced", 1, platform.alerts.size)

        backend.pool = SkillPool(
            pending = listOf(PendingSkill(versionId = 41), PendingSkill(versionId = 42, name = "second")),
            pendingCount = 2,
        )
        notifier.observeNow("token", 2)
        assertEquals("a grown pending set publishes once", 2, platform.alerts.size)
        assertTrue(platform.alerts.last().preview.contains("2"))
    }

    @Test
    fun `a background-created candidate reaches the user through one merged pending reminder`() = runTest {
        // The learning engine only writes rows; the client sees the candidate
        // through the ordinary pending list. An empty observation publishes
        // nothing, the new background candidate publishes exactly one merged
        // reminder and the same set never repeats.
        val backend = ScriptedBackend(SkillPool())
        val notifier = notifier(backend, this)
        notifier.observeNow("token", 2)
        assertEquals("an empty pending set publishes nothing", 0, platform.alerts.size)

        backend.pool = SkillPool(
            pending = listOf(
                PendingSkill(
                    versionId = 71,
                    skillId = 12,
                    name = "background-checklist",
                    sourceType = 2,
                    nextActions = listOf("approve", "request_changes", "reject"),
                ),
            ),
            pendingCount = 1,
        )
        notifier.observeNow("token", 2)
        assertEquals("the background candidate publishes one reminder", 1, platform.alerts.size)
        val preview = platform.alerts.single().preview
        assertTrue("the reminder names the pending count: $preview", preview.contains("1"))
        assertTrue("the reminder is the review reminder: $preview", preview.contains("待审核"))
        assertEquals("the ledger keeps the observed candidate", listOf(71L), ledger.records.values.single().pending)

        notifier.observeNow("token", 2)
        assertEquals("the same background candidate is never re-announced", 1, platform.alerts.size)
        assertEquals("one observation costs one read", 3, backend.reads)
    }

    @Test
    fun `a terminal common decision reaches its proposer once, not another reviewer`() = runTest {
        val backend = ScriptedBackend(SkillPool(
            reviewResults = listOf(
                result(51, "shared-skill", SkillVersionStatus.APPROVED, proposer = true),
                result(52, "not-mine", SkillVersionStatus.REJECTED, proposer = false),
            ),
        ))
        val notifier = notifier(backend, this)
        notifier.observeNow("token", 2)

        assertEquals(1, platform.alerts.size)
        val preview = platform.alerts.single().preview
        assertTrue("the proposer's approved result is named: $preview", preview.contains("shared-skill"))
        assertTrue(preview.contains("已通过"))
        assertTrue("another user's result is not the caller's reminder", !preview.contains("not-mine"))

        notifier.observeNow("token", 2)
        assertEquals("a decision is announced once", 1, platform.alerts.size)
    }

    @Test
    fun `a new pending set and a new decision merge into one notification`() = runTest {
        val backend = ScriptedBackend(SkillPool(
            pending = listOf(PendingSkill(versionId = 61, name = "candidate")),
            pendingCount = 1,
            reviewResults = listOf(result(62, "decided-skill", SkillVersionStatus.REJECTED, proposer = true)),
        ))
        val notifier = notifier(backend, this)
        notifier.observeNow("token", 2)

        assertEquals("both sets produce one merged reminder", 1, platform.alerts.size)
        val preview = platform.alerts.single().preview
        assertTrue(preview.contains("待审核"))
        assertTrue(preview.contains("decided-skill"))
        assertTrue(preview.contains("被拒绝"))
    }

    @Test
    fun `a foreground or disabled reminder is consumed instead of replayed on the next observation`() = runTest {
        val backend = ScriptedBackend(SkillPool(pending = listOf(PendingSkill(versionId = 71))))

        platform.foreground = true
        notifier(backend, this).observeNow("token", 2)
        assertEquals("the foreground suppresses publication", 0, platform.alerts.size)

        platform.foreground = false
        notifier(backend, this).observeNow("token", 2)
        assertEquals("a suppressed set was recorded and is not replayed", 0, platform.alerts.size)

        // A genuinely new candidate is still announced after the suppressed one.
        backend.pool = SkillPool(pending = listOf(PendingSkill(versionId = 71), PendingSkill(versionId = 72)))
        notifier(backend, this).observeNow("token", 2)
        assertEquals(1, platform.alerts.size)
    }

    @Test
    fun `a disabled notification switch records the set without publishing`() = runTest {
        val backend = ScriptedBackend(SkillPool(pending = listOf(PendingSkill(versionId = 81))))
        notifier(backend, this, enabled = false).observeNow("token", 2)
        assertEquals(0, platform.alerts.size)
        assertEquals(1, ledger.writes)
    }

    @Test
    fun `each account keeps its own ledger`() = runTest {
        val backend = ScriptedBackend(SkillPool(pending = listOf(PendingSkill(versionId = 91))))
        val notifier = notifier(backend, this)
        notifier.observeNow("token", 2)
        notifier.observeNow("token", 3)
        assertEquals("a second account sees the candidate as new", 2, platform.alerts.size)
        assertEquals(listOf(2, 3), platform.alerts.map { it.account })
    }
}
