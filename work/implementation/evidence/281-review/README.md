# #281 两轴复审修订（`ticket/281-review-fixes`）

- 父 spec：[#281](https://github.com/eafen405/OurFairy/issues/281)（本地副本 `work/tickets/281/281.md`），子票
  `287.md`、`288.md`、`289.md` 同目录。
- 复审基线：`integration/spec-281` @ `5e329acb6e`；本分支 `ticket/281-review-fixes` 以该提交为起点。
- 本目录记录两轴复审的发现、逐项处置与本轮实际跑过的命令。最终门禁由本分支在合入后重跑，结果见
  「实际跑过的命令与结果」。
- 未改 `work/implementation/evidence/README.md` 与 `evidence/index/*`（按任务要求）；旧证据目录
  `287-`/`288-`/`289-` 是历史记录，旧函数名与旧文案由本目录取代，不回写。

## 两轴报告（按轴归类，保留基线行号）

### Standards axis — spec #281（基线 `5e329acb6e`）

```text
HARD（文档化标准）
1. F1 复用优先：ui/identity/RemoteAttachmentHandoff.kt:23-35,44-55 与
   ui/identity/RemoteAppUpdate.kt:84-91,101-110 近乎逐行同形：FileProvider URI、ACTION_VIEW、
   ClipData 显示名、读授权/NEW_TASK、launch 接缝、ActivityNotFoundException 各一份；两处各自
   维护一句缺失文案。同一能力两套实现。
2. F6 声称须可执行：ui/identity/RemoteAttachmentDestination.kt:3-13 的 KDoc 声称
   「the client's only attachment-routing decision」且调用方「instead of inspecting the MIME,
   the name or the size itself」，但没有任何让该形状不可绕开的接缝（类型路由仍可从外部调用），
   且同句重复一次。
3. F8 声称 ≠ 命名检查：android/GLOSSARY.md:78-86 称图片、文本预览与另存为都共用预览缓存；
   实际普通另存为走 createAttachmentTempFile（ui/identity/RemoteAttachmentFiles.kt:52）与独立
   下载（ui/identity/RemoteChatPanel.kt:180-187），只有「外派无接收方」的回落才复用缓存字节。
   android/README.md:45 把关闭清理记在 RemoteAttachmentPreviewFileTest；关闭清理实际由
   RemoteAttachmentPreviewTest 固定（该文件 :235-252、:328-344）。

JUDGEMENT（Fowler 异味/判断项）
4. F4 Duplicated Code：ui/identity/RemoteChatPanel.kt:163-178 自建 try/catch 与 epoch 检查，
   并用另一套错误文案（failure.message ?: "保存失败"）；与 data/remote/RemoteChatState.kt:603-616
   的 notice/「原件已保存」/description() 重复。同一字面量在 panel:169 与 state:608 各一份。
5. F5 接缝泄漏：ui/identity/RemoteChatPanel.kt:100-104,306-312 把测试专用的
   launchExternal: ((Intent) -> Unit)? 放进生产 composable 参数。
6. F7 Mysterious Name：ui/identity/RemoteAttachmentDestination.kt:60-71 的
   remoteAttachmentDestinationFor 名称没有说明它包含 2 MiB 规则；类型路由还能被外部单独调用。
7. F9 文案：ui/identity/RemoteAttachmentHandoff.kt:11 的「已改为另存为」在用户尚未选择保存位置
   前就断言结果，用户取消时文案不成立。
8. F10 重复测试设置：RemoteAppUpdateTest.kt:52-59、RemoteAttachmentHandoffTest.kt:30-36、
   RemoteAttachmentExternalTest.kt:114-120、RemoteAttachmentPreviewTest.kt:140-146 各自反射
   清 FileProvider sCache。
9. F11 cheap：data/remote/RemoteChatState.kt:583-618 的 keep: Boolean 没有说明保留的是哪个文件。
```

### Spec axis — spec #281（基线 `5e329acb6e`）

```text
(c) Looks wrong / 规格细节
1. F2 两处权威：ui/identity/RemoteChatPanel.kt:306-312 外派直接转发 attachment.mime；
   ui/identity/RemoteAttachmentDestination.kt:35-48,73-79 用「可信 MIME 级联 + 后缀级联」两套
   判定，外派不读后缀纠正后的类型。spec 281.md:41 明确「MIME 为 application/octet-stream 或
   缺失时按后缀判定」，因此 octet-stream 的 .docx/.pdf 会以 octet-stream 交接，系统查看器不匹配。
   「类型路由是唯一分叉点」（281.md:40）也因此出现旁路。
2. F3 另一份 md 判定：ui/identity/RemoteAttachmentText.kt:25-38 在 destination 模块之外维护
   MARKDOWN_SUFFIXES 与 text/markdown 判断；同一个 md 决策存在两处。

(b) Scope creep / 测试面
3. F5 测试接缝进生产：ui/identity/RemoteChatPanel.kt:100-104,306-312 让生产 composable 暴露
   测试专用 launchExternal；spec 281.md:52 要求「只断言外部行为，不测平台 Intent 本身」，
   测试应走真实 startActivity 路径而不是由面板注入替身。
```

## 逐项处置

| 编号 | 结论 | 处理与理由 | 固定它的检查 |
| --- | --- | --- | --- |
| F1（Standards 1，HARD） | 已修 | 新增 `ui/identity/LocalFileHandoff.kt:16-47`：`localFileViewIntent(context, file, mime, displayName)` 与 `launchLocalFileView(..., missingMessage, launch = { context.startActivity(it) })`。安装包（`RemoteAppUpdate.kt:187-193`）与附件（`RemoteChatPanel.kt:296-302`）都改用这一份；删除 `appInstallIntent`/`launchInstall`/`externalAttachmentIntent`/`launchExternalAttachment` 与旧 `RemoteAttachmentHandoff.kt`，不保留只转发包装。各自文案仍在调用方（「未找到系统安装程序」、附件无接收方文案）。 | `RemoteAttachmentHandoffTest` 的 intent 形状/launch 接缝用例；`RemoteAppUpdateTest` 的安装意图与「未找到系统安装程序」用例 |
| F2（Spec c1 + Standards，两处权威） | 已修 | `RemoteAttachmentDestination.kt:31-35` 新增 `attachmentMimeFor(mime, name)`：可信 MIME 去参数、转小写后优先；否则唯一 `SUFFIX_MIMES` 表（:73-138）给出类型；未知后缀为 `application/octet-stream`。路由改由该有效类型判定（`remoteAttachmentOpenDestination` :43-54，`destinationFor` 私有），外派在 `RemoteChatPanel.kt:296-301` 使用同一有效 MIME。删除原 MIME/后缀两套级联；既有路由用例全部保持。 | `RemoteAttachmentDestinationTest` 的有效类型用例（octet `.docx`→Word MIME、`.pdf`→`application/pdf`、`.md`→`text/markdown`、未知后缀→octet/SAVE_AS）；`RemoteAttachmentExternalTest`「an octet stream docx is handed off with the word document type」 |
| F3（Spec c2） | 已修 | Markdown 的 MIME 与后缀表收进 `RemoteAttachmentDestination.kt:18-21`（`MARKDOWN_MIME`、`MARKDOWN_SUFFIXES`），后缀表由该集合生成；`RemoteAttachmentText.kt:25-37` 的 `remoteAttachmentTextLayout` 只读同一组常量，不再自带一份。 | `RemoteAttachmentTextTest` 的 Markdown/纯文本取舍用例；`RemoteAttachmentDestinationTest` 的 `.md` 有效类型用例 |
| F4（Standards 4，Duplicated Code） | 已修 | `RemoteChatState.kt:567-588` 新增 `suspend fun saveCachedAttachment(expectedEpoch, cached, save)`：先查 epoch，运行保存，成功后写唯一字面量 `ATTACHMENT_SAVED`（:21），失败用既有私有 `description()`；`markAttachmentSaved()`（:662-664）同时供直接另存与缓存另存。面板缓存分支（`RemoteChatPanel.kt:160-168`）只调用它，不再自建 try/catch 或另一套错误文案。 | `RemoteAttachmentStateTest` 新增「saving the cached attachment…」「a failed cached save…」「a cached save captured under an older epoch…」三例；`RemoteAttachmentExternalTest` 回落保存后断言「原件已保存」 |
| F5（Spec b2 + Standards 5，seam leak） | 已修（走真实包管理器路线） | 生产 `RemoteChatPanel` 删除 `launchExternal` 参数；共享 helper 保留函数级 `launch` 接缝（与既有 `launchInstall` 同形）。测试用 Robolectric 的真实 `startActivity`：`Application.requireActivityResolution()`（`ShadowApplication.checkActivities(true)`）+ `registerActivityFor` 注册假查看器；无查看器用例不注册，`ActivityNotFoundException` 由真实路径抛出，回落另存为的目标用真实 `ActivityResultContracts.CreateDocument` 注册。未采用「只保留函数级接缝」的退路，因为 Robolectric 能确定性复现 ANFE 与成功解析。 | `RemoteAttachmentHandoffTest`「the real launch path reports a device without a receiver」；`RemoteAttachmentExternalTest` 的 PDF/docx 成功交接与无查看器回落；`RemoteAttachmentPreviewTest` 的 PDF/超 2 MiB 外派 |
| F6（Standards 2，HARD） | 已修 | 删除 `RemoteAttachmentDestination` 的「唯一判定/调用方不自行检查」保证与重复句，改为「The four places a click on a transcript attachment can go.」；`remoteAttachmentOpenDestination` 的 KDoc 只陈述输入输出，并事实性写明类型路由私有、公开入口仅此一个（:37-54）。 | 编译期可见性（`destinationFor` 私有）＋ `RemoteAttachmentDestinationTest` 全部经公开入口 |
| F7（Standards 6，Mysterious Name） | 已修 | `remoteAttachmentDestinationFor` 更名 `remoteAttachmentOpenDestination`，名称包含 2 MiB 展开规则；类型路由 `destinationFor` 私有，生产只有一个公开路由入口。测试全部改调公开入口。 | `RemoteAttachmentDestinationTest` 的类型路由与 2 MiB 用例都调用 `remoteAttachmentOpenDestination` |
| F8（Standards 3，HARD） | 已修 | `android/GLOSSARY.md`「附件预览缓存」改为：普通另存为写独立临时文件，不读预览缓存；只有外派无接收方回落才复用缓存字节。`android/README.md`「会话附件」删去重复的完整路由表，保留操作事实并指向 GLOSSARY 作为词汇权威；测试引用改为：关闭清理在 `RemoteAttachmentPreviewTest`、缓存路径在 `RemoteAttachmentPreviewFileTest`、一次下载/复用/过期 epoch 在 `RemoteAttachmentStateTest`。 | 文档中的每个行为名都能落到真实测试：`RemoteAttachmentPreviewTest`（关闭清理）、`RemoteAttachmentPreviewFileTest`（路径）、`RemoteAttachmentStateTest`（下载/epoch）、`RemoteAttachmentDestinationTest`/`RemoteAttachmentTextTest`（路由/Markdown） |
| F9（Standards 7） | 已修 | 无接收方文案改为取消安全的「没有能打开该文件的系统应用，请选择保存位置」（`RemoteChatPanel.kt:78`）；`RemoteAttachmentHandoffTest` 与 `RemoteAttachmentExternalTest` 同步字面量。 | 上述两个测试的断言；`RemoteAttachmentExternalTest` 还验证随后真的打开 `ACTION_CREATE_DOCUMENT` |
| F10（Standards 8，重复测试设置） | 已修 | 新增测试辅助 `FileProviderTestSupport.kt:16-19` 的 `clearFileProviderCache()`；`RemoteAppUpdateTest`、`RemoteAttachmentHandoffTest`、`RemoteAttachmentExternalTest`、`RemoteAttachmentPreviewTest` 的 `@Before` 都只调用它。 | 四个测试类的 `@Before`；反射实现只此一处 |
| F11（cheap） | 已修 | `RemoteChatState.startAttachmentDownload` 的 `keep` 更名 `keepCompletedFile`，直接说明保留的是下载完成的文件还是 `.part`。 | `RemoteAttachmentStateTest` 的预览缓存/一次下载/迟到下载用例经公开入口覆盖两条分支 |

## 明确保留（kept, with reason）

| 项 | 结论 | 理由与固定它的检查 |
| --- | --- | --- |
| 缓存布局＝坐标目录（会话/消息/序号的摘要）＋清洗后的原始显示名叶子 | 保留 | 外派要求查看器看到真实文件名与后缀；spec 281.md 里「文件名只由坐标决定」早于 #289 的外派交接，由 #289 取代。`RemoteAttachmentPreviewFileTest` 固定同坐标同路径、不同坐标互异、原名叶子与不可逃逸 |
| `sweepAttachmentPreviews` 保留 | 保留 | 接收方可能仍在读交接文件，交接时不能删；下一次外派打开清扫其余坐标目录，图片/文本预览仍按关闭删除自己的文件。`RemoteAttachmentHandoffTest` 的清扫用例与 `RemoteAttachmentExternalTest`「a later external open sweeps…」固定 |
| 裸 `ACTION_VIEW`（不套 `Intent.createChooser`）＋ANFE 回落 | 保留 | AOSP 的 chooser 对零目标走自己的空状态，不会抛错，回落不可达；裸 VIEW 无匹配 activity 时才抛 ANFE。依据：[`NoAppsAvailableEmptyStateProvider.java`](https://android.googlesource.com/platform/frameworks/base.git/+/refs/heads/main/core/java/com/android/internal/app/NoAppsAvailableEmptyStateProvider.java)。`RemoteAttachmentHandoffTest` 断言裸 VIEW 且无 `EXTRA_INTENT`，并用真实包管理器复现 ANFE；`RemoteAttachmentExternalTest` 固定回落另存为 |
| 路由语义、2 MiB 阈值、UTF-8→GB18030、FileProvider 暴露面、无新依赖 | 保留 | 行为未改：`RemoteAttachmentDestinationTest` 的全部既有路由/2 MiB 用例、`RemoteAttachmentTextTest` 的解码用例、`RemoteAppUpdateTest` 的 `file_paths.xml` 精确清单与 `RemoteAttachmentExternalTest` 的无存储权限用例；本轮 `git diff` 无 `build.gradle*`/manifest/依赖变更 |

## 实际跑过的命令与结果

| 命令 | 结果 |
| --- | --- |
| `cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentDestinationTest' --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentTextTest' --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentHandoffTest' --tests 'me.rerere.rikkahub.ui.identity.RemoteAppUpdateTest' --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentExternalTest' --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentPreviewTest' --tests 'me.rerere.rikkahub.data.remote.RemoteAttachmentStateTest'` | 79 tests、0 failures/errors/skips（7 个类：Destination 20、Text 8、Handoff 5、AppUpdate 17、External 6、Preview 10、State 13） |
| `cd android && ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug` | `BUILD SUCCESSFUL in 3m 10s`（134 tasks：64 executed、70 up-to-date）；JUnit XML 合计 612 tests（app 540、ui 20、highlight 52）、0 failures/errors/skips；lintDebug 通过，31 条既存 warning，无新增文件告警（改动文件上只有 `RemoteChatPanel.kt:102` 的既存 `ModifierParameter`） |
| `git merge integration/spec-281` | 集成分支 tip 未移动（仍为 `5e329acb6e`），`Already up to date.`，无合并提交；随后在最终树复跑 79 个受影响测试，0 failures/errors/skips |
| `git commit`（含 `android/`，pre-commit 自动 full gate） | `npm test` 473 pass / 0 fail（17 suites）；`npm run combo:verify` → `combo: combination verified`；`./gradlew test lintDebug` `BUILD SUCCESSFUL in 2s`（任务均为 up-to-date，同一代码树的完整 Android 门禁结果见上一行）；未使用 `--no-verify`。首次 commit 的 Android 步骤因 shell 未导出 `ANDROID_HOME` 在 3s 内失败，显式导出后通过；不是代码或测试失败 |
| `git status --porcelain`（提交与合并后） | 空 |

测试与实现同批落地：行为测试先写，但本轮没有为每个切片单独执行并留存红灯运行。改名/新符号切片在实现前本会以未解析
符号编译失败；第一次整体运行暴露的 6 个失败是测试夹具问题（Robolectric 把普通 `startActivity` 同时记入 for-result
队列；`CreateDocument` 的目标需用真实 contract 构造），修正后全绿。如实记录这一点，不把「测试通过」写成设备验收。

## 未验证（无设备）

- 真机/模拟器未执行：系统解析器与多应用选择界面、真实 PDF/Office 查看器打开 FileProvider URI 并显示原始文件名、
  设备「没有应用可处理」时的真实 ANFE、真实 SAF 保存目标。
- F5 的真实 `startActivity` 路线只在 Robolectric 中由假查看器/无查看器复现；它证明的是 intent 解析与异常分支，
  不是某台设备上的查看器行为。
- F2 的 Word MIME 由意图 type 断言固定（成功路径要求该 MIME 可解析），未由真实 Word 查看器打开验证。
- 按任务只跑 `test lintDebug`，未跑 `assembleDebug`/`assembleRelease`。

## 提交

- `74d85caacb` `fix(#281): 按两轴复审统一附件外派与有效类型`（含代码与测试；pre-commit full gate 通过）
- `7d43874903` `docs(#281): 修正附件词汇与 README 的可执行声称`（含本文件；pre-commit docs gate 通过）
- 其后仅补记本节的合并结果，分支最终 tip 以 `git log --oneline -1` 为准。

## 最终状态

- 分支：`ticket/281-review-fixes`
- 起点与合并基线：`integration/spec-281` @ `5e329acb6e`（`git merge` 为 `Already up to date.`，无合并提交）
- 最终树：`cd android && ./gradlew test lintDebug` 通过（612 tests / 0 failures；lint 无新增告警），
  合入后在最终树复跑 7 个受影响测试类共 79 tests / 0 failures
- `git status --porcelain`：空
