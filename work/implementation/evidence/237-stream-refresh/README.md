# #237 流式正文分帧呈现

基线：`main` @ `d56b928c2e`；分支：`ticket/237-stream-refresh`；worktree：`.worktrees/237-stream-refresh`。
票面与工作副本：`work/tickets/237/README.md`。本文件记录确定性复现、红绿回归、评审和最终门禁；原始日志、视频与测量 JSON 不入库。

## 复现与定位

用户报告当前发布包在 vivo S50 上总速度正常，但正文约每秒只刷新三次，一次出现数行。发布页与本地检出均对应 `main@d56b928c`。

使用现有 #214 真实 HTTP/SSE、Android 接收状态与 Compose 测量接缝，在空会话输入每次 80 字符、间隔 333 ms 的累计正文。修复前的最小结果为：

| 环节 | 推进次数 | 总字符速率（UTF-16 字符/秒） |
| --- | ---: | ---: |
| 模型分片 | 6 | 225.00 |
| 产品 SSE | 6 | 226.13 |
| 设备 SSE | 6 | 226.20 |
| Android 状态应用 | 6 | 225.86 |
| Compose 呈现 | 6 | 225.76 |

呈现为 **3.01 次/秒**，单次最多增加 **80 字符**，最大间隔约 **342 ms**；总速度没有异常。40 轮历史不是触发条件。细分片在同一设备上可达约 28 次/秒，真实本地模型链路的 SSE、状态应用和呈现均约 17.5 次/秒，因此设备能够高频呈现，中间快照也没有在网络或状态层丢失。

`RemoteTranscriptPresentation.update` 将完整 `attempt.text` 直接放入视觉行。问题是大分片原样穿过所有环节后，呈现 implementation 没有自己的逐帧推进节奏。

## 改动

- `RemoteTranscript` 在现有呈现 implementation 内为实时 attempt 维护瞬态可见前缀，逐帧按 Unicode 码点推进；至少推进 4 个码点，并按剩余量分摊到 16 帧内加速，避免持续积压。
- 后端事实、`RemoteTranscript` 公共输入、attempt 行键、工具名与正式消息不变。正式消息仍在下一帧直接发布完整正文，不等待实时分帧队列。
- 阅读位置随实际可见正文推进；复制已打开的实时行时仍取得已经到达的完整正文，而不是可见前缀。
- 新增 `RemoteStreamingPacingTest` 两条 Compose 回归；在现有 `RemoteTranscriptCopyTest` 增加一条部分显示时复制全文的回归。未改后端、网络 DTO、SSE、数据库或持久状态。

## 红绿回归与评审

首个回归经公开 `RemoteTranscript` 输入 80 字符，要求早期帧只显示部分正文、随后显示全文。修复前：

```text
RemoteStreamingPacingTest > large live increments are revealed progressively before the latest text completes FAILED
java.lang.AssertionError
```

实现后该用例通过。复制回归先证明只读可见行会复制部分正文（`org.junit.ComparisonFailure`），恢复读取已到达全文后通过。终态用例证明分帧期间收到正式消息后，下一帧即显示完整正文。

最终聚焦命令：

```sh
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteStreamingPacingTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteReadingTransitionTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteTranscriptViewportTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteTranscriptCopyTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteTranscriptToolCallTest' --console=plain
```

结果：`BUILD SUCCESSFUL`，**26 tests / 0 failures**。这些都是 JVM/Robolectric 行为测试，不是设备性能测量。

两轴评审范围是 `main` 后的未提交差异及未跟踪测试。Spec 无发现。Standards 无硬性违规；唯一判断项是复制回归与现有复制测试的夹具重复，已将用例迁入 `RemoteTranscriptCopyTest`，最终复核无剩余发现。

## 最终门禁

从 worktree 根执行：

```sh
npm test
npm run combo:verify
npm run evidence:index
npm run evidence:index -- --check
```

- `npm test`：**336 tests / 336 pass / 0 fail / 0 skipped**。
- `npm run combo:verify`：`combo: combination verified`，OurFairy、dsh 与 Android 来源声明均通过。
- 证据索引生成 265 行，复核输出 `evidence index is current`。

Android 最终命令：

```sh
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug assembleDebug :app:compilePerfKotlin --console=plain
```

`BUILD SUCCESSFUL in 3m 3s`。JUnit XML 合计 **44 suites / 308 tests / 0 failures / 0 errors / 0 skipped**；lint 为 **31 warnings / 0 errors**；debug APK 完成打包，perf 源集编译通过。上述结果均来自合并前的 worktree 最终树（基线 `d56b928c2e` + 本票改动），不是真机验收；合并 `main` 后重跑的数字见「合并」一节。

## 未执行 / 边界

- 修复后的 vivo S50 真机复测未执行：实施期间 USB 设备断开。不得把上述 JVM/Robolectric、构建或旧基线测量写成修复后的真机证据。
- 原始复现探针、视频和测量 JSON 未入库；持久回归为上述公开 Compose 与复制测试。
- 本证据记录合入 `main` 前的最终树与门禁；合并提交与合并后门禁记录在 `main` 上的后续 docs 提交。

## 合并

- 合入前先把 `main`（`6c9cee351e`）并入 `ticket/237-stream-refresh`（快进，分支无本地领先提交）；随后提交实现 `1d162b2b51`。
- `main` 以 `--no-ff` 合入该分支，合并提交 `0e31f05f6a`（`Merge branch 'ticket/237-stream-refresh'`）。合并提交的树与 `1d162b2b51` 的树同为 `c19e5a9f20`，所以第 3 节的门禁结果对应的就是现在 `main` 上的树。
- 合并提交在 `android/` 的改动上重新运行了提交门禁：`npm test` **340 tests / 340 pass / 0 fail / 0 skipped**，`npm run combo:verify` 三行 `ok`，以及 `./gradlew test lintDebug`（`BUILD SUCCESSFUL in 7s`）。
- 合并后另跑完整 Android 门禁 `./gradlew test lintDebug assembleDebug :app:compilePerfKotlin`：`BUILD SUCCESSFUL in 2m 37s`；JUnit XML 合计 **44 suites / 319 tests / 0 failures / 0 errors / 0 skipped**（app 246 + highlight + ui；比合并前的 308 多出 `main` 新并入的用例），lint **0 errors / 30 warnings**，debug APK 与 perf 源集均成功。
- 触发命令（在 worktree 根，`main` 并入后）：

```sh
npm test
npm run combo:verify
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug assembleDebug :app:compilePerfKotlin --console=plain
```

- 真机复测仍未执行；本票不据此关闭 issue，等本人在 vivo S50 上体验确认后自行关闭。
