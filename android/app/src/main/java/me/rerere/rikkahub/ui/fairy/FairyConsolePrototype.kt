package me.rerere.rikkahub.ui.fairy

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import me.rerere.rikkahub.BuildConfig
import me.rerere.rikkahub.Screen
import me.rerere.rikkahub.data.remote.IdentityUser
import me.rerere.rikkahub.data.remote.SessionsSnapshot

// PROTOTYPE: three structurally different console pages on the existing home route.
// Switch with the debug-only bottom bar. The wordmark, Fairy renderer and data stay shared.
private enum class ConsoleVariant(val key: String, val label: String) {
    Quiet("A", "QUIET"),
    Signal("B", "SIGNAL DOCK"),
    Session("C", "SESSION FIRST"),
}

private data class ConsoleModel(
    val name: String,
    val shortId: String,
    val role: String,
    val primary: String,
    val current: String?,
    val sessionCount: Int,
)

private val PrototypeSurface = Color(0xFF121824)
private val PrototypeSurfaceRaised = Color(0xFF182131)

@Composable
internal fun FairyConsolePrototype(
    user: IdentityUser?,
    sessions: SessionsSnapshot,
    eye: FairyEyeController,
    asleep: Boolean,
    caption: FairyLine?,
    onCaptionFinished: () -> Unit,
    onOpen: (Screen) -> Unit,
    modifier: Modifier = Modifier,
) {
    var variant by remember { mutableStateOf(ConsoleVariant.Quiet) }
    val model = ConsoleModel(
        name = user?.name ?: "—",
        shortId = user?.let { "#${it.shortId}" } ?: "—",
        role = when (user?.isAdmin) {
            true -> "ADMIN"
            false -> "AGENT"
            null -> "—"
        },
        primary = sessions.primarySessionId ?: "—",
        current = sessions.selectedId ?: sessions.primarySessionId,
        sessionCount = sessions.sessions.size,
    )
    val openCurrent = {
        onOpen(model.current?.let(Screen::Conversation) ?: Screen.Sessions)
    }
    val openSessions = { onOpen(Screen.Sessions) }
    val openSettings = { onOpen(Screen.Settings) }

    Box(modifier) {
        when (variant) {
            ConsoleVariant.Quiet -> QuietConsole(model, eye, asleep, caption, onCaptionFinished, openCurrent, openSettings)
            ConsoleVariant.Signal -> SignalConsole(model, eye, asleep, caption, onCaptionFinished, openCurrent, openSessions, openSettings)
            ConsoleVariant.Session -> SessionConsole(model, eye, asleep, caption, onCaptionFinished, openCurrent, openSessions, openSettings)
        }
        if (BuildConfig.DEBUG) {
            PrototypeSwitcher(
                current = variant,
                onChange = { variant = it },
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .navigationBarsPadding()
                    .padding(bottom = 10.dp)
                    .zIndex(20f),
            )
        }
    }
}

/** A: the existing structure, stripped down to one quiet, grouped information panel. */
@Composable
private fun QuietConsole(
    model: ConsoleModel,
    eye: FairyEyeController,
    asleep: Boolean,
    caption: FairyLine?,
    onCaptionFinished: () -> Unit,
    onOpenCurrent: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    PrototypeColumn {
        FairyHddWordmark()
        Spacer(Modifier.height(16.dp))
        PrototypeStage(
            eye = eye,
            asleep = asleep,
            caption = caption,
            onCaptionFinished = onCaptionFinished,
            eyeSize = 112.dp,
            modifier = Modifier.fillMaxWidth().height(208.dp),
        )
        Spacer(Modifier.height(16.dp))
        QuietIdentityPanel(model)
        Spacer(Modifier.height(20.dp))
        PrototypePrimaryKey(
            text = "进入会话",
            tag = "SESSIONS",
            onClick = onOpenCurrent,
            modifier = Modifier.fillMaxWidth().height(56.dp),
        )
        Spacer(Modifier.height(8.dp))
        PrototypeTextKey(
            text = "设置",
            tag = "SETTINGS",
            onClick = onOpenSettings,
            modifier = Modifier.fillMaxWidth().height(48.dp),
        )
    }
}

/** B: Fairy dominates; identity and session data become rails around a bottom action dock. */
@Composable
private fun SignalConsole(
    model: ConsoleModel,
    eye: FairyEyeController,
    asleep: Boolean,
    caption: FairyLine?,
    onCaptionFinished: () -> Unit,
    onOpenCurrent: () -> Unit,
    onOpenSessions: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    PrototypeColumn {
        FairyHddWordmark()
        Spacer(Modifier.height(12.dp))
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            PrototypeLabel("PROXY")
            Spacer(Modifier.width(10.dp))
            Text(
                model.name,
                color = LocalFairyTokens.current.textPrimary,
                fontSize = 15.sp,
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f, fill = false),
            )
            Spacer(Modifier.width(8.dp))
            PrototypeLabel(model.shortId)
            Spacer(Modifier.weight(1f))
            PrototypeBadge(model.role)
        }
        Spacer(Modifier.height(12.dp))
        PrototypeStage(
            eye = eye,
            asleep = asleep,
            caption = caption,
            onCaptionFinished = onCaptionFinished,
            eyeSize = 120.dp,
            modifier = Modifier.fillMaxWidth().height(228.dp),
        )
        Spacer(Modifier.height(18.dp))
        Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
            Column(Modifier.weight(1f)) {
                PrototypeLabel("PRIMARY SESSION")
                Spacer(Modifier.height(5.dp))
                PrototypeValue(model.primary, size = 18)
            }
            Column(horizontalAlignment = Alignment.End) {
                PrototypeLabel("SESSIONS")
                Spacer(Modifier.height(5.dp))
                PrototypeValue(model.sessionCount.toString(), size = 18)
            }
        }
        Spacer(Modifier.height(20.dp))
        PrototypePrimaryKey(
            text = "进入会话",
            tag = model.current ?: "SESSIONS",
            onClick = onOpenCurrent,
            modifier = Modifier.fillMaxWidth().height(56.dp),
        )
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PrototypeDockKey(
                text = "全部会话",
                tag = "${model.sessionCount} SESSIONS",
                onClick = onOpenSessions,
                modifier = Modifier.weight(1f).height(50.dp),
            )
            PrototypeDockKey(
                text = "设置",
                tag = "SETTINGS",
                onClick = onOpenSettings,
                modifier = Modifier.weight(1f).height(50.dp),
            )
        }
    }
}

/** C: a daily-tool layout — Fairy is present, but the current session is the largest object. */
@Composable
private fun SessionConsole(
    model: ConsoleModel,
    eye: FairyEyeController,
    asleep: Boolean,
    caption: FairyLine?,
    onCaptionFinished: () -> Unit,
    onOpenCurrent: () -> Unit,
    onOpenSessions: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    val tokens = LocalFairyTokens.current
    PrototypeColumn {
        FairyHddWordmark()
        Spacer(Modifier.height(16.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                PrototypeLabel("HDD // FAIRY")
                Spacer(Modifier.height(8.dp))
                Text(
                    text = if (asleep) "SLEEP" else "STANDBY",
                    fontFamily = tokens.labelFontFamily,
                    fontSize = 17.sp,
                    letterSpacing = 1.sp,
                    color = tokens.fairyLink,
                )
                Spacer(Modifier.height(28.dp))
                Text(
                    model.name,
                    color = tokens.textPrimary,
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Spacer(Modifier.height(4.dp))
                PrototypeLabel("${model.shortId} / ${model.role}")
            }
            Spacer(Modifier.width(12.dp))
            PrototypeStage(
                eye = eye,
                asleep = asleep,
                caption = null,
                onCaptionFinished = onCaptionFinished,
                eyeSize = 88.dp,
                hud = false,
                modifier = Modifier.width(172.dp).height(172.dp),
            )
        }
        caption?.let { line ->
            Spacer(Modifier.height(12.dp))
            FairyCaption(line, compact = true, onFinished = onCaptionFinished)
        }
        Spacer(Modifier.height(20.dp))
        CurrentSessionCard(model, onOpenCurrent)
        Spacer(Modifier.height(12.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            PrototypeDockKey(
                text = "全部会话",
                tag = "${model.sessionCount} SESSIONS",
                onClick = onOpenSessions,
                modifier = Modifier.weight(1f).height(50.dp),
            )
            PrototypeDockKey(
                text = "设置",
                tag = "SETTINGS",
                onClick = onOpenSettings,
                modifier = Modifier.weight(1f).height(50.dp),
            )
        }
    }
}

@Composable
private fun PrototypeColumn(content: @Composable ColumnScope.() -> Unit) {
    Column(
        Modifier
            .fillMaxSize()
            .statusBarsPadding()
            .navigationBarsPadding()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp)
            .padding(top = 16.dp, bottom = 88.dp),
        content = content,
    )
}

@Composable
private fun PrototypeStage(
    eye: FairyEyeController,
    asleep: Boolean,
    caption: FairyLine?,
    onCaptionFinished: () -> Unit,
    eyeSize: Dp,
    modifier: Modifier,
    hud: Boolean = true,
) {
    val tokens = LocalFairyTokens.current
    Box(modifier.zIndex(1f)) {
        FairyScreen(
            presence = FairyPresence.IDLE,
            eyeSize = eyeSize,
            hud = hud,
            eye = eye,
            hudStatus = if (asleep) "SLEEP" else null,
            modifier = Modifier.fillMaxSize(),
        )
        if (asleep) {
            Text(
                "TAP TO WAKE",
                fontFamily = tokens.labelFontFamily,
                fontSize = 11.sp,
                letterSpacing = 1.2.sp,
                color = tokens.fairyLink,
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 14.dp),
            )
        }
        caption?.let { line ->
            Box(Modifier.align(Alignment.BottomCenter)) {
                FairyCaption(line, compact = false, onFinished = onCaptionFinished)
            }
        }
    }
}

@Composable
private fun QuietIdentityPanel(model: ConsoleModel) {
    val tokens = LocalFairyTokens.current
    val shape = RoundedCornerShape(18.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .background(PrototypeSurface, shape)
            .border(1.dp, tokens.hairline, shape)
            .padding(18.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                PrototypeLabel("PROXY")
                Spacer(Modifier.height(7.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        model.name,
                        color = tokens.textPrimary,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Spacer(Modifier.width(10.dp))
                    PrototypeLabel(model.shortId)
                }
            }
            Spacer(Modifier.width(12.dp))
            PrototypeBadge(model.role)
        }
        Spacer(Modifier.height(16.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(tokens.hairline))
        Spacer(Modifier.height(16.dp))
        Row(Modifier.fillMaxWidth()) {
            Column(Modifier.weight(1f)) {
                PrototypeLabel("CURRENT SESSION")
                Spacer(Modifier.height(5.dp))
                PrototypeValue(model.current ?: "—")
            }
            Column(horizontalAlignment = Alignment.End) {
                PrototypeLabel("SESSIONS")
                Spacer(Modifier.height(5.dp))
                PrototypeValue(model.sessionCount.toString())
            }
        }
    }
}

@Composable
private fun CurrentSessionCard(model: ConsoleModel, onClick: () -> Unit) {
    val tokens = LocalFairyTokens.current
    val shape = RoundedCornerShape(20.dp)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(tokens.primary)
            .clickable(onClick = onClick)
            .padding(20.dp),
    ) {
        PrototypeLabel("CURRENT SESSION", color = tokens.onPrimary.copy(alpha = 0.58f))
        Spacer(Modifier.height(10.dp))
        Text(
            model.current ?: "—",
            color = tokens.onPrimary,
            fontFamily = tokens.labelFontFamily,
            fontSize = 28.sp,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
        Spacer(Modifier.height(18.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (model.current == null) "选择会话" else "进入会话",
                color = tokens.onPrimary,
                fontSize = 16.sp,
                fontWeight = FontWeight.Black,
            )
            Spacer(Modifier.weight(1f))
            Text("→", color = tokens.onPrimary, fontSize = 24.sp)
        }
    }
}

@Composable
private fun PrototypePrimaryKey(text: String, tag: String, onClick: () -> Unit, modifier: Modifier) {
    val tokens = LocalFairyTokens.current
    val shape = FairySlantShape(slant = 8.dp, corner = 9.dp)
    Box(
        modifier
            .clip(shape)
            .background(tokens.primary)
            .clickable(onClick = onClick)
            .padding(horizontal = 20.dp),
        contentAlignment = Alignment.Center,
    ) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Text(text, color = tokens.onPrimary, fontSize = 17.sp, fontWeight = FontWeight.Black)
            PrototypeLabel(tag, color = tokens.onPrimary.copy(alpha = 0.55f))
        }
    }
}

@Composable
private fun PrototypeTextKey(text: String, tag: String, onClick: () -> Unit, modifier: Modifier) {
    val tokens = LocalFairyTokens.current
    Box(modifier.clickable(onClick = onClick), contentAlignment = Alignment.Center) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(text, color = tokens.textPrimary.copy(alpha = 0.82f), fontSize = 14.sp, fontWeight = FontWeight.Bold)
            PrototypeLabel(tag, color = tokens.textMuted)
        }
    }
}

@Composable
private fun PrototypeDockKey(text: String, tag: String, onClick: () -> Unit, modifier: Modifier) {
    val tokens = LocalFairyTokens.current
    val shape = RoundedCornerShape(14.dp)
    Column(
        modifier
            .clip(shape)
            .background(PrototypeSurfaceRaised)
            .border(1.dp, tokens.hairline, shape)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(text, color = tokens.textPrimary, fontSize = 14.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(3.dp))
        PrototypeLabel(tag, fontSize = 9.sp)
    }
}

@Composable
private fun PrototypeBadge(text: String) {
    val tokens = LocalFairyTokens.current
    Text(
        text,
        fontFamily = tokens.labelFontFamily,
        fontSize = 10.sp,
        letterSpacing = 0.8.sp,
        color = tokens.fairyLink,
        modifier = Modifier
            .background(tokens.fairyLink.copy(alpha = 0.09f), RoundedCornerShape(6.dp))
            .padding(horizontal = 9.dp, vertical = 5.dp),
    )
}

@Composable
private fun PrototypeLabel(text: String, color: Color? = null, fontSize: TextUnit = 10.sp) {
    val tokens = LocalFairyTokens.current
    Text(
        text,
        fontFamily = tokens.labelFontFamily,
        fontSize = fontSize,
        letterSpacing = 0.8.sp,
        color = color ?: tokens.textMuted,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun PrototypeValue(text: String, size: Int = 15) {
    Text(
        text,
        color = LocalFairyTokens.current.textPrimary,
        fontSize = size.sp,
        fontWeight = FontWeight.Medium,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun PrototypeSwitcher(
    current: ConsoleVariant,
    onChange: (ConsoleVariant) -> Unit,
    modifier: Modifier = Modifier,
) {
    val variants = ConsoleVariant.entries
    Row(
        modifier
            .background(Color(0xF2262931), CircleShape)
            .border(1.dp, Color.White.copy(alpha = 0.18f), CircleShape)
            .padding(4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        PrototypeSwitchArrow("‹", "上一方案") {
            onChange(variants[(current.ordinal - 1 + variants.size) % variants.size])
        }
        Text(
            "${current.key} · ${current.label}",
            color = Color.White,
            fontFamily = LocalFairyTokens.current.labelFontFamily,
            fontSize = 11.sp,
            letterSpacing = 0.5.sp,
            textAlign = TextAlign.Center,
            modifier = Modifier.width(142.dp),
        )
        PrototypeSwitchArrow("›", "下一方案") {
            onChange(variants[(current.ordinal + 1) % variants.size])
        }
    }
}

@Composable
private fun PrototypeSwitchArrow(text: String, description: String, onClick: () -> Unit) {
    Box(
        Modifier
            .size(38.dp)
            .clip(CircleShape)
            .clickable(onClick = onClick)
            .semantics { contentDescription = description },
        contentAlignment = Alignment.Center,
    ) {
        Text(text, color = Color.White, fontSize = 26.sp, textAlign = TextAlign.Center)
    }
}
