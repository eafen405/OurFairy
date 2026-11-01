package me.rerere.rikkahub.ui.identity

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * The preview cache slot is a function of the attachment's coordinates only, so opening the same
 * attachment again reads the same bytes and two different attachments can never collide. The file
 * leaf carries the sanitised original name because an external viewer shows it to the user.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35])
class RemoteAttachmentPreviewFileTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()

    private val previewRoot: File get() = File(context.cacheDir, "attachment-preview").canonicalFile

    @Test
    fun `the same attachment coordinate always names the same cache file`() {
        assertEquals(
            attachmentPreviewFile(context, "session-1", "message-1", 0, "report.pdf"),
            attachmentPreviewFile(context, "session-1", "message-1", 0, "report.pdf"),
        )
    }

    @Test
    fun `the cache file lives in a coordinate directory under the dedicated preview subdirectory`() {
        val file = attachmentPreviewFile(context, "session-1", "message-1", 0, "季度 报告.pdf")

        assertEquals(previewRoot, file.canonicalFile.parentFile?.parentFile)
        assertEquals("季度 报告.pdf", file.name)
        assertTrue("缓存坐标目录应可直接写入", file.parentFile!!.isDirectory)
    }

    @Test
    fun `different sessions messages and indexes never share a cache file`() {
        val files = listOf(
            attachmentPreviewFile(context, "session-1", "message-1", 0, "attachment"),
            attachmentPreviewFile(context, "session-2", "message-1", 0, "attachment"),
            attachmentPreviewFile(context, "session-1", "message-2", 0, "attachment"),
            attachmentPreviewFile(context, "session-1", "message-1", 1, "attachment"),
            attachmentPreviewFile(context, "session-1", "message-1", 2, "attachment"),
        )

        assertEquals(files.size, files.toSet().size)
    }

    @Test
    fun `untrusted identifiers cannot escape the preview subdirectory`() {
        val file = attachmentPreviewFile(context, "../../s1", "../m1/../m1", -1, "report.pdf")

        assertEquals(previewRoot, file.canonicalFile.parentFile?.parentFile)
    }

    @Test
    fun `an untrusted display name stays inside its coordinate directory`() {
        val coordinate = attachmentPreviewDirectory(context, "session-1", "message-1", 0)
        val file = attachmentPreviewFile(context, "session-1", "message-1", 0, "../../evil.pdf")

        assertEquals(coordinate.canonicalFile, file.canonicalFile.parentFile)
        assertFalse("目录分隔符不得进入文件名", file.name.contains('/') || file.name.contains('\\'))
    }
}
