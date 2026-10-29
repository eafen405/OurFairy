# #260 首页与对话页统一 Fairy 当前表现

日期：2026-10-29。票面：[`work/tickets/256/260.md`](../../../tickets/256/260.md)，父规格
[`#256`](../../../tickets/256/256.md)。分支 `ticket/260-unified-presence`，worktree
`.worktrees/260-unified-presence`，基线 `b30ba705c4`（`integration/spec-256`）。

设计决议见 [`256-interaction-module.md`](../../notes/256-interaction-module.md)；源码事实见
`/home/eafen405/projects/spec-notes/256/exploration.md`（仓库外）。本 README 只记本票的改动与证据。

## 判断：先造出唯一那份规则，再接首页

探索确认了两件与规格措辞不同的事实：

1. **对话页不是"各自推导却缺眼部互动"，它连 `FairyEyeController` 都没有**——
   `FairyWindowState.eye` 没有生产者，对话页顶部两块 `FairyScreen` 拿到 `eye = null`。
2. **页面状态零跨页保留**，返回首页 `backStack.clear()` 销毁对话条目；`RemoteReceiveState.selectedChat`
   是 `runtimes[selectedId]`，**不回退主会话**，首页若直接用它会在读者尚未选择时什么都显示不出来。

因此本票的范围是：把 `RemoteChatSnapshot.fairyWindow()` 那五个分支搬进一个新 module，让首页与对话页
都只读它；`eye` 的接线与跨页持有留给 #261。

## 改动

Android `ui/fairy`：

| 文件 | 职责 |
| --- | --- |
| [`FairyInteraction.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyInteraction.kt) | 新增的 deep module：`FairyInteractionContext`（只带会话 id，不带账号）、`FairyRemoteFacts`（页面转述的只读事实）、`FairyInteractionState`、`window(facts)`（唯一的存在感合成）、`show(context, facts)`（唯一写入方）。`now: () -> Long` 与 `random: Random` 注入，当前表现两者都不读 |
| [`FairyInteractionSources.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyInteractionSources.kt) | module 与远程协议之间仅有的两处翻译：`SessionsSnapshot.currentSessionId()`（`selectedId ?: primarySessionId`）与 `RemoteChatSnapshot.fairyFacts()`（复制 `activity` getter 的答案，不重读原始事件） |
| [`FairyConversationPage.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyConversationPage.kt) | 删除页内 `fairyWindow()`；改为 `fairy.window(facts)` + `fairy.show(context, facts)`；未结算在目标会话里时上下文为 null（未知表现），不呈现上一会话 |
| [`FairyConsolePage.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyConsolePage.kt) | 不再硬编码 `FairyPresence.IDLE`：按当前会话取运行时（`receive.runtimes` → `stateForSession` 同一映射），渲染 module 的窗口并 `show` |
| [`RemoteReceiveState.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteReceiveState.kt) | `chats` 内存 map 改为 `runtimes: StateFlow<Map<String, RemoteChatState>>`：首页要"当前会话的运行时出现/退役"可观察，否则只能靠列表通知的先后。`stateForSession`/`stopReply`/`bind`/`stopObservation` 全部改读同一份，仍是唯一一份 |
| [`IdentityModule.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/di/IdentityModule.kt) | `single { FairyInteraction(now = SystemClock::uptimeMillis, random = Random.Default) }`：进程级一个实例，时钟在装配层注入 |

测试：

| 文件 | 覆盖 |
| --- | --- |
| [`FairyInteractionTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/ui/fairy/FairyInteractionTest.kt) | 20 个纯 JUnit 用例（无 Robolectric）：未知不是安静、连接中/离线/未知/工作的分支顺序、`expanded`/`awaitingReply`、换上下文退役旧事实、登出不留状态、同一上下文替换事实、当前会话回退主会话、`fairyFacts()` 复制快照的未知答案 |
| [`FairyPagesTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/ui/fairy/FairyPagesTest.kt) | 5 个新增接线用例：首页显示当前会话的思考而非待机、活动未知显示连接中、只跟当前会话（另一会话在执行不影响首页）、账号切换后旧会话不再驱动首页、首页与对话页对同一会话得到同一表现 |

## 关键决定

**module 只认会话 id，不认账号。** 账号退役点已经存在（`RemoteReceiveState.bind` 的 `epoch++` /
`detach` / 清空、`RemoteChatState.bind` 的硬重置）。再给 module 一个账号字段就是第二份账号权威；
现在它只接"事实属于哪个上下文"，键变了就丢弃旧的持续状态（`presenting a different context retires
the facts of the previous one`）。

**未知不是安静，且只回答一次。** `fairyFacts()` 复制 `RemoteChatSnapshot.activity` 的答案——那个 getter
已经在"未连接 / 未初始化 / 已消费水位没覆盖游标"三种情况下答 `status = 0`，并有
`RemoteActivityStateTest`、`RemoteActivityTrustTest` 锁住。module 拿不到原始事件，所以它**没有能力**
把未知变成安静；`FairyInteractionTest` 的两条用例分别固定"复制了这个答案"与"未知渲染成连接中"。

**`window()` 是纯函数，`show()` 才是写入。** 页面渲染时用 `window(facts)` 立即拿到结果，不依赖 module
的 StateFlow 是否已经追上本帧；`show()` 只负责让其余读者（#261 的待机/台词、跨页状态）看到同一份。
一条用例用"时钟与随机源被读取就抛错"的 module 证明当前表现不依赖二者。

## 实际跑过的命令

在 `.worktrees/260-unified-presence/android`：

| 命令 | 结果 |
| --- | --- |
| `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.fairy.*'` | BUILD SUCCESSFUL；`FairyInteractionTest` 20/20、`FairyPagesTest` 30/30、其余 fairy 套件全绿，0 失败 |
| `./gradlew test lintDebug` | BUILD SUCCESSFUL，0 lint error（详见下方门禁一节） |

## 未执行项

- **真机验收未执行**：本机无 Android 设备，`#45` 的设备验收仍待目标设备。构建与替身测试通过不等于运行时验收通过。
- 眼部反应、待机与台词的归属、`FairyWindowState.eye`/`speechPulse` 的接线**不在本票**，由 #261 / #262 完成；
  本票只保证它们今天的状态不被改变（首页仍无 controller、对话页仍无 controller、待机仍由页面自己计时）。
