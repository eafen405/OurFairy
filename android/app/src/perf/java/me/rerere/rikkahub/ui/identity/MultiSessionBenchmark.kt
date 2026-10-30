package me.rerere.rikkahub.ui.identity

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emitAll
import kotlinx.coroutines.flow.flow
import me.rerere.rikkahub.data.remote.ChatHistoryPage
import me.rerere.rikkahub.data.remote.ChatReceipt
import me.rerere.rikkahub.data.remote.OwnedSession
import me.rerere.rikkahub.data.remote.OwnedSessions
import me.rerere.rikkahub.data.remote.RemoteChatBackend
import me.rerere.rikkahub.data.remote.RemoteChatProjection
import me.rerere.rikkahub.data.remote.SessionBackend
import java.util.concurrent.atomic.AtomicInteger

/**
 * The combined multi-session workload (#268), declared once for every reader.
 *
 * It exists because the five single-session tiers (#74) cannot say what several history-bearing
 * sessions cost while one of them keeps streaming. Everything a round depends on is fixed here:
 * how many sessions reception observes, how much history each carries, and the streaming body's
 * length, step and interval. [parse] reads `src/perf/assets/presentation/multi-session.md`, which
 * `RemotePresentationBaselineTest` pins, so editing the numbers fails a host test instead of
 * quietly producing a baseline that looks like the previous one.
 *
 * The streaming parameters reuse #74's `stream` tier (232,703 characters in 128-character steps
 * every 20 ms), so a combined round is directly comparable with the single-session one it extends.
 */
internal data class MultiSessionWorkload(
    val sessions: Int,
    val historySessions: Int,
    val historyMessages: Int,
    val streamingSessions: Int,
    val replyChars: Int,
    val chunkChars: Int,
    val intervalMillis: Long,
) {
    companion object {
        const val DECLARATION_FILE = "presentation/multi-session.md"

        /** Parse the declaration asset. Unknown keys are rejected: a typo must not measure nothing. */
        fun parse(text: String): MultiSessionWorkload {
            val declared = LinkedHashMap<String, String>()
            text.lineSequence().map { it.trim() }
                .filter { it.isNotEmpty() && !it.startsWith("#") }
                .forEach { line ->
                    val separator = line.indexOf('=')
                    require(separator > 0) { "负载声明行缺少 '='：$line" }
                    declared[line.substring(0, separator).trim()] = line.substring(separator + 1).trim()
                }
            fun int(key: String) = declared[key]?.toIntOrNull()
                ?: throw IllegalArgumentException("多会话负载缺少整数 $key")
            fun long(key: String) = declared[key]?.toLongOrNull()
                ?: throw IllegalArgumentException("多会话负载缺少整数 $key")
            val known = setOf(
                "sessions", "historySessions", "historyMessages",
                "streamingSessions", "replyChars", "chunkChars", "intervalMillis",
            )
            require(declared.keys == known) {
                "多会话负载声明的键必须恰好是 $known；实际为 ${declared.keys}"
            }
            val workload = MultiSessionWorkload(
                sessions = int("sessions"),
                historySessions = int("historySessions"),
                historyMessages = int("historyMessages"),
                streamingSessions = int("streamingSessions"),
                replyChars = int("replyChars"),
                chunkChars = int("chunkChars"),
                intervalMillis = long("intervalMillis"),
            )
            require(workload.sessions == workload.historySessions + workload.streamingSessions) {
                "组合负载的会话数必须等于带历史会话数与流式会话数之和"
            }
            // The benchmark routes exactly one streaming primary; accepting a different count
            // would wait for runtimes the backend never creates and write a binding-failure run
            // instead of the declared workload.
            require(workload.streamingSessions == 1) {
                "组合负载当前只支持一个持续流式会话；声明的 streamingSessions 为 ${workload.streamingSessions}"
            }
            require(workload.historySessions > 0) { "组合负载必须至少有一个带历史的会话" }
            require(workload.historyMessages > 0 && workload.replyChars > 0) {
                "组合负载必须同时带历史与流式正文"
            }
            return workload
        }
    }
}

/**
 * The combined workload's backend: one replayable [SyntheticChatBackend] per listed session,
 * behind the single [RemoteChatBackend] the production chat factory shares.
 *
 * Production reception ([me.rerere.rikkahub.data.remote.RemoteReceiveState]) binds one
 * [me.rerere.rikkahub.data.remote.RemoteChatState] per listed session and the page shares that
 * instance; that is the path being measured, so this class only routes each binding to its
 * session's replay. It is not a second aggregation model: merging, ordering, consumption and
 * presentation stay in the production states.
 *
 * [leaseGate] holds every replay start until the measurement has attached its snapshot readers,
 * so no opening snapshot is missed between `bind` and attaching; [release] opens it.
 */
internal class MultiSessionBenchmark(
    private val unit: String,
    val workload: MultiSessionWorkload,
) : RemoteChatBackend {
    /** One session's replay and what the measurement is allowed to read back from it. */
    internal class Replay(
        val sessionId: String,
        val historyMessages: Int,
        val replyChars: Int,
        val backend: SyntheticChatBackend,
    )

    private fun replay(name: String, history: Int, reply: Int): Replay {
        val streaming = reply > 0
        val declared = PresentationWorkload(
            name = name,
            historyMessages = history,
            replyChars = reply,
            chunkChars = if (streaming) workload.chunkChars else 0,
            intervalMillis = if (streaming) workload.intervalMillis else 0,
        )
        val backend = SyntheticChatBackend(declared, unit)
        return Replay(backend.sessionId, history, reply, backend)
    }

    val history: List<Replay> = List(workload.historySessions) { index ->
        replay("multi-history-${index + 1}", workload.historyMessages, 0)
    }

    /** The continuously streaming session; it is also the account's primary, so the page shows it. */
    val streaming: Replay = replay("multi-stream", 0, workload.replyChars)

    val replays: List<Replay> = history + streaming

    private val routes: Map<String, Replay> = replays.associateBy { it.sessionId }
    private val leaseGate = CompletableDeferred<Unit>()
    private val active = AtomicInteger()
    private val peak = AtomicInteger()
    private val opened = AtomicInteger()

    fun release() {
        if (!leaseGate.isCompleted) leaseGate.complete(Unit)
    }

    /** Observe leases opened so far, including any reopened after a teardown. */
    fun observeOpens(): Int = opened.get()

    /** The most leases that were open at the same time. */
    fun peakConcurrentObserves(): Int = peak.get()

    private fun route(sessionId: String): Replay =
        routes[sessionId] ?: throw IllegalArgumentException("组合负载没有会话 $sessionId")

    override fun observe(token: String, sessionId: String): Flow<RemoteChatProjection> {
        val session = route(sessionId)
        return flow {
            opened.incrementAndGet()
            val concurrent = active.incrementAndGet()
            peak.updateAndGet { current -> maxOf(current, concurrent) }
            try {
                leaseGate.await()
                emitAll(session.backend.observe(token, sessionId))
            } finally {
                active.decrementAndGet()
            }
        }
    }

    override suspend fun read(token: String, sessionId: String): RemoteChatProjection =
        route(sessionId).backend.read(token, sessionId)

    override suspend fun send(
        token: String,
        sessionId: String,
        requestId: String,
        text: String,
        uploadIds: List<String>,
    ): ChatReceipt = route(sessionId).backend.send(token, sessionId, requestId, text, uploadIds)

    override suspend fun receipt(token: String, sessionId: String, requestId: String): ChatReceipt? =
        route(sessionId).backend.receipt(token, sessionId, requestId)

    override suspend fun stop(token: String, sessionId: String) =
        route(sessionId).backend.stop(token, sessionId)

    override suspend fun page(
        token: String,
        sessionId: String,
        throughSeq: Long,
        beforeSeq: Long,
    ): ChatHistoryPage = route(sessionId).backend.page(token, sessionId, throughSeq, beforeSeq)

    override suspend fun checkpoint(token: String, sessionId: String): Long =
        route(sessionId).backend.checkpoint(token, sessionId)

    /** The replay behind one session, for the measurement's own read-back of emit times. */
    fun replayOf(sessionId: String): Replay? = routes[sessionId]
}

/**
 * The account's list for the combined workload.
 *
 * It answers the one question reception asks of it — which sessions exist and which is primary —
 * and refuses the rest, so the measurement cannot acquire an action path the product does not use
 * here. The streaming session is primary, which is what makes the page present it.
 */
internal class SyntheticSessionList(private val benchmark: MultiSessionBenchmark) : SessionBackend {
    override suspend fun list(token: String, archived: Boolean): OwnedSessions = OwnedSessions(
        sessions = benchmark.replays.map { OwnedSession(it.sessionId) },
        primarySessionId = benchmark.streaming.sessionId,
    )

    override suspend fun read(token: String, sessionId: String): OwnedSession = OwnedSession(sessionId)

    override suspend fun create(token: String): OwnedSession = error("组合负载不创建会话")

    override suspend fun select(token: String, sessionId: String): OwnedSession = OwnedSession(sessionId)

    override suspend fun primary(token: String): OwnedSession = OwnedSession(benchmark.streaming.sessionId)

    override suspend fun rename(token: String, sessionId: String, title: String): OwnedSession =
        error("组合负载不重命名会话")

    override suspend fun archive(token: String, sessionId: String): OwnedSession =
        error("组合负载不归档会话")

    override suspend fun restore(token: String, sessionId: String): OwnedSession =
        error("组合负载不恢复会话")
}
