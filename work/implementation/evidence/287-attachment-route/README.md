# #287 附件去处单一判定与图片全屏预览

Android worktree `287-attachment-route`，分支 `ticket/287-attachment-route`，基线
`integration/spec-281` @ `67e4402756`。提交：

- `67c29be07a` `feat(#287): 收敛附件去处的唯一纯函数判定`
- `c94be4a262` `feat(#287): 图片附件应用内全屏预览并复用一次下载`
- `209de19e83` `docs(#287): 记录附件去处与预览缓存子目录`
- 本证据文件的提交见该文件自身所在提交。

无数据库、wire 与 manifest 变更，无新增依赖。

## 改了什么

**一处去处判定。** `ui/identity/RemoteAttachmentDestination.kt` 新增 `RemoteAttachmentDestination`
（IMAGE / TEXT / EXTERNAL / SAVE_AS）与 `remoteAttachmentDestination(mime, name)`：

- MIME 去参数、去空白、转小写后，`image/*` → IMAGE，`text/*`、常见文本应用类型（json/xml/yaml 等）
  → TEXT，PDF/Office/RTF/EPUB 等 → EXTERNAL，其余 → SAVE_AS；
- MIME 为 `application/octet-stream` 或缺失时按后缀判定：图片、文本/代码、PDF/Office 三类后缀，
  未知或无后缀 → SAVE_AS；
- 有可信 MIME 时以 MIME 为准（例如 `text/plain` + `picture.png` 仍是 TEXT）；后缀大小写不敏感。

**附件预览缓存。** `ui/identity/RemoteAttachmentFiles.kt` 新增 `attachmentPreviewFile(context,
sessionId, messageId, index)`：文件位于 `cacheDir/attachment-preview/`，文件名是三个坐标的
SHA-256 十六进制摘要，不夹带显示名，标识符里的路径分隔符无法逃出子目录；解析时准备目录。

**一次下载。** `data/remote/RemoteChatState.kt` 新增 `cacheAttachment(...)`，与原
`downloadAttachment(...)` 共用私有 `startAttachmentDownload`：

- 图片缓存下载先写同目录 `.part`，完整后 `renameTo` 目标路径，中断/失败/切会话都不会留下可被复用的
  半截文件；
- 目标路径已有完整文件时直接回调，不再请求下载接口（同一附件重复打开复用同一路径与字节）；
- 成功后保留文件给预览与保存读取，由预览关闭时删除；失败写 `attachmentNotice` 并清掉临时文件；
- epoch 不符的迟到下载不回调、不落最终文件（沿用原另存为的绑定检查）。

**面板唯一分叉。** `ui/identity/RemoteChatPanel.kt` 的 `onDownload` 是对四个去处的一个 `when`：
IMAGE 解析缓存路径、调用 `cacheAttachment` 并打开预览；TEXT / EXTERNAL / SAVE_AS 三个分支本票都
走原有另存为（`PendingDownload` + `CreateDocument`），供后续票按行替换。

**预览生命周期。** `ui/identity/RemoteAttachmentPreview.kt` 的 `AttachmentImagePreview` 复用
现有 `ImagePreviewDialog`（缩放、保存入参是本地绝对路径，不重新下载）；`DisposableEffect` 在预览
离开组合时删除缓存文件，已另存的文件不在该路径上，不受影响。

**文档。** `android/GLOSSARY.md` 增加「附件去处」「附件预览缓存」两条；`android/README.md` 增加
「会话附件」一节，记录判定、缓存子目录与一次下载/清理语义，并指向固定这些行为的测试。

## 测试（红 → 绿）

先写测试再实现，逐片红绿：

| 切片 | 红 | 绿（命令与结果） |
| --- | --- | --- |
| 去处判定 | 未实现符号，`compileDebugUnitTestKotlin` 失败 | `./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentDestinationTest'`，`BUILD SUCCESSFUL in 20s`，14 tests / 0 failures |
| 缓存路径 | 未实现符号 | `... --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentPreviewFileTest'`，`BUILD SUCCESSFUL in 1m 12s`，4 tests / 0 failures |
| 一次下载与清理 | 未实现 `cacheAttachment` | `... --tests 'me.rerere.rikkahub.data.remote.RemoteAttachmentStateTest'`，`BUILD SUCCESSFUL in 44s`，10 tests / 0 failures（含原有 6 条） |
| 面板接线 | 3 个图片用例超时失败、非图片用例通过（`4 tests completed, 3 failed`） | `... --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentPreviewTest'`，`BUILD SUCCESSFUL in 24s`，4 tests / 0 failures；连续重跑两次均通过 |

改动面的合并运行：

```
cd android && ./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.ui.identity.*' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteAttachmentStateTest' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteChatStateTest' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteAttachmentApiTest'
```

`BUILD SUCCESSFUL in 24s`；JUnit XML 汇总 21 个类、139 tests、0 failures/errors/skips。

收口门禁（最终树，`--rerun-tasks` 强制全跑）：

```
cd android && ./gradlew test lintDebug --rerun-tasks
```

`BUILD SUCCESSFUL in 3m 29s`，`130 actionable tasks: 130 executed`。JUnit XML：app 505 tests、
ui 20 tests、highlight 52 tests，合计 577 tests，0 failures / 0 errors / 0 skipped。`lintDebug`
通过；本票新增文件无告警，改动到的旧文件上的两条告警为既存（`RemoteAttachmentFiles.kt` 的
`DefaultLocale` 来自原有 `attachmentSizeLabel`，`RemoteChatPanel.kt` 的 `ModifierParameter`
来自原有参数顺序）。

两条源码提交的 pre-commit gate 各自实跑 `./gradlew test lintDebug`，均 `BUILD SUCCESSFUL`
（`5m 02s`、`2m 20s`），未使用 `--no-verify`。

## 覆盖的验收标准

| #287 验收标准 | 证据 |
| --- | --- |
| 点图片直接应用内全屏、可缩放；保存拿到字节且整次打开只下载一次 | `RemoteAttachmentPreviewTest` 打开与保存两条：下载调用数恒为 1，查看器出现，保存得到与原字节相同的文件；缩放组件为复用的 `ImagePreviewDialog`，手势未在设备上执行 |
| 同一会话消息同一附件重复打开复用同一路径与字节；不同会话/消息/序号不相撞 | `RemoteAttachmentPreviewFileTest` 4 条（同坐标同路径、专用子目录、四类坐标互异、不可逃逸）；`RemoteAttachmentStateTest` 的 reopen 用例断言第二次不再调用下载 |
| 去处只在一处纯函数，卡片与打开流程不各自猜类型 | `RemoteAttachmentDestinationTest` 覆盖全部四类结果；面板 `onDownload` 一个 `when` 分派，`RemoteAttachmentPreviewTest` 断言图片进入查看器、非图片仍走另存为。结构唯一性由该单一调用点保证，未另写扫源码检查 |
| 纯函数单测覆盖 `.md`（两种 MIME）、`.txt`、代码后缀、图片、`.pdf`、`.docx`、未知、大写后缀、无后缀、octet-stream 被后缀纠正 | `RemoteAttachmentDestinationTest` 14 条，逐项对应 |
| 非图片本票行为与今天一致（另存为） | `RemoteAttachmentPreviewTest` 非图片用例：不发下载、不出现查看器、发出 `ACTION_CREATE_DOCUMENT`；原 `downloadAttachment` 用例保持通过 |
| 关闭预览回到消息位置、会话不跳 | 查看器是覆盖层，打开期间原消息 chip 仍在组合中（`RemoteAttachmentPreviewTest` 打开用例断言）；清理契约由 `AttachmentImagePreview` 卸载用例固定。真实滚动位置未在设备上验收 |
| 应用内打开不需要额外存储权限 | manifest 未声明外部存储权限（`grep -E 'READ_EXTERNAL\|WRITE_EXTERNAL\|MANAGE_EXTERNAL' android/app/src/main/AndroidManifest.xml` 无输出），本票未改 manifest 与依赖 |
| 词汇表与 README 记录去处与缓存子目录，声称可执行 | `android/GLOSSARY.md`、`android/README.md` 的新条目均指向上述测试类 |

父规格 #281 用户故事：1、2、11、12（部分，见上）、14、15 由本票覆盖；3–10、13 属于 #288/#289
（文本预览、外派与投递/上传一致性），本票不做。

## 未执行 / 未完成

- **真机或模拟器验收未执行**：本环境未连接设备，也没有启动模拟器。缩放/翻页手势、系统返回关闭
  预览、SAF 另存到真实位置、大图性能均未人工确认。
- **文本与老格式外派仍是另存为**：按票面要求保留现状，由 #288（文本/Markdown 预览）与 #289
  （PDF/Office 外派）替换 `when` 的相邻分支。
- **预览另存建议名**：沿用现有查看器的 `image` 建议名（共享组件行为），本票未改；票面只要求保存
  拿到字节。
- **关闭清理的测试接缝**：Robolectric 下 Compose Dialog 的返回键关闭不稳定，清理契约固定在
  `AttachmentImagePreview` 卸载处（`RemoteAttachmentPreviewTest` 的关闭用例）；设备返回键行为列入
  人工验收。
- 未 push；按 Lead 要求未改 `work/implementation/evidence/README.md` 与 `index/`，由 Lead 在合并时
  登记。

## 合并

`git merge integration/spec-281`（tip `67e4402756`，与基线相同）：`Already up to date.`，无冲突；
合并后代码与测试文件未变化，故收口门禁即上述最终树结果。
