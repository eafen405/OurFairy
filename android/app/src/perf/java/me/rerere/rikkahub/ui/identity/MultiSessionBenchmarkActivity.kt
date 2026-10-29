package me.rerere.rikkahub.ui.identity

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.FrameMetrics
import android.view.Window
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import me.rerere.rikkahub.data.remote.ChatSyncKey
import me.rerere.rikkahub.data.remote.RemoteChatSnapshot
import me.rerere.rikkahub.data.remote.RemoteChatState
import me.rerere.rikkahub.data.remote.RemoteNotificationPlatform
import me.rerere.rikkahub.data.remote.RemoteReceiveState
import me.rerere.rikkahub.ui.fairy.FairyAppTheme
import org.json.JSONObject

/**
 * The combined multi-session measurement (#268): several history-bearing sessions and one strictly
 * streaming session observed at the same time.
 *
 * It measures the product's own reception path. [RemoteReceiveState] lists the synthetic account's
 * sessions, binds one [RemoteChatState] per listed session, and exposes the snapshot the page
 * shares; the transcript below is the production [RemoteTranscript] for the session the page stands
 * in. The replayable backend only supplies projection snapshots — nothing here merges, orders,
 * consumes or presents on its own, so there is no second aggregation model to keep in step.
 *
 * What a round therefore reports:
 * - receive → state for **every** session, from each runtime's own commit;
 * - receive → frame only for the **presented** session, because production composes one session's
 *   transcript; composing the others would measure this activity, not the product;
 * - connections as the observe leases the production runtimes opened, plus their peak;
 * - heap, frames against the display's refresh budget, and main-thread tick lateness;
 * - whether every session's newest version was applied, so a skipped tail is a miss, not a drop.
 *
 * It exists only in the `perf` variant; the shipping release build does not contain it.
 */
class MultiSessionBenchmarkActivity : ComponentActivity() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val frameNanos = mutableListOf<Long>()

    /** Every session's receive→state latency. */
    private val stateNanosBySession = LinkedHashMap<String, MutableList<Long>>()

    /** The presented session's receive→frame latency. */
    private val frameLatencyNanos = mutableListOf<Long>()

    /** Distinct versions each session's receive state committed. */
    private val committedBySession = LinkedHashMap<String, Int>()

    /** Each session's last committed projection version. */
    private val latestApplied = LinkedHashMap<String, Long>()

    /** Main-thread tick lateness beyond its own schedule. */
    private val mainThreadLatenessNanos = mutableListOf<Long>()

    private var startHeap = 0L
    private var terminalRichMs = -1.0

    /** Frames before the window opens are the activity's startup, not the workload's. */
    @Volatile private var windowOpen = false

    private lateinit var benchmark: MultiSessionBenchmark
    private lateinit var receive: RemoteReceiveState
    private var ticker: Job? = null
    private val watchJobs = mutableListOf<Job>()
    private val attached = mutableSetOf<String>()
    private var summary by mutableStateOf("运行中……")

    /** Completed once every listed session's runtime exists and is being watched. */
    private val runtimesReady = CompletableDeferred<Boolean>()

    /** Completed once the presented session's terminal document has been drawn. */
    private val terminalPresented = CompletableDeferred<Boolean>()

    private val frames = Window.OnFrameMetricsAvailableListener { _, metrics, _ ->
        if (windowOpen) frameNanos += metrics.getMetric(FrameMetrics.TOTAL_DURATION)
    }

    /**
     * The page is open, so the reminder backlog scan runs as it does with the app in front and
     * suppression is exercised. No Android notification is published from a measurement build.
     */
    private val notifications = object : RemoteNotificationPlatform {
        override fun isForeground(): Boolean = true
        override fun publish(key: ChatSyncKey, preview: String) = Unit
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addOnFrameMetricsAvailableListener(frames, Handler(Looper.getMainLooper()))
        val runId = intent.getStringExtra(RUN_ID)
        val unit = assets.open(PresentationWorkload.WORKLOAD_FILE).bufferedReader().use { it.readText() }
        val declaration = assets.open(MultiSessionWorkload.DECLARATION_FILE).bufferedReader().use { it.readText() }
        val workload = MultiSessionWorkload.parse(declaration)
        benchmark = MultiSessionBenchmark(unit, workload)
        val store = InMemoryChatSyncStore()
        // The production shape: reception owns one runtime per listed session, each settling reminders.
        receive = RemoteReceiveState(
            backend = SyntheticSessionList(benchmark),
            scope = scope,
            chatFactory = { settle ->
                RemoteChatState(
                    backend = benchmark,
                    scope = scope,
                    store = store,
                    endpoint = BENCHMARK_ENDPOINT,
                    retryDelayMillis = 3_600_000,
                    settleReminders = settle,
                )
            },
            notifications = notifications,
            notificationsEnabled = { true },
            // Reception reads reminder debt from this same ledger now, so the measured shape is
            // the production one rather than a receiver that still has to walk runtimes.
            ledger = store,
            endpoint = BENCHMARK_ENDPOINT,
        )

        setContent {
            FairyAppTheme {
                LaunchedEffect(Unit) { openWindow() }
                LaunchedEffect(Unit) {
                    // A round that cannot bind every runtime still writes its result: an abnormal
                    // sample must be visible as a miss, not disappear into a bare script timeout.
                    if (!runtimesReady.await()) {
                        ticker?.cancel()
                        summary = writeResult(workload, runId, allSessionsSettled = false,
                            bindingFailure = "reception bound only $attached of ${workload.sessions} runtimes")
                        if (runId != null) finish()
                        return@LaunchedEffect
                    }
                    val settled = withTimeoutOrNull(WORKLOAD_TIMEOUT_MILLIS) {
                        benchmark.replays.forEach { it.backend.awaitCompletion() }
                        true
                    } == true
                    // The streaming session has a terminal document to draw; a deadline that
                    // expires stays a miss rather than a small number.
                    withTimeoutOrNull(TERMINAL_TIMEOUT_MILLIS) { terminalPresented.await() }
                    ticker?.cancel()
                    summary = writeResult(workload, runId, settled)
                    if (runId != null) finish()
                }
                Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.padding(12.dp)) {
                        Text(
                            "多会话组合测量 / ${workload.sessions} 个会话",
                            style = MaterialTheme.typography.titleMedium,
                        )
                        Text(summary, style = MaterialTheme.typography.bodySmall)
                        // What the page stands in: the primary (streaming) session's runtime — the
                        // same instance reception observes and the page shares.
                        receive.selectedChat.collectAsStateWithLifecycle().value?.let { chat ->
                            PresentedTranscript(chat)
                        }
                    }
                }
            }
        }
    }

    /** The product's transcript for the one session on screen; nothing else is composed. */
    @Composable
    private fun PresentedTranscript(chat: RemoteChatState) {
        val snapshot by chat.snapshot.collectAsStateWithLifecycle()
        RemoteTranscript(
            messages = snapshot.projection?.messages.orEmpty(),
            generation = snapshot.projection?.generation.orEmpty(),
            attempt = snapshot.projection?.attempt,
            settledAttempt = snapshot.projection?.settledAttempt,
            downloadEnabled = false,
            onDownload = { _, _ -> },
            onFinalPresented = ::onTerminalPresented,
        )
    }

    /**
     * Bind the synthetic account, wait for reception to create every session's runtime, attach this
     * run's readers, then open the replay gate.
     *
     * The gate is what makes a round complete: replays emit their opening snapshot only after every
     * reader exists, so no version can be published into a window nobody was watching.
     */
    private suspend fun openWindow() {
        receive.bind(PERF_TOKEN, PERF_USER_SHORT_ID)
        val ready = withTimeoutOrNull(RUNTIME_TIMEOUT_MILLIS) {
            while (attached.size < benchmark.workload.sessions) {
                receive.owned.snapshot.value.sessions.forEach { session ->
                    if (session.id !in attached) receive.stateForSession(session.id)?.let { attach(session.id, it) }
                }
                if (attached.size >= benchmark.workload.sessions) break
                delay(5)
            }
            true
        } == true
        withFrameNanos { }
        delay(STARTUP_SETTLE_MILLIS)
        frameNanos.clear()
        stateNanosBySession.clear()
        frameLatencyNanos.clear()
        committedBySession.clear()
        latestApplied.clear()
        mainThreadLatenessNanos.clear()
        startHeap = usedHeapBytes()
        windowOpen = true
        ticker = startMainThreadTicker()
        runtimesReady.complete(ready)
        benchmark.release()
    }

    /** Watch one runtime: every session counts to receive→state, the presented one also to frame. */
    private fun attach(sessionId: String, chat: RemoteChatState) {
        attached += sessionId
        watchJobs += scope.launch {
            var lastVersion = -1L
            chat.snapshot.collect { value ->
                val projection = value.projection ?: return@collect
                if (projection.version == lastVersion) return@collect
                val emitted = benchmark.replayOf(sessionId)?.backend?.emittedAt(projection.version)
                    ?: return@collect
                lastVersion = projection.version
                stateNanosBySession.getOrPut(sessionId) { mutableListOf() } +=
                    SystemClock.elapsedRealtimeNanos() - emitted
                committedBySession[sessionId] = (committedBySession[sessionId] ?: 0) + 1
                latestApplied[sessionId] = projection.version
                if (sessionId == benchmark.streaming.sessionId) {
                    // The frame after the commit is the presentation of this exact version.
                    withFrameNanos { }
                    frameLatencyNanos += SystemClock.elapsedRealtimeNanos() - emitted
                }
            }
        }
    }

    private fun onTerminalPresented() {
        if (terminalPresented.isCompleted) return
        val emitted = benchmark.streaming.backend.terminalEmitNanos
        if (emitted > 0) {
            terminalRichMs = (SystemClock.elapsedRealtimeNanos() - emitted) / 1_000_000.0
            terminalPresented.complete(true)
        }
    }

    /**
     * How late a 16 ms main-thread tick lands. It is the main thread's own availability under the
     * combined load, measured on the thread that services input and composition.
     */
    private fun startMainThreadTicker(): Job = scope.launch {
        val handler = Handler(Looper.getMainLooper())
        var expected = SystemClock.elapsedRealtimeNanos() + TICK_MILLIS * 1_000_000
        while (true) {
            val landed = CompletableDeferred<Unit>()
            handler.postAtTime({
                mainThreadLatenessNanos += (SystemClock.elapsedRealtimeNanos() - expected).coerceAtLeast(0)
                landed.complete(Unit)
            }, expected / 1_000_000)
            landed.await()
            expected += TICK_MILLIS * 1_000_000
            delay(0)
        }
    }

    private fun writeResult(
        workload: MultiSessionWorkload,
        runId: String?,
        allSessionsSettled: Boolean,
        bindingFailure: String? = null,
    ): String {
        val refreshBudget = 1_000_000_000.0 / windowManager.defaultDisplay.refreshRate
        val presented = benchmark.streaming.sessionId
        val emitted = benchmark.replays.associate { it.sessionId to it.backend.emitCount }
        val received = emitted.values.sum()
        val observed = committedBySession.values.sum()
        // Applied is answered per session: the committed version must be the replay's last emit.
        // A session that never committed is a miss, not a skip.
        val unapplied = emitted.filter { (session, count) ->
            count <= 0 || latestApplied[session] != count.toLong()
        }.keys
        val snapshot: RemoteChatSnapshot =
            receive.stateForSession(presented)?.snapshot?.value ?: RemoteChatSnapshot()
        val presentedState = stateNanosBySession[presented].orEmpty()
        val everySession = stateNanosBySession.values.flatten()
        val result = JSONObject().apply {
            put("scenario", SCENARIO)
            put("runId", runId)
            put("buildType", "perf")
            put("sessions", workload.sessions)
            put("historySessions", workload.historySessions)
            put("historyMessages", workload.historyMessages)
            put("streamingSessions", workload.streamingSessions)
            put("replyChars", workload.replyChars)
            put("chunkChars", workload.chunkChars)
            put("intervalMillis", workload.intervalMillis)
            put("presentedSession", presented)
            put("presentedSessions", 1)
            put("connectionCount", benchmark.observeOpens())
            put("peakConcurrentObserves", benchmark.peakConcurrentObserves())
            put("sessionsApplied", workload.sessions - unapplied.size)
            put("sessionsUnapplied", unapplied.sorted())
            put("allSessionsSettled", allSessionsSettled)
            put("received", received)
            put("observed", observed)
            put("superseded", received - observed)
            put("latestVersionApplied", unapplied.isEmpty())
            put("latestAppliedVersion", latestApplied[presented] ?: -1L)
            put("latestEmittedVersion", emitted[presented] ?: 0)
            put("unappliedAtEnd", unapplied.size)
            put("terminalPresented", terminalRichMs >= 0)
            put("terminalRichPresentedMs", if (terminalRichMs >= 0) terminalRichMs else null)
            put("receiveToStateP50Ms", percentileMillis(everySession, 0.50))
            put("receiveToStateP95Ms", percentileMillis(everySession, 0.95))
            put("receiveToStateMaxMs", percentileMillis(everySession, 1.0))
            put("receiveToStatePresentedP95Ms", percentileMillis(presentedState, 0.95))
            put("receiveToFrameP50Ms", percentileMillis(frameLatencyNanos, 0.50))
            put("receiveToFrameP95Ms", percentileMillis(frameLatencyNanos, 0.95))
            put("frameP95Ms", percentileMillis(frameNanos, 0.95))
            put("frameCount", frameNanos.size)
            put("overRefreshBudgetRatio", frameNanos.count { it > refreshBudget }.toDouble() / frameNanos.size.coerceAtLeast(1))
            put("mainThreadTickP50Ms", percentileMillis(mainThreadLatenessNanos, 0.50))
            put("mainThreadTickP95Ms", percentileMillis(mainThreadLatenessNanos, 0.95))
            put("mainThreadTickMaxMs", percentileMillis(mainThreadLatenessNanos, 1.0))
            put("mainThreadTicks", mainThreadLatenessNanos.size)
            put("consumedThrough", snapshot.consumedThrough)
            put("initialized", snapshot.initialized)
            put("failure", snapshot.failure)
            put("receptionBindingFailure", bindingFailure)
            put("heapStartBytes", startHeap)
            put("heapEndBytes", usedHeapBytes())
            put("emittedBySession", JSONObject().apply {
                emitted.toSortedMap().forEach { (session, count) -> put(session, count) }
            })
        }
        // One file per run: a later round must never be read back as this one. The
        // `presentation-` prefix is the one the replay script already reads, so a combined round
        // uses the same reader as the #74 tiers instead of a second path.
        val name = resultFileName(SCENARIO, runId)
        val file = java.io.File(filesDir, name)
        file.writeText(result.toString(2))
        Log.i(LOG_TAG, result.toString())
        return "完成：${file.name}；同步写入 logcat $LOG_TAG。"
    }

    override fun onDestroy() {
        window.removeOnFrameMetricsAvailableListener(frames)
        watchJobs.forEach { it.cancel() }
        ticker?.cancel()
        scope.cancel()
        super.onDestroy()
    }


    private companion object {
        const val LOG_TAG = "OurFairyPresentation"
        const val SCENARIO = "multi-session"
        const val RUN_ID = "runId"
        const val PERF_TOKEN = "perf-token"
        const val PERF_USER_SHORT_ID = 1
        const val BENCHMARK_ENDPOINT = "http://perf.invalid"
        const val TICK_MILLIS = 16L
        const val STARTUP_SETTLE_MILLIS = 500L

        /** A round's own deadline: 1,818 streaming steps at 20 ms is ~37 s of emission alone. */
        const val WORKLOAD_TIMEOUT_MILLIS = 240_000L

        /** How long the terminal document may take to reach the screen before it is a miss. */
        const val TERMINAL_TIMEOUT_MILLIS = 60_000L

        /** How long reception may take to create every listed session's runtime. */
        const val RUNTIME_TIMEOUT_MILLIS = 15_000L
    }
}
