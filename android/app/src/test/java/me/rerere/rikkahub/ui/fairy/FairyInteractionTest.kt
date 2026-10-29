package me.rerere.rikkahub.ui.fairy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * The interaction module's own seam: 当前表现 is asked of the module with remote-fact doubles, a
 * fixed clock and a seeded random, so no Android or Compose runtime is involved.
 */
class FairyInteractionTest {
    private val module = FairyInteraction(now = { 0L }, random = Random(7))
    private val main = FairyInteractionContext(sessionId = "main")
    private val other = FairyInteractionContext(sessionId = "other")

    private fun facts(
        connected: Boolean = true,
        connecting: Boolean = false,
        status: Int = 1,
        reasons: List<Int> = emptyList(),
        messages: Int? = 0,
        reply: String? = null,
    ) = FairyRemoteFacts(
        connected = connected,
        connecting = connecting,
        activityStatus = status,
        activityReasons = reasons,
        transcript = messages?.let { FairyTranscript(it, reply) },
    )

    private fun presented(remote: FairyRemoteFacts? = facts()): FairyWindowState =
        module.window(remote)

    @Test fun `a session that says nothing yet is CONNECTING, never quiet`() {
        val window = presented(remote = null)

        assertEquals(FairyPresence.CONNECTING, window.presence)
        assertFalse("没有事实时窗口不展开", window.expanded)
        assertFalse("没有事实时不等待回复", window.awaitingReply)
    }

    @Test fun `a session still opening is CONNECTING`() {
        assertEquals(FairyPresence.CONNECTING, presented(facts(connecting = true)).presence)
    }

    @Test fun `a disconnected session is OFFLINE even when its activity still claimed work`() {
        val window = presented(facts(connected = false, status = 2, reasons = listOf(1)))

        assertEquals(FairyPresence.OFFLINE, window.presence)
    }

    @Test fun `unknown activity is CONNECTING, never quiet`() {
        // A session the backend has not described yet: the shared snapshot reports unknown rather
        // than silence, and 当前表现 must say so.
        assertEquals(FairyPresence.CONNECTING, presented(facts(status = 0)).presence)
    }

    @Test fun `a quiet session is IDLE`() {
        assertEquals(FairyPresence.IDLE, presented(facts(status = 1)).presence)
    }

    @Test fun `an active session without reply text is THINKING`() {
        val window = presented(facts(status = 2, reasons = listOf(2)))

        assertEquals(FairyPresence.THINKING, window.presence)
        assertFalse("不是等回复的运行时窗口不展开", window.awaitingReply)
    }

    @Test fun `an executing run without reply text is awaiting its reply`() {
        val window = presented(facts(status = 2, reasons = listOf(1)))

        assertEquals(FairyPresence.THINKING, window.presence)
        assertTrue("reasons 含 execution 且还没有输出时，窗口应展开等待", window.awaitingReply)
        // 这条会话没有消息，所以按既有规则它本身就是展开的；等待回复只决定折叠的时机。
        assertTrue("已连接且没有消息的会话展开眼屏", window.expanded)
    }

    @Test fun `an active session with reply text is SPEAKING`() {
        val window = presented(facts(status = 2, reasons = listOf(1), reply = "正在生成"))

        assertEquals(FairyPresence.SPEAKING, window.presence)
        assertFalse("已经出现输出时不再等待回复", window.awaitingReply)
    }

    @Test fun `blank reply text is not output`() {
        assertEquals(
            FairyPresence.THINKING,
            presented(facts(status = 2, reasons = listOf(1), reply = " ")).presence,
        )
    }

    @Test fun `an empty connected session opens the window`() {
        assertTrue("已连接且尚无消息的会话展开眼屏", presented(facts()).expanded)
        assertFalse("有消息的会话不展开眼屏", presented(facts(messages = 1)).expanded)
    }

    @Test fun `the five branches keep their order`() {
        // Each case lists every condition that would also match a later branch: only the branch
        // order makes the assertion hold.
        assertEquals(
            "连接中优先于离线与活动",
            FairyPresence.CONNECTING,
            presented(facts(connecting = true, connected = false, status = 0)).presence,
        )
        assertEquals(
            "离线优先于未知活动",
            FairyPresence.OFFLINE,
            presented(facts(connected = false, status = 0)).presence,
        )
        assertEquals(
            "未知活动优先于工作",
            FairyPresence.CONNECTING,
            presented(facts(status = 0, reasons = listOf(1), reply = "文本")).presence,
        )
        assertEquals(
            "有输出时是 SPEAKING 而不是 THINKING",
            FairyPresence.SPEAKING,
            presented(facts(status = 2, reasons = listOf(1), reply = "文本")).presence,
        )
    }

    @Test fun `recording a presentation keeps whose it is and what it showed`() {
        module.show(main, facts(status = 2))

        assertEquals(main, module.state.value.context)
        assertEquals(FairyPresence.THINKING, module.state.value.window.presence)
    }

    @Test fun `presenting a different context retires the facts of the previous one`() {
        module.show(main, facts(status = 2))
        assertEquals(FairyPresence.THINKING, module.state.value.window.presence)

        module.show(other, null)
        assertEquals(other, module.state.value.context)
        assertNull("换上下文后旧事实不得留在状态里", module.state.value.facts)
        assertEquals(
            "换上下文后旧事实不得继续驱动表现",
            FairyPresence.CONNECTING,
            module.state.value.window.presence,
        )
    }

    @Test fun `presenting the same context again keeps what is already known`() {
        module.show(main, facts(status = 2, reasons = listOf(1)))

        module.show(main, facts(status = 2, reasons = listOf(1)))
        assertEquals(FairyPresence.THINKING, module.state.value.window.presence)
        assertTrue(module.state.value.window.awaitingReply)
    }

    @Test fun `signing out holds nothing`() {
        module.show(main, facts(status = 2))

        module.show(null, null)
        assertNull(module.state.value.context)
        assertNull("没有当前会话时不得留着上一个会话的事实", module.state.value.facts)
        assertEquals(FairyPresence.CONNECTING, module.state.value.window.presence)
    }

    @Test fun `the presence rule reads neither the clock nor the random source`() {
        // 当前表现 must be a function of the facts alone. A module whose clock and random source
        // throw when touched proves the rule takes nothing from them; #261 is where they get read.
        val strict = FairyInteraction(
            now = { error("当前表现不得读取时钟") },
            random = object : Random() {
                override fun nextBits(bitCount: Int): Int = error("当前表现不得读取随机源")
            },
        )
        assertEquals(FairyPresence.IDLE, strict.window(facts(status = 1)).presence)
        assertEquals(FairyPresence.CONNECTING, strict.window(null).presence)
        strict.show(main, facts(status = 2, reasons = listOf(1)))
        assertEquals(FairyPresence.THINKING, strict.state.value.window.presence)
    }

    @Test fun `presenting the same context again replaces its facts`() {
        module.show(main, facts(status = 2))
        assertEquals(FairyPresence.THINKING, module.state.value.window.presence)

        module.show(main, facts(status = 1))
        assertEquals(
            "同一上下文的新事实必须替换旧事实，而不是被当作保持原状",
            FairyPresence.IDLE,
            module.state.value.window.presence,
        )
    }

    @Test fun `the session facts keep the snapshot's own answer about unknown`() {
        // `RemoteChatSnapshot.activity` is the one place that decides whether a prefix establishes
        // anything; these two cases differ only in that answer, so copying it is what is checked.
        fun snapshot(consumedThrough: Long) = me.rerere.rikkahub.data.remote.RemoteChatSnapshot(
            sessionId = "main",
            connected = true,
            initialized = true,
            consumedThrough = consumedThrough,
            projection = me.rerere.rikkahub.data.remote.RemoteChatProjection(
                sessionId = "main",
                cursor = 0,
                activity = me.rerere.rikkahub.data.remote.RemoteActivity(status = 1),
            ),
        )

        assertEquals(
            "未追平到投影游标时，快照的答案就是未知",
            0,
            snapshot(consumedThrough = -1).fairyFacts().activityStatus,
        )
        assertEquals(
            "追平之后，快照的答案就是它报的安静",
            1,
            snapshot(consumedThrough = 0).fairyFacts().activityStatus,
        )
    }

    @Test fun `the current session falls back to the account's main session`() {
        fun listed(selectedId: String?, primary: String?) =
            me.rerere.rikkahub.data.remote.SessionsSnapshot(
                primarySessionId = primary,
                selectedId = selectedId,
            )

        assertEquals("chosen", listed(selectedId = "chosen", primary = "main").currentSessionId())
        assertEquals("main", listed(selectedId = null, primary = "main").currentSessionId())
        assertEquals(null, listed(selectedId = null, primary = null).currentSessionId())
    }

    @Test fun `the facts a page renders are transcribed from the session snapshot`() {
        val snapshot = me.rerere.rikkahub.data.remote.RemoteChatSnapshot(
            sessionId = "main",
            connected = true,
            initialized = true,
            consumedThrough = 0,
            projection = me.rerere.rikkahub.data.remote.RemoteChatProjection(
                sessionId = "main",
                cursor = 0,
                activity = me.rerere.rikkahub.data.remote.RemoteActivity(
                    status = 2, reasons = listOf(1),
                ),
            ),
        )

        module.show(main, snapshot.fairyFacts())

        assertEquals(FairyPresence.THINKING, module.state.value.window.presence)
        assertTrue(module.state.value.window.awaitingReply)
    }
}
