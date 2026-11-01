package me.rerere.rikkahub.ui.identity

import android.Manifest
import android.app.Activity
import android.app.Application
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import java.io.File
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf
import me.rerere.rikkahub.data.remote.ChatHistoryPage
import me.rerere.rikkahub.data.remote.ChatReceipt
import me.rerere.rikkahub.data.remote.ChatSyncKey
import me.rerere.rikkahub.data.remote.ChatSyncRecord
import me.rerere.rikkahub.data.remote.ChatSyncStore
import me.rerere.rikkahub.data.remote.RemoteAttachmentBackend
import me.rerere.rikkahub.data.remote.RemoteAttachmentUpload
import me.rerere.rikkahub.data.remote.RemoteChatAttachment
import me.rerere.rikkahub.data.remote.RemoteChatBackend
import me.rerere.rikkahub.data.remote.RemoteChatMessage
import me.rerere.rikkahub.data.remote.RemoteChatProjection
import me.rerere.rikkahub.data.remote.RemoteChatState
import me.rerere.rikkahub.data.remote.remoteEvent
import me.rerere.rikkahub.ui.fairy.FairyAppTheme
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The transcript's PDF/Office click, observed through the real panel and the real `startActivity`
 * path: one authenticated download into the preview cache, handed to an installed viewer as a
 * content URI with ACTION_VIEW and the effective media type. A device with no receiver falls back
 * to save-as from those same bytes, and a later external open sweeps the file the earlier receiver
 * may still be reading.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemoteAttachmentExternalTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val context = ApplicationProvider.getApplicationContext<Application>()

    private val bytes = byteArrayOf(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31) // %PDF-1

    private class Chat(private val projection: RemoteChatProjection) : RemoteChatBackend {
        override fun observe(token: String, sessionId: String): Flow<RemoteChatProjection> = flowOf(projection)
        override suspend fun read(token: String, sessionId: String) = projection
        override suspend fun send(
            token: String,
            sessionId: String,
            requestId: String,
            text: String,
            uploadIds: List<String>,
        ): ChatReceipt = error("not used")
        override suspend fun receipt(token: String, sessionId: String, requestId: String): ChatReceipt? = null
        override suspend fun stop(token: String, sessionId: String) = Unit
        override suspend fun page(token: String, sessionId: String, throughSeq: Long, beforeSeq: Long) =
            ChatHistoryPage(sessionId, throughSeq, 0)
        override suspend fun checkpoint(token: String, sessionId: String) = 0L
    }

    private class Files(private val bytes: ByteArray) : RemoteAttachmentBackend {
        val downloads = mutableListOf<String>()
        override suspend fun upload(
            token: String,
            sessionId: String,
            file: File,
            name: String,
            mime: String,
        ): RemoteAttachmentUpload = error("not used")
        override suspend fun download(
            token: String,
            sessionId: String,
            messageId: String,
            attachment: RemoteChatAttachment,
            destination: File,
        ) {
            downloads += messageId
            destination.writeBytes(bytes)
        }
    }

    private val store = object : ChatSyncStore {
        override suspend fun load(key: ChatSyncKey) = ChatSyncRecord(-1, true)
        override suspend fun save(key: ChatSyncKey, record: ChatSyncRecord) = Unit
    }

    @Before
    fun clearProviderCache() {
        clearFileProviderCache()
    }

    @After
    fun close() {
        scope.cancel()
    }

    /** One attachment as the backend records it, plus the media type an installed viewer handles. */
    private data class AttachmentSpec(val name: String, val mime: String, val viewerMime: String?)

    private fun pdf(name: String) = AttachmentSpec(name, "application/pdf", "application/pdf")

    private fun show(vararg attachments: AttachmentSpec): Files {
        val recorded = attachments.mapIndexed { index, spec ->
            RemoteChatAttachment(index, 1, spec.name, spec.mime, bytes.size.toLong())
        }
        val projection = RemoteChatProjection(
            sessionId = "s1", generation = "g1", version = 1, cursor = 0, durableThroughSeq = 0,
            messages = listOf(RemoteChatMessage("m1", 0, 0, null, 1, 2, "附件", recorded)),
            throughSeq = 0, fromSeq = 0, events = listOf(remoteEvent(0)),
        )
        // A device verifies that the intent resolves before starting it; register the installed
        // viewers the handoff should find, and the save-as target the fallback needs.
        context.requireActivityResolution()
        context.registerDocumentCreator("application/octet-stream")
        attachments.forEachIndexed { index, spec ->
            val viewerMime = spec.viewerMime ?: return@forEachIndexed
            val cached = attachmentPreviewFile(context, "s1", "m1", index, spec.name)
            context.registerActivityFor(localFileViewIntent(context, cached, viewerMime, spec.name))
        }
        val files = Files(bytes)
        val state = RemoteChatState(Chat(projection), scope, store, "https://fairy", attachmentsBackend = files)
        state.bind("token", "s1", 1)
        compose.setContent {
            FairyAppTheme {
                RemoteChatPanel(state = state, onReconnect = {})
            }
        }
        compose.waitForIdle()
        return files
    }

    private fun clickAttachment(name: String) {
        compose.onNodeWithText("$name · ${attachmentSizeLabel(bytes.size.toLong())}").performClick()
    }

    private fun awaitStartedActivity(): Intent {
        val shadow = shadowOf(compose.activity)
        compose.waitUntil(timeoutMillis = 5_000) { shadow.peekNextStartedActivity() != null }
        return shadow.nextStartedActivity
    }

    /** Robolectric records plain starts in both queues; only a document request means save-as. */
    private fun nextDocumentRequest(): Intent? =
        shadowOf(compose.activity).nextStartedActivityForResult?.intent
            ?.takeIf { it.action == Intent.ACTION_CREATE_DOCUMENT }

    @Test
    fun `clicking a pdf downloads once and hands the cached file to the system`() {
        val files = show(pdf("report.pdf"))
        val cached = attachmentPreviewFile(context, "s1", "m1", 0, "report.pdf")

        clickAttachment("report.pdf")
        val intent = awaitStartedActivity()

        assertEquals("打开只应下载一次", 1, files.downloads.size)
        assertTrue("交接的文件应留在预览缓存里", cached.isFile)
        assertEquals(Intent.ACTION_VIEW, intent.action)
        assertEquals("application/pdf", intent.type)
        assertEquals("content", intent.data?.scheme)
        assertEquals("${context.packageName}.fileprovider", intent.data?.authority)
        assertTrue(intent.data?.path?.startsWith("/attachment-preview/") == true)
        assertTrue(intent.data?.path?.endsWith("/report.pdf") == true)
        assertEquals("report.pdf", intent.clipData?.description?.label)
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertTrue(intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertNull("有接收方时不得打开另存为", nextDocumentRequest())
    }

    @Test
    fun `an octet stream docx is handed off with the word document type`() {
        val word = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        val files = show(AttachmentSpec("report.docx", "application/octet-stream", word))

        clickAttachment("report.docx")
        val intent = awaitStartedActivity()

        assertEquals("外派应使用后缀纠正后的类型，而不是 octet-stream", word, intent.type)
        assertEquals(1, files.downloads.size)
        assertNull("有接收方时不得打开另存为", nextDocumentRequest())
    }

    @Test
    fun `without an installed viewer the cached bytes go to save-as`() {
        val files = show(AttachmentSpec("report.pdf", "application/pdf", viewerMime = null))
        val cached = attachmentPreviewFile(context, "s1", "m1", 0, "report.pdf")
        val saved = File(context.cacheDir, "saved-report.pdf")

        val expectedHandoff = localFileViewIntent(context, cached, "application/pdf", "report.pdf")
        assertNull("没有安装查看器时不得解析到 activity", context.packageManager.resolveActivity(expectedHandoff, 0))
        clickAttachment("report.pdf")
        compose.waitUntil(timeoutMillis = 5_000) { files.downloads.size == 1 }
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithText("没有能打开该文件的系统应用，请选择保存位置")
                .fetchSemanticsNodes().isNotEmpty()
        }

        val started = shadowOf(compose.activity).nextStartedActivityForResult
        assertNotNull("没有接收方时应打开另存为", started)
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, started.intent.action)
        shadowOf(compose.activity).receiveResult(
            started.intent,
            Activity.RESULT_OK,
            Intent().setData(Uri.fromFile(saved)),
        )
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithText("原件已保存").fetchSemanticsNodes().isNotEmpty()
        }

        assertArrayEquals(bytes, saved.readBytes())
        assertEquals("回落另存不得再次下载", 1, files.downloads.size)
        assertTrue("缓存字节保留给下一次打开清扫", cached.isFile)
    }

    @Test
    fun `reopening the same pdf reuses the cached bytes without downloading again`() {
        val files = show(pdf("report.pdf"))

        clickAttachment("report.pdf")
        assertEquals(Intent.ACTION_VIEW, awaitStartedActivity().action)
        clickAttachment("report.pdf")
        assertEquals(Intent.ACTION_VIEW, awaitStartedActivity().action)

        assertEquals("同一附件重复打开只应下载一次", 1, files.downloads.size)
    }

    @Test
    fun `a later external open sweeps the file handed to the earlier receiver`() {
        val files = show(pdf("first.pdf"), pdf("second.pdf"))
        val first = attachmentPreviewFile(context, "s1", "m1", 0, "first.pdf")
        val second = attachmentPreviewFile(context, "s1", "m1", 1, "second.pdf")

        clickAttachment("first.pdf")
        assertEquals(Intent.ACTION_VIEW, awaitStartedActivity().action)
        assertTrue("交接后不得立刻删除接收方可能仍在读的文件", first.isFile)

        clickAttachment("second.pdf")
        assertEquals(Intent.ACTION_VIEW, awaitStartedActivity().action)

        assertEquals(2, files.downloads.size)
        assertFalse("下一次外派打开应清掉上一份缓存", first.exists())
        assertTrue(second.isFile)
    }

    @Test
    fun `the handoff asks for no storage permission`() {
        val requested = context.packageManager
            .getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS)
            .requestedPermissions.orEmpty().toSet()

        assertFalse(requested.contains(Manifest.permission.READ_EXTERNAL_STORAGE))
        assertFalse(requested.contains(Manifest.permission.WRITE_EXTERNAL_STORAGE))
    }
}
