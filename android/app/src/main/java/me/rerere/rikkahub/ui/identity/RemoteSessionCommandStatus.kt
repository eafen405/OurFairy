package me.rerere.rikkahub.ui.identity

internal const val CONTEXT_RESET_RETENTION = "聊天历史、印象、长期记忆与可用技能仍保留"

internal fun sessionCommandStatusText(command: Int?, status: Int?, error: String? = null): String = when (status) {
    2 -> "已压缩"
    3 -> "当前无需压缩"
    4 -> "上下文已重置"
    5 -> "命令失败：${error ?: "执行失败"}"
    else -> if (command == 1) "正在压缩上下文…" else "正在重置上下文…"
}
