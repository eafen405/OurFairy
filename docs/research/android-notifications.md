> 2026-10-20 状态：现行。本文记录 2026-10-13 的判断，不描述当前实现。

# Android 通知能力核查

研究日期：2026-10-13。对象是本地 `/home/eafen405/projects/rikkahub`，提交 `0966502c4d65c1ee4b2a3e49a19703bb1978016c`，研究时工作树干净。结论仅覆盖该版本，不代表未检查的上游版本或其他 fork。研究不决定 OurFairy 的触发策略或推送方案。

## 已核实的事实

### RikkaHub 的“通知”目前是发送本应用的系统通知

| 能力 | 当前源码证据 | 判断 |
| --- | --- | --- |
| 展示聊天进度、生成完成消息 | `app/src/main/java/me/rerere/rikkahub/service/ChatNotificationManager.kt:35` 描述职责；`:60` 订阅应用内部 `AppEventBus`；`:71`、`:85` 处理生成更新和结束；`:99`、`:120` 发送系统通知 | 已实现，事件来自应用内聊天生成 |
| 系统通知构建、点击进入会话 | `app/src/main/java/me/rerere/rikkahub/utils/NotificationUtil.kt:44` 检查通知权限；`:74` 调用 `NotificationManagerCompat.notify`；`ChatNotificationManager.kt:187` 创建带 `conversationId` 的点击 Intent | 可作为通知呈现与会话入口的复用材料 |
| 前台服务保活本地生成 | `app/src/main/AndroidManifest.xml:126` 声明聊天生成前台服务；`app/src/main/java/me/rerere/rikkahub/service/ChatGenerationForegroundService.kt:46` 启动前台服务，`:79` 返回 `START_NOT_STICKY` | 是本地任务执行辅助，不等于后端消息接收通道 |
| 读取其他应用通知 | 全仓 Kotlin/XML/Gradle/TOML 检索未发现 `NotificationListenerService`、`BIND_NOTIFICATION_LISTENER_SERVICE` 或 `onNotificationPosted`；manifest 的服务声明见 `AndroidManifest.xml:126` 至 `:145` | 未发现实现，不能将已有通知功能当作通知采集 hook |
| 接收后端推送 | 同范围检索未发现 `FirebaseMessagingService`、Firebase Messaging 配置或 UnifiedPush；manifest 没有对应消息接收服务 | 未发现这些推送机制；本次没有完成所有网络协议的全面审计，因此不声称不存在任何远程通信 |

源码固定提交链接：

- [AndroidManifest.xml](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/AndroidManifest.xml#L126)
- [ChatNotificationManager.kt](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/service/ChatNotificationManager.kt#L35)
- [NotificationUtil.kt](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/utils/NotificationUtil.kt#L44)
- [ChatGenerationForegroundService.kt](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/service/ChatGenerationForegroundService.kt#L46)

上述链接以本地提交为基准；没有验证该本地 fork 提交是否可在该上游 GitHub URL 访问，本地路径和行号是本次核查的直接依据。

### Android 平台：采集事件、激活 Fairy、展示消息是不同环节

1. Android 的 `NotificationListenerService` 会在通知发布、移除、排序变化时收到系统回调。服务必须在 manifest 声明 `BIND_NOTIFICATION_LISTENER_SERVICE` 和对应 intent filter；用户必须授予通知访问权限。`onNotificationPosted` 是可以承载“通知 hook”的平台入口。它本身没有“调用 agent”的语义，也不意味着所有回调都应激活 Fairy。[官方类文档](https://developer.android.com/reference/android/service/notification/NotificationListenerService)、[requestRebind 权限说明](https://developer.android.com/reference/android/service/notification/NotificationListenerService#requestRebind(android.content.ComponentName))。
2. 监听存在生命周期和设备限制：应等待 `onListenerConnected`；断开后不再收到事件；Android Q 及以下低内存设备不支持绑定，工作资料内的监听器会被忽略，设备策略可能屏蔽工作资料通知。这些是采集能力边界，不能宣称能读取手机上的全部通知。[同一官方类文档](https://developer.android.com/reference/android/service/notification/NotificationListenerService)。
3. `POST_NOTIFICATIONS` 是 Android 13+ 展示非豁免系统通知的运行时权限，与读取其他应用通知所需的通知访问授权是两回事。后台消息抵达和用户看到系统通知也应分别验证。[官方通知权限说明](https://developer.android.com/develop/ui/views/notifications/notification-permission)。
4. 锁屏并不自动等于进程被杀；设备长期闲置进入 Doze 后，系统会暂停网络访问并推迟 jobs、syncs 和普通 alarms。因此仅在客户端维持 SSE/WebSocket 连接，不能据此承诺长期锁屏期间及时收取后端消息。[官方 Doze / App Standby 文档](https://developer.android.com/training/monitoring-device-state/doze-standby)。
5. Android 官方推荐在可行时用 FCM 提供后台下行消息。Doze 中，普通优先级消息可能延迟至维护窗口；高优先级用于时效性强、用户可见的通知，并给予短暂执行及联网机会。这是平台支持的一种候选机制，不是本报告替 OurFairy 选定的方案。[官方 Doze 文档的 FCM 部分](https://developer.android.com/training/monitoring-device-state/doze-standby#use_fcm)。
6. FCM 对前台、后台的处理不同：前台消息通过 `onMessageReceived`；后台 notification payload 由系统通知栏处理；后台混合 notification/data 的 data 经点击 Intent 交给应用。回调执行窗口很短，长工作应交给合适的后台任务机制，而不在接收回调中执行 agent。[Firebase 官方 Android 接收文档](https://firebase.google.com/docs/cloud-messaging/android/receive)。
7. “被杀”必须分清普通进程回收和用户在设置中强制停止。Firebase 官方接收指南明确：Android 用户从设置强制退出应用后，必须手动重新打开，消息接收才恢复。该说明来自 Firebase 的跨平台 Flutter 接收指南中的 Android 平台前提，不是对所有厂商后台行为的普遍承诺。[官方接收前提](https://firebase.google.com/docs/cloud-messaging/flutter/receive#receive_messages_in_a_flutter_app)。

## 未知与需继续研究

- 用户目标手机是否具有可用 Google Play services、所在网络能否稳定使用 FCM；厂商推送或 UnifiedPush 等替代机制尚未研究。
- 通知监听在目标系统版本、厂商省电策略下的实际完整性，以及敏感内容在新 Android 版本的可见范围，尚需专项资料与实机验证。
- 通知如何筛选、汇总、判断是否值得激活 Fairy，及主动消息的时机、频率与用户打扰成本：本次没有足够证据给出策略，应由主动 agent 论文和产品场景研究推进。
- 手机通知属于个人内容；哪些内容允许上传、保留多久、是否参与共享记忆，仍是待决策项。
- 后端主动消息需要多强的即时性、离线后是否补达、通知预览展示多少内容，尚未确定。

## 对后续决策的建议（未定案）

- 将“手机通知被观察到”与“Fairy 被激活”写成两个独立概念；先研究决策机制，再决定连接方式和触发实现。
- 复用 RikkaHub 的通知呈现和点击跳转时，保留它们与执行来源的解耦；已有本地生成通知不解决服务器主动消息的送达。
- 为推送方案先明确目标设备与期望体验，验证锁屏、Doze、普通进程回收、强制停止和离线恢复等不同状态。不要用“有前台服务”推断长期连接必然可靠。
- 将后端消息持久化/重连补取与即时系统提醒分开评估，以便讨论消息存在和消息提示这两种需求。是否采用这种设计仍由架构决策票收敛。

## 核查方法

读取本地 AGENTS.md、manifest、通知管理器、通知工具和前台服务；限定源码与配置格式检索上述监听/推送符号，避免测试二进制 payload 产生误匹配。通过网络读取 Android Developers 和 Firebase 官方页面；通知监听文档首次读取超时，后续完整读取成功。未编译应用，未执行实机测试。
