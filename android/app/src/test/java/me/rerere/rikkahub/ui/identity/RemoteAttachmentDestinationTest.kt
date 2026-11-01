package me.rerere.rikkahub.ui.identity

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The one decision "what does clicking this attachment do": MIME first, suffix only when the
 * MIME cannot identify the content. Values come from the spec's acceptance list, not from the
 * implementation's tables.
 */
class RemoteAttachmentDestinationTest {
    @Test
    fun `markdown mime routes to the text destination`() {
        assertEquals(
            RemoteAttachmentDestination.TEXT,
            remoteAttachmentDestination("text/markdown", "note.md"),
        )
    }

    @Test
    fun `octet stream markdown is corrected by its suffix`() {
        assertEquals(
            RemoteAttachmentDestination.TEXT,
            remoteAttachmentDestination("application/octet-stream", "note.md"),
        )
    }

    @Test
    fun `plain text routes to the text destination`() {
        assertEquals(
            RemoteAttachmentDestination.TEXT,
            remoteAttachmentDestination("text/plain", "note.txt"),
        )
    }

    @Test
    fun `code suffixes route to the text destination`() {
        val octet = "application/octet-stream"
        listOf("Main.kt", "app.ts", "data.json", "config.yaml", "rows.csv").forEach { name ->
            assertEquals(name, RemoteAttachmentDestination.TEXT, remoteAttachmentDestination(octet, name))
        }
    }

    @Test
    fun `an image mime routes to the image destination`() {
        assertEquals(
            RemoteAttachmentDestination.IMAGE,
            remoteAttachmentDestination("image/png", "cat.png"),
        )
        assertEquals(
            RemoteAttachmentDestination.IMAGE,
            remoteAttachmentDestination("image/jpeg", "photo.jpg"),
        )
    }

    @Test
    fun `octet stream images are corrected by their suffix`() {
        assertEquals(
            RemoteAttachmentDestination.IMAGE,
            remoteAttachmentDestination("application/octet-stream", "cat.png"),
        )
    }

    @Test
    fun `pdf routes to the external destination`() {
        assertEquals(
            RemoteAttachmentDestination.EXTERNAL,
            remoteAttachmentDestination("application/pdf", "document.pdf"),
        )
        assertEquals(
            RemoteAttachmentDestination.EXTERNAL,
            remoteAttachmentDestination("application/octet-stream", "document.pdf"),
        )
    }

    @Test
    fun `word documents route to the external destination`() {
        assertEquals(
            RemoteAttachmentDestination.EXTERNAL,
            remoteAttachmentDestination(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "document.docx",
            ),
        )
        assertEquals(
            RemoteAttachmentDestination.EXTERNAL,
            remoteAttachmentDestination("application/octet-stream", "document.docx"),
        )
    }

    @Test
    fun `an unknown type falls back to save as`() {
        assertEquals(
            RemoteAttachmentDestination.SAVE_AS,
            remoteAttachmentDestination("application/octet-stream", "archive.zip"),
        )
        assertEquals(
            RemoteAttachmentDestination.SAVE_AS,
            remoteAttachmentDestination("application/zip", "archive.zip"),
        )
    }

    @Test
    fun `an uppercase suffix is still recognised`() {
        assertEquals(
            RemoteAttachmentDestination.IMAGE,
            remoteAttachmentDestination("application/octet-stream", "CAT.PNG"),
        )
        assertEquals(
            RemoteAttachmentDestination.TEXT,
            remoteAttachmentDestination("application/octet-stream", "NOTES.MD"),
        )
        assertEquals(
            RemoteAttachmentDestination.EXTERNAL,
            remoteAttachmentDestination("application/octet-stream", "REPORT.PDF"),
        )
    }

    @Test
    fun `a missing suffix falls back to save as`() {
        assertEquals(
            RemoteAttachmentDestination.SAVE_AS,
            remoteAttachmentDestination("application/octet-stream", "README"),
        )
        assertEquals(
            RemoteAttachmentDestination.SAVE_AS,
            remoteAttachmentDestination(null, "README"),
        )
    }

    @Test
    fun `a trusted mime wins over a conflicting suffix`() {
        // Only octet-stream and a missing mime are corrected by the suffix.
        assertEquals(
            RemoteAttachmentDestination.TEXT,
            remoteAttachmentDestination("text/plain", "picture.png"),
        )
        assertEquals(
            RemoteAttachmentDestination.IMAGE,
            remoteAttachmentDestination("image/png", "notes.md"),
        )
        assertEquals(
            RemoteAttachmentDestination.EXTERNAL,
            remoteAttachmentDestination("application/pdf", "notes.md"),
        )
    }

    @Test
    fun `a missing mime is decided by the suffix`() {
        assertEquals(
            RemoteAttachmentDestination.IMAGE,
            remoteAttachmentDestination(null, "cat.png"),
        )
        assertEquals(
            RemoteAttachmentDestination.TEXT,
            remoteAttachmentDestination("", "notes.md"),
        )
    }

    @Test
    fun `mime parameters and case do not change the destination`() {
        assertEquals(
            RemoteAttachmentDestination.TEXT,
            remoteAttachmentDestination("text/plain; charset=utf-8", "notes.txt"),
        )
        assertEquals(
            RemoteAttachmentDestination.IMAGE,
            remoteAttachmentDestination("IMAGE/PNG", "cat.png"),
        )
    }

    @Test
    fun `a text over two mib is not expanded in app`() {
        val over = TEXT_PREVIEW_MAX_BYTES + 1
        listOf(
            Triple("text/plain", "notes.txt", over),
            Triple("text/markdown", "notes.md", over),
            Triple("application/octet-stream", "Main.kt", over),
        ).forEach { (mime, name, bytes) ->
            assertEquals(
                "$name 超过 2 MiB 应离开应用内文本预览",
                RemoteAttachmentDestination.EXTERNAL,
                remoteAttachmentDestinationFor(mime, name, bytes),
            )
        }
    }

    @Test
    fun `a text at or under two mib stays in the in app preview`() {
        listOf(TEXT_PREVIEW_MAX_BYTES, TEXT_PREVIEW_MAX_BYTES - 1, 0L).forEach { bytes ->
            assertEquals(
                "notes.txt @ $bytes",
                RemoteAttachmentDestination.TEXT,
                remoteAttachmentDestinationFor("text/plain", "notes.txt", bytes),
            )
        }
    }

    @Test
    fun `the two mib ceiling applies only to text`() {
        val over = TEXT_PREVIEW_MAX_BYTES + 1
        assertEquals(
            RemoteAttachmentDestination.IMAGE,
            remoteAttachmentDestinationFor("image/png", "cat.png", over),
        )
        assertEquals(
            RemoteAttachmentDestination.EXTERNAL,
            remoteAttachmentDestinationFor("application/pdf", "document.pdf", over),
        )
        assertEquals(
            RemoteAttachmentDestination.SAVE_AS,
            remoteAttachmentDestinationFor("application/zip", "archive.zip", over),
        )
    }
}
