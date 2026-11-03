# 234 — T1 呈现接口：attempt 行身份由后端事实派生

Worktree `.worktrees/234-presentation-identity`，分支 `ticket/234-presentation-identity`，基线
`integration/spec-233` @ `ff2502c2b2`。实现提交 `af7e844b2c`；本文件随 `docs(#234)` 提交。
日志留在 `work/tmp/234/`（已被根 `.gitignore` 忽略），未提交原始输出。

## 改了什么

- `RemoteTranscriptPresentation.update` 的输入收敛为
  `messages, generation, RemoteChatAttempt?, RemoteChatSettlement?, visibleKeys, followTail`。
  `attemptRowKey` 收为 `RemotePresentation.kt` 内的私有函数；live 行键与 settlement 对齐键都由它的
  同一实现从同一 generation 与后端 attempt id 派生，格式仍是 `attempt:<generation>:<attemptId>`。
  `rowKeys`、`deferred`、`observedLiveKey` 仍是私有瞬态状态，处理顺序未变：先按
  `settledKey == observedLiveKey` 决定是否接续 role=Fairy 且 seq 精确相等的 `singleOrNull` 消息，
  再更新 observedLiveKey、释放 deferred、清理 rowKeys、生成消息行并追加 live 行。
- `RemoteTranscript` 的 attempt 输入只剩 `generation`、可空 `RemoteChatAttempt` 与可空
  `RemoteChatSettlement`；删除 `attemptText`、`attemptKey`、`attemptTools` 与预拼 key。attempt 为空
  时没有 live 行；attempt 存在时即使文本为空也有一行；工具名来自 `attempt.tools`。行为不变的部分：
  空会话占位、阅读位置、`onFinalPresented`、复制/查看全文、附件与下载。
- `RemoteChatPanel` 直接传 `projection.generation`、`projection.attempt`、`projection.settledAttempt`。
  `PresentationBenchmarkActivity` 与 `StreamingRateActivity` 用同一组事实，删除两侧的
  `attemptRowKey(...) to seq` 拼接。
- 迁移四个既有测试的调用形状：`RemoteReadingTransitionTest`（含经公开 `update` 返回行观察
  `attempt:<generation>:<attemptId>` 的格式测试）、`RemoteTranscriptViewportTest`、
  `RemoteTranscriptCopyTest`、`RemoteTranscriptToolCallTest`。断言意图与数量未变；没有测试调用行键
  构造函数，也没有读取私有状态。
- 未改 `RemoteChatApi`、`RemoteChatState`、`ChatSyncStore`、`RemoteReceiveState`、conflate、后端、
  网络字段或持久状态；改动面见 `git show --stat af7e844b2c`。

## 测试先行（red）

先把四个测试文件迁到新输入形状，此时生产 interface 仍是旧的，然后运行：

```
cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteReadingTransitionTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteTranscriptViewportTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteTranscriptCopyTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteTranscriptToolCallTest' --console=plain
```

结果 `BUILD FAILED in 48s`：`:app:compileDebugUnitTestKotlin` 拒绝旧形状，错误为
`No value passed for parameter 'attemptText'` / `'attemptKey'`、`No parameter with name
'generation'` / `'attempt'`，以及 `RemoteReadingTransitionTest` 旧 `update` 的 `text` 参数缺失。
这是接口迁移的 red；随后才实现新形状。

## 实现后验证（green）

同一命令：`BUILD SUCCESSFUL in 20s`。JUnit XML `app/build/test-results/testDebugUnitTest/`：

| suite | tests | failures | errors | skipped |
| --- | --- | --- | --- | --- |
| `RemoteReadingTransitionTest` | 6 | 0 | 0 | 0 |
| `RemoteTranscriptViewportTest` | 2 | 0 | 0 | 0 |
| `RemoteTranscriptCopyTest` | 6 | 0 | 0 | 0 |
| `RemoteTranscriptToolCallTest` | 4 | 0 | 0 | 0 |

这些是 JVM/Robolectric 测试，不是设备验收。

## 编译

```
cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew \
  :app:compileDebugKotlin :app:compilePerfKotlin --console=plain
```

`BUILD SUCCESSFUL in 23s`。`:app:compilePerfKotlin` 实际执行；`:app:compileDebugKotlin` 本轮为
`UP-TO-DATE`，因为紧邻的 focused test 运行已执行该任务（green 日志内有 `> Task :app:compileDebugKotlin`，
无 UP-TO-DATE 后缀）。两条编译警告是既有的、与本次改动无关：
`ui/fairy/FairyConversationPage.kt:119`（Condition is always 'true'）与 perf
`PresentationBenchmarkActivity.kt:176`（deprecated `defaultDisplay`）。

## 附带：仓库 pre-commit gate

提交 `af7e844b2c` 时仓库 pre-commit hook 按 9 个改动路径自动跑了完整门禁：`npm test` 311/311 通过、
0 失败；`combo:verify` 输出 `combo: combination verified`。这是 hook 的实际输出，用于说明该提交没有
让仓库级检查漂移；不替代 T3 在最终集成状态的全量门禁。

## 未执行 / 边界

- 未连接设备或模拟器：没有真机/模拟器上的流式、延迟排版、复制或工具行验收；Compose 断言来自
  Robolectric。
- 未新增 #235（T2）的否定场景套件（不同 generation、无关 settlement、未观察 live 等）；本票只迁移并
  保持既有断言。迁移后的测试已保留“未观察 live / 无关 settlement 不新增行”的既有断言。
- 未在最终集成状态手动运行 Android `test`、`lintDebug`、`assembleDebug`，也未把 `npm test`/
  `combo:verify` 当作本票的收口门禁——这些属于 #236（T3）；上面记录的是 pre-commit hook 在本次提交
  上的实际运行结果。
- 未 push；未改 GitHub issue；未改 `combo.json`；未触碰主检出或其它 worktree。
