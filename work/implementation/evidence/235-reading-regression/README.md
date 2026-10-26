# 235 — T2 阅读过渡回归：后端事实驱动行身份

Worktree `.worktrees/235-reading-regression`，分支 `ticket/235-reading-regression`，基线
`integration/spec-233` @ `c15f48b76f`（含 T1 #234）。测试提交 `c98375a122`；本文件随
`docs(#235)` 提交。原始日志留在 `work/tmp/235-reading-regression/`（已被根 `.gitignore` 忽略），
未提交。

## 改了什么

- 重写 `RemoteReadingTransitionTest`：每个场景只经公开
  `RemoteTranscriptPresentation.update(messages, generation, RemoteChatAttempt?, RemoteChatSettlement?, visibleKeys, followTail)`
  输入后端事实，经返回的 `RemoteTranscriptRow.key` 与 `deferFormatting` 观察身份和延迟状态。
  测试没有调用 `attemptRowKey`，也没有读取 `rowKeys`/`deferred`/`observedLiveKey`；这是 `private`
  可见性造成的编译期约束（见下节）。当前测试文件也没有自行拼出 live/settled 行键——这是对现有
  文件的观察，不是编译期保证，字符串字面量无法被 `private` 挡住；唯一有意的例外是 Testing
  Decision 5 要求的格式断言。其余断言使用先前公开更新返回行捕获的 key。
- 保留全部既有场景及断言意图：阅读中保留原始布局到终态、离开该行释放、回到尾部释放、历史不等待、
  停止/失败保留最终增量并释放完整排版、正式消息先于流结束仍只一行、独立投递、同文本不同身份、
  连续新 attempt。行键格式测试同时经返回行证明 settlement 行与已观察 live 行同 key。
- 新增否定场景：不同 generation 的 settlement；无关 attemptId 的 settlement；从未观察过的 live；
  seq 不匹配、同 seq 的 role=User、以及重复 role=Fairy 使 `singleOrNull` 为 null；旧 attempt 在新
  attempt 已成为当前 attempt 后到达。无关 attemptId 与 seq/role 两类还断言随后的精确 settlement
  仍能接续。
- 未改生产代码：没有测试暴露呈现缺陷，`RemoteTranscriptPresentation` 与 Compose 入口保持 T1 形状。
- Compose viewport/copy/tool-call 测试未改（`git diff` 相对 `c15f48b76f` 为空），T1 已迁到
  generation + `RemoteChatAttempt`，原断言保留。未新增 Compose settlement 覆盖：延迟规则与
  `RemoteTranscriptRow.documentToShow` 已由单元测试经公开结果钉住，Compose 结算只会重复同一事实；
  没有新增测试专用 key 参数或入口。

## 验证（JVM/Robolectric，不是设备验收）

聚焦套件：

```
cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteReadingTransitionTest' --console=plain
```

结果 `BUILD SUCCESSFUL in 39s`；JUnit XML `RemoteReadingTransitionTest` tests=11、failures=0、
errors=0、skipped=0。

整个 identity 包（验收要求的范围；在最终 HEAD 上强制重跑）：

```
cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.ui.identity.*' --rerun-tasks --console=plain
```

结果 `BUILD SUCCESSFUL in 25s`（67 actionable tasks executed）。JUnit XML
`app/build/test-results/testDebugUnitTest/` 汇总：

| suite | tests | failures | errors | skipped |
| --- | --- | --- | --- | --- |
| `GatewayEditingTest` | 4 | 0 | 0 | 0 |
| `IdentityAccessPolicyTest` | 3 | 0 | 0 | 0 |
| `IdentityNavigationTest` | 5 | 0 | 0 | 0 |
| `RemoteNotificationNavigationTest` | 3 | 0 | 0 | 0 |
| `RemotePresentationBaselineTest`（host 解析基线） | 1 | 0 | 0 | 0 |
| `RemotePresentationTest` | 4 | 0 | 0 | 0 |
| `RemoteReadingTransitionTest` | 11 | 0 | 0 | 0 |
| `RemoteTranscriptCopyTest`（Robolectric/Compose） | 6 | 0 | 0 | 0 |
| `RemoteTranscriptToolCallTest`（Robolectric/Compose） | 4 | 0 | 0 | 0 |
| `RemoteTranscriptViewportTest`（Robolectric/Compose） | 2 | 0 | 0 | 0 |
| `ScreenIdentityDestinationTest` | 1 | 0 | 0 | 0 |
| **合计** | **44** | **0** | **0** | **0** |

测试侧无法调用行键构造函数或读取私有状态，这是编译期可见性，不是源码扫描的结论：
`attemptRowKey` 是 `RemotePresentation.kt` 的 file-private 顶层函数，`rowKeys`、`deferred`、
`observedLiveKey` 是 `RemoteTranscriptPresentation` 的 private 成员。测试与呈现实现同在
`me.rerere.rikkahub.ui.identity` 包内，但 Kotlin 的 `private` 仍挡住调用与读取；测试若尝试，
下面记录的 `:app:testDebugUnitTest` 会在 `:app:compileDebugUnitTestKotlin` 阶段失败。编译期只保证
无法调用构造函数或读取私有状态，不保证测试不写行键字面量；当前文件除 Testing Decision 5 要求的
格式断言外，其余断言都使用先前公开更新返回行捕获的 key，这是对现有测试的观察。

提交 `c98375a122` 时仓库 pre-commit gate 按改动路径（`android/` 属全量权威）实际执行了
`npm test` 与 `npm run combo:verify`：`tests 311`、`pass 311`、`combo: combination verified`。
这是该提交上的仓库级门禁输出，不替代 T3 在最终集成状态的全量门禁。

## 测试先行说明

本票是在 T1 已建立新输入形状之后补行为回归深度，不是新增行为：测试写成后对现行实现一次通过，
没有出现需要修呈现实现的失败。11 条测试全部经公开 `update` 结果断言；每个否定场景同时检查返回
行的 key 与 `deferFormatting`，settlement 若错误建立映射，key 会退回到正式消息的 `messageId`，
断言即失败。

## 未执行 / 边界

- 未连接设备或模拟器：没有真机/模拟器上的流式阅读、延迟排版或复制验收；上表全部是 JVM/Robolectric。
- 未新增 Compose settlement 用例，原因见上；Compose 入口的 settlement 传参保持 T1 的直连写法。
- 未运行 Android `lintDebug`、`assembleDebug`、`test`（设备），也未把 `npm test` / `combo:verify`
  当作本票收口门禁；这些属于 #236（T3）的最终集成状态。
- 未 push；未改 GitHub issue；未改 `combo.json`；未触碰主检出或其它 worktree。
