package me.rerere.rikkahub.ui.identity

import android.Manifest
import android.app.Activity
import android.app.Application
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import androidx.core.content.FileProvider
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
 * The transcript's PDF/Office click, observed through the real panel: one authenticated download
 * into the preview cache, handed to the system as a content URI through the chooser. A device with
 * no receiver falls back to save-as from those same bytes, and a later external open sweeps the
 * file the earlier receiver may still be reading.
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
        // FileProvider caches path strategies per authority in a static map while Robolectric
        // gives every test its own cache directory.
        FileProvider::class.java.getDeclaredField("sCache").apply { isAccessible = true }
            .get(null).let { (it as HashMap<*, *>).clear() }
    }

    @After
    fun close() {
        scope.cancel()
    }

    private fun show(
        vararg names: String,
        launchExternal: (Intent) -> Unit,
    ): Files {
        val attachments = names.mapIndexed { index, name ->
            RemoteChatAttachment(index, 1, name, "application/pdf", bytes.size.toLong())
        }
        val projection = RemoteChatProjection(
            sessionId = "s1", generation = "g1", version = 1, cursor = 0, durableThroughSeq = 0,
            messages = listOf(RemoteChatMessage("m1", 0, 0, null, 1, 2, "附件", attachments)),
            throughSeq = 0, fromSeq = 0, events = listOf(remoteEvent(0)),
        )
        val files = Files(bytes)
        val state = RemoteChatState(Chat(projection), scope, store, "https://fairy", attachmentsBackend = files)
        state.bind("token", "s1", 1)
        compose.setContent {
            FairyAppTheme {
                RemoteChatPanel(state = state, onReconnect = {}, launchExternal = launchExternal)
            }
        }
        compose.waitForIdle()
        return files
    }

    private fun clickAttachment(name: String) {
        compose.onNodeWithText("$name · ${attachmentSizeLabel(bytes.size.toLong())}").performClick()
    }

    @Suppress("DEPRECATION")
    private fun chooserTarget(chooser: Intent): Intent =
        chooser.getParcelableExtra(Intent.EXTRA_INTENT) ?: error("chooser 缺少目标意图")

    @Test
    fun `clicking a pdf downloads once and hands the cached file to the system`() {
        val launched = mutableListOf<Intent>()
        val files = show("report.pdf", launchExternal = { launched += it })
        val cached = attachmentPreviewFile(context, "s1", "m1", 0, "report.pdf")

        clickAttachment("report.pdf")
        compose.waitUntil(timeoutMillis = 5_000) { launched.isNotEmpty() }

        assertEquals("打开只应下载一次", 1, files.downloads.size)
        assertTrue("交接的文件应留在预览缓存里", cached.isFile)
        val target = chooserTarget(launched.single())
        assertEquals(Intent.ACTION_VIEW, target.action)
        assertEquals("application/pdf", target.type)
        assertEquals("content", target.data?.scheme)
        assertEquals("${context.packageName}.fileprovider", target.data?.authority)
        assertTrue(target.data?.path?.startsWith("/attachment-preview/") == true)
        assertTrue(target.data?.path?.endsWith("/report.pdf") == true)
        assertEquals("report.pdf", target.clipData?.description?.label)
        assertTrue(target.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertTrue(target.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertNull("有接收方时不得打开另存为", shadowOf(compose.activity).nextStartedActivityForResult)
    }

    @Test
    fun `without an installed viewer the cached bytes go to save-as`() {
        val files = show("report.pdf", launchExternal = { throw ActivityNotFoundException() })
        val cached = attachmentPreviewFile(context, "s1", "m1", 0, "report.pdf")
        val saved = File(context.cacheDir, "saved-report.pdf")

        clickAttachment("report.pdf")
        compose.waitUntil(timeoutMillis = 5_000) { files.downloads.size == 1 }
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithText("没有能打开该文件的系统应用，已改为另存为")
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
        val launched = mutableListOf<Intent>()
        val files = show("report.pdf", launchExternal = { launched += it })

        clickAttachment("report.pdf")
        compose.waitUntil(timeoutMillis = 5_000) { launched.size == 1 }
        compose.waitForIdle()
        clickAttachment("report.pdf")
        compose.waitUntil(timeoutMillis = 5_000) { launched.size == 2 }

        assertEquals("同一附件重复打开只应下载一次", 1, files.downloads.size)
    }

    @Test
    fun `a later external open sweeps the file handed to the earlier receiver`() {
        val launched = mutableListOf<Intent>()
        val files = show("first.pdf", "second.pdf", launchExternal = { launched += it })
        val first = attachmentPreviewFile(context, "s1", "m1", 0, "first.pdf")
        val second = attachmentPreviewFile(context, "s1", "m1", 1, "second.pdf")

        clickAttachment("first.pdf")
        compose.waitUntil(timeoutMillis = 5_000) { launched.size == 1 }
        assertTrue("交接后不得立刻删除接收方可能仍在读的文件", first.isFile)

        clickAttachment("second.pdf")
        compose.waitUntil(timeoutMillis = 5_000) { launched.size == 2 }

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
