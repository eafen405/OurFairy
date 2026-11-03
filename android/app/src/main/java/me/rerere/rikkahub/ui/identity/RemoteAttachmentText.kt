package me.rerere.rikkahub.ui.identity

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

/**
 * What one downloaded attachment's bytes mean as text: the decoded body, or the explicit failure
 * the preview shows. An unsupported encoding never becomes replacement characters.
 */
internal sealed interface RemoteAttachmentText {
    data class Decoded(val text: String) : RemoteAttachmentText
    data object Undecodable : RemoteAttachmentText
}

private val GB18030: Charset = Charset.forName("GB18030")

/** How the preview presents a decoded attachment: rendered Markdown, or monospace plain text. */
internal enum class RemoteAttachmentTextLayout {
    MARKDOWN,
    PLAIN,
}

/**
 * Markdown when the effective type is [MARKDOWN_MIME] or the name carries one of
 * [MARKDOWN_SUFFIXES]. The suffix decides for `text/plain`, because that common type comes from
 * the system picker and not from the author; the body never decides, so a `.txt` that happens to
 * contain Markdown stays plain.
 */
internal fun remoteAttachmentTextLayout(mime: String?, name: String): RemoteAttachmentTextLayout {
    val markdown = attachmentMimeFor(mime, name) == MARKDOWN_MIME ||
        attachmentSuffix(name) in MARKDOWN_SUFFIXES
    return if (markdown) RemoteAttachmentTextLayout.MARKDOWN else RemoteAttachmentTextLayout.PLAIN
}

/**
 * UTF-8 first, then GB18030. Both decoders report malformed and unmappable input, so bytes that
 * are valid in neither encoding answer [RemoteAttachmentText.Undecodable] instead of raising or
 * substituting U+FFFD; the caller renders a message, not mojibake.
 */
internal fun decodeRemoteAttachmentText(bytes: ByteArray): RemoteAttachmentText =
    decodeStrictly(bytes, Charsets.UTF_8)?.let(RemoteAttachmentText::Decoded)
        ?: decodeStrictly(bytes, GB18030)?.let(RemoteAttachmentText::Decoded)
        ?: RemoteAttachmentText.Undecodable

private fun decodeStrictly(bytes: ByteArray, charset: Charset): String? =
    try {
        charset.newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
    } catch (_: CharacterCodingException) {
        null
    }
