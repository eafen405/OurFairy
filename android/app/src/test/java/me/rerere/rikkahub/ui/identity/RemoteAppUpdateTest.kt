package me.rerere.rikkahub.ui.identity

import android.Manifest
import android.app.Application
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.core.content.FileProvider
import java.io.File
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import me.rerere.rikkahub.BuildConfig
import me.rerere.rikkahub.R
import me.rerere.rikkahub.data.remote.AppUpdateStatus
import me.rerere.rikkahub.ui.fairy.FairyAppTheme
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
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.xmlpull.v1.XmlPullParser

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class, sdk = [35], qualifiers = "zh-rCN-w411dp-h891dp")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class RemoteAppUpdateTest {
    @get:Rule
    @Suppress("DEPRECATION")
    val compose = createAndroidComposeRule<ComponentActivity>()

    private val context get() = RuntimeEnvironment.getApplication()

    @Before
    fun clearProviderCache() {
        // FileProvider caches the resolved paths per authority in a static map while
        // Robolectric gives every test its own cache directory. A strategy resolved by
        // an earlier test would point at that test's sandbox.
        FileProvider::class.java.getDeclaredField("sCache").apply { isAccessible = true }
            .get(null).let { (it as HashMap<*, *>).clear() }
    }

    private fun apkFile(name: String = "latest.apk"): File {
        val file = File(context.cacheDir, "app-update/$name")
        file.parentFile?.mkdirs()
        file.writeBytes(byteArrayOf(1, 2, 3))
        return file
    }

    @Test
    fun `the install intent hands the package archive to the system installer`() {
        val apk = apkFile()

        val intent = appInstallIntent(context, apk)

        assertEquals(Intent.ACTION_VIEW, intent.action)
        assertEquals("application/vnd.android.package-archive", intent.type)
        assertEquals("content", intent.data?.scheme)
        assertEquals("${context.packageName}.fileprovider", intent.data?.authority)
        assertEquals("/app-update/latest.apk", intent.data?.path)
        assertTrue(intent.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        assertTrue(intent.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)
        assertEquals(intent.data, intent.clipData?.getItemAt(0)?.uri)
    }

    @Test
    fun `the unknown sources intent points at this app's settings page`() {
        val intent = unknownSourcesIntent(context)

        assertEquals(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, intent.action)
        assertEquals("package:${context.packageName}", intent.data.toString())
    }

    @Test
    fun `a missing system installer is reported instead of crashing`() {
        val failure = launchInstall(context, apkFile()) { throw ActivityNotFoundException() }
        val settingsFailure = launchInstallSettings(context) { throw ActivityNotFoundException() }

        assertEquals("未找到系统安装程序", failure)
        assertEquals("未找到系统设置页", settingsFailure)
    }

    @Test
    fun `the manifest asks for install permission and declares a private file provider`() {
        val packageManager = context.packageManager

        assertEquals(
            PackageManager.PERMISSION_GRANTED,
            packageManager.checkPermission(
                Manifest.permission.REQUEST_INSTALL_PACKAGES,
                context.packageName,
            ),
        )
        val provider = packageManager.resolveContentProvider("${context.packageName}.fileprovider", 0)
            ?: error("FileProvider 未注册")
        assertFalse("FileProvider 不得导出", provider.exported)
        assertTrue("FileProvider 必须授予临时读取权限", provider.grantUriPermissions)
    }

    @Test
    fun `the file paths expose only the update cache`() {
        val paths = mutableListOf<Triple<String, String, String>>()
        val parser = context.resources.getXml(R.xml.file_paths)
        var event = parser.eventType
        while (event != XmlPullParser.END_DOCUMENT) {
            if (event == XmlPullParser.START_TAG && parser.name != "paths") {
                paths += Triple(
                    parser.name,
                    parser.getAttributeValue(null, "name") ?: "",
                    parser.getAttributeValue(null, "path") ?: "",
                )
            }
            event = parser.next()
        }
        parser.close()

        assertEquals(listOf(Triple("cache-path", "app-update", "app-update/")), paths)
    }

    @Test
    fun `the panel shows the installed version and offers the check action`() {
        var checks = 0
        compose.setContent {
            FairyAppTheme {
                RemoteAppUpdatePanel(
                    state = AppUpdateUiState.Idle,
                    installedVersion = BuildConfig.VERSION_NAME,
                    onCheck = { checks++ },
                    onCancel = {},
                    onInstall = {},
                    onOpenInstallSettings = {},
                )
            }
        }

        compose.onNodeWithText("已安装版本 ${BuildConfig.VERSION_NAME}").assertIsDisplayed()
        compose.onNodeWithText("检查更新会先下载完整安装包并检查版本，需要更新时由你确认安装。").assertIsDisplayed()
        compose.onNodeWithText("检查更新").performClick()
        assertEquals(1, checks)
    }

    @Test
    fun `the panel reports the current and the older server version`() {
        var state by mutableStateOf<AppUpdateUiState>(AppUpdateUiState.Current("2.5.7"))
        compose.setContent {
            FairyAppTheme {
                RemoteAppUpdatePanel(
                    state = state,
                    installedVersion = BuildConfig.VERSION_NAME,
                    onCheck = {},
                    onCancel = {},
                    onInstall = {},
                    onOpenInstallSettings = {},
                )
            }
        }

        compose.onNodeWithText("已是最新版本").assertIsDisplayed()

        compose.runOnIdle { state = AppUpdateUiState.ServerOlder("2.5.6") }

        compose.onNodeWithText("服务器版本更旧（2.5.6），保持当前版本").assertIsDisplayed()
    }

    @Test
    fun `the panel shows the downloaded bytes and can be cancelled`() {
        var cancelled = 0
        compose.setContent {
            FairyAppTheme {
                RemoteAppUpdatePanel(
                    state = AppUpdateUiState.Downloading(1_048_576, 2_097_152),
                    installedVersion = BuildConfig.VERSION_NAME,
                    onCheck = {},
                    onCancel = { cancelled++ },
                    onInstall = {},
                    onOpenInstallSettings = {},
                )
            }
        }

        compose.onNodeWithText("已下载 1048576 / 2097152 字节").assertIsDisplayed()
        compose.onNodeWithText("取消").performClick()
        assertEquals(1, cancelled)
    }

    @Test
    fun `the panel offers the install action and the permission guidance`() {
        var installs = 0
        var settings = 0
        var state by mutableStateOf<AppUpdateUiState>(AppUpdateUiState.Ready(apkFile(), "2.5.8"))
        compose.setContent {
            FairyAppTheme {
                RemoteAppUpdatePanel(
                    state = state,
                    installedVersion = BuildConfig.VERSION_NAME,
                    onCheck = {},
                    onCancel = {},
                    onInstall = { installs++ },
                    onOpenInstallSettings = { settings++ },
                )
            }
        }

        compose.onNodeWithText("可安装版本 2.5.8").assertIsDisplayed()
        compose.onNodeWithText("安装").performClick()
        assertEquals(1, installs)
        assertEquals(0, settings)

        compose.runOnIdle { state = AppUpdateUiState.Ready(apkFile(), "2.5.8", needsInstallPermission = true) }

        compose.onNodeWithText("去授权安装").assertIsDisplayed()
        compose.onNodeWithText("去授权安装").performClick()
        assertEquals(1, settings)
    }

    @Test
    fun `the panel surfaces a failure and retries`() {
        var checks = 0
        compose.setContent {
            FairyAppTheme {
                RemoteAppUpdatePanel(
                    state = AppUpdateUiState.Failed("安装包已丢失，请重新下载"),
                    installedVersion = BuildConfig.VERSION_NAME,
                    onCheck = { checks++ },
                    onCancel = {},
                    onInstall = {},
                    onOpenInstallSettings = {},
                )
            }
        }

        compose.onNodeWithText("安装包已丢失，请重新下载").assertIsDisplayed()
        compose.onNodeWithText("重试").performClick()
        assertEquals(1, checks)
    }

    @Test
    fun `checking collects the download flow and waits for the user to install`() {
        val apk = apkFile()
        compose.setContent {
            FairyAppTheme {
                RemoteAppUpdateContent(statuses = { flowOf(AppUpdateStatus.Ready(apk, 192, "2.5.8")) })
            }
        }

        compose.onNodeWithText("检查更新").performClick()
        compose.waitForIdle()

        compose.onNodeWithText("可安装版本 2.5.8").assertIsDisplayed()
        assertNull("下载完成不得自动拉起安装器", shadowOf(compose.activity).nextStartedActivity)
    }

    @Test
    fun `a download in flight can be cancelled`() {
        var cancelled = false
        compose.setContent {
            FairyAppTheme {
                RemoteAppUpdateContent(
                    statuses = {
                        flow {
                            try {
                                emit(AppUpdateStatus.Downloading(1_024, 4_096))
                                awaitCancellation()
                            } finally {
                                cancelled = true
                            }
                        }
                    },
                )
            }
        }

        compose.onNodeWithText("检查更新").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("已下载 1024 / 4096 字节").assertIsDisplayed()

        compose.onNodeWithText("取消").performClick()
        compose.waitForIdle()

        assertTrue("取消必须终止下载", cancelled)
        compose.onNodeWithText("检查更新").assertIsDisplayed()
    }

    @Test
    fun `leaving the update content cancels its download`() {
        var visible by mutableStateOf(true)
        var cancelled = false
        compose.setContent {
            FairyAppTheme {
                if (visible) {
                    RemoteAppUpdateContent(
                        statuses = {
                            flow {
                                try {
                                    emit(AppUpdateStatus.Downloading(1_024, 4_096))
                                    awaitCancellation()
                                } finally {
                                    cancelled = true
                                }
                            }
                        },
                    )
                }
            }
        }
        compose.onNodeWithText("检查更新").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("已下载 1024 / 4096 字节").assertIsDisplayed()

        compose.runOnIdle { visible = false }
        compose.waitForIdle()

        assertTrue("离开更新入口必须终止下载", cancelled)
    }

    @Test
    fun `failures have actionable messages and can be retried`() {
        var attempts = 0
        compose.setContent {
            FairyAppTheme {
                RemoteAppUpdateContent(
                    statuses = {
                        flow {
                            attempts++
                            when (attempts) {
                                1 -> throw me.rerere.rikkahub.data.remote.RemoteAppUpdateException(
                                    me.rerere.rikkahub.data.remote.AppUpdateFailure.SERVER,
                                    "Update download returned 500",
                                )

                                2 -> throw me.rerere.rikkahub.data.remote.RemoteAppUpdateException(
                                    me.rerere.rikkahub.data.remote.AppUpdateFailure.PACKAGE,
                                    "Update package has a different application id",
                                )

                                3 -> throw java.io.IOException("offline")
                                else -> emit(AppUpdateStatus.Current(192, "2.5.7"))
                            }
                        }
                    },
                )
            }
        }

        compose.onNodeWithText("检查更新").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("服务器暂未提供可下载的更新包").assertIsDisplayed()
        compose.onNodeWithText("Update download returned 500").assertDoesNotExist()

        compose.onNodeWithText("重试").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("下载的安装包无效，请联系发布者").assertIsDisplayed()

        compose.onNodeWithText("重试").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("下载失败，请检查网络后重试").assertIsDisplayed()

        compose.onNodeWithText("重试").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("已是最新版本").assertIsDisplayed()
        assertEquals(4, attempts)
    }

    @Test
    fun `installing hands the downloaded package to the system installer`() {
        val apk = apkFile()
        shadowOf(context.packageManager).setCanRequestPackageInstalls(true)
        compose.setContent {
            FairyAppTheme {
                RemoteAppUpdateContent(statuses = { flowOf(AppUpdateStatus.Ready(apk, 192, "2.5.8")) })
            }
        }

        compose.onNodeWithText("检查更新").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("安装").performClick()
        compose.waitForIdle()

        val intent = shadowOf(compose.activity).nextStartedActivity
        assertNotNull("安装必须交给系统安装器", intent)
        assertEquals(Intent.ACTION_VIEW, intent!!.action)
        assertEquals("application/vnd.android.package-archive", intent.type)
        assertEquals("${context.packageName}.fileprovider", intent.data?.authority)
    }

    @Test
    fun `installing without the unknown sources permission asks for it first`() {
        val apk = apkFile()
        shadowOf(context.packageManager).setCanRequestPackageInstalls(false)
        compose.setContent {
            FairyAppTheme {
                RemoteAppUpdateContent(statuses = { flowOf(AppUpdateStatus.Ready(apk, 192, "2.5.8")) })
            }
        }

        compose.onNodeWithText("检查更新").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("安装").performClick()
        compose.waitForIdle()

        assertNull("未授权时不得直接拉起安装器", shadowOf(compose.activity).nextStartedActivity)
        compose.onNodeWithText("去授权安装").assertIsDisplayed()

        compose.onNodeWithText("去授权安装").performClick()
        compose.waitForIdle()

        val intent = shadowOf(compose.activity).nextStartedActivity
        assertNotNull("必须跳到未知来源授权页", intent)
        assertEquals(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, intent!!.action)
        assertEquals("package:${context.packageName}", intent.data.toString())

        shadowOf(context.packageManager).setCanRequestPackageInstalls(true)
        compose.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED)
        compose.activityRule.scenario.moveToState(androidx.lifecycle.Lifecycle.State.RESUMED)
        compose.waitForIdle()

        compose.onNodeWithText("去授权安装").assertDoesNotExist()
        compose.onNodeWithText("需要先允许安装未知来源应用，回到这里再点安装。").assertDoesNotExist()
        compose.onNodeWithText("安装").performClick()
        compose.waitForIdle()
        assertEquals(Intent.ACTION_VIEW, shadowOf(compose.activity).nextStartedActivity?.action)
    }

    @Test
    fun `a missing download file is reported instead of installed`() {
        val missing = File(context.cacheDir, "app-update/gone.apk")
        shadowOf(context.packageManager).setCanRequestPackageInstalls(true)
        compose.setContent {
            FairyAppTheme {
                RemoteAppUpdateContent(statuses = { flowOf(AppUpdateStatus.Ready(missing, 192, "2.5.8")) })
            }
        }

        compose.onNodeWithText("检查更新").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("安装").performClick()
        compose.waitForIdle()

        assertNull("缓存丢失时不得拉起安装器", shadowOf(compose.activity).nextStartedActivity)
        compose.onNodeWithText("安装包已丢失，请重新下载").assertIsDisplayed()
    }
}
