package me.rerere.rikkahub.ui.fairy

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.geometry.Offset

/** How long the eye holds a reaction glance before the gaze returns to its own business. */
private const val REACTION_GLANCE_MS = 700

/**
 * Play the interaction module's latest transient reaction on this page's eye.
 *
 * The module names the stimulus ([FairyReactionKind]); the page owns the renderer and the
 * positions, so the mapping lives here: a send glances at the composer, output and delivery glance
 * at the content, and a finished run blinks once. The effect is keyed by [FairyReaction.id], so
 * recomposing or rebuilding the page while the same reaction is still current cannot play it
 * again; the module settles the reaction when the page leaves or comes back
 * ([FairyInteraction.pageExit], [FairyInteraction.foregrounded]).
 *
 * Under Reduced Motion the screen draws its still frame and never consumes these counters, so the
 * reaction is an addition to the state and content the page already shows, never the only feedback.
 */
@Composable
internal fun FairyEyeReactions(
    reaction: FairyReaction?,
    eye: FairyEyeController,
    composer: () -> Offset?,
    content: () -> Offset?,
) {
    LaunchedEffect(reaction?.id) {
        when (reaction?.kind) {
            FairyReactionKind.SENT -> composer()?.let { eye.glanceAt(it, REACTION_GLANCE_MS) }
            FairyReactionKind.OUTPUT, FairyReactionKind.DELIVERY ->
                content()?.let { eye.glanceAt(it, REACTION_GLANCE_MS) }
            FairyReactionKind.COMPLETED -> eye.blink()
            null -> Unit
        }
    }
}
