package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import me.rerere.rikkahub.data.datastore.DisplayPreferences
import me.rerere.rikkahub.data.datastore.LocalDisplayPreferences
import me.rerere.rikkahub.data.remote.AccountSession
import me.rerere.rikkahub.data.remote.AgentSummary
import me.rerere.rikkahub.data.remote.IdentityBackend
import me.rerere.rikkahub.data.remote.IdentityRefused
import me.rerere.rikkahub.data.remote.IdentityUser
import me.rerere.rikkahub.data.remote.InMemoryCredentialStore
import me.rerere.rikkahub.data.remote.PendingSkill
import me.rerere.rikkahub.data.remote.SignedIn
import me.rerere.rikkahub.data.remote.SkillActionTarget
import me.rerere.rikkahub.data.remote.SkillActionScopes
import me.rerere.rikkahub.data.remote.SkillPool
import me.rerere.rikkahub.data.remote.SkillPoolItem
import me.rerere.rikkahub.data.remote.SkillPoolState
import me.rerere.rikkahub.data.remote.SkillReviewResult
import me.rerere.rikkahub.data.remote.SkillScope
import me.rerere.rikkahub.data.remote.SkillVersionStatus
import me.rerere.rikkahub.data.remote.SkillsBackend
import me.rerere.rikkahub.ui.fairy.FairyAppTheme
import me.rerere.rikkahub.ui.fairy.ProvideAgoraMotionPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The skills page renders the backend's derived facts and performs only the one action this
 * ticket owns: the per-item enable switch. Scope labels, pool states, the shadow, and the
 * archive scope are asserted as strings the backend sent, not values the page could derive.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SkillsPageTest {
    @get:Rule val compose = createComposeRule()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val user = IdentityUser(2, "agent-two")
    private val identityBackend = object : IdentityBackend {
        override suspend fun session(token: String) = user
        override suspend fun signIn(name: String, password: String) = SignedIn("test", user)
        override suspend fun register(inviteCode: String, name: String, password: String) = error("not used")
        override suspend fun createInvite(token: String) = error("not used")
        override suspend fun agents(token: String): List<AgentSummary> = emptyList()
        override suspend fun signOut(token: String) = Unit
    }
    private val account = AccountSession(identityBackend, InMemoryCredentialStore("test"))

    @After
    fun close() {
        scope.cancel()
    }

    private class ScriptedSkills(
        var list: suspend () -> SkillPool,
        var setEnabled: suspend (Long, Boolean) -> Unit = { _, _ -> },
        var reviewOpen: suspend (Long) -> String = { "ourfairy-user-2-primary" },
        var archive: suspend (Long) -> Unit = { _ -> },
        var restore: suspend (Long) -> Unit = { _ -> },
    ) : SkillsBackend {
        val writes = mutableListOf<Pair<Long, Boolean>>()
        val archived = mutableListOf<Long>()
        val restored = mutableListOf<Long>()
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
            return SkillPoolItem(skillId, "skill-$skillId", scope = SkillScope.PERSONAL, state = SkillPoolState.IN_CATALOG, enabled = enabled)
        }

        override suspend fun archive(token: String, skillId: Long): SkillPoolItem {
            archived += skillId
            archive(skillId)
            return SkillPoolItem(skillId, "skill-$skillId", scope = SkillScope.PERSONAL, state = SkillPoolState.ARCHIVED, enabled = true)
        }

        override suspend fun restore(token: String, skillId: Long): SkillPoolItem {
            restored += skillId
            restore(skillId)
            return SkillPoolItem(skillId, "skill-$skillId", scope = SkillScope.PERSONAL, state = SkillPoolState.DISABLED, enabled = false)
        }
    }

    private fun item(
        id: Long,
        name: String,
        scope: Int,
        state: Int,
        enabled: Boolean,
        archiveScope: Int = if (scope == SkillScope.COMMON) 2 else 1,
    ) = SkillPoolItem(
        skillId = id,
        name = name,
        description = "后端派生描述",
        scope = scope,
        state = state,
        enabled = enabled,
        currentVersionId = 10 + id,
        actions = SkillActionScopes(
            toggle = 1,
            archive = archiveScope,
            restore = archiveScope,
        ),
    )

    private fun show(backend: SkillsBackend, onOpenConversation: (String) -> Unit = {}) {
        compose.mainClock.autoAdvance = false
        runBlocking { account.restore() }
        compose.setContent {
            CompositionLocalProvider(LocalDisplayPreferences provides DisplayPreferences()) {
                FairyAppTheme {
                    ProvideAgoraMotionPolicy(appReduceMotion = true) {
                        SkillsPage(onBack = {}, session = account, backend = backend, onOpenConversation = onOpenConversation)
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
    }

    @Test
    fun `the page renders the backend's states, scopes, action scopes and pending entry`() {
        var opened: String? = null
        val backend = ScriptedSkills(list = {
            SkillPool(
                skills = listOf(
                    item(1, "archived-skill", SkillScope.COMMON, SkillPoolState.ARCHIVED, enabled = true),
                    item(2, "personal-skill", SkillScope.PERSONAL, SkillPoolState.IN_CATALOG, enabled = true),
                    item(3, "disabled-skill", SkillScope.COMMON, SkillPoolState.DISABLED, enabled = false),
                ),
                pending = listOf(PendingSkill(versionId = 41, name = "pending-skill")),
                pendingCount = 1,
            )
        })
        show(backend) { opened = it }

        compose.onNodeWithText("archived-skill").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("已归档").assertExists()
        compose.onNodeWithText("已禁用").assertExists()
        compose.onNodeWithText("进入目录").assertExists()
        compose.onAllNodesWithText("共有").assertCountEquals(2)
        compose.onAllNodesWithText("个人").assertCountEquals(2)
        compose.onAllNodesWithText("归档/恢复范围：全部用户").assertCountEquals(2)
        compose.onAllNodesWithText("归档/恢复范围：仅本人").assertCountEquals(1)
        compose.onNodeWithText("pending-skill").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        assertEquals("the pending entry asks the backend for that candidate", listOf(41L), backend.opened)
        compose.runOnIdle { assertEquals("ourfairy-user-2-primary", opened) }
    }

    @Test
    fun `the page shows the backend's pending-revision state and growth flag without computing them`() {
        val backend = ScriptedSkills(list = {
            SkillPool(
                skills = listOf(
                    item(2, "revised-skill", SkillScope.PERSONAL, SkillPoolState.IN_CATALOG, enabled = true)
                        .copy(pendingRevision = true),
                    item(4, "plain-skill", SkillScope.PERSONAL, SkillPoolState.IN_CATALOG, enabled = true),
                ),
                pending = listOf(
                    PendingSkill(versionId = 42, name = "growth-skill", growthExceeded = true),
                    PendingSkill(versionId = 43, name = "small-skill", growthExceeded = false),
                ),
                pendingCount = 2,
            )
        })
        show(backend)

        // The chip sits inside a merged clickable row, so its tag lives in the
        // unmerged tree.
        compose.onNodeWithTag("skill-pending-revision-2", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithText("有待审修订", useUnmergedTree = true).assertCountEquals(1)
        compose.onAllNodesWithTag("skill-pending-revision-4", useUnmergedTree = true).assertCountEquals(0)

        compose.onNodeWithTag("skill-growth-42", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithText("需确认增长", useUnmergedTree = true).assertCountEquals(1)
        compose.onAllNodesWithTag("skill-growth-43", useUnmergedTree = true).assertCountEquals(0)
    }

    @Test
    fun `a toggle asks the backend and the switch follows the fresh read`() {
        var enabled = true
        val backend = ScriptedSkills(
            list = {
                SkillPool(skills = listOf(item(2, "personal-skill", SkillScope.PERSONAL,
                    if (enabled) SkillPoolState.IN_CATALOG else SkillPoolState.DISABLED, enabled)))
            },
            setEnabled = { _, next -> enabled = next },
        )
        show(backend)

        compose.onNodeWithTag("skill-switch-2").assertIsOn().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        assertEquals(listOf(2L to false), backend.writes)
        assertEquals("the page re-read the pool after the accepted write", 2, backend.reads)
        compose.onNodeWithTag("skill-switch-2").assertIsOff()
        compose.onNodeWithText("已禁用").assertExists()
    }

    @Test
    fun `archive and restore call the backend and the control follows the fresh read`() {
        var archived = false
        val backend = ScriptedSkills(
            list = {
                SkillPool(skills = listOf(item(2, "personal-skill", SkillScope.PERSONAL,
                    if (archived) SkillPoolState.ARCHIVED else SkillPoolState.IN_CATALOG, enabled = true)))
            },
            archive = { archived = true },
            restore = { archived = false },
        )
        show(backend)

        compose.onNodeWithTag("skill-archive-2").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        assertEquals(listOf(2L), backend.archived)
        compose.onNodeWithText("已归档").assertExists()
        compose.onNodeWithTag("skill-restore-2").performScrollTo().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        assertEquals(listOf(2L), backend.restored)
        compose.onNodeWithText("进入目录").assertExists()
        assertEquals("each write re-read the pool", 3, backend.reads)
    }

    @Test
    fun `a lifecycle action the backend does not offer is not rendered`() {
        val backend = ScriptedSkills(list = {
            SkillPool(skills = listOf(item(5, "common-skill", SkillScope.COMMON, SkillPoolState.IN_CATALOG,
                enabled = true, archiveScope = SkillActionTarget.NONE)))
        })
        show(backend)

        compose.onNodeWithText("common-skill").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("skill-archive-5").assertDoesNotExist()
        compose.onNodeWithTag("skill-restore-5").assertDoesNotExist()
        compose.onAllNodesWithText("归档/恢复范围：全部用户").assertCountEquals(0)
    }

    @Test
    fun `recent decisions render the backend's status and scope`() {
        val backend = ScriptedSkills(list = {
            SkillPool(
                skills = listOf(item(2, "personal-skill", SkillScope.PERSONAL, SkillPoolState.IN_CATALOG, enabled = true)),
                reviewResults = listOf(
                    SkillReviewResult(versionId = 51, skillId = 9, name = "shared-approved", scope = SkillScope.COMMON,
                        status = SkillVersionStatus.APPROVED, decidedAt = 100, proposer = true),
                    SkillReviewResult(versionId = 52, skillId = 10, name = "personal-rejected", scope = SkillScope.PERSONAL,
                        status = SkillVersionStatus.REJECTED, decidedAt = 101, proposer = false),
                ),
            )
        })
        show(backend)

        compose.onNodeWithText("最近审核结果").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("shared-approved").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("已通过").assertExists()
        compose.onNodeWithText("personal-rejected").assertExists()
        compose.onNodeWithText("已拒绝").assertExists()
    }

    @Test
    fun `a refused toggle keeps the pool and shows the backend's code`() {
        val backend = ScriptedSkills(
            list = {
                // The page read the item before it was archived; the toggle is refused because
                // the backend has since archived it.
                SkillPool(skills = listOf(item(1, "archived-skill", SkillScope.COMMON, SkillPoolState.IN_CATALOG, enabled = true)))
            },
            setEnabled = { _, _ ->
                throw IdentityRefused(409, "skills/archived", "skill \"archived-skill\" is archived")
            },
        )
        show(backend)

        compose.onNodeWithTag("skill-switch-1").assertIsOn().performClick()
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()

        compose.onNodeWithText("skills/archived: skill \"archived-skill\" is archived").assertExists()
        compose.onNodeWithText("archived-skill").assertExists()
    }
}
