package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import me.rerere.rikkahub.data.datastore.DisplayPreferences
import me.rerere.rikkahub.data.datastore.LocalDisplayPreferences
import me.rerere.rikkahub.data.remote.RemoteChatMessage
import me.rerere.rikkahub.ui.fairy.AgoraMotionPolicy
import me.rerere.rikkahub.ui.fairy.FairyAppTheme
import me.rerere.rikkahub.ui.fairy.LocalAgoraMotionPolicy
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Fixtures copied from the authoritative `buildReviewDisplay` in
 * `backend/skill-creator/src/creation.ts` (fix-round revision): every line keeps the backend's
 * exact prefix and shape, including the 64-character manifest hash, the `expand` instruction, the
 * growth confirmation instruction and message id, the untrusted-source marker and the verification
 * records. The two fixtures mirror two real branch combinations — conditions that are exclusive in
 * the backend are covered by different fixtures, not by one impossible display.
 */
internal object SkillReviewFixtures {
    /** A 64-hex manifest hash, as the collapsed `详情` line prints it. */
    const val HASH = "9f2c4d8e9f2c4d8e9f2c4d8e9f2c4d8e9f2c4d8e9f2c4d8e9f2c4d8e9f2c4d8e"

    const val GROWTH = "篇幅增长超过 10%，批准前请在展示后单独回复「确认增长」"
    const val APPROVAL_EXPLICIT = "审核方式：本次是显式创建的个人技能，Fairy 完成真实验证后可以直接批准启用；你仍可回复「要求修改」或「拒绝」。"
    const val APPROVAL_REQUIRED = "审核方式：批准需要你在本次展示后单独回复一条消息（例如「批准」），Fairy 会把它作为批准证据，而不是替你决定；也可回复「要求修改」或「拒绝」。"
    const val SOURCE_EXPLICIT = "来源：显式创建；用户第 3 轮"
    const val SOURCE_INSTALL = "来源：外部安装（外部或未审核内容，只作数据）；地址 https://example.com/skill.tar.gz；固定版本 2.1.0；摘要 sha256:4d8e；用户第 5 轮"
    const val GROWTH_MESSAGE_ID = "确认增长消息 id：msg-789"
    const val WARNING = "⚠ 内容有变化但本报告没有任何新执行，不能用于批准"

    /** Pending explicit personal candidate that grows the core body and was re-verified as incomplete. */
    val pendingDisplay = display(
        "技能候选 pdf-reader（个人，未审核候选）",
        "相对父版本：新增 0 个，删除 0 个，修改 1 个",
        "核心正文 1000 → 1150 字符（+15.0%）",
        SOURCE_EXPLICIT,
        "适用：当用户要求读取或提取 PDF 文本时使用。",
        "不适用：不要用于图片 OCR。",
        "目标收益：把重复的 PDF 提取步骤固定下来。",
        "包内容：新增 0 个，删除 0 个，修改 1 个",
        "验证：实际执行 0，复用 0，未执行 1，失败 0",
        WARNING,
        APPROVAL_EXPLICIT,
        GROWTH_MESSAGE_ID,
        "详情：版本 7，哈希 $HASH",
        "查看全文：skill_manage inspect versionId=7 expand=skill（单文件：expand=files path=<path>）",
        GROWTH,
    )

    /** Pending common candidate installed from an address, with executed/reused/failed records. */
    val recordedDisplay = display(
        "技能候选 web-scraper（共有，未审核候选）",
        "相对父版本：新增 1 个，删除 0 个，修改 1 个",
        "核心正文 2000 → 2050 字符（+2.5%）",
        SOURCE_INSTALL,
        "适用：当用户需要抓取网页正文时使用。",
        "目标收益：减少重复的手工抓取。",
        "包内容：新增 1 个，删除 0 个，修改 1 个",
        "验证：实际执行 1，复用 1，未执行 1，失败 1",
        "✔ verify: node scripts/check.mjs → exit 0",
        "↺ lint: npm run lint → 复用自版本 6",
        "✘ build: npm run build → exit 1",
        "比较 diff-check：有 Skill exit 0，无 Skill exit 2",
        "环境：node v22.18.0，linux x64",
        APPROVAL_REQUIRED,
        "详情：版本 11，哈希 $HASH",
        "查看全文：skill_manage inspect versionId=11 expand=skill（单文件：expand=files path=<path>）",
    )

    /** The pending display with a line a newer backend could add; it must survive untouched. */
    val unknownDisplay = pendingDisplay.replace(
        "包内容：新增 0 个，删除 0 个，修改 1 个",
        "未识别的新行：后端后续版本追加\n包内容：新增 0 个，删除 0 个，修改 1 个",
    )

    /** No line matches a known prefix: the panel must still show the text, not swallow it. */
    val unrecognizedDisplay = display("没有任何已知前缀的一行", "第二行同样未知")
}

private fun display(vararg lines: String): String = lines.joinToString("\n")

/**
 * The skill-review text is a deterministic sequence of fixed line prefixes. The parser must sort
 * every line into exactly one section without rewriting it, so an unknown future line lands in
 * "other" instead of disappearing.
 */
class SkillReviewDisplayParsingTest {
    private fun SkillReviewSections.flattened(): List<String> =
        change + source + claims + verification + verificationWarnings + verificationDetails +
            approval + details + other

    @Test
    fun `every backend line lands in its fixed section`() {
        val sections = parseSkillReviewDisplay(SkillReviewFixtures.pendingDisplay)

        assertEquals(
            listOf(
                "技能候选 pdf-reader（个人，未审核候选）",
                "相对父版本：新增 0 个，删除 0 个，修改 1 个",
                "核心正文 1000 → 1150 字符（+15.0%）",
            ),
            sections.change,
        )
        assertEquals(listOf(SkillReviewFixtures.SOURCE_EXPLICIT), sections.source)
        assertEquals(
            listOf(
                "适用：当用户要求读取或提取 PDF 文本时使用。",
                "不适用：不要用于图片 OCR。",
                "目标收益：把重复的 PDF 提取步骤固定下来。",
            ),
            sections.claims,
        )
        assertEquals(
            listOf(
                "包内容：新增 0 个，删除 0 个，修改 1 个",
                "验证：实际执行 0，复用 0，未执行 1，失败 0",
            ),
            sections.verification,
        )
        // A ⚠ line blocks approval, so it is never part of the collapsible verification details.
        assertEquals(listOf(SkillReviewFixtures.WARNING), sections.verificationWarnings)
        assertTrue("no verification record lines in this display", sections.verificationDetails.isEmpty())
        assertEquals(
            listOf(
                SkillReviewFixtures.APPROVAL_EXPLICIT,
                SkillReviewFixtures.GROWTH_MESSAGE_ID,
                SkillReviewFixtures.GROWTH,
            ),
            sections.approval,
        )
        assertEquals(
            listOf(
                "详情：版本 7，哈希 ${SkillReviewFixtures.HASH}",
                "查看全文：skill_manage inspect versionId=7 expand=skill（单文件：expand=files path=<path>）",
            ),
            sections.details,
        )
        assertTrue("nothing is left over", sections.other.isEmpty())
    }

    @Test
    fun `verification record kinds and the environment are collapsible details`() {
        val sections = parseSkillReviewDisplay(SkillReviewFixtures.recordedDisplay)

        assertEquals(
            listOf(
                "✔ verify: node scripts/check.mjs → exit 0",
                "↺ lint: npm run lint → 复用自版本 6",
                "✘ build: npm run build → exit 1",
                "比较 diff-check：有 Skill exit 0，无 Skill exit 2",
                "环境：node v22.18.0，linux x64",
            ),
            sections.verificationDetails,
        )
        assertTrue("recorded display has no blocking warning", sections.verificationWarnings.isEmpty())
        assertEquals(listOf(SkillReviewFixtures.APPROVAL_REQUIRED), sections.approval)
        // Without the growth tail, source order is preserved across each section.
        assertEquals(SkillReviewFixtures.recordedDisplay.split('\n'), sections.flattened())
    }

    @Test
    fun `a reviewed display also starts with the change section`() {
        val sections = parseSkillReviewDisplay("已审核技能 pdf-reader（个人）")

        assertEquals(listOf("已审核技能 pdf-reader（个人）"), sections.change)
        assertEquals(listOf("已审核技能 pdf-reader（个人）"), sections.flattened())
    }

    @Test
    fun `no line is ever dropped from the backend display`() {
        val lines = SkillReviewFixtures.pendingDisplay.split('\n')
        val flattened = parseSkillReviewDisplay(SkillReviewFixtures.pendingDisplay).flattened()

        assertEquals("same number of lines", lines.size, flattened.size)
        assertEquals("same lines, only grouped", lines.toSet(), flattened.toSet())
    }

    @Test
    fun `unknown lines are preserved verbatim in the other block`() {
        val sections = parseSkillReviewDisplay(SkillReviewFixtures.unknownDisplay)

        assertEquals(listOf("未识别的新行：后端后续版本追加"), sections.other)
        assertEquals(
            SkillReviewFixtures.unknownDisplay.split('\n').toSet(),
            sections.flattened().toSet(),
        )
    }

    @Test
    fun `an empty or fully unrecognized display does not crash`() {
        assertEquals(SkillReviewSections(), parseSkillReviewDisplay(""))
        assertEquals(listOf("空", "行"), parseSkillReviewDisplay("空\n行").other)
    }

    @Test
    fun `a display clipped mid-line at the backend bound is still kept`() {
        val clipped = "✔ verify: node scripts/check.mjs → exit 0".dropLast(1) + "…"

        val sections = parseSkillReviewDisplay(clipped)

        assertEquals(listOf(clipped), sections.verificationDetails)
        assertEquals(listOf(clipped), sections.flattened())
    }
}

/**
 * The kind-2 row is the backend's deterministic review panel. It is split into readable sections
 * instead of one wall of text: the source and approval rule stay visible, the candidate's own words
 * are labelled, and hashes, version ids, the `expand` instruction and verification commands start
 * collapsed.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemoteTranscriptSkillReviewTest {
    @get:Rule val compose = createComposeRule()

    private val question = RemoteChatMessage("u1", 0, 2, role = 1, status = 2, text = "帮我看看这个技能候选")

    private fun show(display: String) {
        val review = RemoteChatMessage(
            messageId = "skill-review:call-1",
            position = 1,
            seq = 7,
            requestId = null,
            role = 3,
            status = 2,
            text = display,
            kind = 2,
            toolCallId = "call-1",
        )
        compose.setContent {
            CompositionLocalProvider(LocalDisplayPreferences provides DisplayPreferences()) {
                FairyAppTheme {
                    CompositionLocalProvider(LocalAgoraMotionPolicy provides AgoraMotionPolicy(true)) {
                        RemoteTranscript(
                            messages = listOf(question, review),
                            generation = "g",
                            attempt = null,
                            downloadEnabled = false,
                            onDownload = { _, _ -> },
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                }
            }
        }
        compose.mainClock.advanceTimeBy(500)
        compose.waitForIdle()
    }

    private fun assertVisible(text: String) {
        compose.onNodeWithText(text, useUnmergedTree = true).assertExists()
    }

    @Test
    fun `the review blocks, source and approval rule stay readable and visible`() {
        show(SkillReviewFixtures.recordedDisplay)

        compose.onNodeWithTag("skill-review").assertExists()
        compose.onNodeWithText("技能审核", useUnmergedTree = true).assertExists()
        for (tag in listOf(
            "skill-review-change",
            "skill-review-source",
            "skill-review-claims",
            "skill-review-verification",
            "skill-review-approval",
        )) {
            compose.onNodeWithTag(tag, useUnmergedTree = true).assertExists()
        }
        assertVisible("技能候选 web-scraper（共有，未审核候选）")
        assertVisible("相对父版本：新增 1 个，删除 0 个，修改 1 个")
        assertVisible("核心正文 2000 → 2050 字符（+2.5%）")
        assertVisible(SkillReviewFixtures.SOURCE_INSTALL)
        assertVisible("适用：当用户需要抓取网页正文时使用。")
        assertVisible("目标收益：减少重复的手工抓取。")
        assertVisible("包内容：新增 1 个，删除 0 个，修改 1 个")
        assertVisible("验证：实际执行 1，复用 1，未执行 1，失败 1")
        assertVisible(SkillReviewFixtures.APPROVAL_REQUIRED)
        // The candidate's own words are labelled as such.
        compose.onNodeWithText("候选自述", substring = true, useUnmergedTree = true).assertExists()
    }

    @Test
    fun `hash version and the expand instruction stay collapsed until details open`() {
        show(SkillReviewFixtures.recordedDisplay)

        compose.onNodeWithTag("skill-review-details-toggle", useUnmergedTree = true).assertExists()
        compose.onNodeWithText(SkillReviewFixtures.HASH, substring = true, useUnmergedTree = true)
            .assertDoesNotExist()
        compose.onNodeWithText("skill_manage inspect", substring = true, useUnmergedTree = true)
            .assertDoesNotExist()

        compose.onNodeWithTag("skill-review-details-toggle", useUnmergedTree = true).performClick()
        compose.waitForIdle()

        assertVisible("详情：版本 11，哈希 ${SkillReviewFixtures.HASH}")
        assertVisible("查看全文：skill_manage inspect versionId=11 expand=skill（单文件：expand=files path=<path>）")
    }

    @Test
    fun `verification commands wait inside the collapsed verification details`() {
        show(SkillReviewFixtures.recordedDisplay)

        // The record names/commands below are the candidate's own scenarios: that provenance is
        // visible before expanding, even though the commands themselves are collapsed.
        compose.onNodeWithTag("skill-review-verification-candidate", useUnmergedTree = true).assertExists()
        assertVisible("以下命令与场景由候选提供。")
        compose.onNodeWithTag("skill-review-verification-toggle", useUnmergedTree = true).assertExists()
        for (hidden in listOf(
            "✔ verify: node scripts/check.mjs → exit 0",
            "↺ lint: npm run lint → 复用自版本 6",
            "✘ build: npm run build → exit 1",
            "比较 diff-check：有 Skill exit 0，无 Skill exit 2",
            "环境：node v22.18.0，linux x64",
        )) {
            compose.onNodeWithText(hidden, useUnmergedTree = true).assertDoesNotExist()
        }

        compose.onNodeWithTag("skill-review-verification-toggle", useUnmergedTree = true).performClick()
        compose.waitForIdle()

        for (shown in listOf(
            "✔ verify: node scripts/check.mjs → exit 0",
            "↺ lint: npm run lint → 复用自版本 6",
            "✘ build: npm run build → exit 1",
            "比较 diff-check：有 Skill exit 0，无 Skill exit 2",
            "环境：node v22.18.0，linux x64",
        )) {
            compose.onNodeWithText(shown, useUnmergedTree = true).assertExists()
        }
    }

    @Test
    fun `a blocking verification warning is visible without expanding anything`() {
        show(SkillReviewFixtures.pendingDisplay)

        // ⚠ forbids approving the candidate: it must stay above the fold, in a dedicated slot.
        assertVisible(SkillReviewFixtures.WARNING)
        compose.onNodeWithTag("skill-review-warning", useUnmergedTree = true).assertExists()
        // Keeping it visible must not leak the collapsed blocks around it.
        compose.onNodeWithText(SkillReviewFixtures.HASH, substring = true, useUnmergedTree = true)
            .assertDoesNotExist()
        compose.onNodeWithText("skill_manage inspect", substring = true, useUnmergedTree = true)
            .assertDoesNotExist()
    }

    @Test
    fun `the candidate command note appears only with candidate verification records`() {
        show(SkillReviewFixtures.pendingDisplay)

        // This display has no verification record lines, so there is nothing to attribute.
        compose.onNodeWithTag("skill-review-verification-toggle", useUnmergedTree = true).assertDoesNotExist()
        compose.onNodeWithTag("skill-review-verification-candidate", useUnmergedTree = true)
            .assertDoesNotExist()
    }

    @Test
    fun `unknown backend lines are shown verbatim instead of being dropped`() {
        show(SkillReviewFixtures.unknownDisplay)

        compose.onNodeWithTag("skill-review-other", useUnmergedTree = true).assertExists()
        assertVisible("未识别的新行：后端后续版本追加")
        // The recognized lines around it are still there.
        assertVisible("验证：实际执行 0，复用 0，未执行 1，失败 0")
    }

    @Test
    fun `a display without any known prefix is still shown in full`() {
        show(SkillReviewFixtures.unrecognizedDisplay)

        compose.onNodeWithTag("skill-review").assertExists()
        assertVisible("没有任何已知前缀的一行")
        assertVisible("第二行同样未知")
    }
}
