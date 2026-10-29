package me.rerere.rikkahub.ui.fairy

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.currentStateAsState
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flowOf
import me.rerere.rikkahub.Screen
import me.rerere.rikkahub.data.remote.IdentityUser
import me.rerere.rikkahub.data.remote.RemoteReceiveState
import org.koin.compose.koinInject

/** How often the console pulses the interaction module while the screen is live. */
private const val TICK_MS = 500L

/**
 * The console: Fairy's large live screen over a quiet HDD background, one
 * grouped account/current-session card, and clear ways on to that session,
 * the session list or settings. Fairy follows the finger anywhere on the page
 * (observational only; touches still reach the keys); 待机 and 台词 — a line
 * after 45 s, stand-by after three idle minutes — are the interaction module's
 * rules, which this page only pulses and renders.
 */
@Composable
fun FairyConsolePage(
    onOpen: (Screen) -> Unit,
    session: me.rerere.rikkahub.data.remote.AccountSession = koinInject(),
    receive: RemoteReceiveState = koinInject(),
    fairy: FairyInteraction = koinInject(),
) {
    val baseTokens = LocalFairyTokens.current
    val eye = remember { FairyEyeController(asleep = fairy.state.value.asleep) }
    val identity by session.identity.collectAsStateWithLifecycle()
    val owned by receive.owned.snapshot.collectAsStateWithLifecycle()
    val interaction by fairy.state.collectAsStateWithLifecycle()
    var powerOn by remember { mutableIntStateOf(if (FairyColdStart.claim()) 1 else 0) }
    val lifecycleOwner = LocalLifecycleOwner.current.lifecycle
    val lifecycle by lifecycleOwner.currentStateAsState()
    val speaks = LocalConfiguration.current.locales[0].language == "zh"
    val running = lifecycle.isAtLeast(Lifecycle.State.STARTED)
    val asleep = interaction.asleep
    val caption = interaction.caption
    val tokens = baseTokens

    // The page only supplies the beat; 待机 and 台词 live in the module (and outlive this page).
    LaunchedEffect(running, speaks, asleep) {
        if (!running) {
            fairy.pageExit()
            return@LaunchedEffect
        }
        if (!speaks || asleep) return@LaunchedEffect
        while (true) {
            delay(TICK_MS)
            fairy.tick()
        }
    }
    // The controller is the page's own transient eye state; the continuous 待机 lives in the module.
    LaunchedEffect(asleep) { eye.asleep = asleep }
    // Coming back to the foreground presents the current session's facts as they are right now —
    // read from its runtime, not from this composition, which did not run while away — and settles
    // whatever arrived in the meantime instead of replaying it. Leaving settles the transient
    // presentation.
    DisposableEffect(lifecycleOwner, fairy, receive) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> {
                    val sessionId = receive.owned.snapshot.value.currentSessionId()
                    val current = sessionId?.let(receive::stateForSession)?.snapshot?.value
                    fairy.foregrounded(
                        sessionId?.let(::FairyInteractionContext),
                        current?.fairyFacts(),
                    )
                }
                Lifecycle.Event.ON_STOP -> fairy.pageExit()
                else -> Unit
            }
        }
        lifecycleOwner.addObserver(observer)
        onDispose { lifecycleOwner.removeObserver(observer) }
    }
    DisposableEffect(fairy) { onDispose { fairy.pageExit() } }
    val origin = remember { floatArrayOf(0f, 0f) }
    val bounds = remember { floatArrayOf(0f, 0f) }
    // New events glance at the page's content; the console has no composer of its own, so a SENT
    // reaction (which only a conversation page can produce) has no target here.
    FairyEyeReactions(
        reaction = interaction.reaction,
        eye = eye,
        composer = { null },
        content = { Offset(origin[0] + bounds[0] / 2f, origin[1] + bounds[1] * 0.55f) },
    )
    // 当前会话: the reader's last choice, else the account's main session. Home presents only this
    // one session — its runtime, its connection, its activity — never a union over the account.
    val currentSessionId = owned.currentSessionId()
    val runtimes by receive.runtimes.collectAsStateWithLifecycle()
    val currentRuntime = currentSessionId?.let(runtimes::get)
    // Unconditional collection: the runtime may not exist yet, and a page that appeared or
    // vanished mid-composition would change the composition's shape.
    val currentSnapshot by remember(currentRuntime) {
        currentRuntime?.snapshot ?: flowOf(null)
    }.collectAsStateWithLifecycle(null)
    val currentFacts = currentSnapshot?.fairyFacts()
    val window = fairy.window(currentFacts)
    LaunchedEffect(fairy, currentSessionId, currentFacts) {
        fairy.show(currentSessionId?.let(::FairyInteractionContext), currentFacts)
    }
    CompositionLocalProvider(LocalFairyTokens provides tokens) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Brush.verticalGradient(listOf(tokens.bgTop, tokens.bgBottom))),
        ) {
            FairyBackground(watermark = false)
            Column(
                Modifier
                    .fillMaxSize()
                    .onGloballyPositioned {
                        origin[0] = it.positionInRoot().x
                        origin[1] = it.positionInRoot().y
                        bounds[0] = it.size.width.toFloat()
                        bounds[1] = it.size.height.toFloat()
                    }
                    .pointerInput(eye) {
                        awaitPointerEventScope {
                            while (true) {
                                val event = awaitPointerEvent(PointerEventPass.Final)
                                val touch = event.changes.firstOrNull { it.pressed }
                                eye.lookAt(touch?.let { Offset(origin[0] + it.position.x, origin[1] + it.position.y) })
                                if (touch != null && fairy.touch()) {
                                    eye.wake(confused = true)
                                }
                            }
                        }
                    }
                    .statusBarsPadding()
                    .navigationBarsPadding()
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 20.dp)
                    .padding(top = 16.dp, bottom = 24.dp),
            ) {
                FairyHddWordmark()
                Spacer(Modifier.height(16.dp))
                Box(Modifier.fillMaxWidth().zIndex(1f)) {
                    FairyScreen(
                        presence = window.presence,
                        eyeSize = 112.dp,
                        speechPulse = interaction.speechPulse,
                        hud = true,
                        eye = eye,
                        hudStatus = if (asleep) "SLEEP" else null,
                        modifier = Modifier.fillMaxWidth().height(208.dp).testTag("fairy-console-screen"),
                    )
                    if (asleep) {
                        Text(
                            "TAP TO WAKE",
                            fontFamily = tokens.telemetryFontFamily,
                            fontSize = 11.sp,
                            letterSpacing = 1.5.sp,
                            color = tokens.fairyLink.copy(alpha = 0.85f),
                            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 14.dp).fairySlant(),
                        )
                    }
                }
                // The line is a sibling below the screen: its top stays at the
                // screen's bottom edge, so added height extends downward over
                // the page, never over the Fairy animation.
                caption?.let { line ->
                    FairyCaption(
                        line,
                        onFinished = { fairy.captionFinished() },
                        modifier = Modifier.testTag("fairy-caption"),
                    )
                }
                Spacer(Modifier.height(16.dp))
                ConsoleInfoCard(
                    user = identity?.user,
                    currentSessionId = currentSessionId,
                    sessionCount = owned.sessions.size,
                )
                Spacer(Modifier.height(20.dp))
                SignalButton(
                    text = "进入会话",
                    tag = "SESSIONS",
                    variant = SignalButtonVariant.PRIMARY,
                    onClick = {
                        onOpen(currentSessionId?.let(Screen::Conversation) ?: Screen.Sessions)
                    },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                )
                Spacer(Modifier.height(12.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    SignalButton(
                        text = "全部会话",
                        tag = "${owned.sessions.size} SESSIONS",
                        onClick = { onOpen(Screen.Sessions) },
                        modifier = Modifier.weight(1f).heightIn(min = 50.dp),
                    )
                    SignalButton(
                        text = "设置",
                        tag = "SETTINGS",
                        onClick = { onOpen(Screen.Settings) },
                        modifier = Modifier.weight(1f).heightIn(min = 50.dp),
                    )
                }
            }
            FairyCrtPowerOn(powerOn)
        }
    }
}

@Composable
private fun ConsoleInfoCard(user: IdentityUser?, currentSessionId: String?, sessionCount: Int) {
    val tokens = LocalFairyTokens.current
    InstrumentPanel(
        modifier = Modifier.fillMaxWidth(),
        level = InstrumentLevel.RAISED,
        chamfered = true,
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                ConsoleLabel("PROXY")
                Spacer(Modifier.height(7.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        text = user?.name ?: "—",
                        color = tokens.textPrimary,
                        fontFamily = tokens.functionFontFamily,
                        fontSize = 20.sp,
                        fontWeight = FontWeight.Bold,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f, fill = false),
                    )
                    Spacer(Modifier.width(10.dp))
                    ConsoleLabel(user?.let { "#${it.shortId}" } ?: "—")
                }
            }
            Spacer(Modifier.width(12.dp))
            StatusChip(
                text = when (user?.isAdmin) {
                    true -> "ADMIN"
                    false -> "AGENT"
                    null -> "—"
                },
                tone = if (user?.isAdmin == true) StatusTone.SIGNAL else StatusTone.NEUTRAL,
            )
        }
        Spacer(Modifier.height(16.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(tokens.hairline))
        Spacer(Modifier.height(16.dp))
        Row(Modifier.fillMaxWidth()) {
            Column(Modifier.weight(1f)) {
                ConsoleLabel("CURRENT SESSION")
                Spacer(Modifier.height(5.dp))
                ConsoleValue(currentSessionId ?: "—")
            }
            Spacer(Modifier.width(12.dp))
            Column(horizontalAlignment = Alignment.End) {
                ConsoleLabel("SESSIONS")
                Spacer(Modifier.height(5.dp))
                ConsoleValue(sessionCount.toString())
            }
        }
    }
}

@Composable
private fun ConsoleLabel(text: String, color: Color? = null, fontSize: TextUnit = 10.sp) {
    val tokens = LocalFairyTokens.current
    Text(
        text = text,
        fontFamily = tokens.telemetryFontFamily,
        fontSize = fontSize,
        letterSpacing = 0.8.sp,
        color = color ?: tokens.textMuted,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

@Composable
private fun ConsoleValue(text: String) {
    Text(
        text = text,
        color = LocalFairyTokens.current.textPrimary,
        fontFamily = LocalFairyTokens.current.telemetryFontFamily,
        fontSize = 12.sp,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}
