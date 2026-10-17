# arch-56 — 客户端跨会话通知积压合并为一次发布

票：#56（Android / rikkahub）
分支：`arch/56-notification-backlog`
基线：集成分支 `product/ourfairy-v1` tip `18964827`（开工先 merge，已 up to date）
提交：`aff55b75`（实现）
最终 SHA：`aff55b75`（提交后再 `git merge product/ourfairy-v1` 仍为 up to date，见 `merge-integration.log`）

## 问题（核对后的当前代码）

- `notifications.publish` 唯一调用点在 `RemoteChatState.kt`（评审基线 `:308`，当前 `:326` 附近），位于每个会话自己的同步循环内、水位提交之后。
- 拥有 `chats` map 的 `RemoteReceiveState` 全文无 notification 引用（`grep -i notif` 零命中，已复核）。
- 因此重连跨三个会话 = 三条独立通知，且没有可补的 seam。

## 改动

1. `ChatSyncRecord` 增加 `notificationOwed: Boolean = false`（默认 false，旧记录反序列化兼容）。这是「欠了什么」的持久落点，与水位同一次 `save` 提交。
2. `RemoteChatState`：结算时把 `notificationOwed = true` 写进**它已经拥有的**记录；不再自己发布、不再持有平台。新增 `owedReminder()`（从记录读欠账 + 会话内最近输出作预览）与 `consumeReminder()`（先消费再尝试发布）。
3. `RemoteReceiveState`：接收发布归属。`publishBacklog()` 等所有观察中的会话都停止追赶（无 `syncing`）后，从各会话记录汇总欠账、**一次** `publish`；目标优先账号主会话，使合并仍落在用户实际阅读处。
4. `RemoteNotificationPlatform` **未扩展**：仍是 `isForeground`/`publish` 两个方法；新增的只是接收侧决策与 `RemoteChatState` 的内部接缝。
5. `RemoteChatState` 的 `notifications`/`notificationsEnabled` 参数删除，改为 `notifies`（默认 false）：单会话页面不再发布，接线只在 `IdentityModule` 一处。
6. 先提交后发布语义保留：水位提交仍在任何面板之前，崩溃可能漏一次声音，但不会重放。

## 测试

- 新增 `RemoteNotificationBacklogTest`（3 条）：跨会话积压合并为一次发布；前台期间看到的积压被消费且之后不重放；进程重启后记录仍欠的 episode 会被补发。
- 既有 `RemoteNotificationStateTest`(10)、`RemoteNotificationWireTest`(1)、`RemoteActivityTrustTest`(4)、`RemoteReceiveStateTest`(4)、`RemoteReceiveControllerTest`(4) 全部改为经 `RemoteReceiveState` 驱动（发布归属已迁移），断言含义不变。

### red 证据

- `red-backlog-test.log`：新测试首次运行，编译期即失败（新接缝尚未存在）。
- `red-per-session-publish.log`：把 `publishBacklog` 临时改回逐会话 `publish`，合并用例失败 `expected:<1> but was:<2>`——证明该用例能捕获票面缺陷，而非恒真。
- 复跑绿：`targeted-3.log`（26 条定向全绿）。

## 验收命令与结果

```bash
export ANDROID_HOME=/home/eafen405/Android/Sdk
export PATH=/home/eafen405/ourfairy-bin:$PATH
./gradlew :app:testDebugUnitTest :app:assembleDebug \
  -Pourfairy.identityEndpoint=https://example.invalid \
  -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain
```

- `acceptance-full.log`：`BUILD SUCCESSFUL in 51s`（exit 0）。
- 测试统计（来自 `app/build/test-results/testDebugUnitTest/*.xml`，逐套件见 `suite-counts.tsv`）：**72 套件 / 527 条，failures 0 / errors 0 / skipped 0**（基线 71/524，本票 +1 套件 +3 条）。
- 产物：`app/build/outputs/apk/debug/app-universal-debug.apk` 等三个 ABI 包均生成。

## 未做 / 说明

- 未做真机、模拟器、Firebase 运行时、真实云服务与性能验收；只声明 JVM 测试与 debug 构建。
- 范围外发现（未改）：`RemoteChatState` 中 `before`/`cut` 是跨会话共享字段，`RemoteReceiveState` 同时绑定多个会话时它们会互相覆盖；现有测试通过给每个会话独立 `fromSeq=0` 的投影规避。与本票通知归属无关，建议另立票。
- 预览取「会话内最近一条 Fairy 消息」，非合并摘要文案；票面允许「摘要可使用最近内容预览，无需额外模型调用」。
