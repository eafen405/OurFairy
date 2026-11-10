# #344 Android 会话命令

2026-11-10，分支 `ticket/344-session-command-android`。本票最初从 `integration/spec-342@377e86342413d4e01e1e0e7a0c324b462376e08d` 创建；交付前已包含 #343 的后端实现，最终基线与 `integration/spec-342` 均为 `0b911101ee58d693064db6c040534a91fcf14191`。执行 `git merge --no-edit integration/spec-342` 返回 `Already up to date.`。协议使用 [客户端合同](../../../../tickets/342/protocol.md)，需求为 [Android 票面](../../../../tickets/342/02-android.md) 与 [正式规格](../../../../../docs/specs/session-commands.md)。

原执行者 runtime 中断后，recovery 执行者接管同一 worktree，保留全部未提交源码、测试与日志；复核已有最终日志和标准 JUnit XML 后补齐本证据，没有重跑已通过且没有源码变更的 Android 测试。原始输出与恢复时生成的 XML 汇总保留在本 worktree 的以下目录，不提交原始日志/XML：

```text
work/tmp/344/
work/tmp/344/recovery-junit-summary.json
android/app/build/test-results/testDebugUnitTest/TEST-*.xml
```

## 实现与可观察行为

- [RemoteSessionCommand.kt](../../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteSessionCommand.kt) 固定 `/compact`、`/clear` 两项。候选、完整匹配、着色与发送分流复用同一识别规则；允许首尾空白。前缀、未知斜杠、附加说明和普通正文仍走普通发送，原文本不 trim 后提交。
- [RemoteChatApi.kt](../../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatApi.kt) 接入 execute/status 两个 Bearer HTTP 接口及 `role:3,kind:3` 系统行。snapshot status 为 1 进行中、2 已压缩、3 无需压缩、4 已重置、5 失败。命令接口保持窄边界，普通 send receipt 不承担命令完成语义。
- [ChatSyncStore.kt](../../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/ChatSyncStore.kt) 仅增加可选待恢复命令身份、类型和原草稿；旧记录可加载。消息正文、分界与结果仍从远端日志投影恢复。
- [RemoteChatState.kt](../../../../../android/app/src/main/java/me/rerere/rikkahub/data/remote/RemoteChatState.kt) 在网络副作用前保存稳定 requestId；命令绑定发起账号及会话。结果不明先查询原 requestId，只有显式重试且查询无受理事实时才按原身份重发；明确拒绝/终态失败后用户显式重试才建立新身份。HTTP 终态依合同已经耐久；观察者系统行必须 `seq <= durableThroughSeq` 才呈现终态并消解 pending，同 generation 的耐久水位不倒退。
- [RemoteChatPanel.kt](../../../../../android/app/src/main/java/me/rerere/rikkahub/ui/identity/RemoteChatPanel.kt) 在编辑框上方展示候选，点选仅补全并保持焦点；完整命令使用主题 `signal`。附件齐备时尝试发送完整命令会显示先移除附件的提示，保留附件和草稿，不调用命令或普通 send。命令处理时仍可编辑后续草稿，恢复按钮仅在编辑区为空时写回失败命令；查询失败呈现具体原因并允许恢复原操作。
- [RemoteTranscript.kt](../../../../../android/app/src/main/java/me/rerere/rikkahub/ui/identity/RemoteTranscript.kt) 与 [RemoteSessionCommandStatus.kt](../../../../../android/app/src/main/java/me/rerere/rikkahub/ui/identity/RemoteSessionCommandStatus.kt) 展示五种命令状态和具体错误，不创建普通用户/Fairy 气泡。“上下文已重置”系统结果本身是分界，并显示“聊天历史、印象、长期记忆与可用技能仍保留”；HTTP 已返回终态但系统行尚未到达时同样可见该说明。没有新增二次确认。

本票仅交付 Android 接线；真实模型上下文的压缩/重置、后端权限及 retention 由 #343/#345 的产品入口证据覆盖。

## 测试接缝与 TDD 证据

使用 `tdd` skill；接缝沿用已确认的回环 HTTP、Android 公共状态以及 Compose/Robolectric 页面，不重新询问接缝。API 使用 JDK 回环 HTTP 与真实 OkHttp；状态测试使用网络/存储边界替身；页面使用真实 RemoteChatState 与生产面板/Transcript，在 Robolectric SDK 35、NATIVE、中文 411×891dp 环境运行。存储失败来自替身，不是真实磁盘 EACCES 验收。

现存红绿日志已逐项核对。前三项红灯是新增公开合同尚未实现导致的编译失败，其中 durable 红灯另包含测试构造参数类型错误；这些不冒充已经执行的行为断言失败。其余红灯是实际页面/公共状态断言失败。历史每轮 XML 已被最后一轮覆盖，因此仅按留存文本记录红灯数量和绿灯构建结论，不补造各轮通过数。

| 日志名（均位于上述临时目录） | 红灯实际结果 | 对应最小实现/故障修复及绿灯 |
| --- | --- | --- |
| `api-red.log` / `api-green.log` | 缺少 executeCommand/commandStatus，编译失败 | 接入数字协议及原身份查询；绿灯 `BUILD SUCCESSFUL`，1m |
| `state-red.log` / `state-green.log` | 缺少公共 pendingCommand/sessionCommand，编译失败 | 先保存后执行，未知结果查询及 JSON 重建；绿灯 38s |
| `durable-red.log` / `durable-green.log` | 缺少 commandStatus 字段及测试构造参数类型错误，编译失败 | 适配系统行、修正测试调用、按 writer durability 呈现终态；绿灯 44s |
| `panel-red.log` / `panel-green.log` | 候选/补全/焦点场景 1 test，1 failed | 候选与 FocusRequester 接线；绿灯 35s |
| `color-red.log` / `color-green.log` | 实际字色场景 2 tests，1 failed | 完整命令 TextField textStyle 使用 signal；绿灯 32s |
| `feedback-red.log` / `feedback-green.log` | 新草稿保护/失败重试场景 6 tests，1 failed | 独立命令反馈与空草稿恢复入口；绿灯 40s |
| `transcript-red.log` / `transcript-green.log` | 命令系统行实际可见断言失败 | kind 3 状态及唯一分界呈现；绿灯 40s |
| `attachments-chat.log` | 无对应红灯记录 | 附件拒绝与普通原文路径相关回归绿灯 31s |
| `isolation-red.log` / `isolation-green.log` | 旧账号悬挂查询场景 4 tests，1 failed | bind/detach 取消并释放旧恢复 job，迟到回调不阻塞新账号；绿灯 9s |
| `monotonic-red.log` / `monotonic-green.log` | 耐久终态场景 8 tests，1 failed | 同 generation 水位取最大值，较旧观察不回滚终态；绿灯 10s |
| `retention-copy-red.log` / `retention-copy-green.log` | HTTP 重置后保留说明场景 6 tests，1 failed | 系统行到达前的反馈也显示历史/印象/记忆/技能保留说明；绿灯 40s |
| `clear-failure-red.log` / `clear-failure-green.log` | 拒绝后本地清 pending 失败场景 9 tests，1 failed | 清理保存失败时保留原身份及可查询状态；绿灯 10s |
| `query-feedback-red.log` / `query-feedback-green.log` | 接纳后查询失败场景 7 tests，1 failed | 显示具体查询错误、保留编辑和重试入口；绿灯 54s |

颜色与焦点由 [RemoteSessionCommandPanelTest.kt](../../../../../android/app/src/test/java/me/rerere/rikkahub/ui/identity/RemoteSessionCommandPanelTest.kt) 通过页面公开语义检查：`GetTextLayoutResult` 返回生产 TextField 的 `layoutInput.style.color`，比较当前主题的 `signal` 和先前普通文本实际颜色，覆盖手输、首尾空白、删回前缀、候选补全、compact、附说明及正文；候选点击后编辑节点执行 `assertIsFocused()`，同时断言命令与普通 send 均未发起。不是 parser 布尔标签测试，也不是设备 IME 验收。

[RemoteSessionCommandStateTest.kt](../../../../../android/app/src/test/java/me/rerere/rikkahub/data/remote/RemoteSessionCommandStateTest.kt) 的 `observer command terminal waits for writer durability and keeps old history` 先给出 seq=2 的终态行但 durableThroughSeq/ACK=0，断言仍显示进行中、pending 保留；推进 ACK=2 后才显示已重置并清 pending，再收到水位=0 的旧快照仍保持终态。该公开状态断言保留了 #345 真实 EACCES 所证实的 committed 尚未 durable 窗口。另覆盖迟到失败不复活完成操作、旧账号查询隔离、本地保存/清理失败、未知原身份恢复和旧 JSON 兼容。

[RemoteSessionCommandTranscriptTest.kt](../../../../../android/app/src/test/java/me/rerere/rikkahub/ui/identity/RemoteSessionCommandTranscriptTest.kt) 检查进行中、压缩、无需压缩、重置及具体失败均可见，每次仅一条系统行、旧历史仍在、无 Fairy 气泡。既有 Recovery/Viewport/SkillActivation/FairyPages 等回归随最终相关集执行；这些既有测试不冒充新增命令专属的设备或多端端到端验收。

## 实际命令与最终计数

工作目录为本票 worktree 的 `android/`，使用 wrapper，环境如下。本地 ignored 配置已存在，不提交：

```bash
export JAVA_HOME=/home/fatfish/tools/jdk-21.0.13+9
export ANDROID_HOME=/home/fatfish/tools/android-sdk
```

原始日志首行留存的定向命令包括下列五组。其它复用 configuration cache 的循环没有记录完整 `--tests` 参数，以上表的日志结果为准，不推定完整历史参数：

```bash
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteChatApiTest'
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.data.remote.RemoteSessionCommandStateTest'
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.identity.RemoteSessionCommandPanelTest' --tests 'me.rerere.rikkahub.data.remote.RemoteSessionCommandStateTest'
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.identity.RemoteSessionCommandTranscriptTest'
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.identity.RemoteSessionCommandPanelTest' --tests 'me.rerere.rikkahub.data.remote.RemoteSessionCommandStateTest' --tests 'me.rerere.rikkahub.data.remote.RemoteChatApiTest'
```

最终相关集完整命令记录于 `related-final.log` 首行，结束为 `BUILD SUCCESSFUL in 1m 27s`，71 actionable tasks（4 executed，67 up-to-date）：

```bash
./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.data.remote.RemoteChatApiTest' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteChatStateTest' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteChatRecoveryTest' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteAttachmentStateTest' \
  --tests 'me.rerere.rikkahub.data.remote.ChatSyncStoreTest' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteSessionCommandStateTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteChatPanelRetryTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteTranscriptSkillActivationTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteTranscriptViewportTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteSessionCommandPanelTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteSessionCommandTranscriptTest' \
  --tests 'me.rerere.rikkahub.ui.fairy.FairyPagesTest'
```

2026-11-10 07:34:41–07:35:47 UTC 的 12 份标准 JUnit XML 经 Python `xml.etree.ElementTree` 解析，`tests` 属性总和与实际 `<testcase>` 数均为 **174**；failures/errors/skipped 均为 **0**。恢复时核对源码/新增测试修改时间早于此轮测试完成时间；接管后未修改产品源码或测试。

| Suite（省略公共包名前缀） | tests | failures | errors | skipped |
| --- | ---: | ---: | ---: | ---: |
| ChatSyncStoreTest | 2 | 0 | 0 | 0 |
| RemoteAttachmentStateTest | 13 | 0 | 0 | 0 |
| RemoteChatApiTest | 28 | 0 | 0 | 0 |
| RemoteChatRecoveryTest | 14 | 0 | 0 | 0 |
| RemoteChatStateTest | 22 | 0 | 0 | 0 |
| RemoteSessionCommandStateTest | 10 | 0 | 0 | 0 |
| FairyPagesTest | 71 | 0 | 0 | 0 |
| RemoteChatPanelRetryTest | 1 | 0 | 0 | 0 |
| RemoteSessionCommandPanelTest | 7 | 0 | 0 | 0 |
| RemoteSessionCommandTranscriptTest | 1 | 0 | 0 | 0 |
| RemoteTranscriptSkillActivationTest | 3 | 0 | 0 | 0 |
| RemoteTranscriptViewportTest | 2 | 0 | 0 | 0 |
| **12 suites 合计** | **174** | **0** | **0** | **0** |

仓库根实际检查：

- `npm run specs:status -- --offline`：开工基线为 `377e863`；recovery 再检查 integration tip=`0b91110`。退出 1 来自 #342 integration 尚未推送（MISSING，ahead=3），不是测试失败；推送与 merger 由 Lead 处理，本票不推送或关闭 issue。
- `git merge --no-edit integration/spec-342`：Already up to date，无冲突。
- `git diff --check`：通过；提交前再次检查 staged diff。
- `npm run combo:verify`：原执行者与 recovery 最终检查均通过，OurFairy=`0b91110`、dsh=`ae2adffd8d67773e125b8048120cf9ad2ba7edf3`、Android source=`460109d1b89b824a…` 三行均 ok。日志分别为 `combo-verify.log`、`recovery-combo-verify.log`。

## 延后门禁与未执行项

Lead 已明确授权：本票相关 Android tests 与 combo 绿后使用 `git -c commit.gpgsign=false commit --no-verify` 提交，避免逐票重复全量。未修改 hook 配置或源码。**本票没有执行或声称通过全量 `npm test`、Android `./gradlew test lintDebug`；#346 在最终集成状态统一执行全量后端、combo、Android test/lint，并完成规格收口评审。** 本票的 174 个相关测试不能替代这些最终门禁。

未执行真机候选、软键盘焦点保持、主题可读性与真实多设备验收：Lead 提供的现场无 adb 设备。未构建/安装 APK，未调用真实云模型或 ASR；回环 HTTP、替身状态、Robolectric、编译及组合验证不代表这些验收通过。真实压缩/clear 模型上下文与 retention 的后端验证另见 #343/#345，本票没有重跑或代称完成。
