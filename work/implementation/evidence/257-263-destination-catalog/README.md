# #263 目的地 catalog：打通页面、准入与恢复

日期：2026-10-29。票面：[`work/tickets/257/263.md`](../../../tickets/257/263.md)，父规格
[`#257`](../../../tickets/257/257.md)。分支 `ticket/263-destination-catalog`，worktree
`.worktrees/257-263-destination-catalog`，基线 `6ea0f790a6`（`integration/spec-257`）。

设计决议见 [`257-destination-catalog.md`](../../notes/257-destination-catalog.md)；本 README 只记本票的
改动与证据。

## 判断：先让一条完整路径成立

规格要的是「一个目的地在同一处声明页面内容、身份准入和冷启动恢复」。本票只把首页、设置、网关、
印象四条走通，其余五条留在旧路径上——这不是半成品，而是让 catalog 的形状在只有四条记录时先被
真实调用方验证：装配（`entryProvider`）、准入（`mayCompose` 闸门）、恢复（`FairyLastLocation`）
三个调用方都改读同一份表，之后 #264 只是往里加记录、删旧分支。

## 改动

新增包 `ui/destination/`：

| 文件 | 职责 |
| --- | --- |
| [`FairyDestination.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/destination/FairyDestination.kt) | 词汇：`FairyDestination`（route / access / restore / page）、`DestinationAccess`（Visitors / SignedIn / Admin）、`DestinationRestore`（Never / Resume / ResumeConversation）、`DestinationRestingPlace`、`DestinationActions`、`DestinationPageScope` |
| [`FairyDestinations.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/destination/FairyDestinations.kt) | 静态表与四个调用方接口：`entries`、`destinationOf`、`routeOf`、`restingPlaceOf`、`resumedStack`、`mayCompose`、`contentKeyOf` |

改动既有文件：

| 文件 | 职责 |
| --- | --- |
| [`RouteActivity.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/RouteActivity.kt) | `entryProvider {}` 换成普通 lambda `{ key -> navigationEntry(key as Screen, pageScope) }`；`NavEntry` 直接构造，`contentKey` 是 catalog 给的 String；`mayCompose` 闸门对已迁移目的地读 catalog；`DestinationPageScope` 由真实 `backStack` 构造 |
| [`FairyLastLocation.kt`](../../../../android/app/src/main/java/me/rerere/rikkahub/ui/fairy/FairyLastLocation.kt) | 只剩 I/O：文件名与两个键不变，写入与读取都问 catalog；未知 route 与缺 id 的会话落到具名 `UNKNOWN_LANDING` |

新增用例：

| 文件 | 覆盖 |
| --- | --- |
| [`FairyDestinationsTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/ui/destination/FairyDestinationsTest.kt) | 表驱动：四条目的地的准入矩阵（未登录 / 代理人 / 法厄同 / 残留 admin 位的未登录）、六条恢复栈、未知坐标、会话坐标、`contentKey` 区分实例、每条目的地的 route 唯一且能解析回自己、恢复栈末项是自己、恢复栈不经过 `Never` 目的地 |
| [`FairyLastLocationTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/ui/fairy/FairyLastLocationTest.kt) | 印象页被记住并恢复为「首页、设置、印象」；每条可恢复目的地写入即读出同一栈；凭据页不动文件；陌生 route 与空白会话坐标落到 `UNKNOWN_LANDING` |
| [`CatalogColdStartTest.kt`](../../../../android/app/src/test/java/me/rerere/rikkahub/CatalogColdStartTest.kt) | 生产 `RouteActivity` 冷启动：种子 `route=settings` 落到设置页、种子 `route=impression` 落到印象页；两者都断言零 HTTP |

## 关键决定

**`contentKey` 必须是 String。** 实测：`NavEntry(contentKey = screen)` 在切页时抛
`IllegalArgumentException: Type of the key Settings is not supported`——`Screen` 的子类不是
`Serializable` 也不是 `Parcelable`，而 saveable-state 装饰器要求 key 能进 Bundle。取
`route + ":" + screen` 既满足可存，又让两个会话不共用一份 saved state。这条在
`FairyDestinationsTest` 里钉住（`two conversations must not share saved state`）。

**完整性靠编译期，不靠反射。** 本机单测 classpath 没有 `kotlin-reflect`（`sealedSubclasses` 运行期抛
`KotlinReflectionNotSupportedError`）。所以 `destinationOf` 对 `Screen` 写无 `else` 的 `when`：
新增 `Screen` 子类型直接编译失败。编译器管不到的三件事——route 唯一、恢复栈末项是自己、
恢复栈不经过 `Never`——由 `FairyDestinationsTest` 断言。没有为一条测试引入新依赖。

**`ResumeConversation` 是恢复策略里的第三个分支。** 会话的栈不能写成固定列表：它的末项取决于
上次存下的会话编号。把「前缀 + 坐标」显式建成一个类型，比在 `Resume` 里塞一个可空 id 更能说明
「会话的栈与坐标有关」。缺 id 时落到 `UNKNOWN_LANDING`，是一个具名常量，不是 `else` 兜底。

**印象页的恢复是规格唯一的新增可见行为。** 今天 `FairyLastLocation.record` 的 `else -> return` 把它
排除，`restoredStack()` 也没有 `"impression"` 分支，所以印象页从不被记住。本票把它补成
`[首页, 设置, 印象]`，与它唯一的进入上下文一致。

**route 沿用旧字符串。** `home` / `settings` / `gateway` / `sessions` / `conversation` 与升级前写下的
值完全相同，升级用户的恢复位置继续有效；`sign_in` / `register` / `impression` 是本版新增的名字。

**页面装配接收作用域，不接收 Koin。** `DestinationPageScope` 携带 `actions`、`session`、`receive`、
`identityBackend`。生产侧由 Activity 从容器取；页面测试不启动 Koin，直接传自己的替身——这正是
`FairyPagesTest` 现有的夹具模型，#264 因此可以在不启动容器的前提下复用同一份装配。

## 实际跑过的命令

在 `.worktrees/257-263-destination-catalog` 上，`ANDROID_HOME=/home/eafen405/Android/Sdk`：

| 命令 | 结果 |
| --- | --- |
| `./gradlew :app:compileDebugKotlin` | BUILD SUCCESSFUL |
| `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.destination.*' --tests 'me.rerere.rikkahub.ui.fairy.FairyLastLocationTest'` | BUILD SUCCESSFUL |
| `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.SettingsColdStartTest' --tests 'me.rerere.rikkahub.ImpressionColdStartTest'` | BUILD SUCCESSFUL；两个结果文件各 `tests="1" failures="0" errors="0"` |
| `./gradlew test lintDebug` | BUILD SUCCESSFUL in 3m 18s；`testDebugUnitTest` **54 套件 / 369 用例 / 0 失败 / 0 错误**；`lint-results-debug.xml` 的 `severity="Error"` 计数 0 |

原始日志在 `work/tmp/263/gradle-test-lint.log`（不入库）。

## 未执行项

- **`npm test` 全量后端门禁未能完成。** 本票只改 `android/`，但仓库的提交门禁把任何 `android/`
  改动都判为全量模式（`scripts/precommit.ts` 的 `FULL_AUTHORITY`），于是它要跑 `npm test`。本机
  当前同时有三个 spec 在并行跑门禁，`tests/bundle-packages.test.mjs` 的 profile 安装卡住不返回
  （7 分钟 0 用例、`user` 时间 0.09s，即阻塞在等待而非计算）。**同一命令在 `main` 检出上以完全相同
  的方式卡住**，所以它不是本票引入的：该文件跑的是后端 bundle 装配，与本票改动的 Android 代码无交集。
  门禁的 Android 面（`test lintDebug`）与 `combo:verify` 都已通过。收口合并时重跑一次全量。
- **真机未验收。** 结论止于 Robolectric（SDK 35）与 `lintDebug`；冷启动恢复、返回栈与页面切换
  没有在设备上点过。
- **未验证导航返回时的 saved-state 行为。** `contentKey` 的实例区分有单测钉住取值，但「两个会话
  真的各自恢复滚动位置」没有 UI 级用例——`NavDisplay` 的 saveable-state 行为不在本票可观察范围内。
- **通知冷启动未覆盖。** `handleIntent` 的排队路径本票未改，也没有新增用例。
- **未在真实网络与真实模型下验证**，与既有客户端票相同。

