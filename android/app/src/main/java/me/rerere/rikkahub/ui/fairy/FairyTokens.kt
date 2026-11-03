package me.rerere.rikkahub.ui.fairy

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp

/**
 * Fixed Fairy dark tokens that sit outside the Material3
 * [androidx.compose.material3.ColorScheme] slots. Provided by [FairyAppTheme] via
 * [LocalFairyTokens]; components read from here instead of hard-coding values.
 *
 * Fairy animation keeps its electric-blue identity. Instrument signal cyan is
 * separate and only marks primary actions, focus and live status.
 */
@Immutable
data class FairyTokens(
    /** Page vertical gradient: top and bottom stops. */
    val bgTop: Color = Color(0xFF08111F),
    val bgBottom: Color = Color(0xFF030711),
    /** Cached page texture: a 3% 24 dp grid with quieter 1 px scanlines. */
    val grid: Color = Color(0xFF72D7FF).copy(alpha = 0.03f),
    val scanline: Color = Color.White.copy(alpha = 0.012f),
    /** Fairy window screen keeps the character's original deep-blue material. */
    val screenCenter: Color = Color(0xFF0D2257),
    val screenEdge: Color = Color(0xFF050B1F),
    /** Window bar, composer, dialogs, sheets, menus. */
    val panel: Color = Color(0xFF0A1426).copy(alpha = 0.96f),
    /** Instrument glass: a restrained top light over a dark lower plate. */
    val panelTop: Color = Color(0xFF142238),
    val panelBottom: Color = Color(0xFF091321),
    /** File cards, quick prompts, list items, secondary capsules. */
    val pill: Color = Color(0xFF101C2E),
    /** 1 dp inner panel outline, window bar bottom edge, dividers. */
    val hairline: Color = Color.White.copy(alpha = 0.10f),
    /** Fairy identity remains electric blue across eyes, emblem and animation. */
    val fairyBlue: Color = Color(0xFF1F55E0),
    val fairyGlow: Color = Color(0xFF3D8BFF),
    val fairyLink: Color = Color(0xFF8FB8FF),
    /** Instrument focus, primary action and live status; never drives Fairy animation. */
    val signal: Color = Color(0xFF72D7FF),
    /** Send key, primary buttons, switches, generic progress. */
    val primary: Color = Color(0xFFEAF0FF),
    val onPrimary: Color = Color(0xFF0A1633),
    /** User glass bubble fill and its 1 dp outline. */
    val userBubble: Color = Color.White.copy(alpha = 0.12f),
    val userBubbleBorder: Color = Color.White.copy(alpha = 0.20f),
    /** Code blocks, inline code and quote backgrounds. */
    val codeSurface: Color = Color.White.copy(alpha = 0.06f),
    /** Online status dot, success. */
    val online: Color = Color(0xFF5BE49B),
    /** Errors and the stop key. */
    val danger: Color = Color(0xFFFF5A4E),
    val onDanger: Color = Color.White,
    val textPrimary: Color = Color(0xFFEAF3FF),
    val textMuted: Color = Color(0xFFA9B8D8),
    val panelShape: Shape = RoundedCornerShape(6.dp),
    val controlShape: Shape = RoundedCornerShape(4.dp),
    val screenShape: Shape = RoundedCornerShape(6.dp),
    /** Primary instrument plates use machined corners without extra brackets. */
    val consoleShape: Shape = FairyChamferShape(cut = 10.dp),
    val userBubbleShape: Shape = RoundedCornerShape(
        topStart = 6.dp,
        topEnd = 2.dp,
        bottomEnd = 6.dp,
        bottomStart = 6.dp,
    ),
    /** Industrial display face for page and section titles. */
    val titleFontFamily: FontFamily = DisplayFamily,
    /** MiSans for Chinese functions and controls. */
    val functionFontFamily: FontFamily = TitleFamily,
    /** Outfit for the H.D.D wordmark. */
    val labelFontFamily: FontFamily = LabelFamily,
    /** JetBrains Mono for telemetry, identifiers and short status readouts. */
    val telemetryFontFamily: FontFamily = TelemetryFamily,
) {
    /** A faint top-centered ambient light, not a glow on every surface. */
    val ambientGlow: Color get() = fairyGlow.copy(alpha = 0.055f)

    /** Opaque panel for surfaces that must not show content through. */
    val panelOpaque: Color get() = bgTop
}

val LocalFairyTokens = staticCompositionLocalOf { FairyTokens() }
