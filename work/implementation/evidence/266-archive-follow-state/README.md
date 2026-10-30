# #266 会话状态统一归档跟随与完整列表能力

日期：2026-10-30。票面：[`work/tickets/258/266.md`](../../../tickets/258/266.md)，父规格
[`#258`](../../../tickets/258/258.md)。分支 `ticket/266-archive-follow`，worktree
`.worktrees/266-archive-follow`，基线 `0516f6f83b`（`integration/spec-258` tip，已含 #265）。

本票把归档跟随规则从对话页移入会话状态 module，并让控制台与对话页共用的浮层完整承担既有
列表能力。`Screen.Sessions`、catalog 条目与空会话兼容路径按票面保留，留给 #267。

## 结果

- 对话页不再维护 `standing` 闩锁，也不再比较列表为什么变化。`SessionsSnapshot` 新增
  `archivedSelectionId`：只有 `archive(id)` 被后端接受、且 `id` 是当时当前会话
  （`selectedId ?: primarySessionId`）时才发布该 id；`selectedId` 同时移到主会话，作为跟随目标。
  页面只在 `archivedSelectionId == sessionId` 且选择已不同时导航。
- 从未出现在列表、已过期、不属于当前账号或被后端拒绝的归档不发布任何事实；页面继续显示
  “会话不可用”，不会把两种语义合并。列表因刷新自行移除某行也不再触发跳转。
- 归档别的会话不移动选择，也不发布事实；重复选择当前会话仍只关闭（对话页）/进入（控制台，
  见下）。
- 控制台浮层的默认列表、归档视图 + 恢复、改名、停止回复、首页与设置入口与对话页完全相同；
  控制台不是“正处在某个会话中”，因此每一行（含当前会话行）都进入对应对话；对话页仍传自己的
  route，重选当前会话只关闭（未 settled 时重试）。
- 控制台标题、浮层行与对话标题栏继续读同一份 `owned` 快照行 / `OwnedSession.displayTitle`；
  归档、恢复、改名后三处不另存标题副本。

## 改动

主源码：

| 文件 | 改动 |
| --- | --- |
| [`OwnedSessionState.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/OwnedSessionState.kt) | `SessionsSnapshot` 新增 `archivedSelectionId`；`archive()` 计算当时当前会话与归档后的选择，只对“当前会话被接受归档且选择确实移动”的情况发布事实；`joined(stand = true)`（`bind`/`select`/`read`/`create`/`returnToPrimary`）清除事实，`refresh`/`rename`/`restore` 保留事实。 |
| [`FairyConversationPage.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyConversationPage.kt) | 删除页内 `standing` 闩锁与列表消失推断；`LaunchedEffect` 只响应 `archivedSelectionId` 与 `selectedId`。 |
| [`FairyConsolePage.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyConsolePage.kt) | 浮层传 `currentSessionId = null` 并注明原因：控制台不在会话中，所有行都进入对应对话（用户故事 5）。 |
| [`IdentitySessionList.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/identity/IdentitySessionList.kt) | 首页/设置入口加 `session-list-home` / `session-list-settings` testTag，供两个入口的浮层测试定位（控制台页面上另有同名“设置”按钮）。 |

测试：

| 文件 | 覆盖 |
| --- | --- |
| [`OwnedSessionStateTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/data/remote/OwnedSessionStateTest.kt) | 归档当前会话发布事实并移到主会话；归档非当前会话不发布；拒绝归档不发布且状态不变；刷新/改名/恢复保留事实；显式 `read`/`select` 清除；换账号 `bind` 清除。 |
| [`FairyPagesTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/ui/fairy/FairyPagesTest.kt) | 对话页归档当前会话后经状态事实跟随主会话并显示主会话标题；归档别的会话不导航；列表自行移除不是归档、页面不跟随且仍显示“会话不可用”；改名同步标题栏与行；`unavailable restored conversation...` 保留。控制台浮层：当前行也进入对话；归档视图显示归档行并可恢复、恢复后控制台标题/选择不变；改名同步控制台标题与行；首页只关浮层、设置进入设置页；行上重命名/删除入口齐全。 |

## 关键决定

**单一事实字段，而不是页面推断。** `archivedSelectionId` 只回答“哪个会话是用户站着归档的”，
目标选择仍由既有 `selectedId` 提供，没有第二份选择权威。拒绝归档、归档非当前会话与列表自然
变化都不写该字段。

**刷新/改名/恢复保留事实。** `RemoteReceiveState.refreshTitles` 会在标题事件后重读列表，可能落在
`archive()` 与页面响应之间；若刷新清除事实，页面会误显示“会话不可用”。因此只有显式选择移动
（`bind`/`select`/`read`/`create`/`returnToPrimary`）与后续归档会释放事实，`refresh`/`rename`/
`restore` 的 `joined(stand = false)` 保留它。页面跟随到的新 route 通常已 selected、不再发
`read`，事实会保留到下一次显式选择；现有入口在归档后不再提供该会话的行，故不会二次触发。

**控制台当前行也进入会话。** 浮层原来的“重选当前行只关闭”是对话页保留草稿/阅读位置的规则。
控制台本身不是会话页，按用户故事 5 应进入所选会话，所以控制台传 `currentSessionId = null`；
对话页仍传自己的 `sessionId`，它原有的重选不重建行为不变。

**测试替身按后端行为维护两份列表。** `FairyPagesTest` 的 `SessionBackend` 现在真正把归档行移到
归档视图、恢复时移回，才能从控制台入口验证归档视图与恢复；标题仍由同一行返回。

## 实际跑过的命令

在 `.worktrees/266-archive-follow` 上：

| 命令 | 结果 |
| --- | --- |
| 红灯：`cd android && ./gradlew :app:testDebugUnitTest --tests "me.rerere.rikkahub.data.remote.OwnedSessionStateTest"` | 编译失败：9 处 `Unresolved reference 'archivedSelectionId'`，即新契约尚不存在（44s）。 |
| 绿灯（状态）：同上命令 | BUILD SUCCESSFUL；`OwnedSessionStateTest` 23/23，0 失败。 |
| 聚焦：`cd android && ./gradlew :app:testDebugUnitTest --tests "...OwnedSessionStateTest" --tests "...FairyPagesTest" --tests "...IdentitySessionListTest" --tests "...FairyDestinationsTest"` | BUILD SUCCESSFUL；`OwnedSessionStateTest` 23、`FairyPagesTest` 51、`IdentitySessionListTest` 5、`FairyDestinationsTest` 11，共 90 个用例 0 失败。 |
| 全量客户端门禁（合并集成分支 tip 后）：`cd android && ./gradlew :app:testDebugUnitTest lintDebug` | BUILD SUCCESSFUL；结果 XML 55 个测试套件 459 个用例 0 失败 0 跳过；`lintDebug` 通过。 |
| `git merge integration/spec-258` | `Already up to date.`（基线 `0516f6f83b` 已是集成分支 tip）。 |
| 两个源码提交的仓库 pre-commit 钩子（自动，非本票主动运行） | `android/` 路径按 `scripts/precommit.ts` 触发 FULL：根 `npm test` + `combo:verify` + `android/` 的 `test lintDebug`；两次提交均通过。 |

开发页面用例途中曾有 2 个失败（控制台当前行当时按“只关闭”断言、抽屉关闭后仍在语义树中导致
`assertDoesNotExist` 不成立），按产品规则改为“当前行进入会话”并用 `assertIsNotDisplayed` 后重跑
`FairyPagesTest` 51/51 通过；最终计数见上表。

未执行：真机验收（无设备）、`assembleDebug` / `assembleRelease`（本票只改 Compose 状态/页面与
测试，不新增依赖或打包输入）、根门禁的主动重跑（按票面留给最终门禁；pre-commit 钩子已自动跑过）。

## 未完成项 / 风险

- `archivedSelectionId` 是快照事实而非一次性事件，刷新/改名/恢复按上述理由保留它。若将来出现
  “归档后直接重新打开同一归档会话路由”的入口，页面会把它当作刚归档并跟随；当前归档后该行已从
  默认列表移除，现有入口无法产生该路由。
- `Screen.Sessions`、catalog 的 sessions 条目与 `sessionId == null` 兼容路径按票面保留，由 #267
  删除；本票未改其测试。
- 浮层首页/设置按钮新增 testTag 仅为测试定位，不改变用户可见行为。
- 未改后端、通知定位、提醒/接收记账、互动 module 或标题来源。
