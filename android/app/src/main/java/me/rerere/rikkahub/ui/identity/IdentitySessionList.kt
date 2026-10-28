package me.rerere.rikkahub.ui.identity

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import me.rerere.hugeicons.HugeIcons
import me.rerere.hugeicons.stroke.Add01
import me.rerere.hugeicons.stroke.ArchiveRestore
import me.rerere.hugeicons.stroke.Cancel01
import me.rerere.hugeicons.stroke.Delete02
import me.rerere.hugeicons.stroke.Edit02
import me.rerere.hugeicons.stroke.Refresh
import me.rerere.rikkahub.R
import me.rerere.rikkahub.data.remote.OwnedSession
import me.rerere.rikkahub.data.remote.OwnedSessionState
import me.rerere.rikkahub.data.remote.SessionView
import me.rerere.rikkahub.data.remote.SessionsSnapshot
import me.rerere.rikkahub.ui.fairy.LocalFairyTokens

/**
 * The drawer's two session lists.
 *
 * The default view is the account's live sessions — the list the receiver binds,
 * where a row opens a conversation, and where a row can be renamed or archived
 * (deleted). The archived view is the other half of that delete: the caller's own
 * archived sessions, each restorable, with no primary (the primary is never
 * archived) and no physical delete anywhere.
 *
 * The switch is this composable's own small state and costs one list read on
 * entry. It never repoints the default list, so browsing the archive leaves the
 * open conversation and its notification backlog exactly where they were.
 */
@Composable
internal fun IdentitySessionList(
    state: OwnedSessionState,
    onOpen: (String) -> Unit,
    onClose: () -> Unit,
    onHome: () -> Unit,
    onSettings: () -> Unit,
    // Stops a session's reply before it is archived, awaited so the two
    // requests are ordered. The page supplies it; a row never fetches anything
    // itself, and a session that is idle makes it a no-op.
    stopReply: suspend (String) -> Unit = {},
) {
    val snapshot by state.snapshot.collectAsStateWithLifecycle()
    val archived by state.archived.collectAsStateWithLifecycle()
    val tokens = LocalFairyTokens.current
    val scope = rememberCoroutineScope()
    var view by remember { mutableStateOf(SessionView.Default) }
    // One action at a time across both views, which is the same guard the state
    // enforces; this only keeps the buttons honest while it runs.
    val busy = snapshot.loading || archived.loading
    // The row whose rename dialog is open, and the refusal that keeps it open.
    var renaming by remember { mutableStateOf<OwnedSession?>(null) }
    var renameFailure by remember { mutableStateOf<String?>(null) }
    /** The session the confirmation dialog is asking about; null when closed. */
    var pendingArchive by remember { mutableStateOf<OwnedSession?>(null) }

    // Entering the archived view asks for it; leaving changes nothing, because
    // the two lists are separate flows. The effect re-runs on `busy` so a switch
    // made while the other list was still loading is asked again once it
    // settles, instead of leaving an empty "no archived sessions" that was never
    // requested. `refreshArchived` itself is a no-op while a request is in
    // flight, so the extra run costs nothing.
    LaunchedEffect(view, busy) {
        if (view == SessionView.Archived && !busy) state.refreshArchived()
    }

    val failure = if (view == SessionView.Default) snapshot.failure else archived.failure

    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (view == SessionView.Default) "会话" else "已归档会话",
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.weight(1f),
            )
            TextButton(
                enabled = !busy,
                onClick = {
                    view = if (view == SessionView.Default) SessionView.Archived else SessionView.Default
                },
            ) {
                Text(if (view == SessionView.Default) "已归档" else "返回会话")
            }
            IconButton(
                onClick = { if (view == SessionView.Default) state.refresh() else state.refreshArchived() },
                enabled = !busy,
            ) {
                Icon(
                    HugeIcons.Refresh,
                    contentDescription = if (view == SessionView.Default) "刷新会话" else "刷新已归档会话",
                    modifier = Modifier.size(20.dp),
                )
            }
            IconButton(onClick = onClose) {
                Icon(HugeIcons.Cancel01, contentDescription = "关闭会话列表", modifier = Modifier.size(20.dp))
            }
        }
        // Creating and the per-row actions below belong to the default view; the
        // archived view's only action is restoring a row.
        if (view == SessionView.Default) {
            TextButton(
                enabled = !busy,
                onClick = {
                    scope.launch {
                        state.create()
                        val created = state.snapshot.first { !it.loading }
                        if (created.failure == null) created.selectedId?.let(onOpen)
                    }
                },
                modifier = Modifier.fillMaxWidth(),
            ) {
                Icon(HugeIcons.Add01, contentDescription = null, modifier = Modifier.size(20.dp))
                Text("新建会话", modifier = Modifier.padding(start = 8.dp))
            }
        }
        if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
        failure?.let {
            Text(
                if (it == SessionsSnapshot.UNREACHABLE) stringResource(R.string.identity_unreachable) else it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(vertical = 8.dp),
            )
        }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (view == SessionView.Default) {
                if (snapshot.sessions.isEmpty() && !busy) {
                    item { Text("暂无会话", modifier = Modifier.padding(16.dp), color = tokens.textMuted) }
                }
                items(snapshot.sessions, key = { session -> session.id }) { session ->
                    val selected = session.id == snapshot.selectedId
                    SessionRow(
                        title = session.title.ifEmpty { "新会话" },
                        selected = selected,
                        enabled = !busy,
                        onOpen = { onOpen(session.id) },
                    ) {
                        // The primary binding stays a marker beside the title.
                        if (session.primary) {
                            Text(
                                "主会话",
                                style = MaterialTheme.typography.labelSmall,
                                color = tokens.textMuted,
                                modifier = Modifier.padding(start = 8.dp),
                            )
                        }
                        // Renaming is offered on every own session, the primary
                        // included: the ticket asks for "任意自己的会话", and the
                        // backend accepts it. Only archiving is refused for the
                        // primary, so only that entry is absent below.
                        IconButton(
                            onClick = {
                                renameFailure = null
                                renaming = session
                            },
                            enabled = !busy,
                        ) {
                            Icon(
                                HugeIcons.Edit02,
                                contentDescription = "重命名会话",
                                modifier = Modifier.size(18.dp),
                                tint = tokens.textMuted,
                            )
                        }
                        // Delete is archiving: the row action names it by the
                        // product's word, and the confirmation says what it
                        // keeps and how to get it back. The primary session has
                        // no entry here, and the backend refuses it anyway.
                        if (!session.primary) {
                            IconButton(
                                onClick = { pendingArchive = session },
                                enabled = !busy,
                            ) {
                                Icon(
                                    HugeIcons.Delete02,
                                    contentDescription = "删除会话",
                                    modifier = Modifier.size(20.dp),
                                )
                            }
                        }
                    }
                }
            } else {
                if (archived.sessions.isEmpty() && !busy) {
                    item { Text("暂无已归档会话", modifier = Modifier.padding(16.dp), color = tokens.textMuted) }
                }
                items(archived.sessions, key = { session -> session.id }) { session ->
                    // A row here is not a conversation to stand in: it is one to
                    // bring back. It carries no rename and no delete, and the
                    // primary can never appear because it is never archived.
                    SessionRow(
                        title = session.title.ifEmpty { "新会话" },
                        selected = false,
                        enabled = !busy,
                        onOpen = null,
                    ) {
                        IconButton(
                            onClick = { scope.launch { state.restore(session.id) } },
                            enabled = !busy,
                        ) {
                            Icon(
                                HugeIcons.ArchiveRestore,
                                contentDescription = "恢复会话",
                                modifier = Modifier.size(20.dp),
                            )
                        }
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth()) {
            TextButton(onClick = onHome) { Text("首页") }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onSettings) { Text("设置") }
        }
    }
    val unreachable = stringResource(R.string.identity_unreachable)
    renaming?.let { session ->
        RenameSessionDialog(
            initial = session.title,
            busy = busy,
            failure = renameFailure,
            onDismiss = { renaming = null },
            onConfirm = { title ->
                scope.launch {
                    state.rename(session.id, title)
                    // The refusal is answered when the request settles, so the
                    // dialog keeps the text the reader wrote until then.
                    val settled = state.snapshot.first { !it.loading }
                    if (settled.failure == null) {
                        renaming = null
                        renameFailure = null
                    } else {
                        renameFailure = when (settled.failure) {
                            SessionsSnapshot.EMPTY_TITLE -> "标题不能只有空白或不可见字符"
                            // The same unreachable wording this page already
                            // renders above, from the one resource that owns it.
                            SessionsSnapshot.UNREACHABLE -> unreachable
                            else -> settled.failure
                        }
                    }
                }
            },
        )
    }
    pendingArchive?.let { session ->
        AlertDialog(
            onDismissRequest = { if (!busy) pendingArchive = null },
            title = { Text("删除会话") },
            text = {
                Column {
                    Text("会话「${session.title.ifEmpty { "新会话" }}」将从列表消失。")
                    Text("这是归档：日志和消息都会保留，之后可以在已归档列表里恢复。")
                    Text("如果它正在回复，会先停止当前回复，再归档。")
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !busy,
                    onClick = {
                        pendingArchive = null
                        // Confirming is the only path that changes anything:
                        // stop the reply (a no-op when idle), then archive.
                        scope.launch {
                            stopReply(session.id)
                            state.archive(session.id)
                        }
                    },
                ) { Text("归档") }
            },
            dismissButton = {
                TextButton(
                    enabled = !busy,
                    onClick = { pendingArchive = null },
                ) { Text("取消") }
            },
        )
    }
}

/**
 * One row of either list: the name on the left, the row's own actions on the
 * right.
 *
 * [onOpen] is null for a row that is not a conversation to stand in — an
 * archived row only comes back, so it must not look like it opens something.
 */
@Composable
private fun SessionRow(
    title: String,
    selected: Boolean,
    enabled: Boolean,
    onOpen: (() -> Unit)?,
    trailing: @Composable RowScope.() -> Unit,
) {
    val tokens = LocalFairyTokens.current
    Row(
        Modifier.fillMaxWidth()
            .background(if (selected) tokens.pill else tokens.panelOpaque, tokens.panelShape)
            .semantics { this.selected = selected }
            .clickable(enabled = enabled && onOpen != null) { onOpen?.invoke() }
            .padding(horizontal = 16.dp, vertical = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // The session's own name is the row's name. An unnamed session shows a
        // placeholder; the opaque id is never the displayed name.
        Text(
            title,
            style = MaterialTheme.typography.titleSmall,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f).testTag("session-row-title"),
        )
        trailing()
    }
}

/**
 * The rename dialog: one text field, the backend's own verdict on it, and the
 * row left open until the answer lands. The backend normalizes the title
 * (whitespace collapsed, invisible characters dropped, an over-long one cut on a
 * UTF-8 boundary), so this dialog means exactly one thing: take the text as
 * written and let the backend answer.
 */
@Composable
private fun RenameSessionDialog(
    initial: String,
    busy: Boolean,
    failure: String?,
    onDismiss: () -> Unit,
    onConfirm: (String) -> Unit,
) {
    var draft by remember(initial) { mutableStateOf(initial) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("重命名会话") },
        text = {
            Column {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    singleLine = true,
                    label = { Text("会话标题") },
                    modifier = Modifier.fillMaxWidth(),
                )
                if (failure != null) {
                    Text(
                        failure,
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.padding(top = 8.dp),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = { onConfirm(draft) }, enabled = !busy) { Text("保存") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("取消") }
        },
    )
}
