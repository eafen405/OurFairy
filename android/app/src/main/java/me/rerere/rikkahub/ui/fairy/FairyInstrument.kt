package me.rerere.rikkahub.ui.fairy

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

enum class InstrumentLevel { NORMAL, RAISED, RECESSED }

@Composable
fun InstrumentPanel(
    modifier: Modifier = Modifier,
    level: InstrumentLevel = InstrumentLevel.NORMAL,
    chamfered: Boolean = false,
    contentPadding: PaddingValues = PaddingValues(16.dp),
    content: @Composable ColumnScope.() -> Unit,
) {
    val tokens = LocalFairyTokens.current
    val shape = if (chamfered) tokens.consoleShape else tokens.panelShape
    Column(
        modifier
            .fairyPanel(shape, deep = level == InstrumentLevel.RECESSED, muted = level != InstrumentLevel.RAISED)
            .padding(contentPadding),
        content = content,
    )
}

enum class SignalButtonVariant { PRIMARY, SECONDARY, DANGER }

@Composable
fun SignalButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    tag: String? = null,
    variant: SignalButtonVariant = SignalButtonVariant.SECONDARY,
    enabled: Boolean = true,
) {
    val tokens = LocalFairyTokens.current
    val primary = variant == SignalButtonVariant.PRIMARY
    val contentColor = when {
        !enabled -> tokens.textMuted.copy(alpha = 0.55f)
        variant == SignalButtonVariant.DANGER -> tokens.danger
        primary -> tokens.onPrimary
        else -> tokens.textPrimary
    }
    @Composable
    fun Labels() {
        Text(
            text = text,
            fontFamily = tokens.functionFontFamily,
            fontWeight = FontWeight.Bold,
            fontSize = 15.sp,
            color = contentColor,
            maxLines = 1,
            softWrap = false,
        )
        if (tag != null) {
            Text(
                text = tag,
                fontFamily = tokens.telemetryFontFamily,
                fontSize = 9.sp,
                letterSpacing = 0.8.sp,
                color = contentColor.copy(alpha = 0.65f),
                maxLines = 1,
                softWrap = false,
            )
        }
    }
    BoxWithConstraints(
        modifier
            .heightIn(min = 48.dp)
            .fairyKey(tokens.controlShape, primary && enabled)
            .then(if (!enabled) Modifier.background(tokens.panel.copy(alpha = 0.72f), tokens.controlShape) else Modifier)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        if (maxWidth < 180.dp) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) { Labels() }
        } else {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(10.dp),
            ) { Labels() }
        }
    }
}

enum class StatusTone { NEUTRAL, SIGNAL, ONLINE, WARNING, DANGER }

@Composable
fun StatusChip(
    text: String,
    modifier: Modifier = Modifier,
    tone: StatusTone = StatusTone.NEUTRAL,
    live: Boolean = false,
) {
    val tokens = LocalFairyTokens.current
    val color = when (tone) {
        StatusTone.NEUTRAL -> tokens.textMuted
        StatusTone.SIGNAL -> tokens.signal
        StatusTone.ONLINE -> tokens.online
        StatusTone.WARNING -> Color(0xFFF0B35E)
        StatusTone.DANGER -> tokens.danger
    }
    val shape = tokens.controlShape
    Box(
        modifier
            .drawWithCache {
                val path = shape.createOutline(size, layoutDirection, this).asPath()
                onDrawBehind {
                    if (live) drawPath(path, color.copy(alpha = 0.12f), style = Stroke(6.dp.toPx()))
                }
            }
            .background(color.copy(alpha = 0.06f), shape)
            .border(1.dp, color.copy(alpha = if (live) 0.5f else 0.25f), shape)
            .semantics { if (live) liveRegion = LiveRegionMode.Polite }
            .padding(horizontal = 9.dp, vertical = 5.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            fontFamily = tokens.telemetryFontFamily,
            fontSize = 10.sp,
            letterSpacing = 0.6.sp,
            color = color,
            maxLines = 1,
        )
    }
}
