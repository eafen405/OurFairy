package me.rerere.rikkahub.ui.identity

import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.DrawerState
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ModalDrawerSheet
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Stable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import me.rerere.rikkahub.data.remote.OwnedSessionState
import me.rerere.rikkahub.ui.fairy.LocalFairyTokens

/**
 * Whether the shared session list is open.
 *
 * The list is an overlay, not a destination: this state is the only thing that
 * knows it is showing, so opening it never touches the navigation stack and
 * closing it leaves the page that owns it exactly where it was. The drawer's
 * own [DrawerState] is the one authority for that answer — this holder only
 * gives the page the verbs, so there is no second boolean to fall out of step
 * with a scrim tap or a back gesture.
 */
@Stable
internal class SessionListOverlayState(
    internal val drawer: DrawerState,
    private val scope: CoroutineScope,
) {
    val isOpen: Boolean get() = drawer.isOpen

    fun open() {
        scope.launch { drawer.open() }
    }

    fun close() {
        scope.launch { drawer.close() }
    }
}

/** The state a page remembers for its one shared session list. */
@Composable
internal fun rememberSessionListOverlayState(): SessionListOverlayState {
    val drawer = rememberDrawerState(DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    return remember(drawer, scope) { SessionListOverlayState(drawer, scope) }
}

/**
 * The one session list both the console and a conversation open.
 *
 * The overlay owns opening, closing and what a row selection means; the page
 * supplies only what to do next. [standingSessionId] is the session the page
 * already presents, or null when it presents none. A row that is already that
 * session closes the list without calling [onOpenSession] — a page that already
 * presents a session keeps standing where it was instead of rebuilding itself.
 * [onReselectStanding] is for such a page to use that same row (the conversation
 * page retries an opening that has not settled); everything else is a plain
 * close.
 *
 * The console passes null: it is not itself standing in a conversation, so every
 * row — the current one included — opens that conversation. That is the
 * deliberate split between the two entry points: #265 requires one list module
 * with the same close and selection behavior, while user story 6 (re-selecting
 * the current session must not rebuild the page) only applies to a page that
 * already presents that session.
 *
 * [content] is the page behind the list. It stays composed whether the list is
 * open or closed, so the page keeps its state while the reader browses.
 */
@Composable
internal fun SessionListOverlay(
    state: SessionListOverlayState,
    sessions: OwnedSessionState,
    /** The session the page is standing in; null when it is not standing in one. */
    standingSessionId: String?,
    onOpenSession: (String) -> Unit,
    onHome: () -> Unit,
    onSettings: () -> Unit,
    onReselectStanding: () -> Unit = {},
    stopReply: suspend (String) -> Unit = {},
    content: @Composable () -> Unit,
) {
    val tokens = LocalFairyTokens.current
    ModalNavigationDrawer(
        drawerState = state.drawer,
        gesturesEnabled = state.isOpen,
        drawerContent = {
            ModalDrawerSheet(
                modifier = Modifier.widthIn(max = 320.dp),
                drawerContainerColor = tokens.panelOpaque,
                drawerContentColor = tokens.textPrimary,
            ) {
                IdentitySessionList(
                    state = sessions,
                    onOpen = { id ->
                        state.close()
                        if (id == standingSessionId) onReselectStanding() else onOpenSession(id)
                    },
                    onClose = state::close,
                    onHome = {
                        state.close()
                        onHome()
                    },
                    onSettings = {
                        state.close()
                        onSettings()
                    },
                    // A row is stopped by its own id, not by whichever session
                    // is open: every listed session has its own runtime here.
                    stopReply = stopReply,
                )
            }
        },
        content = content,
    )
}
