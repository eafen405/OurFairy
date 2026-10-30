# #267 删除 Sessions 假目的地并收拢旧恢复路径

日期：2026-10-30。票面：[`work/tickets/258/267.md`](../../../tickets/258/267.md)，父规格
[`#258`](../../../tickets/258/258.md)。分支 `ticket/267-retire-sessions`，worktree
`.worktrees/267-retire-sessions`，基线 `b8b9ea02b7`（`integration/spec-258` tip，已含 #265 与 #266）。

本票删掉会话列表假目的地：`Screen.Sessions`、catalog 的 `sessions` 条目（声明、准入、恢复行）与
空会话对话页装配。会话列表只以控制台和对话页共用的 `SessionListOverlay` 存在；对话页只接受真实会话
目标。旧版本留下的 `route="sessions"` 记录在冷启动时按 catalog 的未知路由规则回到 `[Home]`。

## 结果

- 生产代码里 `FairyConsolePage` 与 `FairyConversationPage` 都组合共享的 `SessionListOverlay`，
  浮层内部组合 `IdentitySessionList`，没有独立的会话列表页面。测试也直接组合
  `IdentitySessionList`（`IdentitySessionListTest`），所以“只由浮层组合”不是全仓库事实；该结构
  没有可执行检查，本证据不把它当作单一拓扑的保证。
- `FairyConversationPage` 只接受非空 `sessionId`：删除 `sessionId == null` 的自动打开浮层分支、
  `null && retry > 0` 的刷新、`settled` / 归档跟随 / 互动上下文中的空值分支。不可用目标仍显示
  “会话不可用”，正文保留“重试”和“选择会话”（打开同一浮层）。
- 旧 `route="sessions"` + `conversation="main"` 记录：`FairyDestinations.resumedStack` 已按未知路由
  返回 `UNKNOWN_LANDING == [Home]`，没有新增兼容映射；真实 `RouteActivity` 冷启动落在控制台，
  不崩溃、不显示“会话不可用”、不打开会话列表浮层、不发网络请求。
- 归档跟随语义未改：仍只响应 `SessionsSnapshot.archivedSelectionId` 与 `selectedId`；通知定位、
  真实会话恢复、主会话归属、接收/提醒与后端均未改动。

## 改动

主源码与文档：

| 文件 | 改动 |
| --- | --- |
| [`RouteActivity.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/RouteActivity.kt) | 从 `Screen` 密封层级删除 `@Serializable data object Sessions`。 |
| [`FairyDestinations.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/destination/FairyDestinations.kt) | 删除 `sessions` 目的地（route `"sessions"`、`Resume([Home, Sessions])`、页面装配）、`entries` 行与 `destinationOf` 分支；`conversationPage` 只接受 `sessionId: String`，KDoc 改为“浮层不是独立页面”。 |
| [`FairyConversationPage.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyConversationPage.kt) | `sessionId: String`；删除空会话自动开浮层、空会话 retry 刷新、`settled` / 归档跟随 / `context` 的空值判断。归档跟随条件与不可用底页未改。 |
| [`android/GLOSSARY.md`](../../../../android/GLOSSARY.md) | 新增「会话列表浮层」（`SessionListOverlay`）：控制台与会话页共用；打开、关闭与选择不进入返回栈，也不改变冷启动恢复位置。 |

测试：

| 文件 | 覆盖 |
| --- | --- |
| [`FairyDestinationsTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/ui/destination/FairyDestinationsTest.kt) | 准入矩阵与恢复表删除 `Screen.Sessions` 行，`allScreens` 同步删除样板；目的地数量 8 → 7，表相等断言仍要求一行一目的地。 |
| [`FairyLastLocationTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/ui/fairy/FairyLastLocationTest.kt) | 可恢复表删除 `sessions` 行；新增用例：文件里留着上一版本的 `route="sessions"`、`conversation="main"` 时 `restoredStack() == listOf(Screen.Home)`。 |
| [`IdentityNavigationTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/ui/identity/IdentityNavigationTest.kt) | 返回栈序列化样例从 `Home + Sessions` 改为真实的 `Home + Conversation("main")`，断言仍走实际的 `NavBackStackSerializer(NavKeySerializer())`。 |
| [`CatalogColdStartTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/CatalogColdStartTest.kt) | 新增 `SessionsColdStartApplication` 与 `SessionsColdStartTest`：真实 `RouteActivity` 以旧 `route="sessions"`、`conversation="main"` 冷启动，断言控制台入口“进入会话”“全部会话”可见、无“会话不可用”、会话列表关闭按钮不在屏幕上；沿用 `CountingHttp` 零网络断言。 |

## 关键决定

**旧记录回退来自 catalog 的未知路由答案，而不是兼容表。** 删除 `sessions` 条目后，
`destinationByRoute("sessions")` 返回 null，`resumedStack` 直接返回具名的 `UNKNOWN_LANDING`；
没有为旧名字保留第二份映射，符合规格“不留下第二份兼容映射”。

**冷启动测试断言“列表不在屏幕上”，而不是“节点不存在”。** `ModalNavigationDrawer` 的抽屉内容
即使关闭也留在组合树中（与 #266 测试一致，关闭后用 `assertIsNotDisplayed`）；用户可见的行为是列表
没有打开，因此断言关闭按钮 `assertIsNotDisplayed`，而不是依赖内部是否组合。

**空会话对话页是唯一被删的页面用法。** 所有测试调用本来就传真实 id（`"main"`、`"missing"`、
目标 id）；删除 `String?` 后没有测试需要改写语义，只把串行化样例换成真实目的地。

## 实际跑过的命令

在 `.worktrees/267-retire-sessions` 上：

| 命令 | 结果 |
| --- | --- |
| 红灯：`cd android && ./gradlew :app:testDebugUnitTest --tests "...ui.destination.FairyDestinationsTest" --tests "...ui.fairy.FairyLastLocationTest" --tests "...ui.identity.IdentityNavigationTest" --tests "me.rerere.rikkahub.SessionsColdStartTest"` | 23 个用例 6 失败：catalog 表相等、目的地数量、可恢复表、旧 `sessions` 回退、`SessionsColdStartTest` 的控制台断言均按预期失败。 |
| 绿灯（聚焦，含冷启动三例）：同上四种加 `SettingsColdStartTest`、`ImpressionColdStartTest` | BUILD SUCCESSFUL；25 个用例 0 失败（`FairyDestinationsTest` 11、`FairyLastLocationTest` 6、`IdentityNavigationTest` 5、三个冷启动各 1）。 |
| 票面聚焦集：`--tests "me.rerere.rikkahub.ui.destination.*" --tests "...FairyPagesTest" --tests "...FairyLastLocationTest" --tests "...IdentityNavigationTest" --tests "me.rerere.rikkahub.CatalogColdStartTest" --tests "me.rerere.rikkahub.SessionsColdStartTest"` | BUILD SUCCESSFUL；74 个用例 0 失败（`FairyPagesTest` 51、`FairyDestinationsTest` 11、`FairyLastLocationTest` 6、`IdentityNavigationTest` 5、`SessionsColdStartTest` 1）。 |
| 源码提交的仓库 pre-commit 钩子（自动，非本票主动运行） | `android/` 路径触发 FULL：根 `npm test` + `combo:verify`，随后 `android/` 的 `test lintDebug` 通过；提交 `0f46f693ee` 生成。Android 结果：56 个测试套件 461 个用例 0 失败 0 错误 0 跳过。 |
| 全量客户端门禁（合并集成分支 tip 后）：`cd android && ./gradlew :app:testDebugUnitTest lintDebug` | BUILD SUCCESSFUL（5s；`testDebugUnitTest` 为 up-to-date，复用上一轮 56 个测试套件 461 个用例 0 失败 0 错误 0 跳过；`lintDebug` 通过）。 |
| `git merge integration/spec-258` | `Already up to date.`（基线 `b8b9ea02b7` 已是集成分支 tip）。 |

`grep -rn "Screen.Sessions" android/app/src` 与 `grep -rn "data object Sessions" android/app/src`
均无输出。`IdentitySessionList(` 在生产代码里只由 `SessionListOverlay` 组合；测试
`IdentitySessionListTest` 直接组合它。这两条是 grep 读到的事实，不是可执行的结构保证。

## 未完成项 / 风险

- 未做真机验收（无设备）；未跑 `assembleDebug` / `assembleRelease`（本票只删目的地与空值分支，
  不新增依赖或打包输入）。
- 根门禁 `npm test`、`combo:verify` 已由源码提交的 pre-commit 钩子跑过；本票收口仍以最终客户端
  门禁为准。
- 旧 `route="sessions"` 只回退首页，不迁移成任何新的永久页面状态；若未来重新引入同名路由，需要
  新的产品决定。
