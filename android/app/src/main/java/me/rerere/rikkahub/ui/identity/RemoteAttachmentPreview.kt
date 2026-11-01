package me.rerere.rikkahub.ui.identity

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import me.rerere.rikkahub.ui.components.ui.ImagePreviewDialog
import java.io.File

/**
 * Deletes one cached preview file when its preview leaves the composition — dismissed, the
 * session switched, or the conversation left. A copy the user saved elsewhere is not touched.
 */
@Composable
internal fun DeleteCachedPreviewOnDispose(path: String) {
    DisposableEffect(path) {
        onDispose { File(path).delete() }
    }
}

/**
 * The existing full-screen image viewer, opened on one cached attachment file.
 *
 * The viewer reads and saves from that local path, so the save reuses the bytes the open already
 * downloaded.
 */
@Composable
internal fun AttachmentImagePreview(path: String, onDismissRequest: () -> Unit) {
    DeleteCachedPreviewOnDispose(path)
    ImagePreviewDialog(images = listOf(path), onDismissRequest = onDismissRequest)
}
