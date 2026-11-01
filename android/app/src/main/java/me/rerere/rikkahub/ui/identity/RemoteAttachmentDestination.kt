package me.rerere.rikkahub.ui.identity

/**
 * Where clicking one transcript attachment goes.
 *
 * This is the client's only attachment-routing decision: the chip reports the click, and the
 * This is the client's only attachment-routing decision: the chip reports the click, and the
 * caller reads [remoteAttachmentDestinationFor] instead of inspecting the MIME, the name or the
 * size itself. [IMAGE] opens the in-app viewer, [TEXT] the in-app read-only preview (text over
 * [TEXT_PREVIEW_MAX_BYTES] is routed to [EXTERNAL] instead), [EXTERNAL] hands the cached file to
 * an installed system app and falls back to save-as when there is none, and [SAVE_AS] writes the
 * original to a location the user picks.
 */
internal enum class RemoteAttachmentDestination {
    IMAGE,
    TEXT,
    EXTERNAL,
    SAVE_AS,
}

/**
 * Text larger than this is not expanded in-app: one read of the whole body must stay bounded.
 * The comparison is against the attachment's recorded original size, before any download.
 */
internal const val TEXT_PREVIEW_MAX_BYTES: Long = 2L * 1024 * 1024

private const val OCTET_STREAM = "application/octet-stream"
private const val OPEN_DOCUMENT_PREFIX = "application/vnd.openxmlformats-officedocument."

/**
 * Uploads record the system `ContentResolver` type, whose common fallback is
 * [OCTET_STREAM]; only that fallback (or a missing type) is corrected by the suffix. Any other
 * type is trusted even when it disagrees with the name.
 */
internal fun remoteAttachmentDestination(mime: String?, name: String): RemoteAttachmentDestination {
    val type = normalizedMimeType(mime)
    if (type.isNotEmpty() && type != OCTET_STREAM) {
        return when {
            type.startsWith("image/") -> RemoteAttachmentDestination.IMAGE
            type.startsWith("text/") -> RemoteAttachmentDestination.TEXT
            type in TEXT_MIMES -> RemoteAttachmentDestination.TEXT
            type in EXTERNAL_MIMES || type.startsWith(OPEN_DOCUMENT_PREFIX) ->
                RemoteAttachmentDestination.EXTERNAL
            else -> RemoteAttachmentDestination.SAVE_AS
        }
    }
    return destinationForSuffix(name.substringAfterLast('.', "").lowercase())
}

/** The wire MIME without its parameters, trimmed and lowercased; the one spelling both checks use. */
internal fun normalizedMimeType(mime: String?): String =
    mime.orEmpty().substringBefore(';').trim().lowercase()

/**
 * The click decision: the type route from [remoteAttachmentDestination], except that text over
 * [TEXT_PREVIEW_MAX_BYTES] is handed off instead of expanded. Its recorded bytes are the
 * authority, so the preview never has to download a body it will refuse. [EXTERNAL] is the real
 * handoff that falls back to save-as when no installed app can take the file.
 */
internal fun remoteAttachmentDestinationFor(
    mime: String?,
    name: String,
    bytes: Long,
): RemoteAttachmentDestination {
    val destination = remoteAttachmentDestination(mime, name)
    return if (destination == RemoteAttachmentDestination.TEXT && bytes > TEXT_PREVIEW_MAX_BYTES) {
        RemoteAttachmentDestination.EXTERNAL
    } else {
        destination
    }
}

private fun destinationForSuffix(suffix: String): RemoteAttachmentDestination = when {
    suffix.isEmpty() -> RemoteAttachmentDestination.SAVE_AS
    suffix in IMAGE_SUFFIXES -> RemoteAttachmentDestination.IMAGE
    suffix in TEXT_SUFFIXES -> RemoteAttachmentDestination.TEXT
    suffix in EXTERNAL_SUFFIXES -> RemoteAttachmentDestination.EXTERNAL
    else -> RemoteAttachmentDestination.SAVE_AS
}

private val IMAGE_SUFFIXES = setOf(
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "heic", "heif", "avif", "svg",
)

/** Text and code suffixes the client reads as text in the in-app preview. */
private val TEXT_SUFFIXES = setOf(
    "md", "markdown", "txt", "text", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml",
    "toml", "ini", "xml", "html", "htm", "css", "js", "mjs", "cjs", "jsx", "ts", "tsx",
    "kt", "kts", "java", "py", "rb", "go", "rs", "c", "h", "cc", "cpp", "cxx", "hpp",
    "cs", "swift", "sh", "bash", "zsh", "sql", "properties",
)

/** Documents handed to an installed system app. */
private val EXTERNAL_SUFFIXES = setOf(
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "epub",
)

private val TEXT_MIMES = setOf(
    "application/json", "application/ld+json", "application/xml", "application/xhtml+xml",
    "application/javascript", "application/x-javascript", "application/ecmascript",
    "application/yaml", "application/x-yaml", "application/toml", "application/csv",
)

private val EXTERNAL_MIMES = setOf(
    "application/pdf", "application/rtf", "application/epub+zip",
    "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
)
