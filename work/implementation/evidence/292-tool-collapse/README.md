# #292 工具调用默认折叠为最新一次

- 票：[OurFairy #292 对话界面非必要信息的折叠需求](https://github.com/eafen405/OurFairy/issues/292)
- 分支：`ticket/292-tool-collapse`
- 开工基线：`integration/fixes-290-291-292` @ `347c966ed423502583bb3c8ac8f980965f4a1f26`（开工时该集成分支 tip 与
  `HEAD` 相同，无需先行合并）；提交前合并门禁修复 `a10711ec8d`，见「提交门禁」。
- 范围：`android/` 两个文件；未改 wire、数据库、manifest 与依赖。

## 解读：一步即一个动作

线上模型按**消息/步骤**携带工具名：`RemoteChatMessage.tools` 是这条消息请求的工具名（按请求顺序），
`RemoteChatAttempt.tools` 是正在流式的那一步已经请求的工具名（`data/remote/RemoteChatApi.kt` 的字段
注释）。后端没有任何跨消息的“行动”标识，因此本票把**一条消息（或实时 attempt 行）视为一个动作**，
折叠范围就落在这一个 transcript row 上；不跨消息合并，也不新增分组状态。

## 行为

`RemoteTranscript.kt`：

- 每个有工具的 row 默认只渲染该 row 的**最后一个**工具名（`tools.takeLast(1)`），文本仍是既有的
  `调用工具 · <name>`、`labelSmall` + `onSurfaceVariant`；没有新增 chip、逐工具图标、参数或输出。
- `tools.size > 1` 时在行尾显示箭头：收起态 `HugeIcons.ArrowDown01`（contentDescription
  `展开工具调用`），展开态 `HugeIcons.ArrowUp02`（`收起工具调用`）；展开后按请求顺序渲染该 row 的
  全部工具名。单个工具的 row 没有箭头。
- 展开状态是 `RemoteTranscript` 内的 `mutableStateMapOf<String, Boolean>`，键为 `row.key`：
  - 实时 attempt 行在流式更新中 key 不变，`tools` 增长时仍按原折叠状态只显示最新名字（有
    `a streaming step keeps its newest tool collapsed as the list grows` 固定）；
  - 新到达的步骤没有 map 项，默认收起。
- 实时行沿用既有取数：`message?.tools ?: attempt?.tools.orEmpty()`。
- 消息正文的 `combinedClickable` 长按菜单（复制/查看全文）未改；箭头自身消费点击/长按，不会打开该
  菜单（`the expand control does not open the message menu` 固定）。

## 测试（先红后绿）

测试 seam 是公开的 `RemoteTranscript` composable 的 Compose 语义树（Robolectric，`RemoteTranscriptToolCallTest`），
不读内部状态。

1. 先只改测试（`a step with several tools starts collapsed...` 等 8 个用例），在旧实现上得到红：

```bash
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests "me.rerere.rikkahub.ui.identity.RemoteTranscriptToolCallTest"
```

结果：`8 tests completed, 6 failed`、`BUILD FAILED in 23s`。失败的 6 个分别是默认收起、展开、
收起、stays while next streams、流式增长、箭头不打开菜单；另外 2 个单工具用例在旧实现上本来就成立。

2. 实现后同一命令：

结果：`BUILD SUCCESSFUL in 39s`；JUnit XML
`TEST-me.rerere.rikkahub.ui.identity.RemoteTranscriptToolCallTest.xml`：`tests=8 failures=0 errors=0 skipped=0`。

3. 提交前全量 `:app:testDebugUnitTest`（不带 `--tests`）：

结果：`BUILD SUCCESSFUL in 41s`；`app/build/test-results/testDebugUnitTest` 合计
`544 tests, 0 failures, 0 errors, 0 skipped`。

覆盖的用例：

- `a step with several tools starts collapsed on the latest name`：`read` 在、`bash` 不在、有展开箭头；
- `expanding a step reveals every tool in request order`：展开后两个名字都在，且 `bash` 的 `top`
  小于 `read`（保留 #213 的几何/顺序断言，只在展开后断言）；
- `collapsing a step hides the earlier names again`：收起后回到只显示 `read`；
- `a step with one tool shows it and no control`：单工具无展开/收起箭头；
- `a streaming step keeps its newest tool collapsed as the list grows`：`bash` → `bash, read` 后仍只显示
  `read`，且箭头在第二个工具到达后出现；
- `the expand control does not open the message menu`：长按展开箭头不出现 `复制`/`查看全文`；
- `a step still streaming shows the tool it has already requested` 与
  `the tool entry stays while the next step streams`：原有流式可见性在产品行为下仍成立。

## 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest --tests "me.rerere.rikkahub.ui.identity.RemoteTranscriptToolCallTest"`（旧实现 + 新测试） | 8 tests，6 failed，`BUILD FAILED in 23s` |
| 同上（新实现） | `BUILD SUCCESSFUL in 39s`，8/8 通过 |
| 同上（合并 `a10711ec8d` 后重跑） | `BUILD SUCCESSFUL in 10s`，JUnit XML 8 tests、0 failures/errors/skips |
| `cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest` | `BUILD SUCCESSFUL in 41s`，544 tests，0 failures/errors/skips |
| `cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug` | `BUILD SUCCESSFUL in 3m 51s`，JUnit XML 合计 616 tests（app 544、ui 20、highlight 52），0 failures/errors/skips；lint 0 error（31 条既存 warning，`RemoteTranscript.kt` 的一条是既有 Modifier 参数顺序告警） |
| `git merge --autostash integration/fixes-290-291-292` | fast-forward `347c966ed4` → `a10711ec8d`（门禁修复 #293），autostash 正常恢复；见「提交门禁」 |
| 提交 | 走仓库钩子（完整后端套件 + Android `test lintDebug`），未使用 `--no-verify` |

## 提交门禁

第一次 `git commit` 被 #293 挡住，未提交、未使用 `--no-verify`：`tests/precommit.test.mjs` 的
`the merge entry point asks for the full gate itself` 实跑 `scripts/precommit.ts --print --merge` 时读取
真实暂存区；本票暂存了 `android/**`，`plan()` 正确追加 `./gradlew test lintDebug`，测试却仍按
`FULL_COMMANDS` 全等断言，于是钩子的 `npm test` 先失败。核验：带上暂存文件时
`node --test tests/precommit.test.mjs` 为 28 tests / 27 pass / 1 fail；合成空 index 时该判定只含
`npm test` + `combo:verify`。

门禁修复已落在集成分支 `a10711ec8d`（`tests/precommit.test.mjs` 的 merge 自检改用从 `HEAD` 填充的临时
index），本票合并后 `node --test tests/precommit.test.mjs` 在暂存 `android/**` 的情况下 28/28 通过；
随后按定向命令重跑 `RemoteTranscriptToolCallTest`，提交在修复后的门禁上重试。

## 合并状态

- `git merge --autostash integration/fixes-290-291-292`：`Updating 347c966ed4..a10711ec8d`，
  `Fast-forward`（`tests/precommit.test.mjs`、`work/implementation/evidence/293-precommit-merge-index/`），
  本票的暂存改动经 autostash 正常恢复，`git status` 仍只有本票三个文件。
- 合并后重跑定向 `RemoteTranscriptToolCallTest`，见「实际命令与结果」。

## 未执行项

- **真机/模拟器交互未执行**：箭头点击、长按屏蔽菜单、TalkBack 读出的
  `展开工具调用`/`收起工具调用`、折叠/展开后的实际行高与视觉密度都只在 Robolectric + Compose
  测试中验证，没有在设备上目视或手势验收。
- 未测 `tools` 在展开状态下继续增长时的屏幕表现；行为由 `visible = tools` 直接决定，但没有单独用例。
- 未测行滚出视口再回到视口后的展开状态（状态存在 `RemoteTranscript` 的 map 中，但没有滚动用例）。
- 无数据库、wire、manifest、依赖变更；未改后端与 dsh。
