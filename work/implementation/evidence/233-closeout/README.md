# 233 — T3 收口：attempt 行身份由后端事实派生

Worktree `.worktrees/236-closeout`，分支 `ticket/236-closeout`，基线
`integration/spec-233` @ `526853df65`（含 T1 #234、T2 #235）。评审修复提交
`eb1c17dfa1`、`65bbbb4433`、`7678e334bd`、`548b6a3bb9`；本文件与证据索引描述文件随后续
`docs(#236)` 提交。原始日志留在 `work/tmp/236-closeout/`（被根 `.gitignore` 忽略），未提交。

## 评审发现与处置

| # | 发现 | 处置 | 失效时失败的检查 |
| --- | --- | --- | --- |
| 1 | `235-reading-regression/README.md` 用 `grep` 扫测试源码充当结构检查 | 改写出真实接缝：`attemptRowKey` 是 `RemotePresentation.kt` 的 file-private 顶层函数，`rowKeys`/`deferred`/`observedLiveKey` 是 `RemoteTranscriptPresentation` 的 private 成员；测试若调用或读取，测试编译失败。删除了「正则保证测试形状」的措辞，也明确 `private` 不阻止字符串字面量 | `cd android && ./gradlew :app:testDebugUnitTest …` 的 `:app:compileDebugUnitTestKotlin` 阶段 |
| 2 | `RemoteReadingTransitionTest` KDoc 说「测试从不自行拼 attempt key」，但格式测试断言了 `attempt:gen-7:attempt-2` | 改为「helper 只收后端事实、不收行键」；并指明唯一的格式字面量是 Testing Decision 5 的有意断言 | 文档修正，无行为断言；格式测试见下 |
| 3 | 全量门禁未在集成分支最终状态运行 | 在最终 HEAD 运行 Android `test lintDebug assembleDebug`、`:app:compilePerfKotlin`、`npm test`、`npm run combo:verify`，结果见下 | 四条命令本身 |
| 4 | 呈现 `update` 参数 `settled` 与测试 helper 的 `settlement` 名称不一致 | 参数改为 `settlement`，局部 settlement 对象改名为 `endedAttempt`、派生键改名为 `settlementKey`；所有调用点均按位置传参，无需迁移 | 既有 `RemoteReadingTransitionTest` 11 条；改名后聚焦与全量套件通过 |
| 5 | `LaunchedEffect(messages, generation, attempt, settledAttempt)` 使 tools-only、revision-only、settlement-only 快照也重跑 `preservePosition()` | 收窄为 `LaunchedEffect(messages, generation, attempt?.attemptId, attempt?.text)`，回到旧调用形状依赖的事实；settlement 不再单独触发重定位 | `RemoteTranscriptViewportTest.reading history stays at the same position while the reply updates` 断言同一事实（阅读位置不移动）；没有新增 settlement-only 覆盖，也不声称新覆盖 |
| 6 | Compose 测试重复构造 `RemoteChatAttempt`、`projection?.generation.orEmpty()` 哨兵与三处 projection 三元组 | 判断为暂不抽象：测试侧 5 处构造分散在 4 个文件、每处 1–3 行且文本/工具不同，共享 fixture 需新增测试工具文件；生产侧 3 处各 1 行，`projection == null` 时 attempt 与 settledAttempt 同时为 null，空 generation 不会进入任何行键；加 bundle 类型会引入规格明确避免的新类型。理由记录于此，未加推测性抽象 | 不需要新检查；既有编译期参数名/类型已挡住漂移 |
| 7 | T2 重写丢掉了独立投递行的 `deferFormatting == false` 断言，使「保留全部既有断言」过强 | 恢复 `assertFalse(next[0].deferFormatting)`；该行若被错误延迟，断言失败 | `RemoteReadingTransitionTest.same text delivery and new live attempt are never identified by content` |
| 8 | 是否有其它缺失的规格行为 | 复核 T2 全部既有断言与 11 条场景，未发现缺失行为；未新增范围 | 下方声称对照表 |

## 改动

- `android/app/src/main/java/me/rerere/rikkahub/ui/identity/RemoteTranscript.kt`：`LaunchedEffect`
  键收窄（发现 5）。这是本次唯一的行为回归修复，恢复的是 settlement 前既有行为。
- `android/app/src/main/java/me/rerere/rikkahub/ui/identity/RemotePresentation.kt`：`settled` →
  `settlement`，派生键与 settlement 局部名一致（发现 4）。
- `android/app/src/test/java/me/rerere/rikkahub/ui/identity/RemoteReadingTransitionTest.kt`：恢复投递
  行断言、修正 helper KDoc（发现 2、7）。
- `work/implementation/evidence/235-reading-regression/README.md`：改用编译期私有接缝，删除
  `grep` 源码检查（发现 1）。
- 本文件与 `work/implementation/evidence/index/20-attempt-row-identity.json`；证据索引表格由
  `npm run evidence:index` 生成，未手改。

未修改 `RemoteChatApi`、`RemoteChatState`、`ChatSyncStore`、`RemoteReceiveState`、`conflate`、
后端、网络字段、数据库或持久呈现状态；`combo.json` 未改；没有新增测试专用 key 入口。

## 验证

以下结果都来自本 worktree 最终 HEAD 的树；JVM 测试由 Gradle 在宿主 JVM 上运行，Compose 用例为
Robolectric，不是设备或模拟器验收。

### 聚焦套件（JVM/Robolectric）

```
cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteReadingTransitionTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteTranscriptViewportTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteTranscriptCopyTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteTranscriptToolCallTest' --console=plain
```

`BUILD SUCCESSFUL in 43s`（71 actionable tasks executed）。JUnit XML：

| suite | tests | failures | errors | skipped |
| --- | --- | --- | --- | --- |
| `RemoteReadingTransitionTest` | 11 | 0 | 0 | 0 |
| `RemoteTranscriptViewportTest`（Robolectric/Compose） | 2 | 0 | 0 | 0 |
| `RemoteTranscriptCopyTest`（Robolectric/Compose） | 6 | 0 | 0 | 0 |
| `RemoteTranscriptToolCallTest`（Robolectric/Compose） | 4 | 0 | 0 | 0 |

### Android 最终门禁（最终 HEAD）

```
cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug assembleDebug --console=plain
```

`BUILD SUCCESSFUL in 2m 44s`（161 actionable tasks：91 executed、70 up-to-date）。在最终证据提交上
重跑同一命令为 `BUILD SUCCESSFUL in 2s`（157 actionable tasks：3 executed、154 up-to-date；
`:app:testDebugUnitTest`、`lintDebug` 与 `assembleDebug` 均为 up-to-date，输入未变）。JUnit
`app/build/test-results/testDebugUnitTest/`：37 suites、232 tests、0 failures、0 errors、0 skipped。
`lintDebug` 成功：30 条 warning、0 error；touched 文件 `RemoteTranscript.kt:84` 的
`ModifierParameter` 是既有 `modifier` 参数位置警告，本次未改参数顺序。`assembleDebug` 产出三个
APK：`app-arm64-v8a-debug.apk`（32,079,953 bytes）、`app-universal-debug.apk`
（32,097,086 bytes）、`app-x86_64-debug.apk`（32,080,614 bytes）。

### Perf 源集编译

```
cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:compilePerfKotlin --console=plain
```

`BUILD SUCCESSFUL in 39s`（32 actionable tasks：28 executed、4 up-to-date）；在最终证据提交上重跑为
`BUILD SUCCESSFUL in 1s`（28 actionable tasks 均 up-to-date）。两条编译 warning 是既有的
`FairyConversationPage.kt:119` 与 `PresentationBenchmarkActivity.kt:176` deprecated
`defaultDisplay`。这只证明性能 caller 与新签名一起编译，不是性能或设备验收。

### 仓库门禁

从仓库根：

```
npm test
npm run combo:verify
```

`npm test`：`tests 311`、`suites 7`、`pass 311`、`fail 0`、`skipped 0`、`duration_ms 73579`。
`npm run combo:verify`：ourfairy 基于集成分支 tip、dsh `d1b6099ae716870a`、android source
`460109d1b89b824a`，输出 `combo: combination verified`。

### 证据索引

```
npm run evidence:index
npm run evidence:index -- --check
```

生成输出 `evidence index rewritten: 253 line(s)`，复核输出 `evidence index is current`。生成的表格行
把 `234-presentation-identity`、`235-reading-regression`、`233-closeout` 三份 README 挂在
`#233 Android 呈现：attempt 行身份由后端事实派生` 小节下。

## 测试先行说明

本票修复都是收口发现，不是新增产品行为：改名与证据措辞不改变行为，`LaunchedEffect` 收窄恢复的是
settlement 前既有的事实键，恢复的断言是既有检查的回归保护。因此没有新的 red→green 循环；行为修复
由既有 Compose viewport 测试守护，断言的是同一事实（流式更新时阅读位置不移动）。T1/T2 的新接口与
场景在各自票中已有 red/green 记录（见 `234-presentation-identity`、`235-reading-regression`）。

## 可执行声称对照表

| 规格声称 | 失效时会失败的测试或命令 |
| --- | --- |
| 同一 attempt 的 live 行与 settlement 后正式行保留同一 key | `RemoteReadingTransitionTest.attempt row key format is generation scoped and settlement keeps the observed live key`、`reader keeps same raw layout…`；聚焦命令 |
| 行键只在呈现 implementation 内派生，测试不能调用构造函数或读私有映射 | `attemptRowKey` 为 file-private、三个状态为 private；聚焦命令的 `:app:compileDebugUnitTestKotlin` 阶段。注意这不禁止测试写行键字面量，格式字面量是 Testing Decision 5 的有意断言 |
| 未观察过的 live 不被 settlement 接续 | `settlement for a live attempt never observed neither maps nor defers` |
| 不同 generation 的 settlement 不接续 | `settlement from another generation neither inherits the observed row nor defers` |
| 无关 attemptId、旧 attempt 不接续 | `unrelated settlement neither maps nor defers…`、`settlement for the previous attempt does not map after a new attempt is current` |
| 只匹配 role=Fairy 且 seq 精确相等的唯一消息 | `settlement only maps a unique Fairy message with the exact seq…`（含 seq 不匹配、role=User、重复 Fairy 三种否定） |
| 阅读中延迟排版；离开该行、回到尾部释放；历史不等待 | `reader keeps same raw layout…after leaving`、`return to tail releases pending formatting while history never waits for scrolling` |
| 停止与失败保留最终增量并释放完整排版 | `stopped and failed terminal bodies retain final increment and release full formatting` |
| 正式消息先于流结束仍只有一行 | `formal reply before stream end and unrelated delivery retain exactly one settled reading row` |
| 独立投递行不共享 attempt 身份、不被延迟 | 同上的行 key 断言与 `same text delivery and new live attempt are never identified by content` 中恢复的 `assertFalse(next[0].deferFormatting)` |
| 流式正文可复制 | `RemoteTranscriptCopyTest` 6 条（Robolectric/Compose）；聚焦命令 |
| 流式工具名来自后端 attempt | `RemoteTranscriptToolCallTest` 4 条（Robolectric/Compose）；聚焦命令 |
| 流式更新不移动阅读位置 | `RemoteTranscriptViewportTest.reading history stays at the same position while the reply updates`；也是发现 5 收窄的守卫，断言同一事实 |
| 生产 panel 与两个性能 caller 使用同一事实输入 | `:app:compilePerfKotlin` 与 `assembleDebug` 编译三处 caller；签名不匹配即失败 |
| 未修改 `RemoteChatApi`、`RemoteChatState`、`ChatSyncStore`、`RemoteReceiveState`、`conflate`、后端、网络字段、数据库、持久呈现状态或 `combo.json` | `git diff --exit-code main...HEAD -- android/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatApi.kt android/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatState.kt android/app/src/main/java/me/rerere/rikkahub/data/remote/ChatSyncStore.kt android/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteReceiveState.kt combo.json backend` 退出码 0 |

## 未执行 / 边界

- 未连接真机或模拟器：没有设备上的流式阅读、延迟排版、复制、工具行或性能验收；上述 Compose 结果
  都是 Robolectric。
- 未做性能基准，也不声称性能变化；只编译了 perf 源集。
- 未执行 release 构建与签名验收；`lintDebug`/`assembleDebug` 是 debug 门禁。
- 未新增 Compose settlement 场景（T2 已说明其与单元测试重复），本次只恢复既有投递断言。
- 未 push；未修改或关闭 GitHub issue；未改 `combo.json`；未触碰主检出或其它 worktree。
