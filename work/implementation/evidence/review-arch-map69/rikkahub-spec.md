# rikkahub — Spec 轴（只读评审）

a) #56 `RemoteReceiveState.kt:125` 等 syncing，未收首帧者 false，错峰多发，违背「积压合成一条通知」；#63 `AttachmentTest:83` 读 records。
b) #60 另建 `ReceivePlatform.kt:13`/`ServiceHost.kt:14`（票面称 NotifPlatform 已存在）；前台对象只剩 DI `IdentityModule.kt:84/93`。
c) #55 `RemoteChatState.kt:320/342` 无 detach 守卫，在途 detach 写 notificationThrough/owed；`TrustTest:119` 未断言 owed，重绑补发，「detach 后 getter 未知，通知仍可能已结算」未消。

补充（未入正文）：#56 `RemoteReceiveState.kt:135-147` 先 consume 后 publish，catch 称「Nothing was consumed, so…tried again」不成立；publish 抛异常后 owed 已清，重试无账可发。#61 `PresentationBenchmarkActivity.kt:145` 仍手拼 attempt key（票面要求「使约定只陈述一次」），`RemotePresentation` 的 attemptRowKey 未覆盖该处。#56 新测试 `RemoteNotificationBacklogTest.kt:85` 标题称 three sessions，实际只有 alice-main/alice-other 两会话且都被同一 gate 同步，漏测错峰。red 证据：#55/#56/#58/#60 均为临时还原旧实现的行为级；#63 为断言级（测试票适当）；#68 仅编译级，已在 resolution 声明。

通过：#55 谓词共用、#56 旧 publish 删、#58 同步清空、#60 无缓存、#68 五删。
