# #289 附件外派系统应用：FileProvider 子目录交接与无接收者回落另存为

Android worktree `289-external-open`，分支 `ticket/289-external-open`，基线
`integration/spec-281` @ `cb6d68d626`（已含 #287）。提交见文末「提交」。

无数据库、wire 与 manifest 变更，无新增依赖；EXTERNAL 分支之外的 TEXT/SAVE_AS 路由未改。

## 改了什么

**外派意图。** `ui/identity/RemoteAttachmentHandoff.kt` 新增 `externalAttachmentIntent(context,
file, mime, displayName)`：`FileProvider.getUriForFile` 生成 `${applicationId}.fileprovider` 的
`content://` URI，`ACTION_VIEW` + `setDataAndType(uri, mime)`，`ClipData.newRawUri(displayName, uri)`
保留原始显示名，目标意图与外层 `Intent.createChooser` 都带
`FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK`。`launchExternalAttachment(..., launch =
{ context.startActivity(it) })` 是启动接缝，捕获 `ActivityNotFoundException` 并返回
「没有能打开该文件的系统应用，已改为另存为」。

**FileProvider 暴露面加一条。** `app/src/main/res/xml/file_paths.xml` 只新增
`<cache-path name="attachment-preview" path="attachment-preview/" />`；既有 `app-update` 条目不变。
`RemoteAppUpdateTest` 的路径清单测试由「只有 app-update」更新为精确的
`[app-update/, attachment-preview/]` 两条，provider 仍未导出并持有 URI 授权；`appInstallIntent`
的 `/app-update/latest.apk` 断言保持通过。

**一次下载后交接。** `RemoteChatPanel` 的 EXTERNAL 分支：`attachmentPreviewFile` 解析坐标路径 →
`state.cacheAttachment` 走既有会话鉴权下载并复用已有完整文件 → `sweepAttachmentPreviews` 保留本次
文件、清掉其它坐标缓存 → `launchExternalAttachment`。每次打开至多一次下载调用；重复打开同一附件
直接复用缓存字节。

**无接收者回落。** `launchExternalAttachment` 返回失败文案时，面板把文案写进既有
`attachmentNotice`（`RemoteChatState.noticeAttachment`），用 `PendingDownload.cached` 记住已缓存
文件并打开原有 `CreateDocument` 另存为；SAF 回调直接 `exportAttachment` 这份缓存字节，不再调用
下载接口。用户能看到「没有能打开该文件的系统应用，已改为另存为」，另存成功显示「原件已保存」。

**缓存布局与旧布局迁移。** `attachmentPreviewDirectory(context, sessionId, messageId, index)` 仍只由
三个坐标的 SHA-256 决定坐标目录 `cacheDir/attachment-preview/<digest>/`；`attachmentPreviewFile(..., name)`
把清洗后的原始显示名作为目录内文件名（替换 `/`、`\`、控制字符，拒绝 `.`/`..`，限长 120），
PDF/Office 查看器不再显示十六进制摘要名。已存在的旧布局文件 `attachment-preview/<digest>` 会被
重命名进坐标目录，坐标目录内已存在的完整文件也会重命名为当前名字，两种迁移都是 `renameTo`，不复制、
不二次下载。同一坐标的目录不变；显示名变化只改变叶子名。

**清理规则。** 外派交接后**不**删除文件（接收方可能仍在读）；规则是「下一次外派打开时清扫其它坐标
目录」，由 `sweepAttachmentPreviews(context, keep = file)` 实现，保留本次交接文件。图片预览仍由
`AttachmentImagePreview` 的 `DisposableEffect` 在关闭时删除自己的文件，#287 的关闭清理未改。

**文档。** `android/README.md`「会话附件」补 FileProvider 暴露面、外派与回落、清扫规则；
`android/GLOSSARY.md`「附件去处」「附件预览缓存」改为外派是真实交接并指向固定它的测试。改动只落在
外派/FileProvider 句子，便于与 #288 的文本预览文字合并。

## 测试（红 → 绿）

| 切片 | 红 | 绿（命令与结果） |
| --- | --- | --- |
| 坐标目录 + 原名叶子 + 旧布局迁移 | `RemoteAttachmentPreviewFileTest` 改签名后 `compileDebugUnitTestKotlin` 失败（`Too many arguments` / `Unresolved reference`）；迁移断言首次跑红 | `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentPreviewFileTest'`：6 tests / 0 failures |
| 外派意图形状与启动接缝 | `RemoteAttachmentHandoffTest` 引用未实现符号，编译失败 | 同命令 `--tests '...RemoteAttachmentHandoffTest'`：4 tests / 0 failures（chooser 内 `ACTION_VIEW`、`content` scheme、`.fileprovider` authority、`/attachment-preview/` 路径、读授权、NEW_TASK、ClipData label、抛异常回落、清扫保留） |
| 面板一次下载、回落、清扫 | 首跑 2 failed：Robolectric 每测试独立 cacheDir 导致 FileProvider 静态策略缓存指向旧目录（补清 `sCache` 的 `@Before`）；另一次是导出完成与状态刷新之间的等待竞态（改为等待语义节点） | `... --tests '...RemoteAttachmentExternalTest'`：5 tests / 0 failures（PDF 点击下载 1 次并交出 chooser；抛出 `ActivityNotFoundException` 时打开 `ACTION_CREATE_DOCUMENT`、保存后仍只有 1 次下载；重复打开复用缓存；第二次外派清掉第一份；manifest 无存储权限） |
| 既有 FileProvider 清单 | 原测试期望仅 `app-update`，加 xml 条目后失败 | `... --tests '...RemoteAppUpdateTest'`：17 tests / 0 failures |
| 未改动的路由/图片/状态 | — | `RemoteAttachmentDestinationTest` 14、`RemoteAttachmentPreviewTest` 4、`RemoteAttachmentStateTest` 10，均 0 failures |

改动面的合并运行：

```
cd android && ./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentPreviewFileTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentHandoffTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentExternalTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentPreviewTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteAppUpdateTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentDestinationTest' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteAttachmentStateTest'
```

`BUILD SUCCESSFUL`；JUnit XML 汇总 7 个类、60 tests、0 failures / 0 errors / 0 skipped
（File 6、Handoff 4、External 5、Preview 4、AppUpdate 17、Destination 14、State 10）。

收口门禁（最终树）：

```
cd android && ./gradlew test lintDebug
```

结果：`BUILD SUCCESSFUL in 1m 26s`（`130 actionable tasks: 6 executed, 124 up-to-date`）。JUnit XML 合计
588 tests、0 failures / 0 errors / 0 skipped（app 516、ui 20、highlight 52）。`lintDebug` 通过；本次新增
`RemoteAttachmentHandoff.kt`、`RemoteAttachmentHandoffTest.kt`、`RemoteAttachmentExternalTest.kt` 无告警；
改动文件上的 `DefaultLocale`（`RemoteAttachmentFiles.kt` 原有 `attachmentSizeLabel`）与
`ModifierParameter`（`RemoteChatPanel.kt` 原有参数顺序）为既存告警。

## 覆盖的验收标准

| #289 验收标准 | 证据 |
| --- | --- |
| 点 PDF/docx 拉起系统 chooser，意图带正确 MIME 与临时读授权，接收方拿到附件缓存子目录里的文件 | `RemoteAttachmentHandoffTest` 意图形状 4 条中的 chooser 用例逐项断言 action/type/scheme/authority/path/read-grant/NEW_TASK/ClipData label；`RemoteAttachmentExternalTest` 从真实面板点击 PDF 断言交给 chooser 的目标意图与缓存文件；`.docx` 走同一 EXTERNAL 分支（路由由既有 `RemoteAttachmentDestinationTest` 固定），未单独造 docx 面板用例 |
| FileProvider 只额外暴露附件缓存子目录；安装包目录既有暴露不变；结构测试固定清单 | `file_paths.xml` 精确两条；`RemoteAppUpdateTest` 的「file paths expose exactly ...」断言完整清单（多/少/改名都会失败），同文件的 provider 未导出/授权用例与 `appInstallIntent` 的 `/app-update/latest.apk` 用例保持通过 |
| 没有匹配应用时回落另存为，用户能看到结果，不静默失败 | `RemoteAttachmentExternalTest` 以抛出 `ActivityNotFoundException` 的启动接缝跑真实面板：出现回落通知、发出 `ACTION_CREATE_DOCUMENT`、保存后字节正确，且下载调用数仍为 1；`RemoteAttachmentHandoffTest` 直接断言失败文案 |
| 不需要额外存储权限，不新增依赖 | `RemoteAttachmentExternalTest` 断言 manifest 未请求 `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE`（文件 URI 读取走 FileProvider 临时授权）；`git diff` 无 `build.gradle*` 依赖变更 |
| README/词汇表关于暴露面的描述与 xml 一致 | `android/README.md` 写明只暴露 `app-update/` 与 `attachment-preview/`，并指向 `RemoteAppUpdateTest` 的清单测试；`android/GLOSSARY.md` 两条改述外派交接与回落，指向 `RemoteAttachmentHandoffTest`/`RemoteAttachmentExternalTest` |

父规格 #281 用户故事 6、7、8、11、14 由本票覆盖；3、4、5、9、10 属 #288 文本预览，未做。

## 未执行 / 未完成

- **真机或模拟器验收未执行**：环境没有连接设备，也没有启动模拟器。系统 chooser 的实际展示、
  真正安装的 PDF/Office 查看器打开缓存文件、设备的「没有应用可处理」行为均未人工确认。
- **无接收者检测依赖系统 chooser 抛错**：见下节说明；替身测试只能证明接缝捕获后的回落，不能证明
  某台真机的系统 chooser 在没有目标时会抛 `ActivityNotFoundException`。
- **docx 未单独做面板用例**：`.docx` 与 `.pdf` 共用 EXTERNAL 分支，意图形状函数不区分后缀；测试用
  PDF 代表该分支。
- 未 push；按 Lead 要求未改 `work/implementation/evidence/README.md` 与 `index/`。

## 决策

**无接收者检测。** 应用 `targetSdk = 37` 且 manifest 没有 `<queries>`，包可见性会让
`queryIntentActivities`/`resolveActivity` 看不到已安装的 PDF/Office 阅读器，预判会把「有应用」误判成
「没有」，因此不做预查询；使用 `launch: (Intent) -> Unit` 接缝，捕获 `startActivity` 抛出的
`ActivityNotFoundException`，与 `RemoteAppUpdate.launchInstall` 同形。测试通过让接缝抛异常来固定回落
路径。真机系统 chooser 的空列表行为未验证，列入未执行项。

**缓存布局。** 采用「坐标目录 + 清洗后的原始文件名」：坐标目录仍只由 (session, message, index) 决定，
满足 #287 的缓存位置不变量；叶子名来自显示名，解决 PDF/Office 查看器把摘要当文件名展示的问题。
旧布局（`attachment-preview/<digest>` 文件）与叶子改名都用 `renameTo` 迁移，符合票面「缓存内重命名，
不是第二次下载或复制」。`RemoteAttachmentPreviewFileTest` 固定同坐标同路径、坐标目录前缀、不同坐标
互异、不可逃逸、叶子名清洗与旧布局迁移。

**清理规则。** 外派后立即删除会让接收方读不到文件，因此选择单一规则：下一次外派打开时清扫其它坐标
目录，保留本次交接文件；图片预览继续在关闭时删除自己的缓存文件。该规则由
`RemoteAttachmentExternalTest` 的「a later external open sweeps ...」与 `RemoteAttachmentHandoffTest`
的清扫用例固定。

## 提交

- `078c70fbfd` `feat(#289): PDF/Office 附件外派系统应用并在无接收者时回落另存为`
- 证据与文档提交：本文件所在提交（`docs(#289): 记录附件外派暴露面与预览缓存布局`）。

## 合并

`git merge integration/spec-281`（tip `cb6d68d626`，与基线相同）：`Already up to date.`，无冲突；合并
未改变工作树，收口门禁即上述最终树结果。
