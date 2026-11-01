package me.rerere.rikkahub.ui.identity

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import java.io.File
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import me.rerere.hugeicons.HugeIcons
import me.rerere.hugeicons.stroke.Cancel01
import me.rerere.rikkahub.data.remote.RemoteMessageFormat
import me.rerere.rikkahub.ui.fairy.LocalFairyTokens

/** One cached text attachment plus how it is presented; the panel decides both at click time. */
internal data class RemoteAttachmentTextPreviewTarget(
    val path: String,
    val name: String,
    val layout: RemoteAttachmentTextLayout,
)

private sealed interface TextPreviewState {
    data object Loading : TextPreviewState
    data class Ready(val text: String) : TextPreviewState
    data class Failed(val message: String) : TextPreviewState
}

/**
 * Read-only full-screen preview of one cached text attachment, overlay-styled like the image
 * viewer so the transcript stays in place underneath. The bytes are read and decoded off the
 * main thread; Markdown goes through the same renderer a settled message body uses, everything
 * else is selectable monospace text with its line breaks and indentation unchanged.
 */
@Composable
internal fun AttachmentTextPreview(
    target: RemoteAttachmentTextPreviewTarget,
    onDismissRequest: () -> Unit,
) {
    DeleteCachedPreviewOnDispose(target.path)
    val tokens = LocalFairyTokens.current
    var state by remember(target.path) { mutableStateOf<TextPreviewState>(TextPreviewState.Loading) }
    LaunchedEffect(target.path) {
        state = withContext(Dispatchers.IO) {
            val bytes = try {
                File(target.path).readBytes()
            } catch (_: IOException) {
                null
            }
            when (val decoded = bytes?.let(::decodeRemoteAttachmentText)) {
                is RemoteAttachmentText.Decoded -> TextPreviewState.Ready(decoded.text)
                RemoteAttachmentText.Undecodable -> TextPreviewState.Failed("无法解码")
                null -> TextPreviewState.Failed("无法读取附件")
            }
        }
    }
    Dialog(
        onDismissRequest = onDismissRequest,
        properties = DialogProperties(
            dismissOnClickOutside = false,
            usePlatformDefaultWidth = false,
        ),
    ) {
        Column(Modifier.fillMaxSize().background(tokens.panelOpaque).systemBarsPadding()) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = target.name,
                    modifier = Modifier.weight(1f),
                    style = MaterialTheme.typography.titleSmall,
                    color = tokens.textPrimary,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                IconButton(onClick = onDismissRequest) {
                    Icon(
                        imageVector = HugeIcons.Cancel01,
                        contentDescription = "关闭预览",
                        tint = tokens.textMuted,
                    )
                }
            }
            Box(Modifier.fillMaxWidth().height(1.dp).background(tokens.hairline))
            when (val current = state) {
                TextPreviewState.Loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = tokens.signal,
                    )
                }

                is TextPreviewState.Failed -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(
                        text = current.message,
                        style = MaterialTheme.typography.bodyMedium,
                        color = tokens.textMuted,
                    )
                }

                is TextPreviewState.Ready -> when (target.layout) {
                    RemoteAttachmentTextLayout.MARKDOWN -> MarkdownTextPreview(current.text)
                    RemoteAttachmentTextLayout.PLAIN -> PlainTextPreview(current.text)
                }
            }
        }
    }
}

/** Reuse the settled message renderer so an attachment and a message cannot look different. */
@Composable
private fun MarkdownTextPreview(text: String) {
    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 20.dp, vertical = 12.dp),
    ) {
        MessageBody(format = RemoteMessageFormat.MARKDOWN, text = text)
    }
}

@Composable
private fun PlainTextPreview(text: String) {
    val tokens = LocalFairyTokens.current
    SelectionContainer {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
        ) {
            Text(
                text = text,
                style = MaterialTheme.typography.bodyMedium,
                fontFamily = tokens.telemetryFontFamily,
                color = tokens.textPrimary,
            )
        }
    }
}
