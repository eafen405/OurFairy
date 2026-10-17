# Ticket #61 — attempt 行 key 约定收敛（Android / rikkahub）

- 仓库：`/home/eafen405/projects/rikkahub`
- worktree：`.worktrees/arch-61-attempt-row-key`
- 分支：`arch/61-attempt-row-key`
- 基线 / 集成分支：`product/ourfairy-v1` = `771bffd1`（开工时确认；提交前再确认仍未前进）
- 提交：`f3248641 refactor(presentation): state the attempt row key convention once`
- 合并集成分支后 tip：`f32486416e73f90f0609acc514d0f31613bd1a75`（`Already up to date`，集成分支未前进）

## 改了什么

1. `ui/identity/RemotePresentation.kt` 新增唯一构造函数：
   `internal fun attemptRowKey(generation: String, attemptId: String?): String = "attempt:$generation:$attemptId"`，
   并注明它与 `RemoteTranscriptPresentation` 的推迟格式化判定互为前提（KDoc）。
2. `ui/identity/RemoteChatPanel.kt:214`：`settledAttempt` 不再手拼 `"attempt:${...}"`，改调 `attemptRowKey(...)`。
3. `ui/identity/RemoteTranscript.kt:106`：从 `(generation, attemptId)` pair 拼 key 处改调 `attemptRowKey(first, second)`。
   参数签名未改（仍为 `Pair<String, String?>?`），最小改动、不扩散到调用方。
4. `RemoteReadingTransitionTest`：不再自造 `"live"` / `"generation:first"` 等 key，全部经 `attemptRowKey(...)` 生成；
   新增一条字面量断言 `attempt:gen-7:attempt-2`，把约定格式本身钉住（漂移会红，不再只能靠设备发现）。
5. 明确未做：合并 `onBeforeFormat` / `onRichPresented`（票面建议暂缓，触及合成逻辑）。
6. 范围外发现、未改：`PresentationBenchmarkActivity.kt:145` 仍硬编码 `"attempt:benchmark:tail"`。
   它是 benchmark harness 的独立键（generation=`benchmark`、attemptId=`tail`），不参与生产会话路径；
   票面三处已收敛，未把 benchmark 纳入以免扩大改动面。它若漂移只影响自身测量，不影响延后格式化。

## 命令与结果

环境：`ANDROID_HOME=/home/eafen405/Android/Sdk`、`PATH=/tmp/ourfairy-bin:$PATH`，
`-Pourfairy.identityEndpoint=https://example.invalid -Dorg.gradle.jvmargs='-Xmx5g -Dfile.encoding=UTF-8' --max-workers=3 --parallel --console=plain`。

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| red（定向） | `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.identity.RemoteReadingTransitionTest'` | FAILED：`Unresolved reference 'attemptRowKey'`（测试先用了不存在的公共构造函数）—  |
| green（定向） | 同上 | BUILD SUCCESSFUL；该套件 5 tests / 0 failures —  |
| 钉住约定（定向） | 同上（新增字面量断言后） | BUILD SUCCESSFUL；6 tests / 0 failures —  |
| 漂移演练（变异检查） | 临时把实现改成 `attempt/$generation/$attemptId` 后跑定向 | FAILED：`attempt row key spells the generation scoped attempt convention`（ComparisonFailure）→ 约定漂移现在会被测试捕获；已还原 —  |
| 验收（全量） | `./gradlew :app:testDebugUnitTest :app:assembleDebug`（合并集成分支后的 tip 上） | BUILD SUCCESSFUL；69 套件 / 516 tests / 0 failures / 0 errors（基线 515 + 本票新增 1 条）；`assembleDebug` 产出 3 个 debug APK —  |

条数由  聚合统计，未只看 BUILD SUCCESSFUL。

## 证据文件

-  — red（编译期未解析引用）
- 、 — 定向 green
-  — 变异检查：格式漂移被测试捕获
-  — 全量 JVM + debug 构建

## 未完成 / 边界

- 仅声明 JVM 单元测试与 `assembleDebug` 通过；未做真机/模拟器、Firebase、真实云服务或性能验收。
- 未 push、未合入集成分支、未改 `combo.json`、未评论/关闭 issue。
- 生产 Compose 调用点（`RemoteChatPanel`/`RemoteTranscript`）本身仍无单元测试覆盖；本票的保证是「约定只陈述一次 + 两处共用同一函数 + 格式被测试钉住」，
  而非对 composable 的运行时覆盖。
