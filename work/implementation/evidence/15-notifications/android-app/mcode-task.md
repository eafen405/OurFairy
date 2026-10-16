You are executing a bounded subtask delegated by Codex.
Read and follow applicable AGENTS.md instructions before working.
Use the task's allowed edit scope and acceptance criteria. Preserve unrelated changes.
Perform this task yourself; do not delegate to other agents or external harnesses.
Return a concise report of changes, checks performed, and any unresolved blockers.
Do not commit, push, or publish unless the task explicitly authorizes it.

Task:
T15 bounded Android task in /home/eafen405/projects/rikkahub/.worktrees/15-notifications-platform ONLY. Read AGENTS and root OurFairy CODING_STANDARDS. Personal project reuse plain existing native Compose patterns, no infrastructure. Allowed edits ONLY new app/src/main/java/me/rerere/rikkahub/ui/identity/RemoteReceiveSetupCard.kt and additive service declaration inside app/src/main/AndroidManifest.xml. No other edits, no commits/pushes/Gradle. Owner writes runtime/account/notification/control wiring.
1. Implement internal @Composable RemoteReceiveSetupCard(enabled:Boolean, receiving:Boolean, status:String, notificationsAllowed:Boolean,onEnabledChange:(Boolean)->Unit,onRequestPermission:()->Unit,onSettings:()->Unit,onBackgroundSettings:()->Unit,modifier:Modifier=Modifier). Native Material3 expressive Card surfaceContainerHigh padding16, titleSmallEmphasized. Show title 后台接收, Switch explicit enable setting, status text supplied by owner, receiving label 接收服务运行中 when true. When notification permission false show manual 请求通知权限 button (never auto request). Always retain 打开通知设置 / 后台与电池设置 buttons. Explain concisely: 后台接收需用户开启；进程回收、Doze、强行停止可能中断，重新打开应用恢复；不承诺持续在线。 Callback-only UI, no prefs/permission/runtime in composable. Avoid nested elaborate layouts; use simple Column/Row as neighboring cards.
2. Manifest service existing application alongside WebServerService: android:name=".service.RemoteReceiveService" android:exported="false" android:foregroundServiceType="specialUse", child <property android:name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE" android:value="User-enabled authenticated live conversation reception for a self-distributed personal messaging client" />. Existing FOREGROUND_SERVICE_SPECIAL_USE permission already present: do not duplicate.
Return exact changed paths and diff summary. Do not invent policies or classes beyond these two edits.
