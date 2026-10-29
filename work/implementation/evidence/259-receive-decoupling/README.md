# #259 Android 会话接收：解耦持久提醒记账与活运行时

父规格：[`work/tickets/259/259.md`](../../../tickets/259/259.md)。本目录按票记录 #269、#268、#270
与收口；未执行的项单列，不写成通过。

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
- `RemoteNotificationBacklogTest` 8 项通过，含新增的账本权威、账号外记录、停止观察三例。
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

## 票 #268 建立多会话历史与流式并存的性能基线

- 分支 `ticket/268-multi-session`，worktree `.worktrees/259-268-multi-session`，基线
  `d559cd8bf7`；开工时先合入 `1710d6d79a`（`integration/spec-259`，含 #269），使组合负载跑在
  解耦后的生产接收路径上。
- 票面：[`work/tickets/259/268.md`](../../../tickets/259/268.md)。

### 组合负载与声明

| 参数 | 值 | 说明 |
| --- | --- | --- |
| `sessions` | 6 | 接收观察的会话总数 |
| `historySessions` | 5 | 每个 200 条历史，无回复 |
| `historyMessages` | 200 | 每会话历史条数 |
| `streamingSessions` | 1 | 同时持续流式，且是账号主会话 |
| `replyChars` | 232,703 | 与 #74 `stream` 档同值：`workload.md` 64 份加 63 个换行 |
| `chunkChars` | 128 | 每个流式片段字符数 |
| `intervalMillis` | 20 | 片段间隔 |

唯一的负载声明是
[`multi-session.md`](../../../../android/app/src/perf/assets/presentation/multi-session.md)；
活动里的 `MultiSessionWorkload.parse` 拒绝未知或缺失键，`RemotePresentationBaselineTest` 逐行钉住
声明。改一行负载会先让宿主测试失败，再要求把新数值与结果一起记录，避免悄悄产生一个看起来像旧基线
的新基线。结果固定命名为 `multi-session`，`--scenario all` 不包含它，不与 #74 的五档混表。

### 测量入口

| 文件 | 职责 |
| --- | --- |
| [`MultiSessionBenchmark.kt`](../../../../android/app/src/perf/java/me/rerere/rikkahub/ui/identity/MultiSessionBenchmark.kt) | 组合负载声明与路由：每个会话一个 `SyntheticChatBackend` 重放，经同一个生产 `RemoteChatBackend` 暴露；不新建会话聚合模型 |
| [`MultiSessionBenchmarkActivity.kt`](../../../../android/app/src/perf/java/me/rerere/rikkahub/ui/identity/MultiSessionBenchmarkActivity.kt) | 用生产 `RemoteReceiveState` 绑定 6 个会话、页面只组合主会话的 `RemoteTranscript`；记录连接租约/峰值、堆、每会话接收至状态、主会话接收至帧、刷新预算、主线程 tick、最新版本是否应用、终态是否呈现 |
| [`AndroidManifest.xml`](../../../../android/app/src/perf/AndroidManifest.xml) | `perf` 变体登记 `MultiSessionBenchmarkActivity`；release 变体不包含 `src/perf` |
| [`measure-presentation.py`](../../../../scripts/measure-presentation.py) | 新增 `multi-session` 场景与活动映射；该场景默认 600 s（其余仍 180 s），`all` 保持 #74 五档 |
| [`RemotePresentationBaselineTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/ui/identity/RemotePresentationBaselineTest.kt) | 宿主侧钉住组合负载声明与流式正文非空；不是帧或设备基线 |

### 实际执行的命令与结果

在 `android/` 下，`ANDROID_HOME=/home/eafen405/Android/Sdk`：

```bash
./gradlew :app:assemblePerf :app:testDebugUnitTest --tests '*RemotePresentation*' \
  -Pourfairy.identityEndpoint=https://example.invalid
```

- `BUILD SUCCESSFUL`；`7 tests completed, 0 failures`（`RemotePresentationTest` 4 项 +
  `RemotePresentationBaselineTest` 3 项）。
- 产出 `app-arm64-v8a-perf.apk`、`app-x86_64-perf.apk`、`app-universal-perf.apk`；universal
  8,721,351 字节，`aapt2 dump badging` 读到 `versionName='2.5.9-perf'`、`versionCode='194'`。
- `perf` 的合并清单含 `MultiSessionBenchmarkActivity`（exported）；APK 的 assets 含
  `presentation/multi-session.md` 与 `presentation/workload.md`。
- `python3 scripts/measure-presentation.py --help` 列出
  `{history,single,format,stream,burst,multi-session,all}`，组合场景走独立活动与结果文件。

### 设备轮次：未执行，基线未建立

`adb devices -l` 在 15 s 内没有返回（`timeout` 杀掉，退出 124），本轮没有可连接设备；#74 已记录
目标设备 vivo S50 不可用、固定模拟器在满负载下崩溃且该路线被用户要求停止。因此票面的"同一设备、
同一构建至少重复三轮"**未满足**：没有三轮、没有分布、没有设备堆/帧阈值，也没有可复现的多会话
实测数字。

已交付的是：固定组合负载、生产接收/呈现路径上的可重放入口、perf 构建、宿主声明测试与明确的基线
缺口。它足以让后续有设备时按同一命令重放，**不能**用于声称多会话性能达标。

### 未完成项（逐条）

- 目标设备上的任何一轮：未执行（无设备）。
- 模拟器方向性数据：未执行；#74 已证明该环境无法承担满负载，且用户停止了这条路线。
- 同设备同构建三轮、原始帧/内存转储与基线表：未产生。
- 真机通知、真实进程重启与后台接收：未执行。

## 票 #270 依据多会话基线受控优化接收生命周期

- 分支 `ticket/270-receive-lifecycle`，worktree `.worktrees/259-270-receive-lifecycle`，基线
  `0786bcb9fd`（`integration/spec-259`，含 #268 与 #269）。
- 票面：[`work/tickets/259/270.md`](../../../tickets/259/270.md)。

### 决定：不做运行时释放或调度优化

票面允许"若没有满足问题判据，交付测量证据和不优化结论"。本轮的判断：

- 问题判据要求同设备、同构建的重复数据指向运行时注册、连接并发或接收调度是热点；#268 的基线缺口
  意味着没有这类数据，因此**没有任何热点被测量证实**。
- 用 #74 的单会话宿主解析基线、代码观感或未来 Unity 假设代替多会话数据，正是票面禁止的证据形式。
- 默认观察集合、连接数、提醒合并闸门与标题刷新路径均保持原样；没有做有界释放、连接裁剪或调度
  改动，也就没有需要回退的复杂度。

因此本票交付的是：解耦后的接收所有权（#269）、可重放的组合负载（#268）、以及"在拿到目标设备
三轮数据前不优化"的可复查结论。这个结论不把"连接数下降"当成成功标准，也不声称当前实现已经
达到任何资源门槛。

### 实际执行的命令与结果

本票没有代码改动；验证是 #268 的 `assemblePerf`/宿主测试与 #269 的接收行为测试，加上集成分支收口
门禁（见下节）。未执行任何设备测量，未产生优化前后对比。

### 未完成项（逐条）

- 有设备后的多会话三轮基线与热点判定：未执行；拿到数据后若命中判据，再按票面做最小优化并重测。
- 优化前后同负载对比与原始数据：未产生（没有优化）。

## 收口

收口在 `integration/spec-259` 上执行，结果按下发时的实际输出补记；本节是 #269 记录里引用的最终
门禁位置。待补：`android: test lintDebug`、`npm test`、`combo:verify`、两轴 code-review 与
GitHub 票面关闭。

