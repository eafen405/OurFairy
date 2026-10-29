package me.rerere.rikkahub.ui.fairy

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/**
 * The interaction module's own seam: 当前表现, 待机 and 台词 are asked of the module with
 * remote-fact doubles, a fixed clock, a seeded random and an in-memory line memory, so no Android
 * or Compose runtime is involved.
 */
class FairyInteractionTest {
    /** The module's clock: only this test moves it. */
    private var clock = 0L

    /** Stands in for [FairyUiMemory]: the same pick/record rule, without SharedPreferences. */
    private val lines = FakeLines()

    private val module = FairyInteraction(now = { clock }, random = Random(7), lines = lines)
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

    /** One page heartbeat at [at]; the pages pulse every 500 ms, tests pulse at the decision. */
    private fun tickAt(at: Long) {
        clock = at
        module.tick()
    }

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
        // 当前表现 must be a function of the facts alone. A module whose clock, random source and
        // line memory throw when touched proves the rule takes nothing from them; 待机 and 台词 are
        // what get to read them.
        val strictRandom = object : Random() {
            override fun nextBits(bitCount: Int): Int = error("当前表现不得读取随机源")
        }
        val strictLines = object : FairyLineMemory {
            override val recentLines: List<Int> get() = error("当前表现不得读取台词记忆")
            override fun nextLine(pool: List<Int>, avoid: Int, random: Random): FairyLine =
                error("当前表现不得写入台词记忆")
        }
        val strict = FairyInteraction(
            now = { error("当前表现不得读取时钟") },
            random = strictRandom,
            lines = strictLines,
        )
        assertEquals(FairyPresence.IDLE, strict.window(facts(status = 1)).presence)
        assertEquals(FairyPresence.CONNECTING, strict.window(null).presence)

        // show() reads the clock once to arm 待机, but the 当前表现 it records is still the rule's
        // pure answer: neither the random source nor the line memory is touched.
        val recording = FairyInteraction(now = { 0L }, random = strictRandom, lines = strictLines)
        recording.show(main, facts(status = 2, reasons = listOf(1)))
        assertEquals(FairyPresence.THINKING, recording.state.value.window.presence)
        assertTrue(recording.state.value.window.awaitingReply)
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

    // --- 待机与台词 (#261) -------------------------------------------------------------------

    @Test fun `the first idle line waits forty-five seconds`() {
        module.show(main, facts())

        tickAt(FIRST_LINE_MS - 1)
        assertNull("不到四十五秒不得播台词", module.state.value.caption)

        tickAt(FIRST_LINE_MS)
        val caption = module.state.value.caption
        assertNotNull("四十五秒后首页应有一条待机台词", caption)
        assertTrue("首页台词取自既有 homePool", caption!!.id in FairyLines.homePool)
        assertEquals(
            "首页台词沿用 HOME_AVOID",
            FairyLines.homePool to FairyLines.HOME_AVOID,
            lines.picks.single(),
        )
    }

    @Test fun `three idle minutes put the screen to sleep with a sleep line`() {
        module.show(main, facts())
        // The page pulses every 500 ms, so the first line plays and finishes before stand-by.
        tickAt(FIRST_LINE_MS)
        module.captionFinished()
        tickAt(140_000L)
        module.captionFinished()

        tickAt(SLEEP_AT_MS - 1)
        assertFalse("三分之四秒前不进入待机", module.state.value.asleep)

        tickAt(SLEEP_AT_MS)
        assertTrue("三分钟无操作后屏幕进入待机", module.state.value.asleep)
        val caption = module.state.value.caption
        assertNotNull("待机时应说出待机台词", caption)
        assertTrue("待机台词取自既有 sleepPool", caption!!.id in FairyLines.sleepPool)
        assertEquals(
            "待机台词沿用 avoid = 0",
            FairyLines.sleepPool to 0,
            lines.picks.last(),
        )
    }

    @Test fun `stand-by waits for a line that is still playing`() {
        module.show(main, facts())
        tickAt(FIRST_LINE_MS)
        val playing = module.state.value.caption
        assertNotNull(playing)

        tickAt(SLEEP_AT_MS)
        assertFalse("台词还在播时不进入待机", module.state.value.asleep)
        assertEquals("台词不会因为空闲变长而换一条", playing, module.state.value.caption)

        module.captionFinished()
        module.tick()
        assertTrue("台词结束后，已经超过三分钟的空闲立刻进入待机", module.state.value.asleep)
    }

    @Test fun `a touch resets the idle clock and the next line waits again`() {
        module.show(main, facts())
        tickAt(FIRST_LINE_MS)
        val first = module.state.value.caption!!
        module.captionFinished()

        clock = 100_000L
        assertFalse("醒着的屏幕，触摸不算唤醒", module.touch())

        tickAt(100_000L + FIRST_LINE_MS - 1)
        assertNull("触摸后重新数四十五秒", module.state.value.caption)
        tickAt(100_000L + FIRST_LINE_MS)
        val next = module.state.value.caption
        assertNotNull("触摸后的下一个空闲周期仍会说话", next)
        assertNotEquals("刚说过的台词不得立刻重复", first.id, next!!.id)
    }

    @Test fun `the recent lines are remembered across a page change`() {
        // The memory belongs to the device, not to the page: it is the same list a new page reads.
        lines.remember(1, 2, 3, 4, 5)
        module.show(main, facts())
        tickAt(FIRST_LINE_MS)
        val first = module.state.value.caption!!
        assertFalse("首页台词必须避开最近说过的五条", first.id in listOf(1, 2, 3, 4, 5))
        module.captionFinished()

        module.pageExit()
        module.show(main, facts())
        tickAt(FIRST_LINE_MS + 95_000L)
        val next = module.state.value.caption
        assertNotNull("换页后仍按同一记忆选下一条", next)
        assertFalse(
            "换页后最近五条仍被避开（含上一页刚说的一条）",
            next!!.id in listOf(first.id, 1, 2, 3, 4),
        )
    }

    @Test fun `the screen dozes off without a current session too`() {
        // 待机 is a screen state, not a session state: the console shows it before any session
        // exists, exactly as it did when the page owned the timer.
        module.show(null, null)

        tickAt(SLEEP_AT_MS)
        assertTrue(module.state.value.asleep)
    }

    @Test fun `a touch wakes a sleeping screen and answers only that touch`() {
        module.show(main, facts())
        tickAt(SLEEP_AT_MS)
        assertTrue(module.state.value.asleep)
        val sleepLine = module.state.value.caption

        assertTrue("待机时的一次触摸唤醒屏幕", module.touch())
        assertFalse(module.state.value.asleep)
        assertEquals("唤醒不移除正在播的台词", sleepLine, module.state.value.caption)
        assertFalse("唤醒不会排队到下一次触摸", module.touch())
    }

    @Test fun `leaving the page settles an unfinished line instead of queueing it`() {
        module.show(main, facts())
        tickAt(FIRST_LINE_MS)
        assertNotNull(module.state.value.caption)

        module.pageExit()
        assertNull("离页时未播完的台词清算", module.state.value.caption)

        module.show(main, facts())
        assertNull("下一页不得补播上一页未播完的台词", module.state.value.caption)
    }

    @Test fun `stand-by survives a page change until a touch ends it`() {
        module.show(main, facts())
        tickAt(SLEEP_AT_MS)
        assertTrue(module.state.value.asleep)

        module.pageExit()
        module.show(main, facts())
        assertTrue("待机随页面保留", module.state.value.asleep)
        assertNull("待机台词随上一页结算，不跨页补播", module.state.value.caption)

        assertTrue(module.touch())
        assertFalse(module.state.value.asleep)
    }

    @Test fun `a different context retires the previous screen state`() {
        module.show(main, facts())
        tickAt(SLEEP_AT_MS)
        assertTrue(module.state.value.asleep)
        assertNotNull(module.state.value.caption)

        module.show(other, facts())

        assertFalse("换上下文后旧会话的待机不得留着", module.state.value.asleep)
        assertNull("换上下文后旧会话的台词不得留着", module.state.value.caption)
        assertEquals(FairyPresence.IDLE, module.state.value.window.presence)
    }

    @Test fun `signing out settles the screen as well as the session`() {
        module.show(main, facts())
        tickAt(FIRST_LINE_MS)
        assertNotNull(module.state.value.caption)

        module.show(null, null)

        assertNull("登出时未播完的台词清算", module.state.value.caption)
        assertFalse("登出后不得留着旧会话的待机", module.state.value.asleep)
    }

    @Test fun `a sleeping screen ignores page pulses`() {
        module.show(main, facts())
        tickAt(SLEEP_AT_MS)
        val sleepLine = module.state.value.caption
        module.captionFinished()

        tickAt(SLEEP_AT_MS + 90_000L)
        assertTrue(module.state.value.asleep)
        assertNull("待机中不再选新台词", module.state.value.caption)
        assertEquals("待机后不再向台词记忆要新台词", listOf(FairyLines.sleepPool to 0), lines.picks)
        assertNotNull("待机台词确实说过一条", sleepLine)
    }

    /** In-memory [FairyLineMemory]: the production pick-and-record rule, no SharedPreferences. */
    private class FakeLines : FairyLineMemory {
        private var recent = emptyList<Int>()

        /** (pool, avoid) of every pick, in order, so tests can pin the trigger semantics. */
        val picks = mutableListOf<Pair<List<Int>, Int>>()

        override val recentLines: List<Int> get() = recent

        fun remember(vararg ids: Int) {
            recent = ids.toList()
        }

        override fun nextLine(pool: List<Int>, avoid: Int, random: Random): FairyLine {
            picks += pool to avoid
            val id = pickFairyLine(pool, recent, avoid, random)
            recent = (listOf(id) + recent.filter { it != id }).take(8)
            return FairyLines.line(id)
        }
    }
}
