package me.rerere.rikkahub.ui.identity

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The one public click decision "what does clicking this attachment do", and the effective media
 * type it and the external handoff read. Values come from the spec's acceptance list, not from the
 * implementation's tables.
 */
class RemoteAttachmentDestinationTest {
    private fun destination(mime: String?, name: String) =
        remoteAttachmentOpenDestination(mime, name, 0L)

    @Test
    fun `markdown mime routes to the text destination`() {
        assertEquals(RemoteAttachmentDestination.TEXT, destination("text/markdown", "note.md"))
    }

    @Test
    fun `octet stream markdown is corrected by its suffix`() {
        assertEquals(RemoteAttachmentDestination.TEXT, destination("application/octet-stream", "note.md"))
    }

    @Test
    fun `plain text routes to the text destination`() {
        assertEquals(RemoteAttachmentDestination.TEXT, destination("text/plain", "note.txt"))
    }

    @Test
    fun `code suffixes route to the text destination`() {
        val octet = "application/octet-stream"
        listOf("Main.kt", "app.ts", "data.json", "config.yaml", "rows.csv").forEach { name ->
            assertEquals(name, RemoteAttachmentDestination.TEXT, destination(octet, name))
        }
    }

    @Test
    fun `an image mime routes to the image destination`() {
        assertEquals(RemoteAttachmentDestination.IMAGE, destination("image/png", "cat.png"))
        assertEquals(RemoteAttachmentDestination.IMAGE, destination("image/jpeg", "photo.jpg"))
    }

    @Test
    fun `octet stream images are corrected by their suffix`() {
        assertEquals(RemoteAttachmentDestination.IMAGE, destination("application/octet-stream", "cat.png"))
    }

    @Test
    fun `pdf routes to the external destination`() {
        assertEquals(RemoteAttachmentDestination.EXTERNAL, destination("application/pdf", "document.pdf"))
        assertEquals(
            RemoteAttachmentDestination.EXTERNAL,
            destination("application/octet-stream", "document.pdf"),
        )
    }

    @Test
    fun `word documents route to the external destination`() {
        assertEquals(
            RemoteAttachmentDestination.EXTERNAL,
            destination(
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "document.docx",
            ),
        )
        assertEquals(
            RemoteAttachmentDestination.EXTERNAL,
            destination("application/octet-stream", "document.docx"),
        )
    }

    @Test
    fun `an unknown type falls back to save as`() {
        assertEquals(RemoteAttachmentDestination.SAVE_AS, destination("application/octet-stream", "archive.zip"))
        assertEquals(RemoteAttachmentDestination.SAVE_AS, destination("application/zip", "archive.zip"))
    }

    @Test
    fun `an uppercase suffix is still recognised`() {
        assertEquals(RemoteAttachmentDestination.IMAGE, destination("application/octet-stream", "CAT.PNG"))
        assertEquals(RemoteAttachmentDestination.TEXT, destination("application/octet-stream", "NOTES.MD"))
        assertEquals(RemoteAttachmentDestination.EXTERNAL, destination("application/octet-stream", "REPORT.PDF"))
    }

    @Test
    fun `a missing suffix falls back to save as`() {
        assertEquals(RemoteAttachmentDestination.SAVE_AS, destination("application/octet-stream", "README"))
        assertEquals(RemoteAttachmentDestination.SAVE_AS, destination(null, "README"))
    }

    @Test
    fun `a trusted mime wins over a conflicting suffix`() {
        // Only octet-stream and a missing mime are corrected by the suffix.
        assertEquals(RemoteAttachmentDestination.TEXT, destination("text/plain", "picture.png"))
        assertEquals(RemoteAttachmentDestination.IMAGE, destination("image/png", "notes.md"))
        assertEquals(RemoteAttachmentDestination.EXTERNAL, destination("application/pdf", "notes.md"))
    }

    @Test
    fun `a missing mime is decided by the suffix`() {
        assertEquals(RemoteAttachmentDestination.IMAGE, destination(null, "cat.png"))
        assertEquals(RemoteAttachmentDestination.TEXT, destination("", "notes.md"))
    }

    @Test
    fun `mime parameters and case do not change the destination`() {
        assertEquals(
            RemoteAttachmentDestination.TEXT,
            destination("text/plain; charset=utf-8", "notes.txt"),
        )
        assertEquals(RemoteAttachmentDestination.IMAGE, destination("IMAGE/PNG", "cat.png"))
    }

    @Test
    fun `an untrusted type takes its effective type from the suffix`() {
        assertEquals(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            attachmentMimeFor("application/octet-stream", "quarterly.docx"),
        )
        assertEquals("application/pdf", attachmentMimeFor("application/octet-stream", "quarterly.pdf"))
        assertEquals("text/markdown", attachmentMimeFor("application/octet-stream", "notes.md"))
        assertEquals("text/markdown", attachmentMimeFor("application/octet-stream", "NOTES.MD"))
    }

    @Test
    fun `an unknown suffix and a missing name stay octet stream`() {
        assertEquals("application/octet-stream", attachmentMimeFor("application/octet-stream", "archive.zzz"))
        assertEquals("application/octet-stream", attachmentMimeFor(null, "README"))
        assertEquals(RemoteAttachmentDestination.SAVE_AS, destination("application/octet-stream", "archive.zzz"))
        assertEquals(RemoteAttachmentDestination.SAVE_AS, destination(null, "README"))
    }

    @Test
    fun `a trusted mime is the effective type with its parameters removed`() {
        assertEquals("application/pdf", attachmentMimeFor("Application/PDF; q=1", "notes.md"))
        assertEquals("text/plain", attachmentMimeFor(" text/plain; charset=utf-8 ", "notes.txt"))
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
                remoteAttachmentOpenDestination(mime, name, bytes),
            )
        }
    }

    @Test
    fun `a text at or under two mib stays in the in app preview`() {
        listOf(TEXT_PREVIEW_MAX_BYTES, TEXT_PREVIEW_MAX_BYTES - 1, 0L).forEach { bytes ->
            assertEquals(
                "notes.txt @ $bytes",
                RemoteAttachmentDestination.TEXT,
                remoteAttachmentOpenDestination("text/plain", "notes.txt", bytes),
            )
        }
    }

    @Test
    fun `the two mib ceiling applies only to text`() {
        val over = TEXT_PREVIEW_MAX_BYTES + 1
        assertEquals(
            RemoteAttachmentDestination.IMAGE,
            remoteAttachmentOpenDestination("image/png", "cat.png", over),
        )
        assertEquals(
            RemoteAttachmentDestination.EXTERNAL,
            remoteAttachmentOpenDestination("application/pdf", "document.pdf", over),
        )
        assertEquals(
            RemoteAttachmentDestination.SAVE_AS,
            remoteAttachmentOpenDestination("application/zip", "archive.zip", over),
        )
    }
}
