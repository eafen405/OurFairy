package me.rerere.rikkahub.ui.identity

/** The four places a click on a transcript attachment can go. */
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

/** The type that makes the text preview render Markdown instead of monospace plain text. */
internal const val MARKDOWN_MIME = "text/markdown"

/** Suffixes whose effective type is [MARKDOWN_MIME]; the text preview reads the same set. */
internal val MARKDOWN_SUFFIXES = setOf("md", "markdown")

private const val OCTET_STREAM = "application/octet-stream"
private const val OPEN_DOCUMENT_PREFIX = "application/vnd.openxmlformats-officedocument."

/**
 * The media type one attachment is treated as. A recorded type other than [OCTET_STREAM] is kept,
 * with parameters and case removed; otherwise the type its suffix names is used, and an
 * unrecognised suffix stays [OCTET_STREAM]. The handoff sends this type and the route reads it.
 */
internal fun attachmentMimeFor(mime: String?, name: String): String {
    val recorded = normalizedMimeType(mime)
    if (recorded.isNotEmpty() && recorded != OCTET_STREAM) return recorded
    return SUFFIX_MIMES[attachmentSuffix(name)] ?: OCTET_STREAM
}

/**
 * The destination of one click. [attachmentMimeFor] supplies the media type; text over
 * [TEXT_PREVIEW_MAX_BYTES] becomes [RemoteAttachmentDestination.EXTERNAL] instead of
 * [RemoteAttachmentDestination.TEXT]. This is the only public route: the type-only decision is
 * private to this file.
 */
internal fun remoteAttachmentOpenDestination(
    mime: String?,
    name: String,
    bytes: Long,
): RemoteAttachmentDestination {
    val destination = destinationFor(attachmentMimeFor(mime, name))
    return if (destination == RemoteAttachmentDestination.TEXT && bytes > TEXT_PREVIEW_MAX_BYTES) {
        RemoteAttachmentDestination.EXTERNAL
    } else {
        destination
    }
}

/** The wire MIME without its parameters, trimmed and lowercased. */
private fun normalizedMimeType(mime: String?): String =
    mime.orEmpty().substringBefore(';').trim().lowercase()

/** The lowercased name tail after the last dot, or an empty string when there is none. */
internal fun attachmentSuffix(name: String): String = name.substringAfterLast('.', "").lowercase()

private fun destinationFor(type: String): RemoteAttachmentDestination = when {
    type.startsWith("image/") -> RemoteAttachmentDestination.IMAGE
    type.startsWith("text/") -> RemoteAttachmentDestination.TEXT
    type in TEXT_MIMES -> RemoteAttachmentDestination.TEXT
    type in EXTERNAL_MIMES || type.startsWith(OPEN_DOCUMENT_PREFIX) ->
        RemoteAttachmentDestination.EXTERNAL
    else -> RemoteAttachmentDestination.SAVE_AS
}

/** The one suffix-to-type table: routing and the external handoff both read it. */
private val SUFFIX_MIMES: Map<String, String> = buildMap {
    MARKDOWN_SUFFIXES.forEach { put(it, MARKDOWN_MIME) }
    put("txt", "text/plain")
    put("text", "text/plain")
    put("log", "text/plain")
    put("csv", "text/csv")
    put("tsv", "text/tab-separated-values")
    put("json", "application/json")
    put("jsonl", "application/json")
    put("yaml", "application/yaml")
    put("yml", "application/yaml")
    put("toml", "application/toml")
    put("ini", "text/plain")
    put("xml", "application/xml")
    put("html", "text/html")
    put("htm", "text/html")
    put("css", "text/css")
    put("js", "application/javascript")
    put("mjs", "application/javascript")
    put("cjs", "application/javascript")
    put("jsx", "application/javascript")
    put("ts", "text/plain")
    put("tsx", "text/plain")
    put("kt", "text/plain")
    put("kts", "text/plain")
    put("java", "text/plain")
    put("py", "text/plain")
    put("rb", "text/plain")
    put("go", "text/plain")
    put("rs", "text/plain")
    put("c", "text/plain")
    put("h", "text/plain")
    put("cc", "text/plain")
    put("cpp", "text/plain")
    put("cxx", "text/plain")
    put("hpp", "text/plain")
    put("cs", "text/plain")
    put("swift", "text/plain")
    put("sh", "text/plain")
    put("bash", "text/plain")
    put("zsh", "text/plain")
    put("sql", "text/plain")
    put("properties", "text/plain")
    put("png", "image/png")
    put("jpg", "image/jpeg")
    put("jpeg", "image/jpeg")
    put("gif", "image/gif")
    put("webp", "image/webp")
    put("bmp", "image/bmp")
    put("heic", "image/heic")
    put("heif", "image/heif")
    put("avif", "image/avif")
    put("svg", "image/svg+xml")
    put("pdf", "application/pdf")
    put("doc", "application/msword")
    put("docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    put("xls", "application/vnd.ms-excel")
    put("xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    put("ppt", "application/vnd.ms-powerpoint")
    put("pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation")
    put("odt", "application/vnd.oasis.opendocument.text")
    put("ods", "application/vnd.oasis.opendocument.spreadsheet")
    put("odp", "application/vnd.oasis.opendocument.presentation")
    put("rtf", "application/rtf")
    put("epub", "application/epub+zip")
}

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
