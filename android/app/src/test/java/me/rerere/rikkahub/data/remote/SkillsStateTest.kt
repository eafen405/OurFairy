package me.rerere.rikkahub.data.remote

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * What the skills page may claim while it reads and writes.
 *
 * The fake backend is scripted: the assertions are about the page's authority — the backend's
 * derived items are published as given, an accepted write is followed by a fresh read rather
 * than by trusting the request, and a refusal keeps the last read pool and the backend's code.
 */
@OptIn(ExperimentalCoroutinesApi::class)
private class ScriptedSkills(
    var list: suspend () -> SkillPool = { pool() },
    var setEnabled: suspend (Long, Boolean) -> Unit = { _, _ -> },
    var reviewOpen: suspend (Long) -> String = { "ourfairy-user-2-primary" },
) : SkillsBackend {
    val writes = mutableListOf<Pair<Long, Boolean>>()
    val opened = mutableListOf<Long>()
    var reads = 0

    override suspend fun list(token: String): SkillPool {
        reads += 1
        return list()
    }

    override suspend fun detail(token: String, skillId: Long): SkillPoolItem = error("not used")

    override suspend fun reviewOpen(token: String, versionId: Long): String {
        opened += versionId
        return reviewOpen(versionId)
    }

    override suspend fun setEnabled(token: String, skillId: Long, enabled: Boolean): SkillPoolItem {
        writes += skillId to enabled
        setEnabled(skillId, enabled)
        return item(skillId, enabled = enabled, state = if (enabled) SkillPoolState.IN_CATALOG else SkillPoolState.DISABLED)
    }

    companion object {
        fun item(id: Long, name: String = "skill-$id", enabled: Boolean = true, state: Int = SkillPoolState.IN_CATALOG) =
            SkillPoolItem(skillId = id, name = name, description = "backend description", scope = SkillScope.PERSONAL,
                state = state, enabled = enabled)

        fun pool(vararg items: SkillPoolItem) = SkillPool(skills = items.toList())
    }
}

class SkillsStateTest {

    @Test
    fun `a read publishes the backend's derived pool`() = runTest {
        val backend = ScriptedSkills(list = {
            ScriptedSkills.pool(
                ScriptedSkills.item(1, name = "alpha", state = SkillPoolState.ARCHIVED, enabled = false),
                ScriptedSkills.item(2, name = "beta", state = SkillPoolState.SHADOWED),
            )
        })
        val state = SkillsState(backend, this)

        state.load("token-abc")
        advanceUntilIdle()

        val snapshot = state.snapshot.value
        assertFalse(snapshot.loading)
        assertTrue(snapshot.loaded)
        assertNull(snapshot.failure)
        assertEquals(listOf("alpha", "beta"), snapshot.skills.map { it.name })
        assertEquals(listOf(SkillPoolState.ARCHIVED, SkillPoolState.SHADOWED), snapshot.skills.map { it.state })
        assertEquals(1, backend.reads)
    }

    @Test
    fun `an accepted toggle is followed by a fresh read and the page shows the backend's new state`() = runTest {
        var enabled = true
        val backend = ScriptedSkills(
            list = { ScriptedSkills.pool(ScriptedSkills.item(3, enabled = enabled,
                state = if (enabled) SkillPoolState.IN_CATALOG else SkillPoolState.DISABLED)) },
            setEnabled = { _, next -> enabled = next },
        )
        val state = SkillsState(backend, this)
        state.load("token-abc")
        advanceUntilIdle()

        state.setEnabled("token-abc", 3, false)
        advanceUntilIdle()

        assertEquals(listOf(3L to false), backend.writes)
        assertEquals("the write is followed by a fresh read", 2, backend.reads)
        val item = state.snapshot.value.skills.single()
        assertFalse(item.enabled)
        assertEquals(SkillPoolState.DISABLED, item.state)
        assertFalse(state.snapshot.value.working)
    }

    @Test
    fun `a refused toggle keeps the last read pool and the backend's code`() = runTest {
        val backend = ScriptedSkills(
            list = { ScriptedSkills.pool(ScriptedSkills.item(1, name = "skill-1")) },
            setEnabled = { _, _ ->
            throw IdentityRefused(409, "skills/archived", "skill \"alpha\" is archived")
        })
        val state = SkillsState(backend, this)
        state.load("token-abc")
        advanceUntilIdle()

        state.setEnabled("token-abc", 1, false)
        advanceUntilIdle()

        val snapshot = state.snapshot.value
        assertEquals("the last read pool stays visible", listOf("skill-1"), snapshot.skills.map { it.name })
        assertEquals("skills/archived", snapshot.failure?.code)
        assertTrue(snapshot.failure?.message.orEmpty().contains("archived"))
        assertFalse(snapshot.working)
        assertEquals("a refused write does not trigger a read", 1, backend.reads)
    }

    @Test
    fun `the pending entry asks the backend once and opens the primary session it answers`() = runTest {
        val backend = ScriptedSkills(
            list = { SkillPool(skills = listOf(ScriptedSkills.item(1)),
                pending = listOf(PendingSkill(versionId = 41, name = "pending-skill")), pendingCount = 1) },
        )
        val state = SkillsState(backend, this)
        state.load("token-abc")
        advanceUntilIdle()

        var opened: String? = null
        state.openPending("token-abc", 41) { opened = it }
        advanceUntilIdle()

        assertEquals(listOf(41L), backend.opened)
        assertEquals("ourfairy-user-2-primary", opened)
        assertEquals("the pending entry does not re-read the pool", 1, backend.reads)
        assertFalse(state.snapshot.value.working)
        assertNull(state.snapshot.value.failure)
    }

    @Test
    fun `a refused pending entry keeps the pool and the backend's code`() = runTest {
        val backend = ScriptedSkills(
            list = { SkillPool(skills = listOf(ScriptedSkills.item(1))) },
            reviewOpen = { throw IdentityRefused(404, "skills/not-found", "skill version 41 is not visible to this user") },
        )
        val state = SkillsState(backend, this)
        state.load("token-abc")
        advanceUntilIdle()

        var opened: String? = null
        state.openPending("token-abc", 41) { opened = it }
        advanceUntilIdle()

        assertNull(opened)
        assertEquals("skills/not-found", state.snapshot.value.failure?.code)
        assertEquals(listOf("skill-1"), state.snapshot.value.skills.map { it.name })
        assertFalse(state.snapshot.value.working)
    }

    @Test
    fun `an unreachable read leaves no loaded pool`() = runTest {
        val backend = ScriptedSkills(list = { throw IdentityUnreachable(java.io.IOException("down")) })
        val state = SkillsState(backend, this)

        state.load("token-abc")
        advanceUntilIdle()

        val snapshot = state.snapshot.value
        assertFalse(snapshot.loaded)
        assertTrue(snapshot.skills.isEmpty())
        assertTrue(snapshot.failure?.unreachable == true)
    }
}
