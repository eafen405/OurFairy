package me.rerere.rikkahub.ui.fairy

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.first
import me.rerere.rikkahub.R
import me.rerere.rikkahub.data.remote.RemoteChatSnapshot
import me.rerere.rikkahub.data.remote.RemoteReceiveState
import me.rerere.rikkahub.data.remote.SessionsSnapshot
import me.rerere.rikkahub.ui.identity.RemoteChatPanel
import me.rerere.rikkahub.ui.identity.SessionListOverlay
import me.rerere.rikkahub.ui.identity.rememberSessionListOverlayState
import org.koin.compose.koinInject

@Composable
fun FairyConversationPage(
    sessionId: String,
    onBack: () -> Unit,
    receive: RemoteReceiveState = koinInject(),
    fairy: FairyInteraction = koinInject(),
    /**
     * The page's eye controller. A test can inject one and observe its real output
     * (`pointer`, `glances`, `blinks`); production leaves it null and the page remembers one.
     */
    eye: FairyEyeController? = null,
    onOpenConversation: (String) -> Unit,
    onSettings: () -> Unit,
) {
    val sessions by receive.owned.snapshot.collectAsStateWithLifecycle()
    val selected by receive.selectedChat.collectAsStateWithLifecycle()
    val selectedChat = selected
    val chat = selectedChat?.snapshot?.collectAsStateWithLifecycle()?.value
    val overlay = rememberSessionListOverlayState()
    val pageEye = eye ?: remember { FairyEyeController(asleep = fairy.state.value.asleep) }
    // The page owns the eye's transient animation; the continuous 待机 comes from the module so a
    // screen already asleep on home is found asleep here too, and a touch wakes the same state.
    val interaction by fairy.state.collectAsStateWithLifecycle()
    var opening by remember(sessionId) { mutableStateOf(true) }
    var failed by remember(sessionId) { mutableStateOf(false) }
    var retry by remember(sessionId) { mutableIntStateOf(0) }

    LaunchedEffect(sessionId, retry) {
        opening = true
        failed = false
        val ready = receive.owned.snapshot.first { !it.loading }
        val alreadySelected = ready.failure == null && ready.selectedId == sessionId &&
            ready.sessions.any { it.id == sessionId }
        failed = !alreadySelected && !receive.openSession(sessionId)
        opening = false
    }
    val settled = !opening && !failed &&
        sessions.selectedId == sessionId && chat?.sessionId == sessionId
    val snapshot = chat.takeIf { settled }
    // The open session's row, the same one the drawer renders: its title is what
    // the bar shows.
    val session = sessions.sessions.firstOrNull { it.id == sessionId }
    // 当前表现 comes from the interaction module and from this session's facts only. The route
    // says which session this page presents even before it settles; until then it has no facts,
    // and the module keeps the previous page's current appearance instead of flickering through
    // the unknown presentation. Keeping the routed id (instead of presenting nothing while
    // opening) is what lets the continuous 待机 and 当前表现 cross from the console into this page
    // for the same session.
    val context = FairyInteractionContext(sessionId)
    val facts = snapshot?.fairyFacts()
    // The page renders the module's snapshot; it never derives 当前表现 itself. The shared host
    // reports this frame's facts and, on a return, reads the routed session's current runtime.
    val host = rememberFairyPageHost(
        fairy = fairy,
        receive = receive,
        currentSessionId = { sessionId },
        context = context,
        facts = facts,
        eye = pageEye,
        composer = { it.at(0.5f, 1f) },
        content = { it.at(0.5f, 0.55f) },
    )
    val window = interaction.window
    val screenOpen = rememberFairyScreenOpen(window)
    val tokens = LocalFairyTokens.current
    val failure = sessions.failure?.let {
        if (it == SessionsSnapshot.UNREACHABLE) stringResource(R.string.identity_unreachable) else it
    }
    // The session state owns the archive-follow rule: when the reader archives
    // the session this page is standing in, it publishes that very id together
    // with the selection it moved to. The page follows only that explicit fact.
    // It does not remember that the route once existed and cannot tell why a
    // list changed, so a target that was never ours, has expired or whose
    // archive was refused keeps showing "会话不可用" instead of navigating.
    LaunchedEffect(sessionId, sessions.archivedSelectionId, sessions.selectedId) {
        val followed = sessions.selectedId
        if (sessions.archivedSelectionId == sessionId &&
            followed != null && followed != sessionId
        ) {
            onOpenConversation(followed)
        }
    }

    SessionListOverlay(
        state = overlay,
        sessions = receive.owned,
        currentSessionId = sessionId,
        onOpenSession = onOpenConversation,
        onHome = onBack,
        onSettings = onSettings,
        // Re-selecting the session this page already stands in is not a
        // navigation: a page that has not settled yet retries its opening.
        onReselectCurrent = { if (!settled) retry++ },
        // A row is stopped by its own id, not by whichever session is open:
        // every listed session has its own runtime here.
        stopReply = receive::stopReply,
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .then(host.modifier),
        ) {
            FairyBackground(watermark = false)
            FairyConversationSurface(screenOpen = screenOpen) {
                if (settled && selectedChat != null) {
                    key(sessionId) {
                        RemoteChatPanel(
                            state = selectedChat,
                            onReconnect = receive::resumeObservation,
                            onSendAccepted = fairy::sent,
                            modifier = Modifier.fillMaxSize(),
                        )
                    }
                } else {
                    Column(
                        Modifier.fillMaxSize().padding(24.dp),
                        verticalArrangement = Arrangement.Center,
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Text(
                            if (opening) "正在打开会话…" else failure ?: "暂时无法打开此会话",
                            style = MaterialTheme.typography.bodyMedium,
                            color = tokens.textMuted,
                        )
                        if (!opening) {
                            TextButton(onClick = { retry++ }) { Text("重试") }
                            TextButton(onClick = overlay::open) { Text("选择会话") }
                        }
                    }
                }
            }
            FairyWindowTopBar(
                window = window,
                eye = pageEye,
                title = session?.title,
                speechPulse = interaction.speechPulse,
                screenOpen = screenOpen,
                subtitle = when {
                    opening -> "正在打开会话…"
                    !settled -> "会话不可用"
                    snapshot?.connecting == true -> "连接中…"
                    snapshot?.connected != true -> "连接已断开"
                    window.awaitingReply -> "正在思考…"
                    window.presence.isWorking -> "正在工作…"
                    snapshot.activity.status == 0 -> "同步中…"
                    else -> "已连接"
                },
                onNavigateBack = onBack,
                onOpenSessions = overlay::open,
                moreMenuContent = { dismiss ->
                    DropdownMenuItem(text = { Text("首页") }, onClick = { dismiss(); onBack() })
                    DropdownMenuItem(text = { Text("设置") }, onClick = { dismiss(); onSettings() })
                },
            )
        }
    }
}

@Composable
private fun FairyConversationSurface(
    screenOpen: Boolean,
    content: @Composable () -> Unit,
) {
    val extraTop by animateDpAsState(
        targetValue = if (screenOpen) FairyScreenOpenHeight else 0.dp,
        animationSpec = if (LocalAgoraMotionPolicy.current.allowSpatialTransitions) {
            tween(FAIRY_SCREEN_TRANSITION_MS, easing = FastOutSlowInEasing)
        } else {
            snap()
        },
        label = "fairy-content-inset",
    )
    Box(
        modifier = Modifier.fillMaxSize().statusBarsPadding()
            .padding(top = FairyWindowBarHeight + extraTop)
            .navigationBarsPadding().imePadding(),
    ) {
        content()
    }
}

