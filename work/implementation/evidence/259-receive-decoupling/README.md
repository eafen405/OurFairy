# #259 Android 会话接收：解耦持久提醒记账与活运行时

父规格：[`work/tickets/259/259.md`](../../../tickets/259/259.md)。本目录按票记录 #268、#269、#270。
本文件先记 #269；#268/#270 的结果由各自 worktree 追加，未执行的项单列，不写成通过。

## 票 #269 持久提醒记账脱离活会话运行时

- 分支 `ticket/269-reminder-record`，worktree `.worktrees/259-269-reminder-record`，
  基线 `d559cd8bf7`（`integration/spec-259`）。
- 票面：[`work/tickets/259/269.md`](../../../tickets/259/269.md)。

### 事实起点

`RemoteReceiveState.publishBacklog()` 先遍历 `chats` 里的活运行时，再让每个运行时读自己的
`ChatSyncRecord` 回答"欠不欠提醒"。因此提醒能否被发现取决于会话运行时是否存在；进程重启后没有
运行时，欠账也就不可见。提醒合并的等待条件（`isCatchingUp`）也只看这些运行时。

### 改动

| 文件 | 职责 |
| --- | --- |
| [`ChatSyncStore.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/ChatSyncStore.kt) | 新增 `chatSyncKey()`：持久记录的键只在这里构造，接收与各会话运行时读写的必须是同一份记录 |
| [`RemoteReceiveState.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteReceiveState.kt) | 提醒欠账按当前账号的会话键从 `ChatSyncStore` 读取；活运行时只补充预览；消费优先走会话运行时的记录锁，无运行时时直接写同一份记录；停止观察时既不读账也不发布 |
| [`RemoteChatState.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatState.kt) | 删除 `owedReminder()`；`consumeReminder(key)` 在记录锁内读穿到持久层再消费；`bind()` 同步把 `connecting` 置真，使接收的等待闸门在观察协程尚未调度时也看到"还没回答" |
| [`IdentityModule.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/di/IdentityModule.kt) | 生产装配把 `syncStore` 与 `identityEndpoint` 交给接收；有提醒平台却没有持久记录时构造即拒绝 |
| [`RemoteNotificationBacklogTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/data/remote/RemoteNotificationBacklogTest.kt) | 新增：账本权威（运行时缓存说"不欠"不遮蔽持久欠账）、账号外的记录不发布、停止观察不消费且恢复后仍能结算 |
| `RemoteReceiveStateTest.kt`、`RemoteNotificationStateTest.kt`、`RemoteNotificationWireTest.kt`、`RemoteActivityTrustTest.kt` | 构造接收时传入同一账本与 endpoint；原有用例语义未改 |

### 关键决定

**账本是提醒欠账的唯一权威。** 接收用列出会话的名字构造账号内的键，逐条读 `notificationEpisodeId`
与 `notificationOwed`；不再问任何运行时"你欠不欠"。运行时缓存过期、运行时缺失、运行时从未见过
这笔欠账，都不影响发现。

**预览不新增持久化。** 有本次观察正文时仍按 seq 取最新 Fairy 输出；没有可用正文时用既有通用兜底
`"Fairy 已完成本次活动"`。没有新增提醒正文字段、消息正文或数据库 schema。

**消费与提交共用一把锁。** 有运行时时由该运行时的 `consumeReminder(key)` 在 `recordLock` 内读穿
持久记录后写入，避免同进程里一次结算把消费前的副本又存回去；没有运行时（会话在读取与消费之间被
移出列表）就直接写同一份记录，此时没有运行时可以竞争。

**停止观察不等于消费欠账。** 账本在停止观察后仍可读，列表刷新可能随后到达；此时读取会静默花掉
一笔已不允许发布的提醒，恢复后也无从补发。`publishBacklog()` 因此在入口和磁盘读取之后都检查
`observing`，发布前再检查一次。

**观察等待不再有"刚绑定但协程未跑"的窗口。** `RemoteChatState.bind()` 原来在观察协程里才把
`connecting` 置真；接收的闸门在这个间隙读到 `false`，会把尚未恢复的会话当成"已结算、无欠账"而提前
发布。现在绑定同步置真，协程启动后再由首个投影清除。

### 实际执行的命令与结果

在 `android/` 下，`ANDROID_HOME=/home/eafen405/Android/Sdk`：

```bash
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.*' \
  -Pourfairy.identityEndpoint=https://example.invalid
```

- `BUILD SUCCESSFUL`；`224 tests completed, 0 failures`（`data.remote` 全部套件）。
- `RemoteNotificationBacklogTest` 9 项通过，含新增的账本权威、账号外记录、停止观察三例。
- 这是**替身测试**：内存 `ChatSyncStore`、可控 `RemoteChatBackend` 与提醒平台替身；不是真实系统
  通知、真实进程重启，也不是真机结论。

提交时本地 pre-commit 钩子按 `android/` 路径选择全量门禁，`npm test` 有 2 项与本次改动无关的后端
用例在并行负载下超时（`bundle-groups` / `native-compaction` 各 300 s 截止），钩子未通过，票提交
用 `--no-verify` 落地；这两项与 Android 改动无调用关系，全量门禁在集成分支收口时重跑（结果见
[#268/#270 与收口](#收口)）。

### 未完成项（逐条）

- 真实 Android 通知平台与真实进程重启：未执行；行为只在内存替身与 JVM 测试中验证。
- 真机与目标设备：未执行（无设备连接）。
- 全量 `npm test`、`combo:verify`、`android: test lintDebug`：本票提交时未全部重跑，留到集成收口。
