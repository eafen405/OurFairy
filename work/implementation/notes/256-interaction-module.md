# #256 Fairy 互动 module 设计决议

日期：2026-10-29。适用于 #260 / #261 / #262 三票。源码事实见
[`/home/eafen405/projects/spec-notes/256/exploration.md`](/home/eafen405/projects/spec-notes/256/exploration.md)
（仓库外，含逐条 `path:line`）；本文件只记**已经决定、跨票必须一致**的点。票面仍是需求权威。

## 0. 探索纠正了规格的三个前提（实施按事实走，不按规格措辞走）

| 规格/票面措辞 | 源码事实 | 实施含义 |
| --- | --- | --- |
| 对话页「私下计算存在感，却没有同样的眼部互动」 | 对话页连 `FairyEyeController` 都没有：`FairyWindowState.eye` 无生产者 | #261 不是「统一两份」，是**造出唯一那份**并给对话页接上 controller |
| 「多个页面各自拥有 state」 | 页面状态零跨页保留，返回首页 `backStack.clear()` 销毁对话条目 | 「跨页连续」必须由**进程级 holder** 承载，不能靠页面 `remember` |
| 「当前会话沿用最近选择、缺省回退主会话」 | `RemoteReceiveState.selectedChat` = `chats[listed.selectedId]`，**无回退** | 首页不得直接用 `selectedChat`；用 `owned.selectedId ?: owned.primarySessionId` + 既有 `stateForSession(id)` |

## 1. 一个 module，进程级，Koin 单例

`FairyInteraction` 放 `android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyInteraction.kt`（同包先例：
`FairyPresence.kt`、`FairyLastLocation.kt`）。**core 只 import Kotlin 与 `kotlinx.coroutines.flow`**，不 import
`android.*`、`androidx.compose.*`。因此：

- 时间从 `now: () -> Long` 注入，core 里没有默认值；真实时钟由 DI 层给（`SystemClock::uptimeMillis`）。
- 随机从 `random: Random` 注入（先例：`FairyLines.pickFairyLine`/`FairyUiMemory.nextLine` 的 `random: Random` 参数）。
- 最近台词记忆沿用既有 `FairyUiMemory`（SharedPreferences `fairy_ui`/`recent_lines`，`RECENT_KEEP = 8`）；
  core 只依赖它的窄接口（`nextLine(pool, avoid)` / `recentLines`），不自己再存一份。

注册在 `di/IdentityModule.kt`（既有 `single { … }` + 页面默认参数 `koinInject()` 的范式，`IdentityModule.kt:78-114`）。
**不引入 ViewModel、不新增 Gradle module、不新建导航作用域**——仓库里都没有先例。

## 2. 唯一退役点：沿用既有 epoch，module 不自建账号判断

账号切换 → `RemoteReceiveState.bind` 已有 `epoch++` / `detach()` / `chats.clear()`；会话切换 → `RemoteChatState.bind`
硬重置快照。module **只接受「事实属于哪个上下文」的输入**：页面在 `LaunchedEffect`/`DisposableEffect` 里把
`(账号短号或会话 id)` 作为上下文键交给 module，键变了 module 就丢弃旧的持续状态。module 不读 `AccountSession`、
不读 `Token`、不自己判断「这是哪个账号」。

## 3. 输入：三类，全部由页面采集

```kotlin
// 事实（只读，来自既有权威，module 不复制）
FairySessionFacts(
    presenceDriver: …   // 当前会话 RemoteChatSnapshot 的连接与 activity 事实
)
// 事件（页面采集的真实事件，见 #262 的清单）
sealed interface FairyInteractionEvent { … }
// 环境（页面读的环境事实，不是互动规则）
speaks: Boolean, motion: AgoraMotionPolicy（或等价的布尔）, page 生命周期
```

**存在感合成进 module**：`RemoteChatSnapshot.fairyWindow()` 的 5 分支（`FairyConversationPage.kt:215-229`）搬进
module，成为唯一规则；`FairyWindowState.presence` 三个调用方（首页、`ImpressionPage`、`GatewayPage`）都从
module 或显式 IDLE 取值。**活动未知的判定继续用 `RemoteChatSnapshot.activity` getter**（`RemoteChatState.kt:81-97`），
module 不重写 `status == 0 → 未知`。

## 4. 输出：一个只读快照

`state: StateFlow<FairyInteractionState>`，字段至少含
`presence / asleep / caption / reaction（短暂的眼部意图）/ speechPulse`。
页面**只渲染**这些值：不得再各自合成 presence，不得再各自维护 `asleep`，不得再各自计时。

持续状态（跨页保留）：`presence`、`asleep`、最近台词记忆。
短暂状态（离页结算）：未播完的 `caption`、`reaction`。`pageExit` 事件必须把它们清零且**不排队**。

## 5. 台词：沿用现有文本与本机记忆，不新增文案

`homePool`/`HOME_AVOID`/`sleepPool` 继续用；`chatPool`/`CHAT_AVOID` 与 `FairyCaption(compact = true)` 二选一
（#261 决定），不允许留成不可达分支。台词只在本机 SharedPreferences，不进会话日志、不发后端。
**中文 locale 门槛保持**：控制台今天只在 `locales[0].language == "zh"` 时播台词与进待机
（`FairyConsolePage.kt:89/94`）。#261 把这个事实作为 `speaks` 输入交给 module，行为不变；是否为非中文设备
放开待机**不在本 spec 范围**，#261 在证据里记一句「保持原样」即可。

## 6. 去重：只用既有事实，不建第二份权威

`episodeId`、`RemoteActivityDelivery(episodeId, seq)`、`RemoteCompletedActivity(episodeId, finishedSeq)`、
`PendingChatSend.requestId`。module 为这些键维护**只增的已触发集合**（内存即可，离页不清，跨重连有效）；
`generation` 变化时按「同一 episode 重放」处理。
**不得**复制通知记账（`notificationThrough`/`notificationEpisodeId`）——那是提醒的权威，模块只做呈现。

## 7. 不可达分支的收尾（#261 认领主体，#262 收尾）

| 分支 | 处置 |
| --- | --- |
| `chatPool` / `CHAT_AVOID`、`FairyCaption(compact = true)` | #261 决定接线或删除 |
| `FairyEyeController.attend` | #262：没有本 spec 明确事件 → 删除（输入框聚焦不是本 spec 的事件） |
| `FairyEyeController.glanceAt` | #262 接线：收到 Fairy 输出/投递 |
| `FairyEyeController.blink` | #262 接线或删除（Reduced Motion 下的替代反馈候选） |
| `FairyEyeController.startle` | #262 接线或删除；不接线则删 |
| `FairyEyeController.sleepNow` | #261：待机入 module 后由此驱动，或删除 |
| 整条 `drowsy` 路径 | #261 删除。它今天恒为 0（只在 `wake`/`sleepNow` 里归零），删除不改变任何可观察行为 |
| `FairyWindowState.speechPulse` | #262 接线（SPEAKING 脉冲由 module 的说话事实驱动）或删除 |

每删除一项，证据 README 记一行「原来零调用方 → 已删」；每接线一项，记一行「事件 → 表现」并给出测试名。

## 8. 测试

- module 的测试 seam 是它自己的 interface：可控时钟 + 确定性 `Random(seed)` + 事实替身，纯 JUnit
  （`testImplementation(libs.junit)`），不开 Robolectric。这是本次唯一新增的行为 seam。
- 页面 seam 只补高层接线：首页不再固定待机、对话页与首页一致、手势可达、Reduced Motion 生效、离页不补播。
  沿用 `FairyPagesTest` 的替身骨架与 `ShadowSystemClock` 驱动方式。
- 不为眼部、台词、计时分别新增独立 seam。

## 9. 范围红线

不改后端、不改 HTTP/SSE、不改数据库、不改 `RemoteActivity` 语义、不新增文案、不改视觉令牌、
不新增持续后台帧循环、不动 `ImpressionPage`/`GatewayPage` 的互动语义（它们只借外观，签名变了跟着编译通过即可）。
