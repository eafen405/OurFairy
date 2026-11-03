package me.rerere.rikkahub.ui.identity

import android.content.ClipData
import android.widget.Toast
import androidx.compose.foundation.interaction.collectIsDraggedAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.ui.Alignment
import me.rerere.rikkahub.ui.fairy.FairyColorScheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import me.rerere.hugeicons.HugeIcons
import me.rerere.hugeicons.stroke.ArrowDown01
import me.rerere.hugeicons.stroke.ArrowUp02
import me.rerere.hugeicons.stroke.Download01
import me.rerere.rikkahub.R
import me.rerere.rikkahub.data.remote.RemoteChatAttachment
import me.rerere.rikkahub.data.remote.RemoteChatAttempt
import me.rerere.rikkahub.data.remote.RemoteChatMessage
import me.rerere.rikkahub.data.remote.RemoteChatSettlement
import me.rerere.rikkahub.data.remote.RemoteMessageFormat
import me.rerere.rikkahub.data.remote.remoteAttemptFormat
import me.rerere.rikkahub.data.remote.remoteMessageFormat
import me.rerere.rikkahub.ui.components.message.ChatMessageFileChip
import me.rerere.rikkahub.ui.components.richtext.MarkdownBlock
import me.rerere.rikkahub.ui.fairy.FairyDialogPaddingH
import me.rerere.rikkahub.ui.fairy.FairyDialogPaddingV
import me.rerere.rikkahub.ui.fairy.FairyMessagePaddingH
import me.rerere.rikkahub.ui.fairy.LocalFairyTokens
import me.rerere.rikkahub.ui.fairy.fairyDialogPanel
import me.rerere.rikkahub.ui.theme.LocalDarkMode

@Composable
internal fun RemoteTranscript(
    messages: List<RemoteChatMessage>,
    generation: String,
    attempt: RemoteChatAttempt?,
    downloadEnabled: Boolean,
    onDownload: (RemoteChatMessage, RemoteChatAttachment) -> Unit,
    onFinalPresented: () -> Unit = {},
    settledAttempt: RemoteChatSettlement? = null,
    modifier: Modifier = Modifier,
) {
    if (messages.isEmpty() && attempt == null) {
        Box(
            modifier = modifier.fillMaxWidth(),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "此会话还没有消息。",
                modifier = Modifier.padding(16.dp),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    var detail by remember { mutableStateOf<RemoteChatMessage?>(null) }
    var menuRowKey by remember { mutableStateOf<String?>(null) }
    // Expansion belongs to the row identity, so a growing attempt keeps its own choice and a
    // newly arrived step starts collapsed.
    val expandedToolRows = remember { mutableStateMapOf<String, Boolean>() }
    val clipboard = LocalClipboard.current
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    detail?.let { message ->
        AlertDialog(
            onDismissRequest = { detail = null },
            confirmButton = { TextButton(onClick = { detail = null }) { Text("关闭") } },
            text = {
                Column(Modifier.heightIn(max = 560.dp).verticalScroll(rememberScrollState())
                    .fairyDialogPanel(active = false)
                    .padding(horizontal = FairyDialogPaddingH, vertical = FairyDialogPaddingV)) {
                    SelectionContainer {
                        MessageBody(remoteMessageFormat(message), message.text, foreground = LocalFairyTokens.current.textPrimary)
                    }
                }
            },
        )
    }
    val listState = rememberLazyListState()
    val dragging by listState.interactionSource.collectIsDraggedAsState()
    var reading by remember { mutableStateOf(RemoteReadingPosition()) }
    val visibleKeys by remember(listState) {
        derivedStateOf { listState.layoutInfo.visibleItemsInfo.map { it.key.toString() }.toSet() }
    }
    val presentation = remember { RemoteTranscriptPresentation() }
    val liveAttempt = rememberStreamingAttempt(generation, attempt)
    val rows = presentation.update(
        messages, generation, liveAttempt, settledAttempt, visibleKeys, reading.followTail,
    )
    val keys = rows.map { it.key }
    val currentKeys by rememberUpdatedState(keys)
    // The menu's click reads this when it runs: copying a streaming row takes the text that
    // has arrived by then, not the snapshot from when the menu opened.
    val currentRows by rememberUpdatedState(rows)
    val currentAttempt by rememberUpdatedState(attempt)
    LaunchedEffect(dragging) {
        if (dragging) reading = reading.copy(followTail = false, userScrolling = true)
    }
    LaunchedEffect(listState) {
        snapshotFlow {
            Triple(listState.firstVisibleItemIndex, listState.firstVisibleItemScrollOffset, listState.isScrollInProgress)
        }.collect { (index, offset, scrolling) ->
            reading = reading.copy(
                key = currentKeys.getOrNull(index), index = index, offset = offset,
                userScrolling = scrolling,
                followTail = if (!scrolling && !listState.canScrollForward) true else reading.followTail,
            )
        }
    }
    fun preservePosition() {
        reading.target(keys)?.let { listState.requestScrollToItem(it.index, it.offset) }
    }
    // StateFlow already conflates whole snapshots. Preserve the viewport rather than replaying deltas.
    LaunchedEffect(messages, generation, liveAttempt?.attemptId, liveAttempt?.text) { preservePosition() }
    LazyColumn(
        state = listState,
        modifier = modifier.fillMaxWidth().testTag("conversation-messages"),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        items(rows, key = { it.key }) { row ->
            val message = row.message
            // A derived row is neither the user nor Fairy: it has no bubble, no heading, no
            // attachments and no long-press copy menu. kind 1 is the quiet activation line;
            // kind 2 is the backend-composed skill review panel.
            if (message?.role == 3) {
                when (message.kind) {
                    1 -> SkillActivationLine(message.text, Modifier.fillMaxWidth())
                    2 -> SkillReviewPanel(message.text, Modifier.fillMaxWidth())
                    else -> Unit
                }
                return@items
            }
            val fairy = message == null || message.role == 2
            val tokens = LocalFairyTokens.current
            Box(Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.align(if (fairy) Alignment.CenterStart else Alignment.CenterEnd)
                        .then(if (fairy) Modifier.fillMaxWidth()
                            .fairyDialogPanel(active = message == null)
                            .padding(horizontal = FairyMessagePaddingH, vertical = FairyDialogPaddingV)
                        else Modifier.widthIn(max = 340.dp)
                            .background(tokens.userBubble, tokens.userBubbleShape)
                            .border(1.dp, tokens.userBubbleBorder, tokens.userBubbleShape)
                            .padding(12.dp))
                        .then(if (row.text.isNotBlank() || message != null) Modifier.combinedClickable(
                            onClick = {},
                            onLongClickLabel = if (message != null) "查看全文或复制" else "复制",
                            onLongClick = { menuRowKey = row.key },
                        ) else Modifier),
                ) {
                    // Same heading/body geometry before and after a streaming row settles.
                    Text(
                        text = if (fairy) "Fairy" else "你",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (row.text.isNotBlank()) {
                        MessageBody(
                            format = message?.let(::remoteMessageFormat) ?: remoteAttemptFormat(),
                            text = row.text,
                            onBeforeFormat = ::preservePosition,
                            onRichPresented = {
                                if (row.key == rows.lastOrNull()?.key && attempt == null) onFinalPresented()
                            },
                            foreground = if (fairy) LocalFairyTokens.current.textPrimary else MaterialTheme.colorScheme.onSurface,
                            presentationRow = row,
                        )
                    }
                    // The live row has no message yet; its tools come from the attempt.
                    val tools = message?.tools ?: attempt?.tools.orEmpty()
                    if (tools.isNotEmpty()) {
                        Spacer(Modifier.height(6.dp))
                        ToolCallLines(
                            tools = tools,
                            expanded = expandedToolRows[row.key] == true,
                            onToggleExpanded = {
                                expandedToolRows[row.key] = expandedToolRows[row.key] != true
                            },
                        )
                    }
                    if (message != null) {
                        if (message.attachments.isNotEmpty()) {
                            Spacer(Modifier.height(6.dp))
                            AttachmentChips(message.attachments, downloadEnabled) { attachment ->
                                onDownload(message, attachment)
                            }
                        }
                        if (message.status == 3 || message.status == 4) {
                            Text(
                                text = if (message.status == 3) "已停止" else "回复失败",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    DropdownMenu(
                        expanded = menuRowKey == row.key,
                        onDismissRequest = { menuRowKey = null },
                        containerColor = tokens.panelOpaque,
                    ) {
                        if (row.text.isNotBlank()) {
                            DropdownMenuItem(
                                text = { Text("复制") },
                                onClick = {
                                    menuRowKey = null
                                    val body = if (message == null && row.key == currentRows.lastOrNull()?.key) {
                                        currentAttempt?.text ?: row.text
                                    } else {
                                        currentRows.firstOrNull { it.key == row.key }?.text ?: row.text
                                    }
                                    scope.launch {
                                        clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("message", body)))
                                        Toast.makeText(context, "已复制", Toast.LENGTH_SHORT).show()
                                    }
                                },
                            )
                        }
                        if (message != null) {
                            DropdownMenuItem(
                                text = { Text("查看全文") },
                                onClick = {
                                    menuRowKey = null
                                    detail = message
                                },
                            )
                        }
                    }
                }
            }
        }
    }
}

/**
 * The skill review display: the backend's four deterministic blocks, rendered as a multi-line
 * system panel rather than a message. The text is presented verbatim; the client never recomposes
 * a diff, a verification count or a growth percentage.
 */
@Composable
private fun SkillReviewPanel(text: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .padding(horizontal = FairyMessagePaddingH, vertical = 4.dp)
            .fairyDialogPanel(active = false)
            .padding(horizontal = FairyDialogPaddingH, vertical = FairyDialogPaddingV)
            .testTag("skill-review"),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Text(
            text = stringResource(R.string.skills_review_panel_title),
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = text,
            style = MaterialTheme.typography.bodySmall,
            color = LocalFairyTokens.current.textPrimary,
        )
    }
}

/** A quiet full-width system line: what Fairy loaded, not something either side said. */
@Composable
private fun SkillActivationLine(text: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.padding(horizontal = FairyMessagePaddingH, vertical = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.testTag("skill-activation"),
        )
    }
}

private const val STREAMING_MIN_CODEPOINTS_PER_FRAME = 4
private const val STREAMING_FRAMES_PER_TARGET = 16

@Composable
private fun rememberStreamingAttempt(generation: String, attempt: RemoteChatAttempt?): RemoteChatAttempt? {
    val visibleText = remember(generation, attempt?.attemptId) { mutableStateOf("") }
    LaunchedEffect(generation, attempt?.attemptId, attempt?.text) {
        val target = attempt?.text.orEmpty()
        while (visibleText.value != target) {
            withFrameNanos { }
            visibleText.value = streamingPrefix(visibleText.value, target)
        }
    }
    return attempt?.copy(text = visibleText.value)
}

private fun streamingPrefix(current: String, target: String): String {
    if (!target.startsWith(current)) return target
    val currentCount = current.codePointCount(0, current.length)
    val targetCount = target.codePointCount(0, target.length)
    val remaining = targetCount - currentCount
    if (remaining <= 0) return target
    val step = maxOf(
        STREAMING_MIN_CODEPOINTS_PER_FRAME,
        (remaining + STREAMING_FRAMES_PER_TARGET - 1) / STREAMING_FRAMES_PER_TARGET,
    )
    val nextCount = minOf(targetCount, currentCount + step)
    return target.substring(0, target.offsetByCodePoints(0, nextCount))
}

/**
 * The tools one step requested. A step is one action, so collapsed it shows only the newest name;
 * the arrow reveals the step's calls in request order. Only names reach the screen: the request
 * arguments and the tool's output stay in the native session. The line reuses the message's
 * small-label style rather than introducing a chip or a per-tool icon, which keeps a tool step
 * reading as part of its message.
 */
@Composable
private fun ToolCallLines(
    tools: List<String>,
    expanded: Boolean,
    onToggleExpanded: () -> Unit,
) {
    val visible = if (expanded) tools else tools.takeLast(1)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            visible.forEach { name ->
                Text(
                    text = "调用工具 · $name",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (tools.size > 1) {
            IconButton(
                onClick = onToggleExpanded,
                modifier = Modifier.size(24.dp),
            ) {
                Icon(
                    imageVector = if (expanded) HugeIcons.ArrowUp02 else HugeIcons.ArrowDown01,
                    contentDescription = if (expanded) "收起工具调用" else "展开工具调用",
                    modifier = Modifier.size(16.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AttachmentChips(
    attachments: List<RemoteChatAttachment>,
    downloadEnabled: Boolean,
    onDownload: (RemoteChatAttachment) -> Unit,
) {
    // Original name and original size, because that is what the backend recorded and what the
    // download will produce. No preview, no thumbnail, nothing derived from the bytes.
    FlowRow(
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        attachments.forEach { attachment ->
            key(attachment.index) {
                ChatMessageFileChip(
                    text = "${attachment.name} · ${attachmentSizeLabel(attachment.bytes)}",
                    onClick = { if (downloadEnabled) onDownload(attachment) },
                    icon = {
                        Icon(
                            imageVector = HugeIcons.Download01,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                        )
                    },
                )
            }
        }
    }
}

/** Shared list/detail entry: immediate raw body, then a background-parsed complete document. */
@Composable
internal fun MessageBody(
    format: RemoteMessageFormat,
    text: String,
    onBeforeFormat: () -> Unit = {},
    onRichPresented: () -> Unit = {},
    foreground: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.onSurface,
    presentationRow: RemoteTranscriptRow? = null,
) {
    val settings = me.rerere.rikkahub.data.datastore.LocalDisplayPreferences.current
    val base = MaterialTheme.typography.bodyMedium
    val style = base.copy(
        fontSize = base.fontSize * settings.fontSizeRatio,
        fontFamily = if (settings.serif) androidx.compose.ui.text.font.FontFamily.Serif else androidx.compose.ui.text.font.FontFamily.Default,
    )
    val input by rememberUpdatedState(RemoteBodyInput(text, format))
    var presentation by remember { mutableStateOf(RemoteBodyPresentation(text)) }
    LaunchedEffect(Unit) {
        remoteBodyPresentations(snapshotFlow { input }) { source ->
            withContext(Dispatchers.Default) { me.rerere.ui.markdown.parseMarkdown(source) }
        }.collect { next ->
            presentation = next
        }
    }
    val parsed = presentation.document?.takeIf {
        format == RemoteMessageFormat.MARKDOWN && it.source == text
    }
    val document = if (presentationRow == null) parsed else presentationRow.documentToShow(parsed)
    val richPresented by rememberUpdatedState(onRichPresented)
    val beforeFormat by rememberUpdatedState(onBeforeFormat)
    LaunchedEffect(document) {
        if (document != null) {
            beforeFormat()
            androidx.compose.runtime.withFrameNanos { }
            richPresented()
        }
    }
    if (document != null) {
        // List and detail use the same Fairy rich-text palette.
        CompositionLocalProvider(LocalDarkMode provides true) {
            MaterialTheme(colorScheme = FairyColorScheme) {
                MarkdownBlock(content = text, document = document, style = style.copy(color = LocalFairyTokens.current.textPrimary))
            }
        }
    } else {
        Text(text = text, style = style, color = if (format == RemoteMessageFormat.MARKDOWN) LocalFairyTokens.current.textPrimary else foreground)
    }
}
