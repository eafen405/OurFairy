package me.rerere.rikkahub.ui.fairy

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import me.rerere.rikkahub.data.remote.RemoteReceiveState

/** The presenting page's own rectangle in root coordinates, where the eye targets live. */
@Stable
internal class FairyPageFrame {
    var origin: Offset = Offset.Zero
    var size: Size = Size.Zero

    /** A point inside the frame, given as fractions of its width and height. */
    fun at(fractionX: Float, fractionY: Float): Offset =
        Offset(origin.x + size.width * fractionX, origin.y + size.height * fractionY)

    /** A pointer position from a pointer event, which is relative to the frame. */
    fun absolute(position: Offset): Offset = origin + position
}

/**
 * What the shared page host owns for one presenting page: the eye its screens render and the
 * modifier that measures the page and observes its touches.
 */
@Stable
internal class FairyPageHost internal constructor(
    val eye: FairyEyeController,
    val modifier: Modifier,
)

/**
 * The page half of Fairy 互动, shared by the console and the conversation page.
 *
 * One host owns everything that used to be copied into both pages: the page's [FairyEyeController]
 * and its 待机 sync, the lifecycle observer (a return to the foreground presents the current facts
 * read from [receive] with the same session check, a leave settles [FairyInteraction.pageExit]),
 * the observational finger-follow gesture (Final pass, never consumed), and the mapping from the
 * module's reaction to the eye ([FairyEyeReactions]).
 *
 * The page supplies only what is genuinely its own: [currentSessionId] (the route on the
 * conversation page, the console's 当前会话), the composition's [context] and [facts] for normal
 * frames, and the [composer] / [content] positions its layout gives the eye. The eye targets are
 * expressed through [FairyPageFrame] so a caller never reaches into another page's coordinates.
 *
 * [eye] is a parameter rather than a `remember` here so a page test can hand in the controller
 * and observe its real output.
 */
@Composable
internal fun rememberFairyPageHost(
    fairy: FairyInteraction,
    receive: RemoteReceiveState,
    currentSessionId: () -> String?,
    context: FairyInteractionContext?,
    facts: FairyRemoteFacts?,
    eye: FairyEyeController,
    composer: (FairyPageFrame) -> Offset?,
    content: (FairyPageFrame) -> Offset?,
): FairyPageHost {
    val frame = remember { FairyPageFrame() }
    // Not read during composition: it only identifies this page's latest presentation to
    // pageExit() when two pages overlap during navigation.
    val presentation = remember { longArrayOf(0L) }
    val interaction by fairy.state.collectAsStateWithLifecycle()

    LaunchedEffect(interaction.asleep) { eye.asleep = interaction.asleep }
    LaunchedEffect(fairy, context, facts) { presentation[0] = fairy.show(context, facts) }

    val lifecycleOwner = LocalLifecycleOwner.current.lifecycle
    val latestSessionId = rememberUpdatedState(currentSessionId)
    DisposableEffect(lifecycleOwner, fairy, receive) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> {
                    // Read the runtime as it is now, not the last composition: while away the page
                    // did not recompose, and the return must settle what arrived in the meantime.
                    val sessionId = latestSessionId.value()
                    presentation[0] = fairy.foregrounded(
                        sessionId?.let(::FairyInteractionContext),
                        receive.factsForSession(sessionId),
                    )
                }
                Lifecycle.Event.ON_STOP -> fairy.pageExit(presentation[0])
                else -> Unit
            }
        }
        lifecycleOwner.addObserver(observer)
        onDispose { lifecycleOwner.removeObserver(observer) }
    }
    // A page that is really gone (not just stopped) settles too, with the presentation it last
    // recorded; an older page that overlaps the incoming one is ignored by the module.
    DisposableEffect(fairy) { onDispose { fairy.pageExit(presentation[0]) } }

    val modifier = remember(eye, fairy) {
        Modifier
            .onGloballyPositioned {
                frame.origin = it.positionInRoot()
                frame.size = Size(it.size.width.toFloat(), it.size.height.toFloat())
            }
            // Observational only (Final pass, never consumed): fingers still reach the keys, the
            // list and the composer. The module answers whether a touch woke a sleeping screen.
            .pointerInput(eye, fairy) {
                awaitPointerEventScope {
                    while (true) {
                        val event = awaitPointerEvent(PointerEventPass.Final)
                        val touch = event.changes.firstOrNull { it.pressed }
                        eye.lookAt(touch?.let { frame.absolute(it.position) })
                        if (touch != null && fairy.touch()) eye.wake(confused = true)
                    }
                }
            }
    }

    FairyEyeReactions(
        reaction = interaction.reaction,
        eye = eye,
        composer = { composer(frame) },
        content = { content(frame) },
    )
    return remember(eye, modifier) { FairyPageHost(eye, modifier) }
}
