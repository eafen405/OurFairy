# #346 会话命令最终集成门禁与交接

> 本页下列运行固定于 review fixes 之前的 `0886f18` + native `8014fc7`；Node 854 / Android 787 是历史 full，不能替代修复后最终组合的全量门禁。两仓修复已 FF，产品修复为 `f733e0d`、native pin 为 `2b05c48`，merger 构建与交接见 [06](../06-review-fixes/README.md#merger-最终组合与构建交接)。#346 由 Root 接回最终完整门禁，#342/#346 保持 OPEN。

2026-11-10，独立 worktree `/home/fatfish/OurFairy/.worktrees/346-session-command-closeout`，分支 `ticket/346-session-command-closeout`。从最新 `integration/spec-342` 精确 `0886f18a652d9c8e920f026b76b554eacd924115` 创建，开工 HEAD 与该 tip 相等且干净。本票仅整理文档、证据描述与索引，没有改产品源码、测试代码、包配置或 DSH。最终门禁测试代码及运行实现固定在该 OurFairy 提交；文档完成后另用既有文档/索引检查覆盖最终内容。

## 固定组合与工具链

- OurFairy 全量测试代码基线：`0886f18a652d9c8e920f026b76b554eacd924115`；父规格增量起点为 `520e1b16a6002a22f641c4bf5174d0b20a834811`。最终票分支提交 SHA 由交接消息提供，不在自身提交中循环记录。
- DSH PRIMARY `/home/fatfish/deepseek-harness`，master/HEAD 均为 `8014fc775a27e7273300a68fcadb7e2980bb93f0`，开工工作区干净，与 [combo.json](../../../../../combo.json) 的 pin 一致。Android 来源声明仍为 `460109d1b89b824a2ddb7f3201d8d3f7af7e02ce`。
- Node `v24.22.2` / npm `11.19.1`（全量启动命令实测）。Android 使用 `JAVA_HOME=/home/fatfish/tools/jdk-21.0.13+9`（实测 Temurin OpenJDK 21.0.13+9 LTS）与 `ANDROID_HOME=/home/fatfish/tools/android-sdk`，使用仓库 wrapper。
- 主检出的 `android/local.properties` 复制到本 worktree 同名 ignored 位置；`tests/fixtures/google-services.json` 复制为 `android/app/google-services.json`，两者经 `git check-ignore` 确认。没有改全局 Gradle 配置。Firebase key 为 fixture，不提供真实运行验收。

既有最终原生产物已由 #347 merger 完成，详见 [05 原始命令与计数](../05-native-reader/README.md#merger-最终构建与验证)：四条 requiredBuild、artifacts 7/7、其后 build:check 2/2、doctor 12/12。#346 没有重建或重跑 native checks，也没有修改 DSH。source 最终相关 161 tests 与旧 474 tests 的历史 run 不累加；native 宽文档 4 个基线失败仍如 [05](../05-native-reader/README.md#既有-native-文档债)记录，不宣称全通过。

## 接缝、范围与 TDD

已调用 `tdd` skill；沿[规格已确认的接缝](../../../../../docs/specs/session-commands.md#测试接缝)，本票是 docs + existing checks，没有为文档新增镜像测试，也未重做已合入的实现或扩展命令。

后端经真实启动器、profile/Loader、Bearer HTTP、SSE、原生 JSONL writer 和真实 stop/start 观察实际模型请求、公开状态与恢复结果；模型和外部网络为确定性替身。Android 经回环 HTTP、公共状态与 Compose/Robolectric 页面，真实页面断言候选、焦点、文字颜色和可见反馈；不是设备软键盘或真实主题可读性结论。历史红灯、夹具修正与最小实现分别保留在 [01](../01-backend/README.md)、[02](../02-android/README.md)、[03](../03-integration/README.md)、[05](../05-native-reader/README.md)，本票不制造红灯或复述成新的运行。

## 规格场景与现有检查

下表是必测场景到实际检查的导航，测试通过与设备/真实服务验收分别记录。它不表示每条故事都有独立测试，也不表示全部 64 条故事完成设备验收。

| 规格场景 | 会因行为失效而失败的现有公开检查 |
| --- | --- |
| 候选、补全、焦点、手输/删除后的实际颜色、首尾空白、普通正文/前缀/未知文本/附说明、附件拒绝 | [RemoteSessionCommandPanelTest.kt](../../../../../android/app/src/test/java/me/rerere/rikkahub/ui/identity/RemoteSessionCommandPanelTest.kt)；[RemoteSessionCommandStateTest.kt](../../../../../android/app/src/test/java/me/rerere/rikkahub/data/remote/RemoteSessionCommandStateTest.kt)；[RemoteChatApiTest.kt](../../../../../android/app/src/test/java/me/rerere/rikkahub/data/remote/RemoteChatApiTest.kt)，具体页面断言见 [02](../02-android/README.md#测试接缝与-tdd-证据) |
| 本人主/普通会话、管理员/跨用户/匿名拒绝、requestId 冲突；同一重试只产生一条分界且不清新内容 | [session-commands.test.mjs](../../../../../tests/session-commands.test.mjs) 的 `commands reject anonymous, foreign owners and admin before effects, and reject conflicting identities`、`concurrent and late clear retries keep one boundary and preserve subsequent conversation after restart` |
| 原生 compact、无需压缩、进行中查询、维护互斥、新消息排序与无额外聊天回复 | 同文件的 `compact reports no useful history without invoking a model or clearing context`、`native compaction keeps recent text and recovery fills a lost done without summarizing again`、`native maintenance is busy despite public idle and refuses both commands before acceptance`、`slow native compaction exposes durable progress, rejects distinct commands, and orders new input after it` |
| clear 后旧原文/摘要/工具/激活正文退出，印象、保存记忆、审核/偏好/技能包仍可用，本人其他会话不受影响 | [session-commands-retention.test.mjs](../../../../../tests/session-commands-retention.test.mjs) 的 `clear removes summary, raw text, tool results and activated body while retaining saved recognition and reviewed skills` |
| 未完成记忆维护、held/failed 技能学习跨 clear/重启仍恢复原 child/cut，不跳过或重复材料 | 同文件另三例：`an idle source clears while its memory child remains held, then each raw interval is consumed once`、`a held learning child permits clear immediately and resumes its original evidence after restart`、`failed learning resumes the same frozen child after clear and restart without skipping or duplicating signals` |
| committed 尚未 durable 时不可报成功，真实 EACCES、旧身份恢复、多观察者/重连/固定截点分页 | [session-commands-recovery.test.mjs](../../../../../tests/session-commands-recovery.test.mjs) 的 `EACCES after durable acceptance exposes committed completion without reporting durable success, then recovers the old identity`、`two observers, reconnect and fixed cuts retain old history and one boundary through append, late retry and restart`；Android 同 generation 水位/迟到失败/重启身份见上述 StateTest |
| 实际 job 与排队输入忙时拒绝，不停止/丢弃/延后执行；投递竞争后的实际请求和冷读一致 | 同 recovery 文件的 `an idle session with a real running job refuses commands without stopping it or executing them later`、`queued input survives command refusal and no rejected reset executes when the held reply finishes`、`real cross-user delivery racing clear has one durable landing and follows the reset boundary without recipient inference` |
| 摘要失败具体原因与自动压缩设置不变、缺 done/只有 run 的崩溃恢复 | recovery 的 `a refused summary reports a durable failure with its cause and preserves context and automatic settings`；commands 的 `clear recovers a replacement without done and marks run-only as interrupted without changing new input` |
| 五种系统结果、保留旧历史/唯一分界、草稿恢复不覆盖新内容、原身份查询与耐久水位 | [RemoteSessionCommandTranscriptTest.kt](../../../../../android/app/src/test/java/me/rerere/rikkahub/ui/identity/RemoteSessionCommandTranscriptTest.kt)、上述 PanelTest/StateTest；具体断言与替身限制见 [02](../02-android/README.md) |
| 原生投递 literal、晚到 system、真正 system 首节点保护及坏 span 拒绝 | [05 的最终七文件命令](../05-native-reader/README.md#early-delivery-与实际-system-headsource最终-followup)，最终 source 161 tests；本票不重复 native run |

## 顺序全量运行

本票长任务均使用托管 background job，原始输出位于 ignored `work/tmp/346/`，日志与 JUnit XML 不入库。后端全量、combo 和 Android test/lint 按此顺序执行，不并行全量后端与 Gradle。先完成最终代码树的产品运行，再补齐本证据的数字。

| 实际命令 | 结果 | 原始记录 |
| --- | --- | --- |
| `OURFAIRY_DSH_DIR=/home/fatfish/deepseek-harness npm test`（仓库根） | **PASS，exit 0；tests 854、suites 52、pass 854、fail 0、cancelled 0、skipped 0、todo 0；duration_ms 864567.569788（约 14m25s）**，包含本规格 commands 8 / retention 4 / recovery 6 及其余仓库测试 | `work/tmp/346/npm-test.log` |
| `OURFAIRY_DSH_DIR=/home/fatfish/deepseek-harness npm run combo:verify`（仓库根，后端结束后） | **PASS，exit 0；OurFairy `0886f18` / dsh `8014fc7` / Android source `460109d1` 三行 ok，无 skipped** | `work/tmp/346/combo-verify.log` |
| `JAVA_HOME=/home/fatfish/tools/jdk-21.0.13+9 ANDROID_HOME=/home/fatfish/tools/android-sdk ./gradlew test lintDebug --max-workers=2`（`android/`） | **PASS，exit 0；BUILD SUCCESSFUL in 10m 28s，134 actionable tasks / 134 executed；JUnit 88 suites / 787 tests / 0 failures、errors、skipped；lint 三模块均 0 errors**，警告/提示详见下文 | `work/tmp/346/android-test-lint.log` |

开工 `npm run specs:status -- --offline` 返回 1，唯一 need-attention 为 #342 unpushed（MISSING、7 ahead、copies ok）；因最初将其与全量串在 `&&` 中，该次未启动测试，随后单独启动上述完整 `npm test`。这不是后端测试失败，未将该退出码记为 full 结果。GitHub 最小字段查询实查 #346 OPEN、assigned `eafen405`、blocked=0，#343/#344/#345/#347 CLOSED、blocked=0。

### Android JUnit 实际计数

标准 JUnit XML 来自 `android/{app,highlight,ui}/build/test-results/testDebugUnitTest/TEST-*.xml`；用 Python `xml.etree.ElementTree` 分别读取 suite 的 tests/failures/errors/skipped 属性，并逐份核对实际 `<testcase>` 与 failure/error/skipped 子元素，全部一致。时间戳为 2026-11-10 09:54:27.863–09:59:47.769 UTC。三个模块共 **88 suites / 787 tests / 0 failures / 0 errors / 0 skipped**：app 83 suites / 715 tests，highlight 4 / 52，ui 1 / 20。没有把编译任务数当作测试数。

本轮临时汇总命令（脚本及派生 JSON/Markdown 均在 ignored `work/tmp/346/`，不入库）：

```sh
python3 work/tmp/346/summarize_android.py android/app/build/test-results/testDebugUnitTest android/highlight/build/test-results/testDebugUnitTest android/ui/build/test-results/testDebugUnitTest
```

| 模块 / Suite | tests | failures | errors | skipped |
| --- | ---: | ---: | ---: | ---: |
| app / me.rerere.rikkahub.BillColdStartTest | 1 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ClientStartupTest | 1 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ImpressionColdStartTest | 1 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.NotificationColdStartTest | 5 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.SessionsColdStartTest | 1 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.SettingsColdStartTest | 1 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.datastore.DisplayPreferencesTest | 1 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.AccountSessionTest | 8 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.BillStateTest | 8 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.ChatSyncStoreTest | 2 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.CredentialStoreTest | 6 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.GatewayApiTest | 12 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.GatewayStateTest | 14 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.IdentityApiTest | 8 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.ImpressionApiTest | 4 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.ImpressionStateTest | 4 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.OwnedSessionStateTest | 27 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteActivityStateTest | 5 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteActivityTrustTest | 4 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteAppUpdateTest | 13 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteAttachmentApiTest | 5 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteAttachmentStateTest | 13 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteBillApiTest | 7 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteChatApiTest | 28 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteChatRecoveryTest | 14 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteChatStateTest | 22 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteJobApiTest | 5 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteJobStateTest | 6 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteNotificationBacklogTest | 12 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteNotificationStateTest | 11 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteNotificationWireTest | 1 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteReceiveStateTest | 9 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteResourceTest | 12 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteSessionCommandStateTest | 10 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteSpeechApiTest | 3 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.RemoteSpeechInputStateTest | 4 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.SessionApiTest | 16 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.SkillsApiTest | 8 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.SkillsReviewNotifierTest | 8 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.data.remote.SkillsStateTest | 9 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.service.RemoteReceiveControllerSkillsTest | 1 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.service.RemoteReceiveControllerTest | 8 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.destination.FairyDestinationsTest | 11 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.fairy.BillBarsTest | 5 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.fairy.BillFormatTest | 6 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.fairy.FairyBillPageTest | 11 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.fairy.FairyCaptionAnimationTest | 2 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.fairy.FairyCrtPowerDownTest | 2 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.fairy.FairyEyeTest | 3 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.fairy.FairyInstrumentTest | 3 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.fairy.FairyInteractionTest | 59 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.fairy.FairyLastLocationTest | 6 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.fairy.FairyNumericDraftTest | 5 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.fairy.FairyNumericFieldTest | 2 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.fairy.FairyPagesTest | 71 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.GatewayEditingTest | 4 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.GatewayPageTest | 10 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.IdentityNavigationTest | 5 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.IdentitySessionListTest | 6 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.ImpressionPageTest | 3 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteAppUpdateTest | 17 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteAttachmentDestinationTest | 20 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteAttachmentExternalTest | 6 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteAttachmentHandoffTest | 5 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteAttachmentPreviewFileTest | 5 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteAttachmentPreviewTest | 10 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteAttachmentTextTest | 8 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteChatPanelRetryTest | 1 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteNotificationNavigationTest | 7 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemotePresentationBaselineTest | 3 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemotePresentationTest | 4 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteReadingTransitionTest | 11 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteSessionCommandPanelTest | 7 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteSessionCommandTranscriptTest | 1 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteStreamingPacingTest | 2 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteTranscriptCopyTest | 7 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteTranscriptSkillActivationTest | 3 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteTranscriptSkillReviewTest | 7 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteTranscriptTokenUsageTest | 8 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteTranscriptToolCallTest | 8 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.RemoteTranscriptViewportTest | 2 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.SkillReviewDisplayParsingTest | 7 | 0 | 0 | 0 |
| app / me.rerere.rikkahub.ui.identity.SkillsPageTest | 14 | 0 | 0 | 0 |
| highlight / me.rerere.highlight.CodeHighlighterTest | 6 | 0 | 0 | 0 |
| highlight / me.rerere.highlight.core.HighlightEngineTest | 11 | 0 | 0 | 0 |
| highlight / me.rerere.highlight.core.RegexesTest | 5 | 0 | 0 | 0 |
| highlight / me.rerere.highlight.languages.LanguageFixtureTest | 30 | 0 | 0 | 0 |
| ui / me.rerere.ui.markdown.MarkdownParserTest | 20 | 0 | 0 | 0 |
| **88 suites 合计** | **787** | **0** | **0** | **0** |

### Android lint 实际结果

完整命令包含 `lintDebug`，日志有 app、highlight、ui 的分析、report 和 lintDebug 任务；最后 `BUILD SUCCESSFUL`，不是只完成编译。实际读取三个模块的 `build/reports/lint-results-debug.txt`：

| 模块 | errors | warnings | hints | 结论 |
| --- | ---: | ---: | ---: | --- |
| app | 0 | 42 | 1 | lintDebug 通过，保留当前报告的警告/提示 |
| highlight | 0 | 0 | 0 | No issues found |
| ui | 0 | 0 | 1 | lintDebug 通过，UnnecessaryArrayInit 提示 |
| **合计** | **0** | **42** | **2** | 不把 0 errors 写成 0 warnings |

本票没有修改 Android 文件，也未为收口扩修 lint 提示；app 报告含 ApplySharedPref、DefaultLocale、版本更新建议、ComposableNaming、ModifierParameter 等。报告数字按本轮实际输出记录，不套用历史票的较小警告数，也没有将警告误报为失败。

## 文档、索引与最终集成

文档变更：建立本规格入口和本收口记录、加入 evidence descriptor 并用 `npm run evidence:index` 生成索引、在实施约定登记 #342、更新任务图与规格/设计的现行状态。发布时的旧调查明确加历史限定；当前协议收敛到[客户端合同](../../../../tickets/342/protocol.md)，旧证据摘录仍为历史快照。未重开产品决定，未新增业务表或记忆/技能库迁移，未碰主检出原有 dirty 文件。

运行期间曾将 `backend/chat/README.md` 的一行协议链接改为直指合同；Lead 提醒发布包 README 参与 source hash 后，立即逐字恢复到 `0886f18` 原文，并通知 Lead。最终 backend、tests、scripts、Android、包配置与组合锁没有 diff。该临时链接改动只影响 profile source-hash 输入，不改变运行实现或测试断言；没有声称整个运行期间 source hash 始终不变。后端现有链接经 01 的历史证据说明进入当前协议，不再修改发布包。

交付前 `git merge --no-edit integration/spec-342` 返回 `Already up to date.`，exit 0；本票 HEAD 与 integration tip 仍为 `0886f18a652d9c8e920f026b76b554eacd924115`。`git diff --exit-code 0886f18a652d9c8e920f026b76b554eacd924115 -- backend tests scripts android package.json combo.json tsconfig.json` exit 0，确认最终运行/测试代码与 full 基线相同。DSH master/HEAD 再核仍为 `8014fc7` 且 clean。

新文档已显式暂存后执行以下检查；随后只补本段运行结果，并再次暂存/运行文档与索引检查覆盖最终文字。完整 Node/Android 已通过且没有运行代码变化，因此没有无故重跑 full。

| 最终命令 | 结果 | 原始记录 |
| --- | --- | --- |
| `npm run evidence:index` | exit 0，按新 descriptor 生成索引 | 终端输出 `evidence index rewritten: 468 line(s)` |
| `npm run evidence:index -- --check` | exit 0，`evidence index is current` | `work/tmp/346/evidence-index-check.log` |
| `node --test tests/docs.test.mjs` | exit 0，2 tests / 2 pass / 0 fail、cancelled、skipped、todo，含所有已暂存的新 Markdown | `work/tmp/346/docs-test.log` |
| `OURFAIRY_DSH_DIR=/home/fatfish/deepseek-harness npm run combo:verify` | exit 0，三行 ok、无 skipped，精确锁如上 | `work/tmp/346/combo-verify-final.log` |
| `git diff --check` / `git diff --cached --check` | exit 0，无 whitespace 错误 | 终端检查 |
| `npm run specs:status -- --offline` | exit 1，唯一 need-attention 仍为 #342 unpushed（MISSING、7 ahead、copies ok）；符合不 push 的安排，不是门禁测试失败 | `work/tmp/346/specs-status-final.log` |

本 worktree 按 Lead 明确要求保留给 merger；最终 specs 快照中的另一个外部 worktree `/tmp/of-341-check` 为本轮前已存在，不由 #346 清理。主检出原有 dirty 内容与其他票工作区未动。

## 审查与未执行项

- **Standards / Spec：各原有 1 个 P2，已修复合入并获各自原 reviewer 定点确认 RESOLVED。** 原固定审查基线为 OurFairy `02c6e6d` 与 DSH `8014fc7`；定点确认源码为产品 `f733e0d` / native `2b05c48`，不是第二轮全量 review。原始两轴报告、Root 可执行声称检查、修复与 focused evidence 见 [06 review fixes](../06-review-fixes/README.md)。本页的 Node 854 / Android 787 是修复前基线的历史 full，不能用作修复后最终组合的完整门禁；最终 full 待 Root 接回 #346。
- 没有 adb 设备；真机候选、软键盘焦点、主题可读性、真实多设备与通知验收未执行。Robolectric/公共状态不替代这些验收。
- 未调用真实云模型、真实 ASR 或其他外部服务；替身请求只证明当前组合的可观察行为。未构建/安装本轮 APK，未执行 connected/instrumented 设备测试。
- Native full tests/coverage/platform matrix/full lint/full doc-sync 未在本票执行。05 已记录的宽文档四项基线失败不扩修，不称原生全绿。
- 根据 Lead 全程授权，最终 full 和相关文档门禁完成后使用 `git commit --no-verify`，避免 hook 再重复后端和 Android 全量；不修改 hook 源或配置。
- 不 push、不关闭 #346、不清除本 worktree；交 Lead merger 接管。三个本票托管 job 均已 `job_output` 收集：首条 specs 包装 job exit 1（未启动测试，原因如上）、完整 Node job exit 0、Android test/lint job exit 0。最终 `job_list` 无运行中任务，无需取消仍相关的 job；原始日志保留 ignored 目录便于 Lead 复查，不入提交。
