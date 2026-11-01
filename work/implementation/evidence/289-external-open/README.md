# #289 附件外派系统应用：FileProvider 子目录交接与无接收者回落另存为

Android worktree `289-external-open`，分支 `ticket/289-external-open`，起点
`integration/spec-281` @ `cb6d68d626`（已含 #287）。提交见文末「提交」。

无数据库、wire 与 manifest 变更，无新增依赖。本票只改 EXTERNAL；与 #288 合并后，TEXT 走应用内只读
预览，SAVE_AS 仍接收未知类型。

**与 #288 合并。** `integration/spec-281` @ `fca46c15ad`（含 #288 文本预览）已合入本分支：点击决定
仍是唯一的 `remoteAttachmentDestinationFor(mime, name, bytes)`；TEXT 打开应用内只读预览，超过 2 MiB
的 TEXT 由该函数降为 EXTERNAL 并真正外派；图片、文本与外派共享面板 `cachePreview` 的同一份缓存
下载，图片与文本预览共用 `DeleteCachedPreviewOnDispose`。

## 改了什么

**外派意图。** `ui/identity/RemoteAttachmentHandoff.kt` 新增 `externalAttachmentIntent(context,
file, mime, displayName)`：`FileProvider.getUriForFile` 生成 `${applicationId}.fileprovider` 的
`content://` URI，`ACTION_VIEW` + `setDataAndType(uri, mime)`，`ClipData.newRawUri(displayName, uri)`
保留原始显示名，意图带 `FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK`。
`launchExternalAttachment(..., launch = { context.startActivity(it) })` 是启动接缝，捕获
`ActivityNotFoundException` 并返回「没有能打开该文件的系统应用，已改为另存为」。

这里**不**用 `Intent.createChooser` 包装（见「决策」）：直接启动裸 `ACTION_VIEW`，多个应用匹配时
由系统解析器让用户选择；没有匹配 activity 时 `startActivity` 抛 `ActivityNotFoundException`，回落
才可能发生。这是对票面「ACTION_VIEW + chooser」措辞的有意偏离，理由记在证据里，未加针对 AOSP
行为的测试。

**FileProvider 暴露面加一条。** `app/src/main/res/xml/file_paths.xml` 只新增
`<cache-path name="attachment-preview" path="attachment-preview/" />`；既有 `app-update` 条目不变。
`RemoteAppUpdateTest` 的路径清单测试由「只有 app-update」更新为精确的
`[app-update/, attachment-preview/]` 两条，provider 仍未导出并持有 URI 授权；`appInstallIntent`
的 `/app-update/latest.apk` 断言保持通过。

**一次下载后交接。** 合并 #288 后，`RemoteChatPanel` 的 `cachePreview` 闭包统一服务 IMAGE、TEXT 与
EXTERNAL：`attachmentPreviewFile(..., name)` 解析坐标路径 → `state.cacheAttachment` 走既有会话鉴权
下载并复用已有完整文件。EXTERNAL 分支再 `sweepAttachmentPreviews` 保留本次文件、清掉其它坐标缓存 →
`launchExternalAttachment`。每次打开至多一次下载调用；重复打开同一附件直接复用缓存字节。

**无接收者回落。** `launchExternalAttachment` 返回失败文案时，面板把文案写进既有
`attachmentNotice`（`RemoteChatState.noticeAttachment`），用 `PendingDownload.cached` 记住已缓存
文件并打开原有 `CreateDocument` 另存为；SAF 回调直接 `exportAttachment` 这份缓存字节，不再调用
下载接口。用户能看到「没有能打开该文件的系统应用，已改为另存为」，另存成功显示「原件已保存」。

**缓存布局。** `attachmentPreviewDirectory(context, sessionId, messageId, index)` 仍只由三个坐标的
SHA-256 决定坐标目录 `cacheDir/attachment-preview/<digest>/`；`attachmentPreviewFile(..., name)` 把
清洗后的原始显示名作为目录内文件名（替换 `/`、`\`、控制字符，拒绝 `.`/`..`，限长 120），
PDF/Office 查看器不再显示十六进制摘要名。同一坐标的目录不变；显示名变化只改变叶子名。票面最初
设想的旧布局（`attachment-preview/<digest>` 文件）从未发布过，按「规模校准」不做迁移代码；
`RemoteChatState.cacheAttachment` 的 `.part` 暂存已保证复用到的文件是完整的。

**清理规则。** 外派交接后**不**删除文件（接收方可能仍在读）；规则是「下一次外派打开时清扫其它坐标
目录」，由 `sweepAttachmentPreviews(context, keep = file)` 实现，保留本次交接文件。图片与文本预览
由共享的 `DeleteCachedPreviewOnDispose` 在关闭时删除自己的文件，#287 的关闭清理未改。

**文档。** `android/README.md`「会话附件」统一记录唯一入口 `remoteAttachmentDestinationFor`、四种去处
（图片预览、文本预览与 2 MiB 规则、外派交接与回落、另存为）、缓存叶子命名、共享的 `cachePreview`
与 `DeleteCachedPreviewOnDispose`、FileProvider 暴露面与清扫规则；`android/GLOSSARY.md`「附件去处」
「附件预览缓存」同步改写并指向固定这些行为的测试。

## 测试（红 → 绿）

| 切片 | 红 | 绿（命令与结果） |
| --- | --- | --- |
| 坐标目录 + 原名叶子 | `RemoteAttachmentPreviewFileTest` 改签名后 `compileDebugUnitTestKotlin` 失败（`Too many arguments` / `Unresolved reference`） | `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentPreviewFileTest'`：5 tests / 0 failures |
| 外派意图形状与启动接缝 | `RemoteAttachmentHandoffTest` 引用未实现符号，编译失败 | 同命令 `--tests '...RemoteAttachmentHandoffTest'`：4 tests / 0 failures（裸 `ACTION_VIEW` 且无 `EXTRA_INTENT`、`content` scheme、`.fileprovider` authority、`/attachment-preview/` 路径、读授权、NEW_TASK、ClipData label、抛异常回落、清扫保留） |
| 面板一次下载、回落、清扫 | 首跑 2 failed：Robolectric 每测试独立 cacheDir 导致 FileProvider 静态策略缓存指向旧目录（补清 `sCache` 的 `@Before`）；另一次是导出完成与状态刷新之间的等待竞态（改为等待语义节点） | `... --tests '...RemoteAttachmentExternalTest'`：5 tests / 0 failures（PDF 点击下载 1 次并交出裸 `ACTION_VIEW`；抛出 `ActivityNotFoundException` 时打开 `ACTION_CREATE_DOCUMENT`、保存后仍只有 1 次下载；重复打开复用缓存；第二次外派清掉第一份；manifest 无存储权限） |
| 既有 FileProvider 清单 | 原测试期望仅 `app-update`，加 xml 条目后失败 | `... --tests '...RemoteAppUpdateTest'`：17 tests / 0 failures |
| 合并 #288 后的改动面 | 合并冲突与 4 参数 `attachmentPreviewFile` 调用导致编译失败；PDF 仍按 #288 旧断言走另存为 | `:app:testDebugUnitTest --tests 'RemoteAttachment*'` + `RemoteAttachmentStateTest`：59 tests / 0 failures（File 5、Handoff 4、External 5、Preview 10、Text 8、Destination 17、State 10） |

合并后的改动面运行：

```
cd android && ./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachment*' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteAttachmentStateTest'
```

`BUILD SUCCESSFUL`；JUnit XML 汇总 7 个类、59 tests、0 failures / 0 errors / 0 skipped。合并后的
`RemoteAttachmentPreviewTest` 同时覆盖图片打开/保存/关闭、Markdown 与纯文本预览、无法解码、超 2 MiB
文本外派、PDF 外派与未知类型另存为。

收口门禁（最终树）：

```
cd android && ./gradlew test lintDebug
```

结果：`BUILD SUCCESSFUL in 2m 13s`（`134 actionable tasks: 11 executed, 123 up-to-date`）。JUnit XML 合计
604 tests、0 failures / 0 errors / 0 skipped（app 532、ui 20、highlight 52）。`lintDebug` 通过；本次新增
`RemoteAttachmentHandoff.kt`、`RemoteAttachmentHandoffTest.kt`、`RemoteAttachmentExternalTest.kt` 无告警；
改动文件上的 `DefaultLocale`（`RemoteAttachmentFiles.kt` 原有 `attachmentSizeLabel`）与
`ModifierParameter`（`RemoteChatPanel.kt` 原有参数顺序）为既存告警。

## 覆盖的验收标准

| #289 验收标准 | 证据 |
| --- | --- |
| 点 PDF/docx 拉起系统解析器，意图带正确 MIME 与临时读授权，接收方拿到附件缓存子目录里的文件 | `RemoteAttachmentHandoffTest` 的意图用例逐项断言裸 `ACTION_VIEW`（且无 `EXTRA_INTENT`）、type/scheme/authority/path/read-grant/NEW_TASK/ClipData label；`RemoteAttachmentExternalTest` 从真实面板点击 PDF 断言交给系统解析器的意图与缓存文件；`.docx` 走同一 EXTERNAL 分支（路由由既有 `RemoteAttachmentDestinationTest` 固定），未单独造 docx 面板用例。票面措辞是「chooser」，实现改为裸 `ACTION_VIEW`，多个应用匹配时由系统解析器提供选择，理由见「决策」 |
| FileProvider 只额外暴露附件缓存子目录；安装包目录既有暴露不变；结构测试固定清单 | `file_paths.xml` 精确两条；`RemoteAppUpdateTest` 的「file paths expose exactly ...」断言完整清单（多/少/改名都会失败），同文件的 provider 未导出/授权用例与 `appInstallIntent` 的 `/app-update/latest.apk` 用例保持通过 |
| 没有匹配应用时回落另存为，用户能看到结果，不静默失败 | `RemoteAttachmentExternalTest` 以抛出 `ActivityNotFoundException` 的启动接缝跑真实面板：出现回落通知、发出 `ACTION_CREATE_DOCUMENT`、保存后字节正确，且下载调用数仍为 1；`RemoteAttachmentHandoffTest` 直接断言失败文案 |
| 不需要额外存储权限，不新增依赖 | `RemoteAttachmentExternalTest` 断言 manifest 未请求 `READ_EXTERNAL_STORAGE`/`WRITE_EXTERNAL_STORAGE`（文件 URI 读取走 FileProvider 临时授权）；`git diff` 无 `build.gradle*` 依赖变更 |
| README/词汇表关于暴露面的描述与 xml 一致 | `android/README.md` 写明只暴露 `app-update/` 与 `attachment-preview/`，并指向 `RemoteAppUpdateTest` 的清单测试；`android/GLOSSARY.md` 两条改述外派交接与回落，指向 `RemoteAttachmentHandoffTest`/`RemoteAttachmentExternalTest` |

父规格 #281 用户故事 6、7、8、11、14 由本票覆盖；3、4、5、9、10 由已合入的 #288 文本预览覆盖，
合并后的 `RemoteAttachmentPreviewTest` 同时验证两票行为。投递与上传附件共用同一条点击路径（故事 13），
未按来源分别造用例。

## 未执行 / 未完成

- **真机或模拟器验收未执行**：环境没有连接设备，也没有启动模拟器。系统解析器/多应用选择界面、
  真正安装的 PDF/Office 查看器打开缓存文件、设备的「没有应用可处理」行为均未人工确认。
- **无接收方检测的真机行为未验证**：实现改为裸 `ACTION_VIEW`，理由见「决策」；替身测试只能证明
  接缝捕获后的回落，真机上 `startActivity` 是否如预期抛 `ActivityNotFoundException` 未在设备确认。
- **docx 未单独做面板用例**：`.docx` 与 `.pdf` 共用 EXTERNAL 分支，意图形状函数不区分后缀；测试用
  PDF 代表该分支。
- 未 push；按 Lead 要求未改 `work/implementation/evidence/README.md` 与 `index/`。

## 决策

**无接收者检测。** 应用 `targetSdk = 37` 且 manifest 没有 `<queries>`，包可见性会让
`queryIntentActivities`/`resolveActivity` 看不到已安装的 PDF/Office 阅读器，预判会把「有应用」误判成
「没有」，因此不做预查询；使用 `launch: (Intent) -> Unit` 接缝，捕获 `startActivity` 抛出的
`ActivityNotFoundException`，与 `RemoteAppUpdate.launchInstall` 同形。关键是不能把 `ACTION_VIEW`
包进 `Intent.createChooser`：AOSP 的 chooser 对零目标有明确的空状态路径
[`NoAppsAvailableEmptyStateProvider.java`](https://android.googlesource.com/platform/frameworks/base.git/+/refs/heads/main/core/java/com/android/internal/app/NoAppsAvailableEmptyStateProvider.java)，
它展示的正是用户可见的 “No apps can perform this action” 对话框，所以启动 chooser 不会以异常告诉我们
没有接收方，回落永远不可达；裸 `ACTION_VIEW` 在没有匹配 activity 时才抛 `ActivityNotFoundException`，
多个应用匹配时系统解析器仍会给出选择。这是对票面「ACTION_VIEW + chooser」措辞的有意偏离：父规格
故事 6 要的是已安装应用直接打开，故事 8 要的是没有应用时仍能另存为，只有裸 `ACTION_VIEW` 同时满足。
测试通过让接缝抛异常来固定回落路径；真机行为未验证，列入未执行项。

**缓存布局。** 采用「坐标目录 + 清洗后的原始文件名」：坐标目录仍只由 (session, message, index) 决定，
满足 #287 的缓存位置不变量；叶子名来自显示名，解决 PDF/Office 查看器把摘要当文件名展示的问题。
旧布局从未发布，迁移代码已删除；`RemoteChatState.cacheAttachment` 的 `.part` 暂存保证复用文件完整。
`RemoteAttachmentPreviewFileTest` 固定同坐标同路径、坐标目录前缀、不同坐标互异、不可逃逸与叶子名清洗。

**清理规则。** 外派后立即删除会让接收方读不到文件，因此选择单一规则：下一次外派打开时清扫其它坐标
目录，保留本次交接文件；图片与文本预览继续由共享的 `DeleteCachedPreviewOnDispose` 在关闭时删除自己
的缓存文件。该规则由 `RemoteAttachmentExternalTest` 的「a later external open sweeps ...」与
`RemoteAttachmentHandoffTest` 的清扫用例固定。

## 提交

- `078c70fbfd` `feat(#289): PDF/Office 附件外派系统应用并在无接收者时回落另存为`
- `07edbd97dd` `docs(#289): 记录附件外派暴露面与预览缓存布局`
- `bd1fc19859` `fix(#289): 外派直接启动 ACTION_VIEW 并移除未发布的缓存迁移`
- 合并提交：本文件所在提交（`merge(#289): ...`，合入含 #288 的 `integration/spec-281`）。

## 合并

`git merge integration/spec-281` @ `fca46c15ad`（含 #288 文本预览）产生 5 个冲突文件：
`RemoteAttachmentDestination.kt`、`RemoteChatPanel.kt`、`RemoteAttachmentPreviewTest.kt`、
`android/README.md` 与 `android/GLOSSARY.md`。解决方式：

- 保留 `RemoteAttachmentFiles.kt` 的 5 参数 `attachmentPreviewFile(..., name)`，并把 #288 的
  `cachePreview` 调用改成同一签名；
- 面板保留 #288 的 `cachePreview` 共享下载与 TEXT 预览，同时保留 EXTERNAL 的 `sweepAttachmentPreviews`
  → `launchExternalAttachment` → ANFE 通知 + `PendingDownload(cached = file)` + 另存为；
- `RemoteAttachmentPreviewTest` 取两票并集：图片打开/保存/关闭、Markdown、纯文本、无法解码、超 2 MiB
  文本外派、PDF 外派、未知类型另存为；文本用例改用 5 参数缓存路径；
- 文档统一为唯一入口 `remoteAttachmentDestinationFor` 与四种去处，补共享 `cachePreview` 与
  `DeleteCachedPreviewOnDispose`、缓存叶子命名与 #289 的清扫规则。

未重写任一票的提交；`union/spec-281` 仍未合并（等 Lead 指示）。合并后全量门禁见上。
