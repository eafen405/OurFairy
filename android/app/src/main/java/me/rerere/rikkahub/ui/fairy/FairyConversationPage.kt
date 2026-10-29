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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import me.rerere.rikkahub.R
import me.rerere.rikkahub.data.remote.RemoteChatSnapshot
import me.rerere.rikkahub.data.remote.RemoteReceiveState
import me.rerere.rikkahub.data.remote.SessionsSnapshot
import me.rerere.rikkahub.ui.identity.IdentitySessionList
import me.rerere.rikkahub.ui.identity.RemoteChatPanel
import org.koin.compose.koinInject

@Composable
fun FairyConversationPage(
    sessionId: String?,
    onBack: () -> Unit,
    receive: RemoteReceiveState = koinInject(),
    fairy: FairyInteraction = koinInject(),
    onOpenConversation: (String) -> Unit,
    onSettings: () -> Unit,
) {
    val sessions by receive.owned.snapshot.collectAsStateWithLifecycle()
    val selected by receive.selectedChat.collectAsStateWithLifecycle()
    val selectedChat = selected
    val chat = selectedChat?.snapshot?.collectAsStateWithLifecycle()?.value
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    // The page owns the eye's transient animation; the continuous 待机 comes from the module so a
    // screen already asleep on home is found asleep here too, and a touch wakes the same state.
    val interaction by fairy.state.collectAsStateWithLifecycle()
    val eye = remember { FairyEyeController(asleep = fairy.state.value.asleep) }
    LaunchedEffect(interaction.asleep) { eye.asleep = interaction.asleep }
    DisposableEffect(fairy) { onDispose { fairy.pageExit() } }
    // Coming back to the foreground presents the routed session's facts as they are right now —
    // read from its runtime, not from this composition, which did not run while away — and settles
    // whatever arrived in the meantime instead of replaying it. Leaving settles the transient
    // presentation.
    val lifecycleOwner = LocalLifecycleOwner.current.lifecycle
    DisposableEffect(lifecycleOwner, fairy, receive, sessionId) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_START -> {
                    val runtime = sessionId?.let(receive::stateForSession)
                    val current = runtime?.snapshot?.value?.takeIf { it.sessionId == sessionId }
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
    val origin = remember { floatArrayOf(0f, 0f) }
    val bounds = remember { floatArrayOf(0f, 0f) }
    // The module names the stimulus; this page maps it to the eye response. A send glances toward
    // the composer, new output or a delivery toward the transcript, and a finished run blinks.
    FairyEyeReactions(
        reaction = interaction.reaction,
        eye = eye,
        composer = { Offset(origin[0] + bounds[0] / 2f, origin[1] + bounds[1]) },
        content = { Offset(origin[0] + bounds[0] / 2f, origin[1] + bounds[1] * 0.55f) },
    )
    var opening by remember(sessionId) { mutableStateOf(true) }
    var failed by remember(sessionId) { mutableStateOf(false) }
    var retry by remember(sessionId) { mutableIntStateOf(0) }

    LaunchedEffect(sessionId, retry) {
        opening = true
        failed = false
        if (sessionId == null && retry > 0) receive.owned.refresh()
        val ready = receive.owned.snapshot.first { !it.loading }
        if (sessionId == null) {
            opening = false
            drawer.open()
        } else {
            val alreadySelected = ready.failure == null && ready.selectedId == sessionId &&
                ready.sessions.any { it.id == sessionId }
            failed = !alreadySelected && !receive.openSession(sessionId)
            opening = false
        }
    }
    val settled = !opening && !failed && sessionId != null &&
        sessions.selectedId == sessionId && chat?.sessionId == sessionId
    val snapshot = chat.takeIf { settled }
    // The open session's row, the same one the drawer renders: its title is what
    // the bar shows.
    val session = sessions.sessions.firstOrNull { it.id == sessionId }
    // 当前表现 comes from the interaction module and from this session's facts only. The route
    // says which session this page presents even before it settles; until then it has no facts,
    // which the module answers as the unknown presentation — never the previous session's. Keeping
    // the routed id (instead of presenting nothing while opening) is what lets the continuous
    // 待机 and 当前表现 cross from the console into this page for the same session.
    val context = sessionId?.let(::FairyInteractionContext)
    val facts = snapshot?.fairyFacts()
    val window = fairy.window(facts)
    LaunchedEffect(fairy, context, facts) { fairy.show(context, facts) }
    val screenOpen = rememberFairyScreenOpen(window)
    val tokens = LocalFairyTokens.current
    val failure = sessions.failure?.let {
        if (it == SessionsSnapshot.UNREACHABLE) stringResource(R.string.identity_unreachable) else it
    }
    // Archiving the session this page is standing in moves the list's selection
    // to the account's main session, so the page follows it there instead of
    // reading the moved selection as "this conversation is unavailable". Only a
    // session that was in the list and has left it does this: an id that was
    // never ours (a stale deep link) still reports unavailable. The row may
    // arrive after the page's first composition, so latch it whenever it appears.
    var standing by remember(sessionId) { mutableStateOf(false) }
    if (sessionId != null && sessions.sessions.any { it.id == sessionId }) standing = true
    LaunchedEffect(sessionId, sessions.selectedId, sessions.sessions.size) {
        val followed = sessions.selectedId
        if (sessionId != null && followed != null && followed != sessionId && standing &&
            sessions.sessions.none { it.id == sessionId }
        ) {
            onOpenConversation(followed)
        }
    }

    ModalNavigationDrawer(
        drawerState = drawer,
        gesturesEnabled = drawer.isOpen,
        drawerContent = {
            ModalDrawerSheet(
                modifier = Modifier.widthIn(max = 320.dp),
                drawerContainerColor = tokens.panelOpaque,
                drawerContentColor = tokens.textPrimary,
            ) {
                IdentitySessionList(
                    state = receive.owned,
                    onOpen = { id ->
                        scope.launch {
                            drawer.close()
                            if (id != sessionId) onOpenConversation(id)
                            else if (!settled) retry++
                        }
                    },
                    onClose = { scope.launch { drawer.close() } },
                    onHome = onBack,
                    onSettings = { scope.launch { drawer.close(); onSettings() } },
                    // A row is stopped by its own id, not by whichever session
                    // is open: every listed session has its own runtime here.
                    stopReply = { id -> receive.stopReply(id) },
                )
            }
        },
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .onGloballyPositioned {
                    origin[0] = it.positionInRoot().x
                    origin[1] = it.positionInRoot().y
                    bounds[0] = it.size.width.toFloat()
                    bounds[1] = it.size.height.toFloat()
                }
                // Observational only (Final pass, never consumed): fingers still reach the list,
                // the composer and the bar. The module answers whether a touch woke a sleeping
                // screen; the page maps that answer to the eye's own reaction.
                .pointerInput(eye) {
                    awaitPointerEventScope {
                        while (true) {
                            val event = awaitPointerEvent(PointerEventPass.Final)
                            val touch = event.changes.firstOrNull { it.pressed }
                            eye.lookAt(touch?.let { Offset(origin[0] + it.position.x, origin[1] + it.position.y) })
                            if (touch != null && fairy.touch()) eye.wake(confused = true)
                        }
                    }
                },
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
                            TextButton(onClick = { scope.launch { drawer.open() } }) { Text("选择会话") }
                        }
                    }
                }
            }
            FairyWindowTopBar(
                window = window,
                eye = eye,
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
                onOpenSessions = { scope.launch { drawer.open() } },
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

