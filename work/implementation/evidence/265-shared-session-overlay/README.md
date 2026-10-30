# #265 首页直接打开统一会话列表并显示会话标题

日期：2026-10-30。票面：[`work/tickets/258/265.md`](../../../tickets/258/265.md)，父规格
[`#258`](../../../tickets/258/258.md)。分支 `ticket/265-console-overlay`，worktree
`.worktrees/265-console-overlay`，基线 `12e7c6594c`（`integration/spec-258` tip）。

本票只做 #258 的前两段：共享会话列表浮层与当前会话标题。`Screen.Sessions`、catalog 条目和冷启动
恢复仍按票面保留，留给 #267。

## 结果

控制台与对话页现在打开同一个 `SessionListOverlay`。控制台的「全部会话」和无当前会话时的
「进入会话」就地打开浮层，不再经过会话编号为空的对话页；控制台当前会话行显示同一份
`owned` `SessionsSnapshot` 行的标题，未命名会话显示列表使用的「新会话」占位。打开或关闭浮层
不触发任何导航，也不进入返回栈。对话页原有的行选择、关闭、首页与设置入口行为保持不变。

## 改动

主源码：

| 文件 | 改动 |
| --- | --- |
| [`SessionListOverlay.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/identity/SessionListOverlay.kt)（新） | `SessionListOverlayState` 持有 `DrawerState` 与 `CoroutineScope`，`open()` / `close()` 直接驱动抽屉，`isOpen` 由 `drawer.isOpen` 派生，没有第二份布尔状态；`SessionListOverlay` 组合 `ModalNavigationDrawer` + 既有 `IdentitySessionList`，行选择统一为「关闭后转发」：选中 `currentSessionId` 只关闭（可回调 `onReselectCurrent`），其他会话才回调页面导航。 |
| [`FairyConsolePage.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyConsolePage.kt) | 「全部会话」与无当前会话时的「进入会话」调用 `overlay.open()`；有当前会话时仍 `onOpen(Screen.Conversation(id))`。`ConsoleInfoCard` 的 `CURRENT SESSION` 从 opaque id 改为同一 `owned` 快照行的 `displayTitle`；新增 `console-session-title` testTag。 |
| [`FairyConversationPage.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyConversationPage.kt) | 删除页内私有 `ModalNavigationDrawer` / `rememberDrawerState` 接线，改用同一 `SessionListOverlay`；`currentSessionId = sessionId`，当前行重选仍只在未 settled 时 `retry++`。`sessionId == null` 的兼容路径保留，就绪后打开同一浮层。 |
| [`SessionApi.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/SessionApi.kt) | 新增 `UNTITLED_SESSION_TITLE` 与 `OwnedSession.displayTitle`，作为未命名会话显示占位的唯一规则。 |
| [`IdentitySessionList.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/identity/IdentitySessionList.kt) | 默认行、归档行与归档确认文案改用 `session.displayTitle`。 |

测试：

| 文件 | 覆盖 |
| --- | --- |
| [`FairyPagesTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/ui/fairy/FairyPagesTest.kt) | 控制台两个入口就地打开浮层且不导航；关闭浮层留在控制台；控制台标题非 opaque id；未命名当前会话在控制台与列表行同为「新会话」；长标题 + 320dp 窄屏 + 1.3 字体下控制台标题与列表行都在视口内且按钮可达；列表行选择进入对应会话；对话页选择当前会话不导航且保留草稿。原断言 `Screen.Sessions` 的两条用例按本票语义改写。 |

## 关键决定

**浮层状态直接持有抽屉，而不是用布尔量再经 `LaunchedEffect` 同步。** 首版把 `isOpen` 作为唯一状态、
在组合里用 `LaunchedEffect(state.isOpen)` 驱动 `DrawerState`，红灯验证发现暂停时钟的页面测试里
`performClick` 后的重组没有把 `LaunchedEffect` 再跑起来，抽屉停在 `Closed`（`placed=false`，
`x=-320`）。改为状态持有 `DrawerState` + `rememberCoroutineScope()`，`open()`/`close()` 直接
`scope.launch { drawer.open()/close() }`（与改动前页面接线一致）后恢复；`isOpen` 改由
`drawer.isOpen` 派生，避免两份权威。遮挡点击或返回手势关闭抽屉时，`isOpen` 自动跟随，不需要同步代码。

**控制台的「首页」入口只关闭浮层。** 控制台本身就是 `Screen.Home`，catalog 的 `onOpen` 是 push；
从浮层再 push 一个 Home 会制造重复返回栈项。对话页仍传 `onBack`，设置仍导航到 `Screen.Settings`。

**标题栏未改。** `FairyWindowTopBar` 对空标题的既有规则是保留 Fairy 名牌（`fairy_nameplate`），
与列表/控制台的「新会话」占位不是同一条规则；票面只要求在已做等价处理时统一，因此本票不改标题栏，
避免把名牌行为换成占位名。控制台与列表行已共享 `OwnedSession.displayTitle`。

**测试替身按后端行为返回带标题的行。** 原 `read` 替身总是返回无标题的 `OwnedSession`，选择会话后
会把列表里的标题覆盖掉；本票让 `read` 先返回 `listedSessions` 中的同一行（后端 `read`/`select`
的实际形状），才能验证控制台与列表行读同一标题。

## 实际跑过的命令

在 `.worktrees/265-console-overlay` 上：

| 命令 | 结果 |
| --- | --- |
| 红灯：`cd android && ./gradlew :app:testDebugUnitTest --tests "me.rerere.rikkahub.ui.fairy.FairyPagesTest"` | 44 个用例 7 失败：控制台标题、两个入口、未命名占位、窄屏标题等新断言按预期失败。 |
| 绿灯（聚焦）：`cd android && ./gradlew :app:testDebugUnitTest --tests "me.rerere.rikkahub.ui.fairy.FairyPagesTest" --tests "me.rerere.rikkahub.ui.identity.IdentitySessionListTest"` | BUILD SUCCESSFUL；`FairyPagesTest` 44/44、`IdentitySessionListTest` 5/5，共 49 个用例 0 失败。 |
| 全量客户端单元测试 + lint：`cd android && ./gradlew :app:testDebugUnitTest lintDebug` | BUILD SUCCESSFUL（2m52s）；55 个测试套件 448 个用例 0 失败；`lintDebug` 通过。 |
| 两个功能提交时的仓库 pre-commit 钩子（自动，不是本票主动运行根门禁） | 钩子跑完整根门禁：根 `npm test` 430/430 通过，`combo:verify` 通过，随后 `android/` 的 `test lintDebug` 通过；证据提交走 Markdown 门禁（1/1 通过）。 |

未执行：真机验收（无设备）、`assembleDebug` / `assembleRelease`（本票只改 Compose 页面与数据展示，
不新增依赖或打包输入）、根 `npm test` 的主动重跑（按票面留给 Lead 最终门禁；钩子已自动跑过）。

## 未完成项 / 风险

- `Screen.Sessions`、catalog 的 sessions 条目、冷启动恢复分支按票面保留，由 #267 删除；本票没有改动
  它们的测试。
- 控制台浮层的「首页」只关闭浮层（已在「关键决定」说明）；若产品希望它回退到根 Home，需要在
  catalog 增加 pop-to-home 动作，超出本票。
- 归档当前会话后的跟随规则仍是页面现有的 `standing` 闩锁（#266 范围），本票未改。
- 标题栏对未命名会话仍显示 Fairy 名牌，与控制台/列表的「新会话」占位不同；按票面「仅在已做等价
  处理时统一」保留。
