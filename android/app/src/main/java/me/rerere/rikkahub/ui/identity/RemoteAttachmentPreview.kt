package me.rerere.rikkahub.ui.identity

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import me.rerere.rikkahub.ui.components.ui.ImagePreviewDialog
import java.io.File

/**
 * The existing full-screen image viewer, opened on one cached attachment file.
 *
 * The viewer reads and saves from that local path, so the save reuses the bytes the open already
 * downloaded. When the preview leaves the composition — dismissed, the session switched, or the
 * conversation left — its cached file is deleted; a copy the user saved through the viewer lives
 * somewhere else and is not touched.
 */
@Composable
internal fun AttachmentImagePreview(path: String, onDismissRequest: () -> Unit) {
    DisposableEffect(path) {
        onDispose { File(path).delete() }
    }
    ImagePreviewDialog(images = listOf(path), onDismissRequest = onDismissRequest)
}
