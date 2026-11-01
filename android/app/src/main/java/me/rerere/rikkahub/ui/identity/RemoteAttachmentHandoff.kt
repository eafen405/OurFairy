package me.rerere.rikkahub.ui.identity

import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import java.io.File

/** 没有接收方时交给面板展示的文案；调用方据此回落到另存为。 */
private const val NO_EXTERNAL_RECEIVER = "没有能打开该文件的系统应用，已改为另存为"

/**
 * 把缓存里的附件交给系统里能打开它的应用。FileProvider 的 content URI 只指向
 * `attachment-preview/` 子目录；原始显示名放进 ClipData，接收方的“打开方式”标题与最近使用
 * 列表看到的就不是摘要名。读授权与 NEW_TASK 挂在目标意图与选择器上，接收方无需存储权限。
 */
internal fun externalAttachmentIntent(
    context: Context,
    file: File,
    mime: String,
    displayName: String,
): Intent {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    val view = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, mime)
        clipData = ClipData.newRawUri(displayName, uri)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    return Intent.createChooser(view, null).apply {
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        clipData = view.clipData
    }
}

/**
 * 交给系统选择器。系统里没有能接收该意图的应用时抛出 [ActivityNotFoundException]，
 * 这里把它变成可展示的文案而不是崩溃；[launch] 是接缝，测试可以换成抛异常的假实现。
 *
 * 这里不能先用 `queryIntentActivities`/`resolveActivity` 预判：应用声明了 targetSdk 37 且
 * manifest 没有 `<queries>`，包可见性会把能打开 PDF 的应用过滤成“不存在”，预判会误回落。
 */
internal fun launchExternalAttachment(
    context: Context,
    file: File,
    mime: String,
    displayName: String,
    launch: (Intent) -> Unit = { context.startActivity(it) },
): String? = try {
    launch(externalAttachmentIntent(context, file, mime, displayName))
    null
} catch (missing: ActivityNotFoundException) {
    NO_EXTERNAL_RECEIVER
}
