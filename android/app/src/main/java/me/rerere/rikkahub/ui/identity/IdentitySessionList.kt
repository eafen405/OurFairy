package me.rerere.rikkahub.ui.identity

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
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
import me.rerere.hugeicons.stroke.Cancel01
import me.rerere.hugeicons.stroke.Delete02
import me.rerere.hugeicons.stroke.Edit02
import me.rerere.hugeicons.stroke.Refresh
import me.rerere.rikkahub.R
import me.rerere.rikkahub.data.remote.OwnedSession
import me.rerere.rikkahub.data.remote.OwnedSessionState
import me.rerere.rikkahub.data.remote.SessionsSnapshot
import me.rerere.rikkahub.ui.fairy.LocalFairyTokens

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
    val tokens = LocalFairyTokens.current
    val scope = rememberCoroutineScope()
    // The row whose rename dialog is open, and the refusal that keeps it open.
    var renaming by remember { mutableStateOf<OwnedSession?>(null) }
    var renameFailure by remember { mutableStateOf<String?>(null) }
    /** The session the confirmation dialog is asking about; null when closed. */
    var pendingArchive by remember { mutableStateOf<OwnedSession?>(null) }
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("会话", style = MaterialTheme.typography.titleLarge, modifier = Modifier.weight(1f))
            IconButton(onClick = state::refresh, enabled = !snapshot.loading) {
                Icon(HugeIcons.Refresh, contentDescription = "刷新会话", modifier = Modifier.size(20.dp))
            }
            IconButton(onClick = onClose) {
                Icon(HugeIcons.Cancel01, contentDescription = "关闭会话列表", modifier = Modifier.size(20.dp))
            }
        }
        TextButton(
            enabled = !snapshot.loading,
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
        if (snapshot.loading) LinearProgressIndicator(Modifier.fillMaxWidth())
        snapshot.failure?.let {
            Text(
                if (it == SessionsSnapshot.UNREACHABLE) stringResource(R.string.identity_unreachable) else it,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(vertical = 8.dp),
            )
        }
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            if (snapshot.sessions.isEmpty() && !snapshot.loading) {
                item { Text("暂无会话", modifier = Modifier.padding(16.dp), color = tokens.textMuted) }
            }
            items(snapshot.sessions, key = { session -> session.id }) { session ->
                val selected = session.id == snapshot.selectedId
                Row(
                    Modifier.fillMaxWidth()
                        .background(if (selected) tokens.pill else tokens.panelOpaque, tokens.panelShape)
                        .semantics { this.selected = selected }
                        .clickable(enabled = !snapshot.loading) { onOpen(session.id) }
                        .padding(horizontal = 16.dp, vertical = 14.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    // The session's own name is the row's name. An unnamed session
                    // shows a placeholder; the opaque id is never the displayed
                    // name. The primary binding stays a marker beside the title.
                    Text(
                        session.title.ifEmpty { "新会话" },
                        style = MaterialTheme.typography.titleSmall,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        modifier = Modifier.weight(1f).testTag("session-row-title"),
                    )
                    if (session.primary) {
                        Text(
                            "主会话",
                            style = MaterialTheme.typography.labelSmall,
                            color = tokens.textMuted,
                            modifier = Modifier.padding(start = 8.dp),
                        )
                    } else {
                        // The rename entry sits on the row itself: renaming needs
                        // no visit to the session, only the row it names.
                        IconButton(
                            onClick = {
                                renameFailure = null
                                renaming = session
                            },
                            enabled = !snapshot.loading,
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
                        IconButton(
                            onClick = { pendingArchive = session },
                            enabled = !snapshot.loading,
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
        }
        Row(Modifier.fillMaxWidth()) {
            TextButton(onClick = onHome) { Text("首页") }
            Spacer(Modifier.weight(1f))
            TextButton(onClick = onSettings) { Text("设置") }
        }
    }
    renaming?.let { session ->
        RenameSessionDialog(
            initial = session.title,
            busy = snapshot.loading,
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
                            SessionsSnapshot.UNREACHABLE -> "无法连接到后端"
                            else -> settled.failure
                        }
                    }
                }
            },
        )
    }
    pendingArchive?.let { session ->
        AlertDialog(
            onDismissRequest = { if (!snapshot.loading) pendingArchive = null },
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
                    enabled = !snapshot.loading,
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
                    enabled = !snapshot.loading,
                    onClick = { pendingArchive = null },
                ) { Text("取消") }
            },
        )
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
