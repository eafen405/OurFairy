package me.rerere.rikkahub.ui.identity

import android.app.Application
import android.content.ActivityNotFoundException
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

/**
 * Handing one cached local file to an installed system app: the intent shape a receiver gets, the
 * launch seam that catches a missing receiver, and the cache sweep that lets a receiver keep
 * reading after the handoff.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35])
class RemoteAttachmentHandoffTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()

    @Before
    fun clearProviderCache() {
        clearFileProviderCache()
    }

    private fun cachedAttachment(name: String, session: String = "session-1", message: String = "message-1"): File =
        attachmentPreviewFile(context, session, message, 0, name).apply { writeBytes(byteArrayOf(1, 2, 3)) }

    @Test
    fun `the handoff intent opens the cached file with the system's viewer`() {
        val name = "季度 报告.pdf"
        val file = cachedAttachment(name)

        val intent = localFileViewIntent(context, file, "application/pdf", name)

        assertEquals(Intent.ACTION_VIEW, intent.action)
        assertFalse("不得包成 chooser，否则没有接收方时无法抛错", intent.hasExtra(Intent.EXTRA_INTENT))
        assertEquals("application/pdf", intent.type)
        assertEquals("content", intent.data?.scheme)
        assertEquals("${context.packageName}.fileprovider", intent.data?.authority)
        assertTrue(
            "目标必须位于附件预览子目录",
            intent.data?.path?.startsWith("/attachment-preview/") == true,
        )
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertTrue(intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertEquals(name, intent.clipData?.description?.label)
        assertEquals(intent.data, intent.clipData?.getItemAt(0)?.uri)
    }

    @Test
    fun `the handoff goes through the launch seam`() {
        var launched: Intent? = null

        val failure = launchLocalFileView(
            context,
            cachedAttachment("report.pdf"),
            "application/pdf",
            "report.pdf",
            "没有能打开该文件的系统应用，请选择保存位置",
        ) { launched = it }

        assertNull(failure)
        assertNotNull(launched)
        assertEquals(Intent.ACTION_VIEW, launched!!.action)
    }

    @Test
    fun `a missing receiver is reported instead of crashing`() {
        val failure = launchLocalFileView(
            context,
            cachedAttachment("report.pdf"),
            "application/pdf",
            "report.pdf",
            "没有能打开该文件的系统应用，请选择保存位置",
        ) { throw ActivityNotFoundException() }

        assertEquals("没有能打开该文件的系统应用，请选择保存位置", failure)
    }

    @Test
    fun `the real launch path reports a device without a receiver`() {
        context.requireActivityResolution()

        val failure = launchLocalFileView(
            context,
            cachedAttachment("report.pdf"),
            "application/pdf",
            "report.pdf",
            "没有能打开该文件的系统应用，请选择保存位置",
        )

        assertEquals("没有能打开该文件的系统应用，请选择保存位置", failure)
    }

    @Test
    fun `sweeping previews keeps the file just handed off and deletes the rest`() {
        val keep = cachedAttachment("report.pdf", session = "session-1", message = "message-1")
        val other = cachedAttachment("notes.pdf", session = "session-1", message = "message-2")

        sweepAttachmentPreviews(context, keep)

        assertTrue("交接给外部的文件不得立即删除", keep.isFile)
        assertFalse("其余预览缓存应由下一次打开清掉", other.exists())
        assertFalse("空的坐标目录也应清掉", other.parentFile!!.exists())
    }
}
