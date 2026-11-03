package me.rerere.rikkahub.data.remote

import com.sun.net.httpserver.HttpServer
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.InetSocketAddress
import java.nio.file.Files
import java.util.Collections
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class RemoteAppUpdateTest {
    private lateinit var server: HttpServer
    private lateinit var directory: File
    private val requestPaths = Collections.synchronizedList(mutableListOf<String>())

    @Before
    fun start() {
        requestPaths.clear()
        directory = Files.createTempDirectory("app-update-test").toFile()
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.start()
    }

    @After
    fun stop() {
        server.stop(0)
        directory.deleteRecursively()
    }

    @Test
    fun `newer package downloads from the origin root and reports progress`() = runTest {
        val bytes = zipBytes()
        server.createContext("/") { exchange ->
            requestPaths += exchange.requestURI.path
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        val update = update(installedVersion = 191, availableVersion = 192)

        val statuses = update.download().toList()

        assertEquals(listOf("/downloads/ourfairy-v1-arm64-release.apk"), requestPaths)
        val ready = statuses.filterIsInstance<AppUpdateStatus.Ready>().single()
        assertEquals(192, ready.versionCode)
        assertEquals("2.5.7", ready.versionName)
        assertArrayEquals(bytes, ready.file.readBytes())
        assertTrue(ready.file.parentFile == directory)
        val progress = statuses.filterIsInstance<AppUpdateStatus.Downloading>()
        assertTrue(progress.isNotEmpty())
        assertEquals(bytes.size.toLong(), progress.last().downloadedBytes)
        assertEquals(bytes.size.toLong(), progress.last().totalBytes)
    }

    @Test
    fun `current package removes an older downloaded update`() = runTest {
        val bytes = zipBytes()
        server.createContext("/") { exchange ->
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        update(installedVersion = 191, availableVersion = 192).download().toList()
        assertTrue(directory.listFiles().orEmpty().any { it.extension == "apk" })

        val statuses = update(installedVersion = 192, availableVersion = 192).download().toList()

        assertEquals(192, statuses.filterIsInstance<AppUpdateStatus.Current>().single().versionCode)
        assertTrue(directory.listFiles().orEmpty().none { it.extension == "apk" || it.extension == "part" })
    }

    @Test
    fun `cancelling the download interrupts the call and removes partial bytes`() = kotlinx.coroutines.runBlocking {
        val bytes = zipBytes()
        val started = java.util.concurrent.CountDownLatch(1)
        val release = java.util.concurrent.CountDownLatch(1)
        val callCancelled = java.util.concurrent.CountDownLatch(1)
        val client = OkHttpClient.Builder()
            .eventListener(object : okhttp3.EventListener() {
                override fun canceled(call: okhttp3.Call) {
                    callCancelled.countDown()
                }
            })
            .build()
        server.createContext("/") { exchange ->
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { output ->
                output.write(bytes[0].toInt())
                output.flush()
                started.countDown()
                release.await(5, java.util.concurrent.TimeUnit.SECONDS)
            }
        }
        val job = launch {
            RemoteAppUpdate(
                identityEndpoint = "http://127.0.0.1:${server.address.port}/ourfairy",
                client = client,
                directory = directory,
                installed = AppPackageMetadata(PACKAGE_NAME, 191, "2.5.6"),
                inspect = { AppPackageMetadata(PACKAGE_NAME, 192, "2.5.7") },
            ).download().toList()
        }
        kotlinx.coroutines.yield()

        try {
            assertTrue(started.await(5, java.util.concurrent.TimeUnit.SECONDS))
            job.cancel()
            assertTrue(callCancelled.await(1, java.util.concurrent.TimeUnit.SECONDS))
            job.join()
            assertTrue(job.isCancelled)
            assertTrue(directory.listFiles().orEmpty().none { it.extension == "part" })
        } finally {
            release.countDown()
            job.cancel()
        }
    }

    @Test
    fun `empty endpoint reports an update error without making a request`() = runTest {
        val update = update(installedVersion = 191, availableVersion = 192, identityEndpoint = "")

        val error = runCatching { update.download().toList() }.exceptionOrNull()

        assertTrue(error is RemoteAppUpdateException)
        assertEquals("Update server is not configured", error?.message)
        assertEquals(emptyList<String>(), requestPaths)
    }

    @Test
    fun `an older server package is reported and leaves no downloaded file`() = runTest {
        val bytes = zipBytes()
        server.createContext("/") { exchange ->
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        val update = update(installedVersion = 192, availableVersion = 191)

        val statuses = update.download().toList()

        val older = statuses.filterIsInstance<AppUpdateStatus.ServerOlder>().single()
        assertEquals(191, older.versionCode)
        assertEquals("2.5.7", older.versionName)
        assertNoDownloadedFiles()
    }

    @Test
    fun `a failed response is reported and leaves no staged file`() = runTest {
        server.createContext("/") { exchange ->
            exchange.sendResponseHeaders(500, -1)
            exchange.close()
        }

        val error = runCatching { update(installedVersion = 191, availableVersion = 192).download().toList() }.exceptionOrNull()

        assertTrue("unexpected error: $error", error is RemoteAppUpdateException)
        assertEquals("Update download returned 500", error?.message)
        assertNoDownloadedFiles()
    }

    @Test
    fun `a retry starts a new full request without a range`() = runTest {
        val bytes = zipBytes()
        val requests = java.util.concurrent.atomic.AtomicInteger()
        val ranges = Collections.synchronizedList(mutableListOf<String?>())
        server.createContext("/") { exchange ->
            ranges += exchange.requestHeaders.getFirst("Range")
            if (requests.incrementAndGet() == 1) {
                exchange.sendResponseHeaders(500, -1)
                exchange.close()
            } else {
                exchange.sendResponseHeaders(200, bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
            }
        }
        val update = update(installedVersion = 191, availableVersion = 192)

        val failure = runCatching { update.download().toList() }.exceptionOrNull()
        val statuses = update.download().toList()

        assertTrue(failure is RemoteAppUpdateException)
        assertEquals(2, requests.get())
        assertEquals(listOf(null, null), ranges)
        assertArrayEquals(bytes, statuses.filterIsInstance<AppUpdateStatus.Ready>().single().file.readBytes())
    }

    @Test
    fun `a response without a content length is rejected and leaves no staged file`() = runTest {
        val bytes = zipBytes()
        server.createContext("/") { exchange ->
            exchange.sendResponseHeaders(200, 0)
            exchange.responseBody.use { it.write(bytes) }
        }

        val error = runCatching { update(installedVersion = 191, availableVersion = 192).download().toList() }.exceptionOrNull()

        assertTrue("unexpected error: $error", error is RemoteAppUpdateException)
        assertEquals("Update download has invalid length -1", error?.message)
        assertNoDownloadedFiles()
    }

    @Test
    fun `an oversized content length is rejected and leaves no staged file`() = runTest {
        server.createContext("/") { exchange ->
            exchange.sendResponseHeaders(200, 256L * 1024 * 1024 + 1)
            exchange.close()
        }

        val error = runCatching { update(installedVersion = 191, availableVersion = 192).download().toList() }.exceptionOrNull()

        assertTrue("unexpected error: $error", error is RemoteAppUpdateException)
        assertEquals("Update download has invalid length 268435457", error?.message)
        assertNoDownloadedFiles()
    }

    @Test
    fun `a truncated body fails the download and leaves no staged file`() = runTest {
        val bytes = zipBytes()
        server.createContext("/") { exchange ->
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.write(bytes.copyOf(bytes.size - 5))
            exchange.responseBody.flush()
            exchange.close()
        }

        val error = runCatching { update(installedVersion = 191, availableVersion = 192).download().toList() }.exceptionOrNull()

        assertTrue("unexpected error: $error", error is IOException)
        assertNoDownloadedFiles()
    }

    @Test
    fun `a body that is not a zip fails the download and leaves no staged file`() = runTest {
        val bytes = "this is not an apk archive".toByteArray()
        server.createContext("/") { exchange ->
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }

        val error = runCatching { update(installedVersion = 191, availableVersion = 192).download().toList() }.exceptionOrNull()

        assertTrue("unexpected error: $error", error is IOException)
        assertNoDownloadedFiles()
    }

    @Test
    fun `an unreadable package is rejected and leaves no staged file`() = runTest {
        val bytes = zipBytes()
        server.createContext("/") { exchange ->
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        val update = update(installedVersion = 191, availableVersion = 192, inspect = { null })

        val error = runCatching { update.download().toList() }.exceptionOrNull()

        assertTrue("unexpected error: $error", error is RemoteAppUpdateException)
        assertEquals("Update package is unreadable", error?.message)
        assertNoDownloadedFiles()
    }

    @Test
    fun `a package with another application id is rejected and leaves no staged file`() = runTest {
        val bytes = zipBytes()
        server.createContext("/") { exchange ->
            exchange.sendResponseHeaders(200, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        val update = update(installedVersion = 191, availableVersion = 192, availablePackageName = "com.other.app")

        val error = runCatching { update.download().toList() }.exceptionOrNull()

        assertTrue("unexpected error: $error", error is RemoteAppUpdateException)
        assertEquals("Update package has a different application id", error?.message)
        assertNoDownloadedFiles()
    }

    private fun update(
        installedVersion: Long,
        availableVersion: Long,
        identityEndpoint: String = "http://127.0.0.1:${server.address.port}/ourfairy",
        availablePackageName: String = PACKAGE_NAME,
        inspect: ((File) -> AppPackageMetadata?)? = null,
    ): RemoteAppUpdate = RemoteAppUpdate(
        identityEndpoint = identityEndpoint,
        client = OkHttpClient(),
        directory = directory,
        installed = AppPackageMetadata(PACKAGE_NAME, installedVersion, "2.5.6"),
        inspect = inspect ?: { AppPackageMetadata(availablePackageName, availableVersion, "2.5.7") },
    )

    private fun assertNoDownloadedFiles() {
        val leftovers = directory.listFiles().orEmpty().filter { it.extension == "apk" || it.extension == "part" }
        assertTrue("leftover files: $leftovers", leftovers.isEmpty())
    }

    private fun zipBytes(): ByteArray {
        val output = ByteArrayOutputStream()
        ZipOutputStream(output).use { zip ->
            zip.putNextEntry(ZipEntry("AndroidManifest.xml"))
            zip.write(byteArrayOf(1, 2, 3, 4))
            zip.closeEntry()
        }
        return output.toByteArray()
    }

    private companion object {
        const val PACKAGE_NAME = "me.rerere.rikkahub"
    }
}
