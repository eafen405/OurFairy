package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
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
 * The skills page renders the backend's derived facts and performs only the actions this ticket
 * owns: the per-item enable switch and the archive/restore lifecycle. The page groups the pool by
 * the backend's own state, expands and collapses those groups, filters the names locally and shows
 * the backend's pending count; scope labels, pool states, the shadow and the archive scope are
 * asserted as facts the backend sent, not values the page could derive.
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

    private fun settle() {
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
        // An injected tap is handled inside a frame, so its recomposition renders in the next one.
        compose.mainClock.advanceTimeBy(1_000)
        compose.waitForIdle()
    }

    @Test
    fun `the pool groups skills by backend state with the backend's counts and expands on tap`() {
        val backend = ScriptedSkills(list = {
            SkillPool(
                skills = listOf(
                    item(1, "archived-skill", SkillScope.COMMON, SkillPoolState.ARCHIVED, enabled = true),
                    item(2, "personal-skill", SkillScope.PERSONAL, SkillPoolState.IN_CATALOG, enabled = true),
                    item(3, "disabled-skill", SkillScope.COMMON, SkillPoolState.DISABLED, enabled = false),
                    item(4, "catalog-skill", SkillScope.PERSONAL, SkillPoolState.IN_CATALOG, enabled = true),
                    item(5, "shadowed-skill", SkillScope.COMMON, SkillPoolState.SHADOWED, enabled = true),
                ),
                pending = listOf(PendingSkill(versionId = 41, name = "pending-skill")),
                pendingCount = 1,
            )
        })
        show(backend)

        // Four groups, in pool-state order, with the backend's counts. The headings are the
        // backend's own state strings, and they sit inside a clickable row.
        compose.onNodeWithTag("skill-group-title-1", useUnmergedTree = true).assertTextEquals("进入目录")
        compose.onNodeWithTag("skill-group-count-1", useUnmergedTree = true).assertTextEquals("2")
        compose.onNodeWithTag("skill-group-title-2", useUnmergedTree = true).assertTextEquals("被同名个人技能遮蔽")
        compose.onNodeWithTag("skill-group-count-2", useUnmergedTree = true).assertTextEquals("1")
        compose.onNodeWithTag("skill-group-title-3", useUnmergedTree = true).assertTextEquals("已禁用")
        compose.onNodeWithTag("skill-group-count-3", useUnmergedTree = true).assertTextEquals("1")
        compose.onNodeWithTag("skill-group-title-4", useUnmergedTree = true).assertTextEquals("已归档")
        compose.onNodeWithTag("skill-group-count-4", useUnmergedTree = true).assertTextEquals("1")

        // Only the in-catalog group is open by default; the other rows are not rendered at all.
        compose.onNodeWithTag("skill-item-2").assertExists()
        compose.onNodeWithTag("skill-item-4").assertExists()
        compose.onNodeWithTag("skill-item-1").assertDoesNotExist()
        compose.onNodeWithTag("skill-item-3").assertDoesNotExist()
        compose.onNodeWithTag("skill-item-5").assertDoesNotExist()

        // Tapping a heading opens that one group; tapping it again closes it.
        compose.onNodeWithTag("skill-group-2").performScrollTo().performClick()
        settle()
        compose.onNodeWithTag("skill-item-5").assertExists()
        compose.onNodeWithTag("skill-item-1").assertDoesNotExist()

        compose.onNodeWithTag("skill-group-2").performScrollTo().performClick()
        settle()
        compose.onNodeWithTag("skill-item-5").assertDoesNotExist()
        compose.onNodeWithTag("skill-item-1").assertDoesNotExist()
    }

    @Test
    fun `the page renders the backend's scopes, action scopes and pending entry across the groups`() {
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

        // The pending entry is clicked before the pool is expanded: the row and the assertion are
        // about the one action this list owns, and the pool's groups are checked afterwards.
        compose.onNodeWithText("pending-skill").performScrollTo().performClick()
        settle()
        assertEquals("the pending entry asks the backend for that candidate", listOf(41L), backend.opened)
        compose.runOnIdle { assertEquals("ourfairy-user-2-primary", opened) }

        compose.onNodeWithTag("skill-group-3").performScrollTo().performClick()
        settle()
        compose.onNodeWithTag("skill-group-4").performScrollTo().performClick()
        settle()

        compose.onNodeWithText("archived-skill").performScrollTo().assertIsDisplayed()
        compose.onAllNodesWithText("共有").assertCountEquals(2)
        compose.onAllNodesWithText("个人").assertCountEquals(2)
        compose.onAllNodesWithText("归档/恢复范围：全部用户").assertCountEquals(2)
        compose.onAllNodesWithText("归档/恢复范围：仅本人").assertCountEquals(1)
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
    fun `the header shows the backend's pending count rather than the pending list length`() {
        val backend = ScriptedSkills(list = {
            SkillPool(
                skills = emptyList(),
                pending = listOf(PendingSkill(versionId = 41, name = "pending-skill")),
                pendingCount = 3,
            )
        })
        show(backend)

        compose.onAllNodesWithText("待审 3", useUnmergedTree = true).assertCountEquals(1)
        compose.onNodeWithText("pending-skill").assertExists()
    }

    @Test
    fun `a toggle asks the backend and the switch follows the fresh read in its new group`() {
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
        settle()

        assertEquals(listOf(2L to false), backend.writes)
        assertEquals("the page re-read the pool after the accepted write", 2, backend.reads)
        // The backend now reports DISABLED, so the row moved into the collapsed group; open it.
        compose.onNodeWithTag("skill-group-3").performScrollTo().performClick()
        settle()
        compose.onNodeWithTag("skill-switch-2").performScrollTo().assertIsOff()
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
        settle()
        assertEquals(listOf(2L), backend.archived)
        // The backend's fresh read moved the item into the archived group: reachable only there.
        compose.onNodeWithTag("skill-item-2").assertDoesNotExist()
        compose.onNodeWithTag("skill-group-title-4", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("skill-group-4").performScrollTo().performClick()
        settle()
        compose.onNodeWithTag("skill-restore-2").performScrollTo().performClick()
        settle()
        assertEquals(listOf(2L), backend.restored)
        compose.onNodeWithTag("skill-item-2").assertExists()
        compose.onNodeWithTag("skill-group-4").assertDoesNotExist()
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
    fun `search filters the pool by name locally, case-insensitively and trimmed`() {
        val backend = ScriptedSkills(list = {
            SkillPool(
                skills = listOf(
                    item(1, "Archived Weekly", SkillScope.COMMON, SkillPoolState.ARCHIVED, enabled = true),
                    item(2, "Weekly Report", SkillScope.PERSONAL, SkillPoolState.IN_CATALOG, enabled = true),
                    item(3, "daily-standup", SkillScope.PERSONAL, SkillPoolState.IN_CATALOG, enabled = true),
                ),
            )
        })
        show(backend)
        assertEquals(1, backend.reads)

        compose.onNodeWithTag("skills-search").performTextInput("  WEEKLY ")
        settle()

        compose.onNodeWithTag("skill-item-2").assertExists()
        // A match inside a collapsed group is still shown: a search that hides it would lie.
        compose.onNodeWithTag("skill-item-1").assertExists()
        compose.onNodeWithTag("skill-item-3").assertDoesNotExist()
        compose.runOnIdle { assertEquals("search filters locally", 1, backend.reads) }

        compose.onNodeWithTag("skills-search").performTextClearance()
        settle()
        compose.onNodeWithTag("skill-item-3").assertExists()
        compose.onNodeWithTag("skill-item-1").assertDoesNotExist()
        compose.runOnIdle { assertEquals("clearing the search only recomposes", 1, backend.reads) }
    }

    @Test
    fun `search with no match says so locally`() {
        val backend = ScriptedSkills(list = {
            SkillPool(skills = listOf(item(2, "personal-skill", SkillScope.PERSONAL, SkillPoolState.IN_CATALOG, enabled = true)))
        })
        show(backend)

        compose.onNodeWithTag("skills-search").performTextInput("no-such-skill")
        settle()

        compose.onNodeWithTag("skills-search-empty").assertTextEquals("没有匹配的技能。")
        compose.onNodeWithTag("skill-item-2").assertDoesNotExist()
        compose.runOnIdle { assertEquals("no request for a local miss", 1, backend.reads) }
    }

    @Test
    fun `the row description is shortened to one sentence and capped`() {
        val longSentence = "长".repeat(200)
        val backend = ScriptedSkills(list = {
            SkillPool(
                skills = listOf(
                    item(2, "two-sentence", SkillScope.PERSONAL, SkillPoolState.IN_CATALOG, enabled = true)
                        .copy(description = "第一句说明。第二句是完整却很长很长的补充说明，不应出现在选择池里。"),
                    item(3, "long-sentence", SkillScope.PERSONAL, SkillPoolState.IN_CATALOG, enabled = true)
                        .copy(description = longSentence),
                    item(4, "short-line", SkillScope.PERSONAL, SkillPoolState.IN_CATALOG, enabled = true)
                        .copy(description = "只有一句没有句号"),
                ),
            )
        })
        show(backend)

        compose.onNodeWithTag("skill-description-2").performScrollTo().assertTextEquals("第一句说明。")
        compose.onNodeWithTag("skill-description-3").performScrollTo().assertTextEquals("长".repeat(96) + "…")
        compose.onNodeWithTag("skill-description-4").performScrollTo().assertTextEquals("只有一句没有句号")
        compose.onAllNodesWithText(longSentence).assertCountEquals(0)
    }

    @Test
    fun `a known refusal is shown in the page's own words`() {
        val backend = ScriptedSkills(list = {
            throw IdentityRefused(401, "skills/unauthorized", "present a live session credential")
        })
        show(backend)

        compose.onNodeWithTag("skills-failure").assertTextEquals("登录已失效，请重新登录后再读取技能。")
        compose.onAllNodesWithText("skills/unauthorized: present a live session credential").assertCountEquals(0)
    }

    @Test
    fun `a refused toggle keeps the pool and localizes the backend's known code`() {
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
        settle()

        compose.onNodeWithTag("skills-failure").assertTextEquals("该技能已归档，请先恢复再操作。")
        compose.onAllNodesWithText("skills/archived: skill \"archived-skill\" is archived").assertCountEquals(0)
        compose.onNodeWithText("archived-skill").assertExists()
    }

    @Test
    fun `an unknown refusal keeps the backend's own code and message`() {
        val backend = ScriptedSkills(list = {
            throw IdentityRefused(418, "skills/teapot", "the kettle is short and stout")
        })
        show(backend)

        compose.onNodeWithTag("skills-failure")
            .assertTextEquals("skills/teapot: the kettle is short and stout")
    }
}
