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

/** One backend delivery fact: output that reached the session at [seq], run [episodeId]. */
data class FairyDelivery(val episodeId: String, val seq: Long)

/** One backend completion fact: run [episodeId] finished its coverage at [finishedSeq]. */
data class FairyCompletion(val episodeId: String, val finishedSeq: Long)

/**
 * A real stimulus the presenting page observed, one per real event the module reacts to.
 *
 * The kind names the event, not an animation: the page maps each kind to the eye response it can
 * show (see `FairyEyeReactions`). A reaction is transient — it is settled by [FairyInteraction.pageExit]
 * and by [FairyInteraction.foregrounded], and it is never queued.
 */
enum class FairyReactionKind {
    /** A local send command was accepted; the backend has not said anything yet. */
    SENT,

    /** A Fairy output reached the projected transcript. */
    OUTPUT,

    /** The established activity reports a delivered output. */
    DELIVERY,

    /** The established activity reports a finished run. */
    COMPLETED,
}

/**
 * One reaction the presenting page owes.
 *
 * [id] only makes a later presentation of the same reaction distinguishable from a new one: the
 * page keys its one-shot eye response on it, and an unchanged id means nothing new happened.
 */
data class FairyReaction(val id: Long, val kind: FairyReactionKind)

/**
 * The remote facts one presented session offers Fairy, read out of that session's snapshot by
 * `RemoteChatSnapshot.fairyFacts()`. It carries no history and no facts of its own.
 *
 * [activityStatus] / [activityReasons] are the session's activity *as the snapshot answered it*,
 * including unknown (`0`). Whether a committed prefix establishes anything is answered once, by
 * `RemoteChatSnapshot.activity`; this module copies that answer and never inspects raw events, so
 * it has no way to turn unknown into silence on its own.
 *
 * [outputSeq] is the newest Fairy message `seq` in the projected transcript, if any.
 * [delivery] / [completed] are the activity's own delivery and completion facts; the module only
 * reacts to them while [activityStatus] is established, because an unknown activity must not be
 * presented as a fact either. None of these three is keyed by the projection generation: a new
 * generation replays the same message and episode, and treating it as new would react twice.
 */
data class FairyRemoteFacts(
    val connected: Boolean = false,
    val connecting: Boolean = false,
    val activityStatus: Int = 0,
    val activityReasons: List<Int> = emptyList(),
    val transcript: FairyTranscript? = null,
    val outputSeq: Long? = null,
    val delivery: FairyDelivery? = null,
    val completed: FairyCompletion? = null,
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
    /**
     * The transient eye reaction the presenting page owes, or null when there is none. The page
     * keys its eye response on [FairyReaction.id], so recomposing or rebuilding the page without
     * leaving it cannot replay an already-shown reaction; leaving the page settles it.
     */
    val reaction: FairyReaction? = null,
    /**
     * Counts new Fairy outputs that arrived while 当前表现 is SPEAKING: the screen pulses once per
     * output. It is a transient presentation value like [reaction], not continuous state.
     */
    val speechPulse: Int = 0,
)

/** Unknown, not quiet: 当前表现 with no facts behind it. */
private val UNKNOWN = FairyWindowState(presence = FairyPresence.CONNECTING)

/**
 * Fairy 互动: the single owner of 当前表现, 屏幕待机, 台词选择, 最近台词记忆 and the transient
 * reactions real events ask for.
 *
 * A page renders [window] with the facts of the session it is showing, records that it did so with
 * [show], pulses [tick] while the screen is visible, reports what the reader does with [touch], and
 * reports a send with [sent] and a return to the foreground with [foregrounded]. It never
 * synthesizes a presence of its own, keeps a second copy of these facts, or presents a session it
 * is not showing.
 *
 * The continuous state — 当前表现, [FairyInteractionState.asleep] and the line memory — outlives a
 * page. The transient state — an unfinished [FairyInteractionState.caption], an unshown
 * [FairyInteractionState.reaction] and [FairyInteractionState.speechPulse] — is settled by
 * [pageExit] and never replayed on the next page. Events the module only learns about when the page
 * comes back (facts that landed while it was away) settle silently by the same rule.
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

    /**
     * The retained interaction state; [show], [sent], [foregrounded], [tick], [touch], [pageExit]
     * and [captionFinished] are its writers.
     */
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
     * Keys of events already seen, so a reconnect, a recomposition or a page change cannot replay
     * one. They only grow; nothing clears them on a generation change, because a new generation
     * replays the same episode/message. Each key is qualified by the thing that owns it (session id
     * for an output, the backend's episode id for a delivery or completion), so switching context
     * cannot make another context's event look like a replay.
     */
    private val sentRequestIds = mutableSetOf<String>()
    private val seenOutputs = mutableSetOf<OutputKey>()
    private val seenDeliveries = mutableSetOf<DeliveryKey>()
    private val seenCompletions = mutableSetOf<CompletionKey>()

    /** Only makes one reaction distinguishable from the next; never used as a key. */
    private var reactionSeq = 0L

    /**
     * Whether the current context has presented facts at all. A context can be recorded with no
     * facts yet (its runtime is not settled); the first facts that arrive are still a baseline —
     * they are the session's history, not news — even though the context itself is unchanged.
     */
    private var hasPresentedFacts = false

    /**
     * The next [show] was not watched while it happened: it settles the events it presents
     * instead of playing them. Set by [pageExit] and by [foregrounded]; cleared by the next
     * presentation. This is what keeps an event that landed while the page was away from being
     * replayed on return.
     */
    private var catchingUp = false

    private data class OutputKey(val sessionId: String, val seq: Long)
    private data class DeliveryKey(val episodeId: String, val seq: Long)
    private data class CompletionKey(val episodeId: String, val finishedSeq: Long)

    private data class Observation(val reaction: FairyReaction? = null, val pulse: Boolean = false)

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
     *
     * A presentation that was not being watched — the first one for a context, or the first after
     * [pageExit] / [foregrounded] — settles the events it contains without playing them; only a
     * change observed while presenting produces a [FairyInteractionState.reaction].
     */
    fun show(context: FairyInteractionContext?, facts: FairyRemoteFacts?) {
        if (!presented) {
            presented = true
            idleSince = now()
        }
        val held = mutable.value
        val nextWindow = window(facts)
        if (held.context != context) {
            idleSince = now()
            nextLineAt = FIRST_LINE_MS
            catchingUp = false
            hasPresentedFacts = facts != null
            observe(context, facts, react = false)
            publish(FairyInteractionState(context, facts, nextWindow))
            return
        }
        // The first facts of a context are its history even when the context was recorded earlier
        // with none (a runtime that had not settled yet); they update 当前表现 but play nothing.
        val firstFacts = facts != null && !hasPresentedFacts
        if (facts != null) hasPresentedFacts = true
        val react = !catchingUp && !firstFacts
        catchingUp = false
        val observation = observe(context, facts, react, nextWindow)
        publish(
            held.copy(
                facts = facts,
                window = nextWindow,
                reaction = observation.reaction ?: held.reaction,
                speechPulse = held.speechPulse + if (observation.pulse) 1 else 0,
            ),
        )
    }

    /**
     * Record a local send that was accepted with [requestId], the idempotency key of one send.
     *
     * This is only the client acknowledging the reader's action: it produces a short attention
     * reaction and leaves 当前表现 alone, so nothing here pretends the backend has started
     * thinking. The key makes a retry, a rebind or a page that re-reports the same send one event.
     */
    fun sent(requestId: String) {
        if (!sentRequestIds.add(requestId)) return
        val held = mutable.value
        publish(held.copy(reaction = FairyReaction(++reactionSeq, FairyReactionKind.SENT)))
    }

    /**
     * Record that a page is visible again, presenting [context] with the facts that are true right
     * now — read by the page from the session's runtime, not from its last composition.
     *
     * Coming back never replays what happened while no page was watching: the current facts settle
     * the events they contain and update 当前表现, while the continuous state (待机, 当前表现, the
     * line memory) stays. Only a change after this presentation produces a reaction.
     */
    fun foregrounded(context: FairyInteractionContext?, facts: FairyRemoteFacts?) {
        val held = mutable.value
        if (held.reaction != null) publish(held.copy(reaction = null))
        catchingUp = true
        show(context, facts)
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
     * Settle the presenting page's transient state: an unfinished line and an unshown reaction are
     * dropped, and the next presentation is marked as unwatched (see [catchingUp]) — they do not
     * queue for, or replay on, the next page. The continuous state
     * ([FairyInteractionState.asleep], 当前表现, the line memory) stays where it is.
     */
    fun pageExit() {
        catchingUp = true
        val held = mutable.value
        if (held.caption != null || held.reaction != null) {
            publish(held.copy(caption = null, reaction = null))
        }
    }

    /**
     * Read one presentation's events against the append-only seen keys and record them.
     *
     * With [react] false the keys are recorded but nothing is played: that is the first
     * presentation of a context or the first one after leaving a page, where the facts are history
     * rather than news. Delivery and completion only count while the activity is established:
     * unknown is not a fact to present, so the same delivery reacts once the prefix that proves it
     * lands. A presentation that is being settled records them even while unknown, because an
     * event that landed while no page was watching must not react later, when a reconnect finally
     * establishes the activity.
     */
    private fun observe(
        context: FairyInteractionContext?,
        facts: FairyRemoteFacts?,
        react: Boolean,
        window: FairyWindowState = UNKNOWN,
    ): Observation {
        if (context == null || facts == null) return Observation()
        var output = false
        var delivery = false
        var completed = false
        facts.outputSeq?.let { seq ->
            if (seenOutputs.add(OutputKey(context.sessionId, seq))) output = true
        }
        if (facts.activityStatus != 0 || !react) {
            facts.delivery?.let { fact ->
                if (seenDeliveries.add(DeliveryKey(fact.episodeId, fact.seq))) delivery = true
            }
            facts.completed?.let { fact ->
                if (seenCompletions.add(CompletionKey(fact.episodeId, fact.finishedSeq))) {
                    completed = true
                }
            }
        }
        if (!react) return Observation()
        // One presentation produces at most one transient reaction: a delivery and the completion
        // that describes the same message are one event for the reader. Delivery wins because it
        // is the fact that carries the new content.
        val kind = when {
            delivery -> FairyReactionKind.DELIVERY
            output -> FairyReactionKind.OUTPUT
            completed -> FairyReactionKind.COMPLETED
            else -> null
        }
        return Observation(
            reaction = kind?.let { FairyReaction(++reactionSeq, it) },
            pulse = output && window.presence == FairyPresence.SPEAKING,
        )
    }

    private fun publish(next: FairyInteractionState) {
        if (next != mutable.value) mutable.value = next
    }
}
