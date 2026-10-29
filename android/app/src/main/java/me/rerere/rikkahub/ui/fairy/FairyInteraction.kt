package me.rerere.rikkahub.ui.fairy

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.random.Random

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
 * What the module holds between frames and between pages: whose facts these are, the facts last
 * handed in, and the 当前表现 derived from them.
 */
data class FairyInteractionState(
    val context: FairyInteractionContext? = null,
    val facts: FairyRemoteFacts? = null,
    val window: FairyWindowState = UNKNOWN,
)

/** Unknown, not quiet: 当前表现 with no facts behind it. */
private val UNKNOWN = FairyWindowState(presence = FairyPresence.CONNECTING)

/**
 * Fairy 互动: the single owner of 当前表现.
 *
 * A page renders [window] with the facts of the session it is showing and records that it did so
 * with [show]. It never synthesizes a presence of its own, keeps a second copy of these facts, or
 * presents a session it is not showing.
 *
 * [now] and [random] are this module's only clock and randomness, injected by the assembly so no
 * rule reaches for a global one. 当前表现 reads neither; 待机 and 台词 move into this module in
 * #261, and they arrive as this module's own readers rather than as a second seam.
 */
class FairyInteraction(
    val now: () -> Long,
    val random: Random,
) {
    private val mutable = MutableStateFlow(FairyInteractionState())

    /** The retained interaction state; [show] is its only writer. */
    val state: StateFlow<FairyInteractionState> = mutable.asStateFlow()

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
     * facts it already holds for the session it is drawing.
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
     * A different context replaces the held state wholesale, so the previous context's 当前表现
     * cannot survive into the new one; the same context only replaces its facts. A null context
     * (signed out, no session at all) holds nothing.
     */
    fun show(context: FairyInteractionContext?, facts: FairyRemoteFacts?) {
        val next = if (context == null) {
            FairyInteractionState()
        } else {
            FairyInteractionState(context, facts, window(facts))
        }
        if (next != mutable.value) mutable.value = next
    }
}
