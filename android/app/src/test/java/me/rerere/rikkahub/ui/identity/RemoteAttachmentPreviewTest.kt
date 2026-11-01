package me.rerere.rikkahub.ui.identity

import android.app.Activity
import android.app.Application
import android.content.Intent
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
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
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.koin.core.context.startKoin
import org.koin.core.context.stopKoin
import org.koin.dsl.module
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The transcript's attachment click, observed through the real panel: an image opens the existing
 * full-screen viewer from one cached download, text opens the in-app read-only preview from the
 * same cache (over 2 MiB text and PDF/Office are handed to an installed system app), unknown types
 * keep save-as, and closing either preview deletes only the preview cache.
 */
@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemoteAttachmentPreviewTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    @get:Rule val temporaryFolder = TemporaryFolder()

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val context = ApplicationProvider.getApplicationContext<Application>()

    /** A 1x1 PNG, so the viewer's painter has real bytes to decode. */
    private val png = android.util.Base64.decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        android.util.Base64.DEFAULT,
    )

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
    fun prepareKoin() {
        // The reused viewer resolves an OkHttpClient even though a local path needs no network.
        stopKoin()
        startKoin { modules(module { single { OkHttpClient() } }) }
    }

    @Before
    fun clearPreviewCache() {
        // Every case starts from an empty preview cache; otherwise an earlier case's cached
        // bytes for the same coordinate would be reused by a later case that downloads once.
        File(context.cacheDir, "attachment-preview").deleteRecursively()
    }

    @Before
    fun clearProviderCache() {
        clearFileProviderCache()
    }

    @After
    fun close() {
        scope.cancel()
        stopKoin()
    }

    private fun show(
        name: String,
        mime: String,
        content: ByteArray = png,
        recordedBytes: Long = content.size.toLong(),
        viewerMime: String? = null,
    ): Files {
        val attachment = RemoteChatAttachment(0, 1, name, mime, recordedBytes)
        val projection = RemoteChatProjection(
            sessionId = "s1", generation = "g1", version = 1, cursor = 0, durableThroughSeq = 0,
            messages = listOf(RemoteChatMessage("m1", 0, 0, null, 1, 2, "附件", listOf(attachment))),
            throughSeq = 0, fromSeq = 0, events = listOf(remoteEvent(0)),
        )
        viewerMime?.let { handled ->
            // A registered viewer plus resolution checking make startActivity follow the device
            // path: the handoff succeeds only because this app is installed.
            context.requireActivityResolution()
            val cached = attachmentPreviewFile(context, "s1", "m1", 0, name)
            context.registerActivityFor(localFileViewIntent(context, cached, handled, name))
        }
        val files = Files(content)
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

    private fun clickAttachment(chip: String) {
        compose.onNodeWithText(chip).performClick()
    }

    private fun awaitText(text: String) {
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
        }
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

    private fun viewerShown() = compose
        .onAllNodesWithContentDescription("保存图片").fetchSemanticsNodes().isNotEmpty()

    private fun awaitViewer() {
        compose.waitUntil(timeoutMillis = 5_000) { viewerShown() }
    }

    @Test
    fun `clicking an image attachment downloads once and opens the full-screen viewer`() {
        val files = show("cat.png", "image/png")
        val cached = attachmentPreviewFile(context, "s1", "m1", 0, "cat.png")

        clickAttachment("cat.png · ${attachmentSizeLabel(png.size.toLong())}")
        awaitViewer()

        assertEquals(1, files.downloads.size)
        assertTrue("预览应读取缓存文件", cached.isFile)
        assertArrayEquals(png, cached.readBytes())
        // The viewer is an overlay: the conversation it was opened from stays in place.
        compose.onNodeWithText("cat.png · ${attachmentSizeLabel(png.size.toLong())}").assertExists()
    }

    @Test
    fun `saving from the image preview reuses the cached bytes without downloading again`() {
        val files = show("cat.png", "image/png")
        clickAttachment("cat.png · ${attachmentSizeLabel(png.size.toLong())}")
        awaitViewer()
        val saved = File(temporaryFolder.root, "saved.png")

        compose.onNodeWithContentDescription("保存图片").performClick()
        compose.waitForIdle()
        val started = shadowOf(compose.activity).nextStartedActivityForResult
        assertNotNull("保存应交给系统文件选择器", started)
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, started.intent.action)
        shadowOf(compose.activity).receiveResult(
            started.intent,
            Activity.RESULT_OK,
            Intent().setData(Uri.fromFile(saved)),
        )
        compose.waitUntil(timeoutMillis = 5_000) { saved.length() == png.size.toLong() }

        assertArrayEquals(png, saved.readBytes())
        assertEquals("保存不得再次下载", 1, files.downloads.size)
    }

    @Test
    fun `closing the image preview deletes only its cached file`() {
        val cached = File(temporaryFolder.root, "cached-image").apply { writeBytes(png) }
        val saved = File(temporaryFolder.root, "saved.png").apply { writeBytes(png) }
        var visible by mutableStateOf(true)

        compose.setContent {
            FairyAppTheme {
                if (visible) AttachmentImagePreview(cached.absolutePath) { visible = false }
            }
        }
        awaitViewer()

        compose.runOnIdle { visible = false }
        compose.waitForIdle()

        assertFalse("关闭预览应删除缓存文件", cached.exists())
        assertTrue("已另存的文件不受影响", saved.isFile)
    }

    @Test
    fun `a pdf attachment hands the cached file to the system without saving`() {
        val files = show("document.pdf", "application/pdf", viewerMime = "application/pdf")
        val cached = attachmentPreviewFile(context, "s1", "m1", 0, "document.pdf")

        clickAttachment("document.pdf · ${attachmentSizeLabel(png.size.toLong())}")
        val intent = awaitStartedActivity()

        assertEquals("外派只下载一次", 1, files.downloads.size)
        assertTrue("交接的文件应留在预览缓存里", cached.isFile)
        assertEquals(Intent.ACTION_VIEW, intent.action)
        assertFalse("PDF 不走应用内预览", viewerShown())
        assertNull("有接收方时不得另存为", nextDocumentRequest())
    }

    @Test
    fun `an unknown attachment keeps the save-as route without downloading`() {
        val files = show("archive.zip", "application/zip")

        clickAttachment("archive.zip · ${attachmentSizeLabel(png.size.toLong())}")
        compose.waitForIdle()

        assertTrue("未知类型不得预下载", files.downloads.isEmpty())
        assertFalse("未知类型不得进入预览", viewerShown())
        val started = shadowOf(compose.activity).nextStartedActivityForResult
        assertNotNull("未知类型仍走另存为", started)
        assertEquals(Intent.ACTION_CREATE_DOCUMENT, started.intent.action)
    }

    @Test
    fun `clicking a markdown attachment renders it from one cached download`() {
        val markdown = "# 标题\n\n正文".toByteArray()
        val files = show("notes.md", "text/plain", markdown)
        val cached = attachmentPreviewFile(context, "s1", "m1", 0, "notes.md")

        clickAttachment("notes.md · ${attachmentSizeLabel(markdown.size.toLong())}")
        compose.waitUntil(timeoutMillis = 5_000) {
            compose.onAllNodesWithContentDescription("关闭预览").fetchSemanticsNodes().isNotEmpty()
        }
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.onAllNodesWithText("标题").fetchSemanticsNodes().isNotEmpty()
        }
        assertTrue(
            "Markdown 不应仍显示原始符号",
            compose.onAllNodesWithText("# 标题").fetchSemanticsNodes().isEmpty(),
        )

        assertEquals(1, files.downloads.size)
        assertTrue("预览应读取缓存文件", cached.isFile)
        assertArrayEquals(markdown, cached.readBytes())
    }

    @Test
    fun `clicking a plain text attachment shows its body with line breaks kept`() {
        val body = "第一行\n    缩进行\n最后一行"
        val text = body.toByteArray()
        val files = show("notes.txt", "text/plain", text)

        clickAttachment("notes.txt · ${attachmentSizeLabel(text.size.toLong())}")
        awaitText(body)

        assertEquals(1, files.downloads.size)
    }

    @Test
    fun `an undecodable text attachment shows an explicit failure state`() {
        val bytes = byteArrayOf(0xFF.toByte(), 0xFF.toByte())
        show("notes.txt", "text/plain", bytes)

        clickAttachment("notes.txt · ${attachmentSizeLabel(bytes.size.toLong())}")
        awaitText("无法解码")
    }

    @Test
    fun `closing the text preview returns to the transcript and deletes only its cached file`() {
        val text = "只读预览".toByteArray()
        val files = show("notes.txt", "text/plain", text)
        val chip = "notes.txt · ${attachmentSizeLabel(text.size.toLong())}"
        val cached = attachmentPreviewFile(context, "s1", "m1", 0, "notes.txt")

        clickAttachment(chip)
        awaitText("只读预览")
        compose.onNodeWithContentDescription("关闭预览").performClick()
        compose.waitForIdle()

        assertFalse("关闭预览应删除缓存文件", cached.exists())
        assertEquals("预览只下载一次", 1, files.downloads.size)
        // The preview is an overlay: the conversation it was opened from stays in place.
        compose.onNodeWithText(chip).assertExists()
    }

    @Test
    fun `a text over two mib is handed off instead of expanded`() {
        val over = TEXT_PREVIEW_MAX_BYTES + 1
        val files = show(
            "big.txt",
            "text/plain",
            "x".toByteArray(),
            recordedBytes = over,
            viewerMime = "text/plain",
        )

        clickAttachment("big.txt · ${attachmentSizeLabel(over)}")
        val intent = awaitStartedActivity()

        assertEquals("超过 2 MiB 的文本应外派并下载一次", 1, files.downloads.size)
        assertTrue(
            "超过 2 MiB 不得进入文本预览",
            compose.onAllNodesWithContentDescription("关闭预览").fetchSemanticsNodes().isEmpty(),
        )
        assertEquals(Intent.ACTION_VIEW, intent.action)
        assertEquals("text/plain", intent.type)
        assertNull("外派不得同时走另存为", nextDocumentRequest())
    }
}
