package me.rerere.rikkahub.ui.fairy

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialExpressiveTheme
import androidx.compose.material3.MotionScheme
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.remember
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import me.rerere.rikkahub.ui.theme.LocalDarkMode
import androidx.activity.compose.LocalActivity
import androidx.compose.runtime.SideEffect
import androidx.core.view.WindowCompat

private val DefaultFairyTokens = FairyTokens()
private val FairyBgTop = DefaultFairyTokens.bgTop
private val FairyBgBottom = DefaultFairyTokens.bgBottom
private val FairyPanel = DefaultFairyTokens.panel
private val FairyPill = DefaultFairyTokens.pill
private val FairyIce = DefaultFairyTokens.textPrimary
private val FairyNavy = DefaultFairyTokens.onPrimary
private val FairyBlue = DefaultFairyTokens.fairyBlue
private val FairyGlow = DefaultFairyTokens.fairyGlow
private val FairyLink = DefaultFairyTokens.fairyLink
private val FairySignal = DefaultFairyTokens.signal
private val FairyDanger = DefaultFairyTokens.danger
private val FairyMuted = DefaultFairyTokens.textMuted

/**
 * The fixed Fairy dark palette. Product surfaces always use this scheme: it
 * never follows the wallpaper, the system light/dark setting or a user preset.
 * Surfaces step panel -> pill; primary interaction uses signal cyan on navy.
 */
val FairyColorScheme: ColorScheme = ColorScheme(
    primary = FairySignal, onPrimary = FairyNavy,
    primaryContainer = FairyPill, onPrimaryContainer = FairyIce,
    secondary = FairyLink, onSecondary = FairyNavy,
    secondaryContainer = FairyPill, onSecondaryContainer = FairyIce,
    tertiary = FairyBlue, onTertiary = FairyIce,
    tertiaryContainer = FairyBlue, onTertiaryContainer = FairyIce,
    error = FairyDanger, onError = FairyNavy,
    errorContainer = Color(0xFF3A1622), onErrorContainer = Color(0xFFFFB4AC),
    background = FairyBgBottom, onBackground = FairyIce,
    surface = FairyBgBottom, onSurface = FairyIce,
    surfaceVariant = FairyPill, onSurfaceVariant = FairyMuted,
    outline = Color(0xFF3A4666), outlineVariant = Color(0xFF1E2A47),
    inversePrimary = FairyBlue,
    inverseSurface = FairyIce, inverseOnSurface = FairyNavy,
    // Tonal elevation must not tint the navy panels.
    surfaceTint = Color.Transparent, scrim = Color.Black,
    surfaceDim = FairyBgBottom, surfaceBright = Color(0xFF1C2B55),
    surfaceContainerLowest = Color(0xFF081226),
    surfaceContainerLow = FairyBgTop,
    surfaceContainer = FairyPanel,
    surfaceContainerHigh = Color(0xFF122043),
    surfaceContainerHighest = FairyPill,
    primaryFixed = FairyIce, primaryFixedDim = Color(0xFFC9D6F5),
    onPrimaryFixed = FairyNavy, onPrimaryFixedVariant = FairyNavy,
    secondaryFixed = FairyLink, secondaryFixedDim = Color(0xFF6E9BE8),
    onSecondaryFixed = FairyNavy, onSecondaryFixedVariant = FairyNavy,
    tertiaryFixed = FairyBlue, tertiaryFixedDim = FairyGlow,
    onTertiaryFixed = FairyIce, onTertiaryFixedVariant = FairyIce,
)

/**
 * Display, headline, title and label tiers use the Fairy title face; the body
 * tiers are left to the chat-font setting so message reading stays adjustable.
 */
private fun fairyTypography(): Typography {
    fun TextStyle.withFamily(f: androidx.compose.ui.text.font.FontFamily) = copy(fontFamily = f)
    fun TextStyle.tier(size: Float, line: Float) = copy(fontSize = size.sp, lineHeight = line.sp)
    return Typography(
        displayLarge = Typography().displayLarge.withFamily(DisplayFamily),
        displayMedium = Typography().displayMedium.withFamily(DisplayFamily),
        displaySmall = Typography().displaySmall.withFamily(DisplayFamily),
        headlineLarge = Typography().headlineLarge.withFamily(DisplayFamily),
        headlineMedium = Typography().headlineMedium.withFamily(DisplayFamily),
        headlineSmall = Typography().headlineSmall.withFamily(DisplayFamily),
        titleLarge = Typography().titleLarge.withFamily(DisplayFamily),
        titleMedium = Typography().titleMedium.withFamily(TitleFamily),
        titleSmall = Typography().titleSmall.withFamily(TitleFamily),
        labelLarge = Typography().labelLarge.withFamily(TitleFamily),
        labelMedium = Typography().labelMedium.withFamily(TelemetryFamily),
        labelSmall = Typography().labelSmall.withFamily(TelemetryFamily).tier(11f, 15f),
    )
}

/** Fairy palette, typography and expressive motion shared by the client. */
@Composable
fun FairyAppTheme(content: @Composable () -> Unit) {
    val activity = LocalActivity.current
    SideEffect {
        activity?.window?.let { window ->
            WindowCompat.getInsetsController(window, window.decorView).apply {
                isAppearanceLightStatusBars = false
                isAppearanceLightNavigationBars = false
            }
        }
    }
    val tokens = remember { FairyTokens() }
    val typography = remember { fairyTypography() }
    CompositionLocalProvider(
        LocalFairyTokens provides tokens,
        LocalDarkMode provides true,
        LocalContentColor provides tokens.textPrimary,
    ) {
        MaterialExpressiveTheme(
            motionScheme = MotionScheme.expressive(),
            colorScheme = FairyColorScheme,
            typography = typography,
            shapes = Shapes(
                extraSmall = RoundedCornerShape(2.dp),
                small = RoundedCornerShape(4.dp),
                medium = RoundedCornerShape(6.dp),
                large = RoundedCornerShape(6.dp),
                extraLarge = RoundedCornerShape(6.dp),
            ),
            content = { ProvideAgoraMotionPolicy(appReduceMotion = false, content = content) },
        )
    }
}
