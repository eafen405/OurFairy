package me.rerere.rikkahub.ui.identity

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import kotlin.coroutines.coroutineContext

/** Per-file original limit the wire enforces; a larger selection never reaches a proposal. */
const val REMOTE_ATTACHMENT_MAX_BYTES: Long = 32L * 1024 * 1024

private const val TEMP_PREFIX = "remote_attach_"
private const val DEFAULT_MIME = "application/octet-stream"
private const val FALLBACK_NAME = "attachment"
private const val MAX_NAME_LENGTH = 120
private const val BUFFER_BYTES = 64 * 1024

/** One picker selection, already an app-private copy of the provider's original bytes. */
data class ImportedAttachment(val file: File, val name: String, val mime: String, val bytes: Long)

/** Copies the selection into app-private cache storage and reports the original display name and */
suspend fun importAttachment(context: Context, uri: Uri): ImportedAttachment {
    var importedFile: File? = null
    try {
        return withContext(Dispatchers.IO) {
            val resolver = context.contentResolver
            val name = sanitizedDisplayName(displayName(resolver, uri) ?: uri.lastPathSegment)
            val mime = resolver.getType(uri).orEmpty().trim().filterNot { it.isISOControl() }.ifEmpty { DEFAULT_MIME }
            val partial = File.createTempFile(TEMP_PREFIX, tempSuffix(name), context.cacheDir)
            importedFile = partial
            val bytes = resolver.openInputStream(uri)?.use { input ->
                partial.outputStream().use { output -> input.copyBounded(output, REMOTE_ATTACHMENT_MAX_BYTES) }
            } ?: throw IOException("所选内容无法读取")
            ImportedAttachment(partial, name, mime, bytes)
        }
    } catch (failure: Throwable) {
        // Also covers cancellation while dispatching the completed copy back to the UI.
        importedFile?.delete()
        throw failure
    }
}

/** Destination for a download. Owned by the caller until the download finishes or is abandoned. */
fun createAttachmentTempFile(context: Context): File = File.createTempFile(TEMP_PREFIX, null, context.cacheDir)

private const val PREVIEW_DIRECTORY = "attachment-preview"
private const val PREVIEW_PART_SUFFIX = ".part"
private const val HEX = "0123456789abcdef"

/**
 * The cache slot for one attachment coordinate: session, message and attachment index, and
 * nothing else. The slot name is a digest because those identifiers are wire values that may
 * contain separators. The slot is not created here so a legacy cache file that still occupies
 * that path can be migrated by [attachmentPreviewFile].
 */
internal fun attachmentPreviewDirectory(
    context: Context,
    sessionId: String,
    messageId: String,
    index: Int,
): File {
    val root = File(context.cacheDir, PREVIEW_DIRECTORY)
    root.mkdirs()
    val digest = MessageDigest.getInstance("SHA-256")
        .digest("$sessionId\u0000$messageId\u0000$index".toByteArray(Charsets.UTF_8))
    val name = buildString(digest.size * 2) {
        digest.forEach { byte ->
            val value = byte.toInt() and 0xff
            append(HEX[value ushr 4])
            append(HEX[value and 0x0f])
        }
    }
    return File(root, name)
}

/**
 * The one cached preview file for an attachment coordinate. The coordinate directory is decided
 * only by [attachmentPreviewDirectory]; the leaf is the sanitised original display name because
 * an external viewer shows that name to the user. A digest-named file left by the earlier layout
 * is renamed into the new directory instead of downloaded again, and one already-complete file in
 * the slot is renamed to the current leaf for the same reason.
 */
fun attachmentPreviewFile(
    context: Context,
    sessionId: String,
    messageId: String,
    index: Int,
    name: String,
): File {
    val slot = attachmentPreviewDirectory(context, sessionId, messageId, index)
    val leaf = sanitizedPreviewName(name)
    if (slot.isFile) migrateLegacySlot(slot, leaf) else slot.mkdirs()
    val file = File(slot, leaf)
    if (!file.exists() && slot.isDirectory) {
        slot.listFiles()
            ?.firstOrNull { it.isFile && !it.name.endsWith(PREVIEW_PART_SUFFIX) }
            ?.renameTo(file)
    }
    return file
}

/** Renames the previous digest-named cache file into the coordinate directory it now names. */
private fun migrateLegacySlot(slot: File, leaf: String) {
    val legacy = File(slot.parentFile, slot.name + ".legacy")
    legacy.delete()
    if (slot.renameTo(legacy) && slot.mkdirs()) {
        legacy.renameTo(File(slot, leaf))
    } else {
        // Renaming failed; dropping the stale bytes lets the next open download them again.
        legacy.delete()
        slot.delete()
    }
}

/**
 * Deletes every cached preview slot except [keep], which is the file just handed to an external
 * app. A handoff is deliberately not cleaned at launch: the receiving app may still be reading
 * it, so the next external open does the sweep instead. The in-app image preview keeps its own
 * delete-on-close.
 */
internal fun sweepAttachmentPreviews(context: Context, keep: File) {
    val root = File(context.cacheDir, PREVIEW_DIRECTORY)
    val keepSlot = keep.parentFile?.canonicalFile ?: return
    val keepFile = keep.canonicalFile
    root.listFiles()?.forEach { entry ->
        if (entry.canonicalFile != keepSlot) {
            entry.deleteRecursively()
        } else {
            entry.listFiles()?.forEach { child ->
                if (child.canonicalFile != keepFile) child.deleteRecursively()
            }
        }
    }
}

/** Only the original base name reaches the leaf, with path separators neutralised. */
private fun sanitizedPreviewName(raw: String): String {
    val cleaned = buildString(raw.length) {
        for (character in raw) {
            append(if (character.isISOControl() || character == '/' || character == '\\') '_' else character)
        }
    }.trim().take(MAX_NAME_LENGTH)
    return if (cleaned.isBlank() || cleaned == "." || cleaned == "..") FALLBACK_NAME else cleaned
}

/** Writes the downloaded original to the location the user picked, unchanged. The stream is */
suspend fun exportAttachment(context: Context, target: Uri, source: File) = withContext(Dispatchers.IO) {
    val output = context.contentResolver.openOutputStream(target, "wt")
        ?: throw IOException("所选位置无法写入")
    output.use { destination ->
        source.inputStream().use { input -> input.copyBounded(destination, source.length()) }
    }
}

/** Short human label for an original size. Bytes are never rounded up into a bigger unit. */
fun attachmentSizeLabel(bytes: Long): String = when {
    bytes >= 1024L * 1024L -> String.format("%.1f MiB", bytes / (1024.0 * 1024.0))
    bytes >= 1024L -> "${(bytes + 512) / 1024} KiB"
    bytes < 0 -> "未知大小"
    else -> "$bytes B"
}

private suspend fun InputStream.copyBounded(output: OutputStream, limit: Long): Long {
    val buffer = ByteArray(BUFFER_BYTES)
    var total = 0L
    while (true) {
        // Blocking reads do not observe cancellation by themselves. Checking here is what turns
        // a screen that went away into a deleted temp file rather than a finished import.
        coroutineContext.ensureActive()
        val read = read(buffer)
        if (read < 0) break
        total += read
        if (total > limit) throw IOException("单个附件原始大小超过 ${attachmentSizeLabel(limit)}")
        output.write(buffer, 0, read)
    }
    output.flush()
    return total
}

private fun displayName(resolver: ContentResolver, uri: Uri): String? = runCatching {
    resolver.query(uri, null, null, null, null)?.use { cursor ->
        val index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
        if (index >= 0 && cursor.moveToFirst()) cursor.getString(index) else null
    }
}.getOrNull()

private fun sanitizedDisplayName(raw: String?): String {
    val source = raw.orEmpty()
    val cleaned = buildString(source.length) {
        for (character in source) {
            // Separators and control characters are neutralised because a display name crosses
            // this file as untrusted text. It stays a label; the path is the temp file's own.
            append(if (character.isISOControl() || character == '/' || character == '\\') '_' else character)
        }
    }.trim().take(MAX_NAME_LENGTH)
    return cleaned.ifBlank { FALLBACK_NAME }
}

/** Only a short alphanumeric suffix reaches the filesystem, and only as the temp file's tail. */
private fun tempSuffix(name: String): String {
    val extension = name.substringAfterLast('.', "").filter { it.isLetterOrDigit() }.take(8)
    return if (extension.isEmpty()) "" else ".$extension"
}
