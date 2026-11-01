package me.rerere.rikkahub.ui.identity

import java.nio.charset.Charset
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * What the text preview can read, independent of Compose: the decode chain is UTF-8 first,
 * GB18030 second, and an explicit "cannot decode" answer instead of replacement characters.
 * Sample text and encodings come from the ticket, not from the decoder's tables.
 */
class RemoteAttachmentTextTest {
    @Test
    fun `a chinese utf 8 sample decodes as utf 8`() {
        val expected = "费尔：你好。\n第二行：缩进\n    四格"

        assertEquals(
            RemoteAttachmentText.Decoded(expected),
            decodeRemoteAttachmentText(expected.toByteArray(Charsets.UTF_8)),
        )
    }

    @Test
    fun `a chinese gb18030 sample decodes after utf 8 fails`() {
        val expected = "费尔：你好。\n第二行：遇到中文就换编码"

        assertEquals(
            RemoteAttachmentText.Decoded(expected),
            decodeRemoteAttachmentText(expected.toByteArray(Charset.forName("GB18030"))),
        )
    }

    @Test
    fun `bytes that are neither utf 8 nor gb18030 report an explicit failure`() {
        assertEquals(
            RemoteAttachmentText.Undecodable,
            decodeRemoteAttachmentText(byteArrayOf(0xFF.toByte(), 0xFF.toByte())),
        )
    }

    @Test
    fun `a markdown suffix selects rendered markdown`() {
        assertEquals(
            RemoteAttachmentTextLayout.MARKDOWN,
            remoteAttachmentTextLayout("application/octet-stream", "README.md"),
        )
        assertEquals(
            RemoteAttachmentTextLayout.MARKDOWN,
            remoteAttachmentTextLayout("application/octet-stream", "README.markdown"),
        )
    }

    @Test
    fun `a markdown mime selects rendered markdown without a suffix`() {
        assertEquals(
            RemoteAttachmentTextLayout.MARKDOWN,
            remoteAttachmentTextLayout("text/markdown", "README"),
        )
        assertEquals(
            RemoteAttachmentTextLayout.MARKDOWN,
            remoteAttachmentTextLayout("text/markdown; charset=utf-8", "README"),
        )
    }

    @Test
    fun `text plain with a markdown suffix still selects markdown`() {
        // text/plain is the system's fallback type; the author's suffix is what survives it.
        assertEquals(
            RemoteAttachmentTextLayout.MARKDOWN,
            remoteAttachmentTextLayout("text/plain", "notes.md"),
        )
    }

    @Test
    fun `a txt with markdown looking content stays plain`() {
        val body = "# 标题\n\n- 列表"
        assertEquals(RemoteAttachmentText.Decoded(body), decodeRemoteAttachmentText(body.toByteArray()))
        assertEquals(
            RemoteAttachmentTextLayout.PLAIN,
            remoteAttachmentTextLayout("text/plain", "notes.txt"),
        )
    }

    @Test
    fun `code and unsuffixed text use the plain layout`() {
        assertEquals(
            RemoteAttachmentTextLayout.PLAIN,
            remoteAttachmentTextLayout("application/octet-stream", "Main.kt"),
        )
        assertEquals(
            RemoteAttachmentTextLayout.PLAIN,
            remoteAttachmentTextLayout("text/plain", "notes"),
        )
        assertEquals(
            RemoteAttachmentTextLayout.PLAIN,
            remoteAttachmentTextLayout("text/csv", "rows.csv"),
        )
    }
}
