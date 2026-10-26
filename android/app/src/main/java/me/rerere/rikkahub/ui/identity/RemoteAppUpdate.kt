package me.rerere.rikkahub.ui.identity

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.core.net.toUri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch
import me.rerere.rikkahub.BuildConfig
import me.rerere.rikkahub.data.remote.AppUpdateFailure
import me.rerere.rikkahub.data.remote.AppUpdateStatus
import me.rerere.rikkahub.data.remote.RemoteAppUpdate
import me.rerere.rikkahub.data.remote.RemoteAppUpdateException
import me.rerere.rikkahub.ui.fairy.LocalFairyTokens
import org.koin.compose.koinInject
import java.io.File
import java.io.IOException

/**
 * 应用内更新的界面状态。[AppUpdateStatus] 是下载层的事实，这里只把它翻译成
 * 用户能看懂的下一步：检查、下载、已最新、服务器更旧、可安装或失败。
 */
internal sealed interface AppUpdateUiState {
    /** 还没有开始检查。 */
    data object Idle : AppUpdateUiState

    /** 已发起请求，尚未收到服务器的进度。 */
    data object Working : AppUpdateUiState

    /** 下载中，带已下载与总字节数。 */
    data class Downloading(val downloadedBytes: Long, val totalBytes: Long) : AppUpdateUiState

    /** 安装包已就绪，等用户点安装。[needsInstallPermission] 表示系统还没授权安装未知来源。 */
    data class Ready(
        val file: File,
        val versionName: String?,
        val needsInstallPermission: Boolean = false,
    ) : AppUpdateUiState

    /** 服务器上的版本与当前一致。 */
    data class Current(val versionName: String?) : AppUpdateUiState

    /** 服务器上的版本比当前更旧。 */
    data class ServerOlder(val versionName: String?) : AppUpdateUiState

    /** 失败，消息对用户可见，[message] 可恢复时可重试。 */
    data class Failed(val message: String) : AppUpdateUiState
}

/**
 * 交给系统安装器的 Intent。安装包只能以 FileProvider 的 content URI 交给系统，
 * 否则 Android 会拒绝读取（File URI 跨进程被禁止）。
 */
internal fun appInstallIntent(context: Context, apk: File): Intent {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", apk)
    return Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        clipData = ClipData.newRawUri(apk.name, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
}

/** 系统里“允许安装未知来源应用”的页面，带上本应用的包名。 */
internal fun unknownSourcesIntent(context: Context): Intent =
    Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, "package:${context.packageName}".toUri())

/**
 * 把安装包交给系统安装器。系统里没有安装器时返回可展示的错误文案，否则返回 null。
 * [launch] 是接缝：线上交给系统设置页，测试可以换成抛异常的假实现。
 */
internal fun launchInstall(
    context: Context,
    apk: File,
    launch: (Intent) -> Unit = { context.startActivity(it) },
): String? = try {
    launch(appInstallIntent(context, apk))
    null
} catch (missing: ActivityNotFoundException) {
    "未找到系统安装程序"
}

/**
 * 打开未知来源授权页。系统里没有该页面时返回可展示的错误文案，否则返回 null。
 */
internal fun launchInstallSettings(
    context: Context,
    launch: (Intent) -> Unit = { context.startActivity(it) },
): String? = try {
    val intent = unknownSourcesIntent(context)
    if (context !is Activity) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    launch(intent)
    null
} catch (missing: ActivityNotFoundException) {
    "未找到系统设置页"
}

/**
 * 设置页里的应用内更新入口。下载在页面自己的协程作用域里进行，离开页面即取消；
 * 安装始终由用户点按触发，下载完成不会自动拉起安装器。
 */
@Composable
fun RemoteAppUpdateEntry(update: RemoteAppUpdate = koinInject()) {
    RemoteAppUpdateContent(statuses = { update.download() })
}

/**
 * [RemoteAppUpdateEntry] 的可测试形态：状态来源由调用方给出，其余行为与线上一致。
 */
@Composable
internal fun RemoteAppUpdateContent(
    statuses: () -> Flow<AppUpdateStatus>,
    installedVersion: String = BuildConfig.VERSION_NAME,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var state by remember { mutableStateOf<AppUpdateUiState>(AppUpdateUiState.Idle) }
    var downloading by remember { mutableStateOf<Job?>(null) }

    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, event ->
            val ready = state as? AppUpdateUiState.Ready
            if (
                event == Lifecycle.Event.ON_RESUME &&
                ready?.needsInstallPermission == true &&
                context.packageManager.canRequestPackageInstalls()
            ) {
                state = ready.copy(needsInstallPermission = false)
            }
        }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }

    fun start() {
        if (downloading?.isActive == true) return
        state = AppUpdateUiState.Working
        downloading = scope.launch {
            try {
                statuses().collect { status ->
                    state = when (status) {
                        is AppUpdateStatus.Downloading -> AppUpdateUiState.Downloading(
                            status.downloadedBytes,
                            status.totalBytes,
                        )

                        is AppUpdateStatus.Ready -> AppUpdateUiState.Ready(status.file, status.versionName)
                        is AppUpdateStatus.Current -> AppUpdateUiState.Current(status.versionName)
                        is AppUpdateStatus.ServerOlder -> AppUpdateUiState.ServerOlder(status.versionName)
                    }
                }
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: Exception) {
                val message = when (error) {
                    is RemoteAppUpdateException -> when (error.failure) {
                        AppUpdateFailure.CONFIGURATION -> "未配置更新服务器"
                        AppUpdateFailure.SERVER -> "服务器暂未提供可下载的更新包"
                        AppUpdateFailure.PACKAGE -> "下载的安装包无效，请联系发布者"
                        AppUpdateFailure.STORAGE -> "设备存储不可用，请释放空间后重试"
                    }

                    is IOException -> "下载失败，请检查网络后重试"
                    else -> "更新失败，请稍后重试"
                }
                state = AppUpdateUiState.Failed(message)
            }
        }
    }

    fun cancel() {
        downloading?.cancel()
        downloading = null
        state = AppUpdateUiState.Idle
    }

    fun install() {
        val ready = state as? AppUpdateUiState.Ready ?: return
        if (!ready.file.exists()) {
            state = AppUpdateUiState.Failed("安装包已丢失，请重新下载")
            return
        }
        if (!context.packageManager.canRequestPackageInstalls()) {
            state = ready.copy(needsInstallPermission = true)
            return
        }
        val failure = launchInstall(context, ready.file)
        state = if (failure == null) ready.copy(needsInstallPermission = false) else AppUpdateUiState.Failed(failure)
    }

    fun openInstallSettings() {
        launchInstallSettings(context)?.let { state = AppUpdateUiState.Failed(it) }
    }

    RemoteAppUpdatePanel(
        state = state,
        installedVersion = installedVersion,
        onCheck = ::start,
        onCancel = ::cancel,
        onInstall = ::install,
        onOpenInstallSettings = ::openInstallSettings,
    )
}

/**
 * 无状态的应用内更新面板：当前版本、进行中的动作与对应的按钮。下载中提供取消，
 * 失败提供重试，可安装时提供安装与授权入口。
 */
@Composable
internal fun RemoteAppUpdatePanel(
    state: AppUpdateUiState,
    installedVersion: String,
    onCheck: () -> Unit,
    onCancel: () -> Unit,
    onInstall: () -> Unit,
    onOpenInstallSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val tokens = LocalFairyTokens.current
    Column(
        modifier = modifier.fillMaxWidth(),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(
            text = "已安装版本 $installedVersion",
            style = MaterialTheme.typography.bodyMedium,
            color = tokens.textPrimary,
        )
        when (state) {
            AppUpdateUiState.Idle -> {
                Text(
                    text = "检查更新会先下载完整安装包并检查版本，需要更新时由你确认安装。",
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.textMuted,
                )
                Button(onClick = onCheck) { Text("检查更新") }
            }

            AppUpdateUiState.Working -> Text(
                text = "正在检查更新…",
                style = MaterialTheme.typography.bodyMedium,
                color = tokens.textMuted,
            )

            is AppUpdateUiState.Downloading -> {
                val total = state.totalBytes.coerceAtLeast(1L)
                LinearProgressIndicator(
                    progress = { (state.downloadedBytes.toFloat() / total).coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth().height(4.dp),
                )
                Text(
                    text = "已下载 ${state.downloadedBytes} / ${state.totalBytes} 字节",
                    style = MaterialTheme.typography.bodySmall,
                    color = tokens.textMuted,
                )
                OutlinedButton(onClick = onCancel) { Text("取消") }
            }

            is AppUpdateUiState.Ready -> {
                Text(
                    text = state.versionName?.let { "可安装版本 $it" } ?: "可安装版本",
                    style = MaterialTheme.typography.bodyMedium,
                    color = tokens.textPrimary,
                )
                if (state.needsInstallPermission) {
                    Text(
                        text = "需要先允许安装未知来源应用，回到这里再点安装。",
                        style = MaterialTheme.typography.bodySmall,
                        color = tokens.danger,
                    )
                }
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    if (state.needsInstallPermission) {
                        OutlinedButton(onClick = onOpenInstallSettings) { Text("去授权安装") }
                    }
                    Button(onClick = onInstall) { Text("安装") }
                }
            }

            is AppUpdateUiState.Current -> Text(
                text = "已是最新版本",
                style = MaterialTheme.typography.bodyMedium,
                color = tokens.textMuted,
            )

            is AppUpdateUiState.ServerOlder -> Text(
                text = state.versionName?.let { "服务器版本更旧（$it），保持当前版本" }
                    ?: "服务器版本更旧，保持当前版本",
                style = MaterialTheme.typography.bodyMedium,
                color = tokens.textMuted,
            )

            is AppUpdateUiState.Failed -> {
                Text(
                    text = state.message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = tokens.danger,
                )
                Button(onClick = onCheck) { Text("重试") }
            }
        }
    }
}
