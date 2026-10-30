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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.zIndex
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.currentStateAsState
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.flowOf
import me.rerere.rikkahub.Screen
import me.rerere.rikkahub.data.remote.IdentityUser
import me.rerere.rikkahub.data.remote.RemoteReceiveState
import me.rerere.rikkahub.data.remote.displayTitle
import me.rerere.rikkahub.ui.identity.SessionListOverlay
import me.rerere.rikkahub.ui.identity.rememberSessionListOverlayState
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
    /**
     * The page's eye controller. A test can inject one and observe its real output
     * (`pointer`, `glances`, `blinks`); production leaves it null and the page remembers one.
     */
    eye: FairyEyeController? = null,
) {
    val baseTokens = LocalFairyTokens.current
    val pageEye = eye ?: remember { FairyEyeController(asleep = fairy.state.value.asleep) }
    val overlay = rememberSessionListOverlayState()
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
    // Leaving settles the transient presentation through the shared host's lifecycle observer.
    LaunchedEffect(running, speaks, asleep) {
        if (!running || !speaks || asleep) return@LaunchedEffect
        while (true) {
            delay(TICK_MS)
            fairy.tick()
        }
    }
    // 当前会话: the reader's last choice, else the account's main session. Home presents only this
    // one session — its runtime, its connection, its activity — never a union over the account.
    val currentSessionId = owned.currentSessionId()
    // The same row the list renders, so the console's name and the row's name are
    // one value; an unnamed session reads as the list's placeholder, never the id.
    val currentSession = currentSessionId?.let { id -> owned.sessions.firstOrNull { it.id == id } }
    val runtimes by receive.runtimes.collectAsStateWithLifecycle()
    val currentRuntime = currentSessionId?.let(runtimes::get)
    // Unconditional collection: the runtime may not exist yet, and a page that appeared or
    // vanished mid-composition would change the composition's shape.
    val currentSnapshot by remember(currentRuntime) {
        currentRuntime?.snapshot ?: flowOf(null)
    }.collectAsStateWithLifecycle(null)
    val currentFacts = currentSnapshot?.fairyFacts()
    // 当前表现 comes from the module snapshot, not from a second derivation here. The host reports
    // this frame's facts and, when the page returns, reads the current runtime for the same session.
    val host = rememberFairyPageHost(
        fairy = fairy,
        receive = receive,
        currentSessionId = { receive.owned.snapshot.value.currentSessionId() },
        context = currentSessionId?.let(::FairyInteractionContext),
        facts = currentFacts,
        eye = pageEye,
        composer = { null },
        content = { it.at(0.5f, 0.55f) },
    )
    val window = interaction.window
    CompositionLocalProvider(LocalFairyTokens provides tokens) {
        SessionListOverlay(
            state = overlay,
            sessions = receive.owned,
            // The console is not standing in a conversation, so every row —
            // including the current one — enters that conversation. Only a page
            // that already presents a session treats re-selecting it as a close.
            currentSessionId = null,
            onOpenSession = { id -> onOpen(Screen.Conversation(id)) },
            // The console is home already: its list's home entry only closes.
            onHome = {},
            onSettings = { onOpen(Screen.Settings) },
            stopReply = receive::stopReply,
        ) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Brush.verticalGradient(listOf(tokens.bgTop, tokens.bgBottom))),
            ) {
                FairyBackground(watermark = false)
                Column(
                    Modifier
                        .fillMaxSize()
                        .then(host.modifier)
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
                            eye = pageEye,
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
                        currentSessionTitle = currentSession?.displayTitle,
                        sessionCount = owned.sessions.size,
                    )
                    Spacer(Modifier.height(20.dp))
                    SignalButton(
                        text = "进入会话",
                        tag = "SESSIONS",
                        variant = SignalButtonVariant.PRIMARY,
                        onClick = {
                            val target = currentSessionId
                            if (target == null) overlay.open() else onOpen(Screen.Conversation(target))
                        },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                    )
                    Spacer(Modifier.height(12.dp))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        SignalButton(
                            text = "全部会话",
                            tag = "${owned.sessions.size} SESSIONS",
                            onClick = overlay::open,
                            modifier = Modifier.weight(1f).heightIn(min = 50.dp),
                        )
                        SignalButton(
                            text = "设置",
                            tag = "SETTINGS",
                            onClick = { onOpen(Screen.Settings) },
                            modifier = Modifier.weight(1f).heightIn(min = 50.dp)
                                .testTag("console-settings"),
                        )
                    }
                }
                FairyCrtPowerOn(powerOn)
            }
        }
    }
}

@Composable
private fun ConsoleInfoCard(user: IdentityUser?, currentSessionTitle: String?, sessionCount: Int) {
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
                // The session's own title from the same snapshot row the list
                // renders; the opaque id is never a display value.
                ConsoleValue(
                    currentSessionTitle ?: "—",
                    modifier = Modifier.testTag("console-session-title"),
                )
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
private fun ConsoleValue(text: String, modifier: Modifier = Modifier) {
    Text(
        text = text,
        color = LocalFairyTokens.current.textPrimary,
        fontFamily = LocalFairyTokens.current.telemetryFontFamily,
        fontSize = 12.sp,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = modifier,
    )
}
