package me.rerere.rikkahub.ui.fairy

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.random.Random

/** How long the console may stand idle before Fairy says her first line. */
internal const val FIRST_LINE_MS = 45_000L

/** The randomized range between one idle line and the next, counted from the last one. */
private const val NEXT_LINE_MIN_MS = 60_000L
private const val NEXT_LINE_MAX_MS = 90_000L

/** How long the screen may stand idle before Fairy dozes off. */
internal const val SLEEP_AT_MS = 180_000L

/**
 * The session a page is presenting.
 *
 * A session id is all the module is told: the page routes by it and its runtime is keyed by it.
 * Nothing here names an account, so the account cannot be decided twice — the retirements that
 * already exist (`RemoteReceiveState.bind`, `RemoteChatState.bind`/`detach`) stay the only
 * authority on which account is current, and an account switch is what empties the sessions and
 * their runtimes under a page.
 *
 * A changed key is how a page tells the module that what it hands in from now on belongs somewhere
 * else; the module then stops holding the previous context's state.
 */
data class FairyInteractionContext(val sessionId: String)

/** The part of a session's transcript 当前表现 asks about. */
data class FairyTranscript(val messages: Int, val replyText: String? = null)

/**
 * The remote facts one presented session offers Fairy, read out of that session's snapshot by
 * `RemoteChatSnapshot.fairyFacts()`. It carries no history and no facts of its own.
 *
 * [activityStatus] / [activityReasons] are the session's activity *as the snapshot answered it*,
 * including unknown (`0`). Whether a committed prefix establishes anything is answered once, by
 * `RemoteChatSnapshot.activity`; this module copies that answer and never inspects raw events, so
 * it has no way to turn unknown into silence on its own.
 */
data class FairyRemoteFacts(
    val connected: Boolean = false,
    val connecting: Boolean = false,
    val activityStatus: Int = 0,
    val activityReasons: List<Int> = emptyList(),
    val transcript: FairyTranscript? = null,
)

/**
 * The device-local record of which lines Fairy said recently. `FairyUiMemory` is the production
 * implementation (SharedPreferences `fairy_ui` / `recent_lines`); the module needs only this narrow
 * interface, so it holds no memory of its own and stays free of Android.
 */
interface FairyLineMemory {
    /** Line ids said so far, newest first. */
    val recentLines: List<Int>

    /** Picks from [pool] avoiding the [avoid] most recent lines, records the pick and returns it. */
    fun nextLine(pool: List<Int>, avoid: Int, random: Random): FairyLine
}

/**
 * What the module holds between frames and between pages: whose facts these are, the facts last
 * handed in, the 当前表现 derived from them, and the screen-level 待机 and 台词.
 */
data class FairyInteractionState(
    val context: FairyInteractionContext? = null,
    val facts: FairyRemoteFacts? = null,
    val window: FairyWindowState = UNKNOWN,
    /**
     * The screen dozing off: the console's 待机. It is continuous state — a page change keeps it,
     * a touch wakes it — and it is retired with the rest of a context's state when the context key
     * changes.
     */
    val asleep: Boolean = false,
    /** The line the presenting page is showing; null while nothing is being said. */
    val caption: FairyLine? = null,
)

/** Unknown, not quiet: 当前表现 with no facts behind it. */
private val UNKNOWN = FairyWindowState(presence = FairyPresence.CONNECTING)

/**
 * Fairy 互动: the single owner of 当前表现, 屏幕待机, 台词选择 and 最近台词记忆.
 *
 * A page renders [window] with the facts of the session it is showing, records that it did so with
 * [show], pulses [tick] while the screen is visible, and reports what the reader does with [touch].
 * It never synthesizes a presence of its own, keeps a second copy of these facts, or presents a
 * session it is not showing.
 *
 * The continuous state — 当前表现, [FairyInteractionState.asleep] and the line memory — outlives a
 * page. The transient state — an unfinished [FairyInteractionState.caption] — is settled by
 * [pageExit] and never replayed on the next page.
 *
 * [now] and [random] are this module's only clock and randomness, injected by the assembly so no
 * rule reaches for a global one. The page supplies the heartbeat ([tick]) but never the rule: when
 * stand-by begins and which line plays are decided here.
 */
class FairyInteraction(
    val now: () -> Long,
    val random: Random,
    private val lines: FairyLineMemory,
) {
    private val mutable = MutableStateFlow(FairyInteractionState())

    /** The retained interaction state; [show], [tick], [touch] and [pageExit] are its writers. */
    val state: StateFlow<FairyInteractionState> = mutable.asStateFlow()

    /**
     * When the screen last had attention: 待机 and the line schedule are measured from here. It
     * starts when a page first presents, not when the process starts, so a long-idle process does
     * not begin its first presentation already asleep.
     */
    private var idleSince = 0L

    /** The idle time at which the next line may play; relative to [idleSince]. */
    private var nextLineAt = FIRST_LINE_MS

    /** Whether a page has presented at all; [idleSince] is meaningless before that. */
    private var presented = false

    /**
     * 当前表现 for one session's facts — the branches the conversation page used to derive on its
     * own, in their original order. Six conditions produce the five values of 当前表现:
     *
     * 1. still opening → CONNECTING
     * 2. opened but not connected → OFFLINE
     * 3. activity unknown (`status == 0`) → CONNECTING — unknown is not quiet
     * 4. working with reply text on screen → SPEAKING
     * 5. working without it → THINKING
     * 6. otherwise → IDLE
     *
     * `expanded` (an empty connected session opens the eye screen) and `awaitingReply` (an
     * executing run that has shown no text yet) belong to the same answer because they are read
     * from the same facts; deriving them anywhere else would be a second rule over those inputs.
     * No facts — no runtime for this session yet — is the unknown presentation, not IDLE.
     *
     * It is pure and cheap, and reads nothing it was not handed, so a page renders it from the
     * facts it already holds for the session it is drawing. 待机, 台词 and the clock are not read.
     */
    fun window(facts: FairyRemoteFacts?): FairyWindowState {
        if (facts == null) return UNKNOWN
        val working = facts.activityStatus == 2
        val hasOutput = !facts.transcript?.replyText.isNullOrBlank()
        return FairyWindowState(
            presence = when {
                facts.connecting -> FairyPresence.CONNECTING
                !facts.connected -> FairyPresence.OFFLINE
                facts.activityStatus == 0 -> FairyPresence.CONNECTING
                working && hasOutput -> FairyPresence.SPEAKING
                working -> FairyPresence.THINKING
                else -> FairyPresence.IDLE
            },
            expanded = facts.connected && facts.transcript != null &&
                facts.transcript.messages == 0 && !hasOutput,
            awaitingReply = working && 1 in facts.activityReasons && !hasOutput,
        )
    }

    /**
     * Record that the app is presenting [context] with [facts], or with none while that session
     * has no runtime yet.
     *
     * A different context starts a fresh interaction: its facts, its 当前表现 and the screen's
     * 待机 and 台词 are replaced wholesale, so the previous context's state cannot survive into
     * the new one. The same context only replaces its facts, which is what keeps 待机 and the line
     * memory continuous across a page change.
     */
    fun show(context: FairyInteractionContext?, facts: FairyRemoteFacts?) {
        if (!presented) {
            presented = true
            idleSince = now()
        }
        val held = mutable.value
        if (held.context != context) {
            idleSince = now()
            nextLineAt = FIRST_LINE_MS
            publish(FairyInteractionState(context, facts, window(facts)))
            return
        }
        publish(held.copy(facts = facts, window = window(facts)))
    }

    /**
     * One page heartbeat. The presenting page calls this while the screen is visible, allowed to
     * speak, and awake; the module decides whether that pulse has crossed the line or stand-by
     * threshold. No frame loop is added: the page's existing tick is the only beat.
     *
     * A line already playing holds both decisions: stand-by waits for it to finish, and no second
     * line is picked while one is on screen.
     */
    fun tick() {
        val held = mutable.value
        if (held.asleep || held.caption != null) return
        val idle = now() - idleSince
        if (idle >= SLEEP_AT_MS) {
            publish(
                held.copy(
                    asleep = true,
                    caption = lines.nextLine(FairyLines.sleepPool, 0, random),
                ),
            )
            return
        }
        if (idle >= nextLineAt) {
            val line = lines.nextLine(FairyLines.homePool, FairyLines.HOME_AVOID, random)
            nextLineAt = idle + NEXT_LINE_MIN_MS +
                random.nextLong(NEXT_LINE_MAX_MS - NEXT_LINE_MIN_MS + 1)
            publish(held.copy(caption = line))
        }
    }

    /**
     * Record attention on the page's surface and answer what the page must do now.
     *
     * A touch restarts the idle clock, so the line schedule and stand-by begin again. It returns
     * true when it woke a sleeping screen, and only for the press that woke it: the page maps true
     * to the eye's own waking reaction immediately. The answer belongs to this event and is not
     * kept in [state], so no later page or composition can replay it (短暂反应不排队、不补播).
     */
    fun touch(): Boolean {
        idleSince = now()
        nextLineAt = FIRST_LINE_MS
        val held = mutable.value
        if (!held.asleep) return false
        publish(held.copy(asleep = false))
        return true
    }

    /** The presenting page finished the line it was showing; the screen may speak again later. */
    fun captionFinished() {
        val held = mutable.value
        if (held.caption != null) publish(held.copy(caption = null))
    }

    /**
     * The presenting page stopped: its transient presentation is settled. An unfinished line is
     * dropped — it does not queue for, or replay on, the next page — while the continuous state
     * ([FairyInteractionState.asleep], 当前表现, the line memory) stays where it is.
     */
    fun pageExit() {
        val held = mutable.value
        if (held.caption != null) publish(held.copy(caption = null))
    }

    private fun publish(next: FairyInteractionState) {
        if (next != mutable.value) mutable.value = next
    }
}
