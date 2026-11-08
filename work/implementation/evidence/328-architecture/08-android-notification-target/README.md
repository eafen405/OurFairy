# #336 统一 Android 通知定位的端点与账号准入

- 票：[#336](https://github.com/eafen405/OurFairy/issues/336)；父规格 [#328](https://github.com/eafen405/OurFairy/issues/328)
- 分支：`ticket/336-android-notification-target`；worktree `/home/fatfish/OurFairy/.worktrees/336-android-notification-target`
- 基线：`integration/spec-328` @ `1c0188a`（开工时 tip）；交付前合并集成分支 @ `75cae52`（合并提交 `3403c6c`）
- 交付提交：`a2ac052`（统一准入规则 + 模块/Activity 接线 + 测试）、`126e6bb`（客户端词汇表）、本证据提交
- 工作面笔记：`E4-android.md` §2（仓库外 `/home/fatfish/OurFairy-work/spec-328/`）

## 问题（基线代码事实）

端点与账号准入在基线里有两份**逐字等价**的实现：

| | 会话通知 | 技能提醒 |
| --- | --- | --- |
| 规则位置 | `ui/identity/RemoteNotificationNavigation.kt:18`（端点参数化） | `RouteActivity.kt:134-137`（内联，直接读 `BuildConfig.IDENTITY_ENDPOINT`） |
| 谓词 | `target.endpoint.trimEnd('/') != endpoint.trimEnd('/') \|\| target.userShortId != identity.user.shortId` | 同一表达式，端点一侧换成 `BuildConfig` |
| 跨端点拒绝的测试 | module 测试可传任意端点（`RemoteNotificationNavigationTest.kt:52,75`） | **零**：Activity 测试只能换账号（`NotificationColdStartTest.kt:227-242`） |

后果：同一规则两处维护；`SkillsNotificationTarget` 类型已经存在却**没有函数消费它**（只在
`AndroidRemoteNotifications.skillsTarget` 里构造、在 Activity 里拆字段比较）；技能那份把配置端点写死，
所以「另一个部署的提醒不该打开本机技能页」这条只能在 Activity 级验证，而 Activity 测试拿不到第二个端点。

## 做法（不新建文件）

`ui/identity/RemoteNotificationNavigation.kt`（21 → 49 行）：

- `internal fun admits(endpoint, userShortId, configuredEndpoint, account): Boolean`：**唯一**的端点规范化
  （`trimEnd('/')`）与账号准入；身份尚未落定时返回 `false`。
- `fun openSkillsNotification(target, endpoint, account)`：同步纯准入，不查会话、不读 `RemoteReceiveState`、
  不申请权限 —— 技能提醒**不获得会话权限**（E4 §2.4 第 3 条）。
- `openRemoteNotification` 改为：先取身份快照 → `admits` → 原会话归属检查 `openOwnedSession` →
  打开后身份二次确认 `account.identity.value == identity`。行为不变（4 条既有用例不改即绿）。
- 配置端点由**调用方传入**（Activity 仍传 `BuildConfig.IDENTITY_ENDPOINT`）；模块内不引用 `BuildConfig`，
  跨端点测试因此可以传 `https://other`，不需要 Activity、DI 或 Release 配置改动。

`RouteActivity.handleIntent` 技能分支（264 行）：删除内联的 `identity` 预读与谓词，换成一次
`openSkillsNotification(target, BuildConfig.IDENTITY_ENDPOINT, accountSession)`；排队块
（`pendingIntents`）与 catalog 落点 `FairyDestinations.resumedStack(SKILLS_ROUTE, null)` 未动。

`android/GLOSSARY.md`「通知定位」条目：两个 target 类型、`admits` 的端点规范化与账号准入、会话入口的
归属检查与二次确认、技能入口的同步与「不获得额外权限」一次说清。

### 与 E4 建议的唯一偏差

`admits` 用 `internal`（E4 §2.6 也是 `internal`）；两个公开入口是它在本模块内的唯一调用者，测试经入口
覆盖。`openRemoteNotification` 保留身份首读（打开后二次确认需要同一快照），`admits` 内部再读一次
`identity.value`；`AccountSession.identity` 是 `StateFlow`，多读一次不改变判定结果与既有测试。

## 必须保留的安全约束（逐条可执行）

1. **会话归属检查**：`openRemoteNotification` 仍调用 `openOwnedSession(target.sessionId)`；Activity 仍传
   `remoteReceiveController::openNotification`（→ `RemoteReceiveState.openSession`）。缺失时
   `RemoteNotificationNavigationTest` 的 `ownership refusal cannot navigate...` 直接失败。
2. **打开后的身份二次确认**：模块内 `account.identity.value == identity` 保留；
   `RemoteReceiveController.kt:60,62` 的同款二次确认是纵深防御，**未动**。`late old account answer
   cannot navigate` 固定它。
3. **技能提醒不得获得额外权限**：`openSkillsNotification` 是同步纯比较，没有 `openOwnedSession` 一类参数；
   `a skills reminder for another account or deployment never lands` 固定接受/拒绝两侧。
4. **发布侧的门未动**：`AndroidRemoteNotifications.skillsNotificationsAllowed()`、`SkillsReviewNotifier`
   的 `remindersAllowed`、`RemoteReceiveController`、`FairyDestinations`、`BillFailure`、DI 一行未改。
5. **跨端点/跨账号拒绝可在 module interface 上测**：新用例直接构造 `SkillsNotificationTarget` 并传
   `https://other` / 账号 `3`；不启动 Activity、不依赖 `BuildConfig`。
6. **冷启动排队不变**：技能分支仍先排队、后准入；新增 Activity 级排队用例在改线**前**（同一测试文件
   在旧 Activity 上跑）与改线后都绿，是「排队行为不变」的可执行证据。

## 测试（全部在本 worktree 真实执行）

环境：`JAVA_HOME=/home/fatfish/tools/jdk-21.0.13+9`、`ANDROID_HOME=/home/fatfish/tools/android-sdk`；
从主检出复制 `android/local.properties` 与 `android/app/google-services.json`；命令均在 `android/` 下执行，
日志在 `work/tmp/336/`（不入库）。

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `:app:testDebugUnitTest --tests RemoteNotificationNavigationTest`（实现前，红灯） | 编译失败：`Unresolved reference 'openSkillsNotification'`（测试第 77–93 行共 5 处），BUILD FAILED in 35s | `red-module-test.log` |
| 同上（实现后） | **7 tests**（4 旧 + 3 新），0 failures，BUILD SUCCESSFUL in 55s | `green-module-test.log` |
| `:app:testDebugUnitTest --tests NotificationColdStartTest`（Activity 改线**前**，特征化） | **5 tests**（4 旧 + 1 新排队用例），0 failures，BUILD SUCCESSFUL in 1m3s | `baseline-coldstart.log` |
| 两个 suite（Activity 改线后） | **12 tests**，0 failures，BUILD SUCCESSFUL in 1m1s | `green-targeted-suites.log` |
| `./gradlew test lintDebug`（全量，最终代码内容） | BUILD SUCCESSFUL in **11m14s**；84 suites / **757 tests**（app 685、ui 20、highlight 52）/ 0 failures；`lintDebug` 通过（无 error；警告为既有） | `full-test-lint.log` |
| `git merge --no-verify integration/spec-328` @ `75cae52` 后重跑两个 suite | **12 tests**，0 failures，BUILD SUCCESSFUL in 48s | `merged-relevant-suites.log` |
| pre-commit 全量门禁（`a2ac052` 提交时） | 后端 45 suites / 767 pass / **5 fail**（见下）；钩子在 npm test 失败处退出，未跑到 Android 步骤 | `commit-1-hook.log` |
| 失败测试隔离重跑：`npm test -- tests/jobs.test.mjs tests/skill-learning.test.mjs` | **32 pass / 0 fail**，185s | `isolated-rerun-backend.log` |
| pre-commit docs 门禁（`126e6bb` 提交时） | `tests/docs.test.mjs` + `combo:verify` 通过 | `commit-2-hook.log` |

全量 Android 运行发生在本票代码内容落定之后；`git diff 1c0188a 75cae52 -- android/` 为空，合并只带进
后端/脚本/证据文件，合并后的相关 suite 重跑也证明 Android 面未受影响。

### 门禁说明：`a2ac052` 用 `--no-verify` 提交（Lead 授权口径）

正常钩子先跑后端全量：**767 pass / 5 fail**，失败全部在 `tests/jobs.test.mjs` 与
`tests/skill-learning.test.mjs`，与本票 android-only 改动无交集（`a2ac052` 只改 4 个 `android/` 文件）：

| 文件:行 | 失败用例 | 断言 |
| --- | --- | --- |
| `tests/jobs.test.mjs:296` | an awaited result and a failed report both settle without holding terminal tasks active | `3 !== 0`（`:302`） |
| `tests/skill-learning.test.mjs:696` | a failure signal never counts toward the two-session creation threshold | `3 !== 0`（`:710`） |
| `tests/skill-learning.test.mjs:731` | two independent sessions reach the threshold: one claim, one creation child, explicit no improvement | 提示词内容不匹配 `/release-notes:publish/` |
| `tests/skill-learning.test.mjs:839` | a failed creation retries only its claim, never the detection watermarks | `3 !== 0` |
| `tests/skill-learning.test.mjs:870` | a late correction inside a later interval revokes the earlier success and the old evidence is not rewritten | 同上（检测/证据区间） |

五个用例都依赖真实后台子进程与检测排期；隔离重跑这两个文件 32/32 绿，判定为并行 worktree 负载下的
选择/时序 flake（本机同一时间有 4+ 个 worktree 在跑重型套件）。按 Lead 授权：记录上述精确失败清单与
隔离重跑结果后以 `--no-verify` 提交；Android 全量门禁（`test` + `lintDebug`，757 tests）已在本 worktree
真实跑绿，相关测试确实通过。

合并提交 `3403c6c` 用 `git merge --no-verify`（Lead 常设口径：合并钩子的全量套件在并行负载下会被
负载敏感型 flake 打红，全量留收口）。

## 未完成项 / 范围外

- 未新增 Activity 级「跨端点技能提醒被忽略」用例：票面 AC 明确要求跨端点/跨账号拒绝可在 module
  interface 直接测试（本票用 module 测试覆盖），现有 Activity 用例继续覆盖跨账号与技能页落点；
  再加一条的成本是一次 Robolectric 类启动，留给后续按需补。
- 未解析通知 URI（深链接不是本基线的输入通道）、未合并两个 target 类型、未改 catalog 落点、
  未改发布侧门、未动 `RemoteReceiveController` / DI / `BillFailure`。
- 本票是 Android 定位准入的收敛，无协议、数据或 UI 呈现变化；没有真机/模拟器验收项。
- 集成分支最终全量门禁（`npm test` / `npm run combo:verify` / `./gradlew test lintDebug`）由 Lead/收口执行；
  本票不自行合入集成分支。
