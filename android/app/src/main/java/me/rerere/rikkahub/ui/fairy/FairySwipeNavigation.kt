package me.rerere.rikkahub.ui.fairy

import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.input.pointer.util.VelocityTracker
import androidx.compose.ui.unit.dp
import kotlin.math.abs

/** Horizontal travel a swipe must cover before it changes the page. */
private val FairySwipeDistance = 72.dp

/** Horizontal speed, in dp/s, that counts as a flick even below [FairySwipeDistance]. */
private val FairySwipeFlingVelocity = 400.dp

/**
 * Switches pages on a horizontal swipe.
 *
 * The page is not translated while the finger moves: the destination is pushed by the host, and
 * a page already pre-translated by the gesture would jump when the navigation transition starts.
 * The gesture instead commits once the finger has travelled [FairySwipeDistance] horizontally, or
 * flicked faster than [FairySwipeFlingVelocity], and lets the existing page transition play.
 *
 * Attach it outside the scrollable content. Events are observed on the Initial pass, but changes
 * are consumed only after the gesture has committed to the horizontal direction, so vertical
 * scrolling, taps and pressed controls still win: until that commit nothing is consumed, and a
 * vertical drag ends the observation outright. A drag whose horizontal slop is left only after the
 * platform's long-press timeout is ignored and never consumed — that is the beginning of a text
 * selection, not a page swipe. The eye follower in [rememberFairyPageHost] observes the Final pass,
 * which consumption on the Initial pass does not stop, so the eyes still follow the finger.
 *
 * [enabled] is false while the shared session list is open, so the drawer's own gestures are never
 * fought.
 */
@Composable
internal fun Modifier.fairySwipeNavigation(
    enabled: Boolean,
    onSwipeLeft: (() -> Unit)? = null,
    onSwipeRight: (() -> Unit)? = null,
): Modifier {
    // The pages recompose while a gesture is in flight (the interaction module ticks); keying the
    // pointer input on the callbacks would restart and cancel the gesture, so the coroutine reads
    // the latest callbacks instead of capturing these ones.
    val latestLeft = rememberUpdatedState(onSwipeLeft)
    val latestRight = rememberUpdatedState(onSwipeRight)
    return pointerInput(enabled) {
        if (!enabled) return@pointerInput
        val distance = FairySwipeDistance.toPx()
        val fling = FairySwipeFlingVelocity.toPx()
        val touchSlop = viewConfiguration.touchSlop
        val longPressTimeout = viewConfiguration.longPressTimeoutMillis
        awaitEachGesture {
            val down = awaitFirstDown(requireUnconsumed = false)
            val velocity = VelocityTracker()
            velocity.addPosition(down.uptimeMillis, down.position)
            var travelledX = 0f
            var travelledY = 0f
            var horizontal = false
            while (true) {
                val event = awaitPointerEvent(PointerEventPass.Initial)
                val change = event.changes.firstOrNull { it.id == down.id } ?: break
                if (change.isConsumed) break
                velocity.addPosition(change.uptimeMillis, change.position)
                travelledX += change.position.x - change.previousPosition.x
                travelledY += change.position.y - change.previousPosition.y
                if (!horizontal) {
                    val horizontalSlop =
                        abs(travelledX) > touchSlop && abs(travelledX) > abs(travelledY)
                    val verticalSlop =
                        abs(travelledY) > touchSlop && abs(travelledY) > abs(travelledX)
                    when {
                        horizontalSlop -> {
                            // Held still past the long-press timeout first: a selection drag.
                            if (change.uptimeMillis - down.uptimeMillis >= longPressTimeout) break
                            horizontal = true
                        }
                        verticalSlop -> break
                    }
                }
                if (horizontal) change.consume()
                if (!change.pressed) {
                    if (horizontal) {
                        val velocityX = velocity.calculateVelocity().x
                        when {
                            travelledX <= -distance || velocityX <= -fling ->
                                latestLeft.value?.invoke()
                            travelledX >= distance || velocityX >= fling ->
                                latestRight.value?.invoke()
                        }
                    }
                    break
                }
            }
        }
    }
}
