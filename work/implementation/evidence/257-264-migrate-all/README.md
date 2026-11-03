# #264 目的地 catalog：迁移全部目的地并删除旧映射

日期：2026-10-29。票面：[`work/tickets/257/264.md`](../../../tickets/257/264.md)，父规格
[`#257`](../../../tickets/257/257.md)。分支 `ticket/264-migrate-all`，worktree
`.worktrees/257-264-migrate-all`，基线 `dc178ea817`（`integration/spec-257` tip）。

设计决议见 [`257-destination-catalog.md`](../../notes/257-destination-catalog.md)（§8 / §8.1）；本 README 只记
本票的改动与证据。

## 结果

八个目的地现在都由 `FairyDestinations` 提供页面装配、身份准入与恢复策略；登录、注册、会话、
会话列表不再有第二条装配路径，`IdentityAccessPolicy` / `IdentityDestination` /
`Screen.toIdentityDestination()` 已删除。生产路由、通知落点与页面测试读同一张表。

## 改动

主源码：

| 文件 | 改动 |
| --- | --- |
| [`FairyDestinations.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/destination/FairyDestinations.kt) | 补上 SignIn / Register / Sessions / Conversation 四条页面装配；新增 `entryOf(screen, scope)` 统一构造 `NavEntry`（key = screen，contentKey = `contentKeyOf`，content = catalog 页面）；删除 `assembles()`；会话列表与具名会话共用 `conversationPage(sessionId)` |
| [`FairyDestination.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/destination/FairyDestination.kt) | `page` 由可空 `DestinationPageScope.() -> Unit` 改为非空 `@Composable DestinationPageScope.(Screen) -> Unit` |
| [`RouteActivity.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/RouteActivity.kt) | `entryProvider = { key -> FairyDestinations.entryOf(key as Screen, pageScope) }`；删除 `navigationEntry` / `entry` / 私有 `mayCompose` / `toIdentityDestination`；闸门直接读 `FairyDestinations.mayCompose`；`handleIntent` 成功后用 `resumedStack(CONVERSATION_ROUTE, sessionId)` 重置返回栈 |
| [`IdentityScope.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/identity/IdentityScope.kt)（原 `IdentityAccessPolicy.kt`） | 只保留 `IdentityScope`；`IdentityDestination` 与 `IdentityAccessPolicy` 删除 |
| [`IdentityNavigation.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/identity/IdentityNavigation.kt) | 已登录但无存储位置时改用 catalog 的具名 `UNKNOWN_LANDING`，不再在恢复路径里写 `listOf(Screen.Home)` |
| [`android/GLOSSARY.md`](../../../../android/GLOSSARY.md) | 只在本 spec 自己的「目的地 catalog」词条补一句：生产路由、通知落点与页面测试读同一份表 |

删除：

- `ScreenIdentityDestinationTest.kt`（5 条「Screen → 旧枚举」断言）删除，其断言并入下表的表驱动准入矩阵。
- `IdentityAccessPolicyTest.kt` 删除；它的 Conversation / 凭证页 / Home / Settings / Sessions / Gateway /
  Impression 断言同样并入准入矩阵。`IdentityNavigationTest`、`RemoteNotificationNavigationTest` 保留并通过。
- `RouteActivity.kt` 里的 `Screen.toIdentityDestination()` 与 `IdentityAccessPolicy.kt` 里的
  `IdentityDestination` / `IdentityAccessPolicy` 删除；`IdentityScope` 作为身份事实保留在 `ui/identity`。

测试：

| 文件 | 覆盖 |
| --- | --- |
| [`FairyDestinationsTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/ui/destination/FairyDestinationsTest.kt) | 八个目的地 × 四种身份（未登录 / 代理人 / 法厄同 / 未登录但残留 admin 位）的准入矩阵；矩阵必须覆盖 `entries` 的全部 route；八条恢复策略（含 `Never`、会话保留编号、缺 id 与未知 route 落到 `UNKNOWN_LANDING`）；恢复栈末项是自己、不经过 `Never`；route 唯一且解析回自己；`contentKey` 区分会话实例 |
| [`FairyPagesTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/ui/fairy/FairyPagesTest.kt) | 三块手抄 `when (destination)` 与 `home(...)` / `conversation(...)` 两个装配 helper 换成 `DestinationHost` / `destination`：用文件原有的 `account` / `receive` / `identityBackend` 构造 `DestinationPageScope`，经 `FairyDestinations.destinationOf(screen).Content` 装配。测试方法体里的断言未改 |
| [`RemoteNotificationNavigationTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/ui/identity/RemoteNotificationNavigationTest.kt) | 新增「accepted notification lands on the conversation stack the catalog declares」：外部端点与外部用户被 `openRemoteNotification` 拒绝且不动返回栈；被接纳后按 catalog 的 `resumedStack(CONVERSATION_ROUTE, "s2")` 落到 `[Home, Conversation("s2")]`，且准入闸门对已登录账号放行 |

## 关键决定

**`page` 接收 `Screen`（对设计决议 §2 的一处修正，需 Lead 知悉）。** 决议把页面写成
`@Composable DestinationPageScope.() -> Unit`，但会话页的 `sessionId` 只能来自导航键本身
（`Screen.Conversation(id)`），而 `Sessions` 与 `Conversation` 共用同一个页面函数。把实例作为参数传入是
不复制页面装配的最小表达；`Content(screen, scope)` 因此多一个参数。`entryProvider` 仍只有一条表达式：
`entryOf(key as Screen, pageScope)`，第二分支与 `assembles()` 已删除。

**`NavEntry` 构造移入 catalog。** 票面写的是「`entryProvider` 只剩 catalog 调用」。把 key、contentKey、
metadata、content 的构造放进 `entryOf` 后，生产路由和 `FairyPagesTest` 读同一份 key 与页面，不再由
Activity 另写一份 `entry(...)`。

**通知落点只借用 catalog 的会话栈。** `handleIntent` 在 `openRemoteNotification` 已校验端点、用户编号、
会话归属之后，才用 `resumedStack(CONVERSATION_ROUTE, sessionId)` 重置返回栈；端点/账号/归属语义仍在
`openRemoteNotification`，准入闸门照旧对栈顶求值。对非空会话坐标，通知落到的栈与改动前相同
（`[Home, Conversation(id)]`），因此没有黑盒断言能区分「读 catalog」与「又写一遍」；本票用唯一调用点
[`RouteActivity.kt:121-124`](../../../../android/app/src/main/java/me/rerere/rikkahub/RouteActivity.kt) 承担这条结构声称，
行为由新增用例钉住。空白会话坐标现在按 catalog 的既有规则落到 `UNKNOWN_LANDING`（与冷启动恢复一致）；
改动前会进入 `[Home, Conversation("")]` 的不可用页。这是畸形通知才走到的边界，没有专测。

**完整性保持编译期。** `page` / `access` / `restore` 都是非空构造参数，`destinationOf` 对 `Screen` 写无
`else` 的穷尽 `when`：新增目的地缺页面、准入或恢复策略都会先编译失败，比运行期测试更早。没有引入
`kotlin-reflect`，也没有用 `sealedSubclasses`。

**未登录但残留 admin 位仍是访客。** 旧的 `IdentityAccessPolicy` 对 SignIn/Register 只判断
`!signedIn`；迁移时表驱动测试先写错成「残留 admin 位不得进凭证页」，运行后失败，核对旧实现后改为
「凭证页放行、管理页拒绝」。这是本次红-绿过程中唯一一处测试期望修正，不是产品行为变化。

## 实际跑过的命令

在 `.worktrees/257-264-migrate-all` 上，`ANDROID_HOME=/home/eafen405/Android/Sdk`：

| 命令 | 结果 |
| --- | --- |
| 开工前 `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.destination.*'` | BUILD SUCCESSFUL（1m 37s，基线） |
| 红灯：`./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.destination.FairyDestinationsTest'` | 12 个用例 2 失败：`sign_in has a page`（页面缺失，正是本票要补的）与 `stale admin at sign_in`（测试期望写错，已按旧策略修正） |
| `./gradlew :app:compileDebugKotlin` | BUILD SUCCESSFUL in 3s |
| `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.destination.*' --tests 'me.rerere.rikkahub.ui.identity.*' --tests 'me.rerere.rikkahub.ui.fairy.FairyPagesTest'` | BUILD SUCCESSFUL（23s；改动后复跑 35s） |
| 合并前 `./gradlew test lintDebug` | BUILD SUCCESSFUL in 2m 57s；`testDebugUnitTest` **52 套件 / 364 用例 / 0 失败 / 0 错误**；`lint-results-debug.xml` 的 `severity="Error"` 计数 0 |
| 合并后 `./gradlew test lintDebug`（最终州） | BUILD SUCCESSFUL in 2m 14s；`testDebugUnitTest` **52 套件 / 364 用例 / 0 失败 / 0 错误**；`lint-results-debug.xml` 的 `severity="Error"` 计数 0 |
| `git merge integration/spec-257` | `Already up to date.`（基线即 tip `dc178ea817`） |

仓库 pre-commit 钩子对 `android/` 改动会跑全量门禁；一次提交尝试实际跑完了后端套件（430 个用例，
429 通过），唯一失败是旧证据 `work/implementation/evidence/245-impression/README.md` 仍链接已删除的
`IdentityAccessPolicy.kt`。该链接已改为重命名后的 `IdentityScope.kt` 并补一句准入规则移入 catalog 的说明；
`node --test tests/docs.test.mjs` 通过。随后提交使用 `--no-verify`，没有重复运行用户明确要求跳过的
`npm test`；Android 面以单独的全量 `test lintDebug` 为准。

## 最终门禁

合并 `integration/spec-257`（`Already up to date`，tip 仍为 `dc178ea817`）后，在
`.worktrees/257-264-migrate-all/android` 以 `ANDROID_HOME=/home/eafen405/Android/Sdk` 跑
`./gradlew test lintDebug`：**BUILD SUCCESSFUL in 2m 14s**，`testDebugUnitTest` 52 套件 / 364 用例 /
0 失败 / 0 错误，`lint-results-debug.xml` 的 `severity="Error"` 计数 0；证据提交后 `git status --porcelain`
为空。原始日志在 `work/tmp/264/gradle-test-lint-merged.log`（不入库）。

## 未执行 / 限制

- **真机未验收。** 结论止于 Robolectric（SDK 35）与 `lintDebug`，没有在设备上点过通知、返回与冷启动。
- **`handleIntent` 没有 Activity 级用例。** 新用例在 `openRemoteNotification` 的 seam 上验证「拒绝外部
  端点/用户」与「接纳后落到 catalog 声明的会话栈」；`handleIntent` 自身只有唯一调用点可审查，没有
  Activity 级断言覆盖排队与收纳动画之后的重置。
- **页面按现有测试分布覆盖，未逐页新增快照**：SignIn/Register 由 `ClientStartupTest` 经生产路由进入；
  Home/Settings/Sessions/Conversation 由 `FairyPagesTest` 经 catalog 装配；Gateway/Impression 由
  `CatalogColdStartTest` 的冷启动恢复进入。Gateway/Impression 页面仍使用各自 `koinInject()` 的 backend
  默认值，`DestinationPageScope` 只携带 `identityBackend`（#263 的边界，本票未改）。
- **保存态未做 UI 级验证**：`contentKey` 的实例区分仍由取值测试钉住，未验证两个会话各自恢复滚动位置。
- **后端全量套件未作为本票门禁执行**（用户明确要求跳过）；pre-commit 钩子的一次实际运行与结果见上。

## 分支与提交

- 分支：`ticket/264-migrate-all`
- 实现提交：`b09db6ba7d`（含旧证据链接修正）
- 合入：`integration/spec-257` 未前进，报告时 `Already up to date`；未推送远程。
