package me.rerere.rikkahub.data.remote

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.content.pm.PackageInfoCompat
import java.io.File
import java.io.IOException
import java.util.zip.ZipFile
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.launch
import okhttp3.Call
import okhttp3.Callback
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

sealed interface AppUpdateStatus {
    data class Downloading(val downloadedBytes: Long, val totalBytes: Long) : AppUpdateStatus

    data class Ready(val file: File, val versionCode: Long, val versionName: String?) : AppUpdateStatus

    data class Current(val versionCode: Long, val versionName: String?) : AppUpdateStatus

    data class ServerOlder(val versionCode: Long, val versionName: String?) : AppUpdateStatus
}

internal data class AppPackageMetadata(
    val packageName: String,
    val versionCode: Long,
    val versionName: String?,
)

internal class RemoteAppUpdateException(message: String, cause: Throwable? = null) : IOException(message, cause)

class RemoteAppUpdate internal constructor(
    private val identityEndpoint: String,
    private val client: OkHttpClient,
    private val directory: File,
    private val installed: AppPackageMetadata,
    private val inspect: (File) -> AppPackageMetadata?,
) {
    constructor(context: Context, client: OkHttpClient, identityEndpoint: String) : this(
        identityEndpoint = identityEndpoint,
        client = client,
        directory = File(context.cacheDir, "app-update"),
        installed = installedPackage(context),
        inspect = { file -> archivePackage(context, file) },
    )

    fun download(): Flow<AppUpdateStatus> = callbackFlow {
        if (identityEndpoint.isBlank()) throw RemoteAppUpdateException("Update server is not configured")
        val baseUrl = try {
            identityEndpoint.toHttpUrl()
        } catch (invalid: IllegalArgumentException) {
            throw RemoteAppUpdateException("Update server address is invalid", invalid)
        }
        if (!directory.isDirectory && !directory.mkdirs()) {
            throw RemoteAppUpdateException("Update storage is unavailable")
        }
        val staged = File(directory, "download.part")
        val target = File(directory, "latest.apk")
        staged.delete()
        val request = Request.Builder()
            .url(baseUrl.newBuilder()
                .encodedPath(DOWNLOAD_PATH)
                .query(null)
                .fragment(null)
                .build())
            .get()
            .build()
        val call = client.newCall(request)
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                close(e)
            }

            override fun onResponse(call: Call, response: Response) {
                launch {
                    try {
                        response.use {
                            if (!it.isSuccessful) throw RemoteAppUpdateException("Update download returned ${it.code}")
                            val total = it.body.contentLength()
                            if (total !in 1..MAX_APK_BYTES) {
                                throw RemoteAppUpdateException("Update download has invalid length $total")
                            }
                            var downloaded = 0L
                            var reported = 0L
                            val progressStep = (total / 100).coerceAtLeast(MIN_PROGRESS_STEP)
                            staged.outputStream().buffered().use { output ->
                                it.body.byteStream().use { input ->
                                    val buffer = ByteArray(COPY_BUFFER)
                                    while (true) {
                                        currentCoroutineContext().ensureActive()
                                        val read = input.read(buffer)
                                        if (read < 0) break
                                        downloaded += read
                                        if (downloaded > total) {
                                            throw RemoteAppUpdateException("Update download exceeded $total bytes")
                                        }
                                        output.write(buffer, 0, read)
                                        if (downloaded - reported >= progressStep || downloaded == total) {
                                            reported = downloaded
                                            send(AppUpdateStatus.Downloading(downloaded, total))
                                        }
                                    }
                                }
                            }
                            if (downloaded != total) {
                                throw RemoteAppUpdateException("Update download stopped at $downloaded of $total bytes")
                            }
                        }

                        ZipFile(staged).use { }
                        val available = inspect(staged) ?: throw RemoteAppUpdateException("Update package is unreadable")
                        if (available.packageName != installed.packageName) {
                            throw RemoteAppUpdateException("Update package has a different application id")
                        }
                        when {
                            available.versionCode == installed.versionCode -> {
                                staged.delete()
                                if (target.exists() && !target.delete()) {
                                    throw RemoteAppUpdateException("Update storage is unavailable")
                                }
                                send(AppUpdateStatus.Current(available.versionCode, available.versionName))
                            }

                            available.versionCode < installed.versionCode -> {
                                staged.delete()
                                if (target.exists() && !target.delete()) {
                                    throw RemoteAppUpdateException("Update storage is unavailable")
                                }
                                send(AppUpdateStatus.ServerOlder(available.versionCode, available.versionName))
                            }

                            else -> {
                                if (target.exists() && !target.delete()) {
                                    throw RemoteAppUpdateException("Update storage is unavailable")
                                }
                                if (!staged.renameTo(target)) {
                                    throw RemoteAppUpdateException("Update storage is unavailable")
                                }
                                send(AppUpdateStatus.Ready(target, available.versionCode, available.versionName))
                            }
                        }
                        close()
                    } catch (cancelled: CancellationException) {
                        throw cancelled
                    } catch (error: Exception) {
                        staged.delete()
                        close(error)
                    } finally {
                        staged.delete()
                    }
                }
            }
        })
        awaitClose { call.cancel() }
    }.flowOn(Dispatchers.IO)

    private companion object {
        const val DOWNLOAD_PATH = "/downloads/ourfairy-v1-arm64-release.apk"
        const val MAX_APK_BYTES = 256L * 1024 * 1024
        const val MIN_PROGRESS_STEP = 64L * 1024
        const val COPY_BUFFER = 64 * 1024
    }
}

private fun installedPackage(context: Context): AppPackageMetadata {
    val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.packageManager.getPackageInfo(context.packageName, PackageManager.PackageInfoFlags.of(0))
    } else {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageInfo(context.packageName, 0)
    }
    return AppPackageMetadata(info.packageName, PackageInfoCompat.getLongVersionCode(info), info.versionName)
}

private fun archivePackage(context: Context, file: File): AppPackageMetadata? {
    val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        context.packageManager.getPackageArchiveInfo(file.absolutePath, PackageManager.PackageInfoFlags.of(0))
    } else {
        @Suppress("DEPRECATION")
        context.packageManager.getPackageArchiveInfo(file.absolutePath, 0)
    } ?: return null
    return AppPackageMetadata(info.packageName, PackageInfoCompat.getLongVersionCode(info), info.versionName)
}
