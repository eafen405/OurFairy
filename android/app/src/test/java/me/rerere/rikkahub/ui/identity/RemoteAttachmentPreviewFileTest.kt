package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * The preview cache path is a function of the attachment's coordinates only, so opening the same
 * attachment again reads the same file and two different attachments can never collide.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35])
class RemoteAttachmentPreviewFileTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()

    @Test
    fun `the same attachment coordinate always names the same cache file`() {
        assertEquals(
            attachmentPreviewFile(context, "session-1", "message-1", 0),
            attachmentPreviewFile(context, "session-1", "message-1", 0),
        )
    }

    @Test
    fun `the cache file lives in the dedicated preview subdirectory`() {
        val file = attachmentPreviewFile(context, "session-1", "message-1", 0)

        assertEquals(File(context.cacheDir, "attachment-preview"), file.parentFile)
        assertTrue("缓存子目录应可直接写入", file.parentFile!!.isDirectory)
    }

    @Test
    fun `different sessions messages and indexes never share a cache file`() {
        val files = listOf(
            attachmentPreviewFile(context, "session-1", "message-1", 0),
            attachmentPreviewFile(context, "session-2", "message-1", 0),
            attachmentPreviewFile(context, "session-1", "message-2", 0),
            attachmentPreviewFile(context, "session-1", "message-1", 1),
            attachmentPreviewFile(context, "session-1", "message-1", 2),
        )

        assertEquals(files.size, files.toSet().size)
    }

    @Test
    fun `untrusted identifiers cannot escape the preview subdirectory`() {
        val directory = File(context.cacheDir, "attachment-preview").canonicalFile
        val file = attachmentPreviewFile(context, "../../s1", "../m1/../m1", -1)

        assertEquals(directory, file.canonicalFile.parentFile)
    }
}
