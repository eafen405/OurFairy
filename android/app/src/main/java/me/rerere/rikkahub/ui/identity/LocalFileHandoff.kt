package me.rerere.rikkahub.ui.identity

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File

/**
 * The intent that hands one private [file] to an installed app: a FileProvider content URI typed
 * [mime], the original [displayName] in ClipData, and a temporary read grant. The intent is
 * started directly rather than through `Intent.createChooser`, because AOSP's chooser activity
 * resolves even when no app can handle the payload.
 */
internal fun localFileViewIntent(
    context: Context,
    file: File,
    mime: String,
    displayName: String,
): Intent {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    return Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mime)
        clipData = ClipData.newRawUri(displayName, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}

/**
 * Starts [localFileViewIntent] and answers [missingMessage] when the system has no receiver, or
 * null when the launch was handed off. [launch] is the function-level seam tests use in place of
 * `startActivity`.
 */
internal fun launchLocalFileView(
    context: Context,
    file: File,
    mime: String,
    displayName: String,
    missingMessage: String,
    launch: (Intent) -> Unit = { context.startActivity(it) },
): String? = try {
    launch(localFileViewIntent(context, file, mime, displayName))
    null
} catch (missing: ActivityNotFoundException) {
    missingMessage
}
