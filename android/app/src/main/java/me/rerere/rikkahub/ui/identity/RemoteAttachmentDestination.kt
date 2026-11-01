package me.rerere.rikkahub.ui.identity

/**
 * Where clicking one transcript attachment goes.
 *
 * This is the client's only attachment-routing decision: the chip reports the click, and the
 * caller reads this answer instead of inspecting the MIME or the name itself. [EXTERNAL] is the
 * handoff to an installed system app; [TEXT] is named for its follow-up ticket and currently
 * keeps save-as.
 */
internal enum class RemoteAttachmentDestination {
    IMAGE,
    TEXT,
    EXTERNAL,
    SAVE_AS,
}

private const val OCTET_STREAM = "application/octet-stream"
private const val OPEN_DOCUMENT_PREFIX = "application/vnd.openxmlformats-officedocument."

/**
 * Uploads record the system `ContentResolver` type, whose common fallback is
 * [OCTET_STREAM]; only that fallback (or a missing type) is corrected by the suffix. Any other
 * type is trusted even when it disagrees with the name.
 */
internal fun remoteAttachmentDestination(mime: String?, name: String): RemoteAttachmentDestination {
    val type = mime.orEmpty().substringBefore(';').trim().lowercase()
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

/** Text and code suffixes the client can read as text once the text preview ticket lands. */
private val TEXT_SUFFIXES = setOf(
    "md", "markdown", "txt", "text", "log", "csv", "tsv", "json", "jsonl", "yaml", "yml",
    "toml", "ini", "xml", "html", "htm", "css", "js", "mjs", "cjs", "jsx", "ts", "tsx",
    "kt", "kts", "java", "py", "rb", "go", "rs", "c", "h", "cc", "cpp", "cxx", "hpp",
    "cs", "swift", "sh", "bash", "zsh", "sql", "properties",
)

/** Documents handed to an installed system app once the external-handoff ticket lands. */
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
