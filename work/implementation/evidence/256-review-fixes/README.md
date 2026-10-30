# #256 集成分支两轴评审修复

日期：2026-10-30。分支 `fix/256-review`，worktree `.worktrees/256-review-fixes`，基线
`b27b99f4b1`（`integration/spec-256` tip）。本 README 只记本轮 review 修复：逐条 F1–F9 的发现、
决定、改动与可执行证据；票面与三票证据仍以
[`work/tickets/256/`](../../../tickets/256/256.md) 和
[`260`](../260-unified-presence/README.md) / [`261`](../261-interaction-continuity/README.md) /
[`262`](../262-fairy-reactions/README.md) 为准，凡被本轮改动推翻的声称已在对应 README 修正。

## 结论

F1–F9 全部处置，无遗留实现项。F6/F7 是文档/注释事实修正，无行为改动。F9 是 Lead 追加项，按
"呈现令牌"以较小成本修掉，并在下面记录为什么这不是过度设计。未执行真机验收（本机无设备）；
根仓库全量门禁与 Android 门禁在本轮实际通过（见「根门禁」）。

## F1 页面与 module 的两套 `window` / 无事实过渡帧

**发现。** 两个页面渲染自己算的 `fairy.window(facts)`，而 `FairyInteractionState.window` 由
`show()` 写入却无生产读者；`show(context, null)` 会把同一会话的新页写成 `UNKNOWN`，首页 → 对话页
的第一帧不连续。

**决定。** 页面只渲染 module 快照里的 `window`；`window(facts)` 保留为 `show()` 与单测的唯一合成
规则。同一上下文收到 `facts == null` 时保留已持有的 facts/window；不同上下文或 null 上下文
（登出）重置为 `UNKNOWN`。已持有 facts 后同一上下文再传 null：保留 facts/window（不制造未知），
测试固定。

**改动。** `FairyInteraction.show()` 的 same-context/null 分支、`FairyConsolePage` /
`FairyConversationPage` 改读 `interaction.window`、`FairyInteraction` / `FairyPageHost` 的 KDoc
同步。

**失败测试 → 通过。**
- module：`the next page's first frame keeps the presentation it has not replaced yet`（修复前红：
  `show(main, null)` 后 window 变 UNKNOWN）；`no facts reset a different context and a signed-out context to unknown`。
- 页面：`the conversation page renders the module's appearance while its facts are missing`（修复前红：
  页面重新用 `window(null)` 得到 UNKNOWN，`fairy-screen-overlay` 折叠）。
- 页面可见断言：`home and the conversation page render the same current appearance for one session`、
  `home and the conversation page show a working session, never standby`、
  `home and the conversation page show unknown activity as linking, never as standby`、
  `home follows only the current session's visible current appearance`。

## F2 页面 seam：可见结果、可注入眼睛、手势与反应接线

**发现。** 四处 `FairyPagesTest` 断言只证明 module 状态；reaction 映射测试不经过页面却被 #262
证据当作页面接线；页面 seam 缺少手指跟随的实际输出断言。

**决定。** 断言页面可见结果（首页 `TAP TO WAKE`/台词/眼屏、对话页副标题与
`fairy-screen-overlay`），测试名说明验证的是页面呈现；两个页面增加可注入的
`FairyEyeController?` 参数（生产默认 `remember { … }`）；把两页共享的宿主抽出来后，
`FairyEyeReactions` 真正经过页面。

**改动。** `FairyConsolePage` / `FairyConversationPage` 的 `eye` 参数；`FairyPageHost` 内的
`FairyEyeReactions` 调用；`FairyPagesTest` 的四处断言与测试名；reaction 映射测试改名。

**失败测试 → 通过。**
- 可见结果：上列四条页面用例在修复前只有 module 断言，页面渲染错误也能通过；现在至少断言一个
  页面可见节点（`TAP TO WAKE`、`正在思考…`、`同步中…`、`已连接`、`fairy-screen-overlay`）。
- 手势：`dragging either fairy page moves that page's eye`（注入 controller，真实
  `down`/`moveBy` 后断言 `eye.pointer.isSpecified`；两页都走同一宿主）。
- 页面反应：`a delivery reaches the conversation page's own eye once`（module 观测 → 页面 →
  注入的 `eye.glances`）。
- 映射：`the eye mapping plays each reaction kind once and never replays a recomposition`（原名
  `the module's reaction reaches the page's eye once`，现名不再声称经过页面）。

## F3 `pageExit()` 不结算 `speechPulse`

**发现。** KDoc 声称离页结算短暂状态，但 `speechPulse` 不清，下一页会为已演过的输出再脉冲一次。

**决定。** `pageExit()` 同时结算 `speechPulse`（与 caption、reaction 一起），KDoc 与实现一致。

**改动。** `FairyInteraction.pageExit()` 的 `copy(..., speechPulse = 0)` 与 KDoc。

**失败测试 → 通过。** `leaving the page settles the speaking pulse instead of replaying it`
（修复前红：离页后 `speechPulse` 仍为 1，回页仍为 1）。

## F4 待机中的视线反应等到醒来才播

**发现。** 待机时 `FairyEyeReactions` 仍写 glance，但 `FairyEyeMotion` 在 `asleep` 时跳过
`advanceGaze`，反应被留到醒来：陈旧且属于"排队补播"。

**决定。** 待机中的视线反应当下可见并立即结算：`still` 判定改为
`input.asleep && scriptIndex < 0 && glanceLeft <= 0f`，glance 在待机中走一次再回静；module 侧照旧
产生反应，不因 asleep 丢弃。

**改动。** `FairyEyeMotion.advance` 的 still 条件与注释。

**失败测试 → 通过。** `a glance in stand-by is shown now and is not replayed on waking`
（修复前红：待机 + glance 后 `gazeX` 仍为 0；修复后 128 ms 内可见、结束后回静、醒来不重播）；
`stand-by without a reaction keeps the eye still`（待机其余表现保持静止，含放大的瞳孔）。

## F5 重试分支虚报"不会上报"

**发现。** `RemoteChatPanel` 的重试注释声称被拒绝的重试不会上报，但守卫只复制了
`retryPending()` 五个条件中的两个；无 key/token 时会话返回而 panel 仍 `onSendAccepted`。

**决定。** `RemoteChatState.retryPending()` 返回 `Boolean`（真正受理才 true），panel 只在 true
时上报；注释改成事实。

**改动。** `RemoteChatState.retryPending()`、`RemoteChatPanel` 的重试回调与 KDoc。

**失败测试 → 通过。**
- state：`retry answers whether the command was actually accepted`（未绑定 false、无凭据 false、
  已发送中 false、真正受理 true）。
- panel：`a refused retry is not reported and an accepted one is`（`RemoteChatPanelRetryTest`：
  无凭据点击「重试原请求」不上报；恢复凭据后上报同一个 requestId）。
- module 去重：既有 `the same send is one event however often it is reported`。

## F6 `android/GLOSSARY.md` 范围蔓延

**发现。** 删除规格明说为语义权威的「存在感」，并加入属于 #257 的「目的地」「会话列表浮层」。

**决定。** 恢复「存在感」词条（保留现名并附规格术语），删除两条 #257 词；`GLOSSARY-MAP.md` 的
客户端描述同步且不出现 #257 词；保留 #261 的「待机」修正与「Fairy 互动」「当前会话」。

**改动 / 检查。** `android/GLOSSARY.md` 现为
`**Fairy 当前表现**（FairyPresence，规格中亦称存在感）`；`目的地`、`会话列表浮层` 不再出现；
`GLOSSARY-MAP.md` 的 Android 行经 grep 未含 #257 词，无需改字。

## F7 `runtimes` KDoc 与值相反

**发现。** KDoc 说「it is not a view of the account's sessions in aggregate」，但值就是所有已列会话
的运行时映射，`selectedChat` 也由它派生。

**决定。** 改成事实：每个值是那一场会话自己的运行时，module/页面只取当前会话，这里不派生任何
账号级活动汇总；删掉被值本身否定的措辞。

**改动。** `RemoteReceiveState.runtimes` KDoc。

## F8 两页约 40 行重复宿主逻辑，且已分叉

**发现。** `FairyEyeController` 创建与 `asleep` 同步、生命周期 `ON_START`/`ON_STOP`、
`pageExit`、`onGloballyPositioned` + 手势、`FairyEyeReactions` 在两页重复；控制台 `ON_START`
少了对话页的 `takeIf { it.sessionId == sessionId }`。

**决定。** 抽成 internal 宿主 `rememberFairyPageHost`：返回持有 `eye` 与 `modifier` 的
`FairyPageHost`，页面只提供当前会话 id、本帧 facts、composer/content 位置函数。不新增公开 API、
不引入 ViewModel。`ON_START` 的事实读取收敛到 `RemoteReceiveState.factsForSession(id)`，两页
共用同一 session 校验。

**改动。** 新增 `FairyPageHost.kt`；`FairyInteractionSources.kt` 增加 `factsForSession`；两页删除
重复块并应用 `host.modifier`、使用 `host.eye`（页面注入的 `eye` 继续可见）。

**证据。** 既有页面用例（待机跨页、离页结算、前台结算、发送、抽屉、消息呈现）全绿；新增
`dragging either fairy page moves that page's eye` 与 `a delivery reaches the conversation page's own eye once`
覆盖宿主的手势与反应接线。

## F9 回前台无事实时 `catchingUp` 被清掉 / 过期 `pageExit`

**发现。** Lead 追加：`show()` 每次调用都 `catchingUp = false`，`foregrounded(context, null)` 后
第一份事实会被当成新事件演出；另一个页面晚到的 `pageExit()` 也可能落在到页页面的 `show()` 之后，
把新页面的下一条真实事件静默结算。

**决定。** 只有本次呈现确实带 facts 才清 `catchingUp`；`pageExit` 接受本页最新 presentation 号
（`show()` 返回），比 module 记录的最新增号旧则忽略（不新增 ViewModel/公开 API，成本为一个
`Long?` 参数和一次比较），因此不把短暂反应竞争留成无测试的隐含行为。

**改动。** `FairyInteraction.show()` 返回 `Long`、`foregrounded()` 同步返回、`pageExit(presentation)`
的过期判定；`FairyPageHost` 保存本页 presentation 并在 `ON_STOP`/dispose 传回。

**失败测试 → 通过。**
- `a return without facts keeps the settling guard until the first facts arrive`（修复前红：第一份
  投递产生 reaction）。
- `a stale page exit cannot settle the next page's presentation`（修复前红：过期离页清掉新页面反应，
  下一条投递被静默结算）。
- `the current page's exit still settles the presentation`（本页离页仍结算反应与脉冲）。

## 实际跑过的命令与结果

在 `.worktrees/256-review-fixes/android`，`ANDROID_HOME=/home/eafen405/Android/Sdk`：

| 命令 | 结果 |
| --- | --- |
| 先补测试后的定向红：`:app:testDebugUnitTest --tests '…FairyEyeTest' …` | `FairyEyeTest > a glance in stand-by is shown now and is not replayed on waking`、`FairyInteractionTest > the next page's first frame keeps…`、`leaving the page settles the speaking pulse…`、`a return without facts keeps the settling guard…`、`a stale page exit cannot settle…` 等按预期失败（实现前；token API 未就位时为编译期失败） |
| `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.fairy.*' --tests 'me.rerere.rikkahub.data.remote.*' --tests 'me.rerere.rikkahub.ui.identity.RemoteChatPanelRetryTest'` | `BUILD SUCCESSFUL in 27s`；fairy 113 + data.remote 222 + panel 1 = 336 tests / 0 failures（JUnit XML 汇总；指定命令不含 panel 时为 335） |
| `./gradlew test lintDebug assembleDebug`（最终门禁） | `BUILD SUCCESSFUL in 3m 43s`；52 suites / 427 tests / 0 failures / 0 errors；`lintDebug` 0 errors、30 warnings（仓库既有 warning）；产出 3 个 debug APK：`app-arm64-v8a-debug.apk`、`app-universal-debug.apk`、`app-x86_64-debug.apk` |
| `git merge integration/spec-256`（收尾再合一次） | `Already up to date.`（集成分支 tip 仍为 `b27b99f4b1`） |

关键新增/改名测试：`the next page's first frame keeps the presentation it has not replaced yet`、
`no facts reset a different context and a signed-out context to unknown`、
`the conversation page renders the module's appearance while its facts are missing`、
`leaving the page settles the speaking pulse instead of replaying it`、
`a glance in stand-by is shown now and is not replayed on waking`、
`stand-by without a reaction keeps the eye still`、
`retry answers whether the command was actually accepted`、
`a refused retry is not reported and an accepted one is`、
`a delivery reaches the conversation page's own eye once`、
`dragging either fairy page moves that page's eye`、
`a return without facts keeps the settling guard until the first facts arrive`、
`a stale page exit cannot settle the next page's presentation`、
`the current page's exit still settles the presentation`。

## 根门禁

`android/` 改动属于 `scripts/precommit.ts` 的 FULL_AUTHORITY。实现提交 `f45a21d9fd` 的 pre-commit
实际运行了根仓库全量 `npm test` 与 Android `./gradlew test lintDebug`（提交时显式带
`ANDROID_HOME=/home/eafen405/Android/Sdk`）：

- `npm test`：`pass 430 / fail 0`；
- Android：`BUILD SUCCESSFUL in 31s`（增量，`test lintDebug`）。

首次不带 `ANDROID_HOME` 的提交尝试在 hook 内报 `SDK location not found`，是本机 hook 环境缺变量，
不是测试失败；补变量后正常通过，**未使用 `--no-verify`**。文档提交单独落地，不改变上述代码门禁
覆盖范围。

## 未完成 / 需 Lead 决定项

- **真机验收未执行**：本机无 Android 设备；本轮只覆盖替身测试、lint 与构建，不等于运行时视觉/
  手势验收。
- **F9 的取舍说明**：采用呈现令牌后，回前台无事实的路径与跨页竞争都有 module 级测试；没有发现
  需要 Lead 裁决的剩余项。
