# #288 附件文本预览：Markdown 渲染、纯文本与代码只读、UTF-8/GB18030 解码

- 票：#288，父规格 #281
- 分支：`ticket/288-text-preview`（基线 `integration/spec-281` @ `cb6d68d626`）
- 范围：`android/`；未改 wire、数据库、manifest、依赖或 `work/implementation/evidence/` 索引。
- 真机：**未执行**（本机无目标设备，未以模拟器替代）。

## 改了什么

- `android/app/src/main/java/me/rerere/rikkahub/ui/identity/RemoteAttachmentDestination.kt`
  - 新增 `TEXT_PREVIEW_MAX_BYTES = 2 * 1024 * 1024` 与 `remoteAttachmentDestinationFor(mime, name, bytes)`：
    先按原有 MIME/后缀规则得到类型，文本按附件记录的 `bytes` 超过上限时改判 `EXTERNAL`
    （`EXTERNAL` 目前仍走另存为，由 #289 换成外派）。面板只调用这一个入口。
- `.../RemoteAttachmentText.kt`（新增，无 UI 依赖）
  - `RemoteAttachmentText`：`Decoded(text)` 或 `Undecodable`。
  - `decodeRemoteAttachmentText(bytes)`：严格 UTF-8 → 严格 GB18030；`CharsetDecoder` 均设
    `CodingErrorAction.REPORT`，`CharacterCodingException` 转成 `Undecodable`，不返回替换字符、不抛异常。
  - `remoteAttachmentTextLayout(mime, name)`：`.md`/`.markdown` 后缀或 `text/markdown` MIME 为
    `MARKDOWN`（`text/plain` + `.md` 也按后缀算 Markdown）；其余 `.txt`、代码后缀与无后缀文本为
    `PLAIN`；正文不参与判定。
- `.../RemoteAttachmentTextPreview.kt`（新增）
  - 全屏 `Dialog` 浮层，标题为附件名，带「关闭预览」按钮；与图片预览一样使用 `usePlatformDefaultWidth = false`。
  - 文本在 `Dispatchers.IO` 上读取并解码；Markdown 在同一次后台加载里用
    `me.rerere.ui.markdown.parseMarkdown` 解析，再交给 `me.rerere.rikkahub.ui.components.richtext.MarkdownBlock`
    ——与 `MessageBody` 相同的一对解析/渲染入口；
    纯文本/代码用 Fairy token 的等宽字体（`telemetryFontFamily`）、`SelectionContainer` 可选择、
    竖向滚动，保留原文换行与缩进。失败显示「无法解码」（读文件失败显示「无法读取附件」）。
- `.../RemoteAttachmentPreview.kt`
  - 抽出 `DeleteCachedPreviewOnDispose(path)`，图片与文本共用；关闭预览时只删除该缓存文件。
- `.../RemoteChatPanel.kt`
  - 点击回调只调用 `remoteAttachmentDestinationFor`；IMAGE 与 TEXT 共用 `cachePreview`（`attachmentPreviewFile`
    + `state.cacheAttachment`），一次认证下载；TEXT 分支按 `remoteAttachmentTextLayout` 打开文本预览。
    EXTERNAL/SAVE_AS 保持原有另存为。
- `android/GLOSSARY.md`「附件去处」「附件预览缓存」与 `android/README.md`「会话附件」：记录文本预览边界、
  2 MiB 上限、编码顺序与对应测试。

## 关键决策

- **解码顺序与失败状态**：UTF-8 优先，失败才尝试 GB18030；两者都失败返回 `Undecodable`，由 UI 显示
  「无法解码」，绝不使用替换字符。测试：
  - `RemoteAttachmentTextTest.a chinese utf 8 sample decodes as utf 8`
  - `RemoteAttachmentTextTest.a chinese gb18030 sample decodes after utf 8 fails`
  - `RemoteAttachmentTextTest.bytes that are neither utf 8 nor gb18030 report an explicit failure`
  - `RemoteAttachmentPreviewTest.an undecodable text attachment shows an explicit failure state`
- **2 MiB 上限**：用附件记录的 `bytes`（下载前即可判断），超过 `2 * 1024 * 1024` 的文本判为 `EXTERNAL`，
  不在应用内展开；今天落回另存为，#289 落地后自动变成外派。测试：
  - `RemoteAttachmentDestinationTest.a text over two mib is not expanded in app`
  - `RemoteAttachmentDestinationTest.a text at or under two mib stays in the in app preview`
  - `RemoteAttachmentDestinationTest.the two mib ceiling applies only to text`
  - `RemoteAttachmentPreviewTest.a text over two mib keeps the save-as route without downloading`
- **Markdown 判定**：文件名后缀与 MIME 任一指向 Markdown 即渲染；`text/plain` 是系统兜底类型，不能压过
  `.md` 后缀；`text/markdown` 无后缀也渲染；`.txt` 即使正文像 Markdown 仍是纯文本。测试：
  - `RemoteAttachmentTextTest.a markdown suffix selects rendered markdown`
  - `RemoteAttachmentTextTest.a markdown mime selects rendered markdown without a suffix`
  - `RemoteAttachmentTextTest.text plain with a markdown suffix still selects markdown`
  - `RemoteAttachmentTextTest.a txt with markdown looking content stays plain`
  - `RemoteAttachmentTextTest.code and unsuffixed text use the plain layout`

## 验收标准覆盖

| # | 票面条目 | 覆盖 |
| --- | --- | --- |
| 1 | `.md`（`text/markdown` 或 `octet-stream` 按后缀）呈现渲染排版 | `RemoteAttachmentTextTest` 判定用例；`RemoteAttachmentPreviewTest.clicking a markdown attachment renders it from one cached download` 断言标题不显示 `#` |
| 2 | `.txt` 与代码后缀等宽只读，换行与缩进保留 | 判定用例 + `RemoteAttachmentPreviewTest.clicking a plain text attachment shows its body with line breaks kept`；只读/等宽是 `SelectionContainer` 与 `telemetryFontFamily` 的实现事实 |
| 3 | 中文 UTF-8 与 GB18030 都能显示；都不成立时明确提示 | 三条解码用例 + `an undecodable text attachment shows an explicit failure state` |
| 4 | 超过 2 MiB 文本不在应用内展开 | 去向三条用例 + 面板超限用例（不下载、走另存为） |
| 5 | 解码与大小规则有不依赖 UI 的测试；点击 → 文本预览有 Robolectric/Compose 覆盖 | `RemoteAttachmentTextTest`、`RemoteAttachmentDestinationTest`、`RemoteAttachmentPreviewTest` |
| 6 | 不新增解析/渲染依赖 | 未改 `build.gradle.kts`、`gradle/libs.versions.toml`；Markdown 复用现有 `parseMarkdown` + `MarkdownBlock` |
| 7 | 词汇表与 README 记录边界 | `android/GLOSSARY.md`、`android/README.md` 的「会话附件」；每条声称都指向本文列出的测试 |

## 实际命令与结果

### 定向测试（收口前）

```bash
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew :app:testDebugUnitTest \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentTextTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentDestinationTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentPreviewTest' \
  --tests 'me.rerere.rikkahub.ui.identity.RemoteAttachmentPreviewFileTest' \
  --tests 'me.rerere.rikkahub.data.remote.RemoteAttachmentStateTest' \
  --console=plain
```

结果：`BUILD SUCCESSFUL in 1m 7s`；5 个类共 **48 tests、0 failures、0 errors、0 skipped**：
`RemoteAttachmentTextTest` 8、`RemoteAttachmentDestinationTest` 17、`RemoteAttachmentPreviewTest` 9、
`RemoteAttachmentPreviewFileTest` 4、`RemoteAttachmentStateTest` 10。Markdown 预览修复后单独重跑
`RemoteAttachmentPreviewTest` 9 tests 全通过；最终门禁的 `--rerun-tasks` 重跑了同一批用例。

### 收口门禁

```bash
cd android
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew test lintDebug --rerun-tasks --console=plain
```

结果：`BUILD SUCCESSFUL in 5m 33s`，`130 actionable tasks: 130 executed`；单元测试共 **593 tests、
0 failures、0 errors、0 skipped**（app 521、ui 20、highlight 52），`lintDebug` 通过。

第一次 `--rerun-tasks` 全套重跑时，Markdown 面板用例在 5 秒内没等到「标题」且原文节点消失
（单类单跑通过，属于等待条件过脆）。改为预览在后台解析 `parseMarkdown` 后直接渲染 `MarkdownBlock`
（不再经过 `MessageBody` 的原文闪帧），测试拆成「预览出现」与「渲染文本出现」两步后，本次全套重跑通过。

`git merge integration/spec-281`：`Already up to date.`（该集成分支 tip 仍为 `cb6d68d626`，未与 #289 的并行工作冲突）。

提交前钩子对每个提交运行共享门禁（`npm test` 473 tests 全通过、`combo:verify`、Android `test lintDebug`），
从未使用 `--no-verify`。

## 未完成 / 未执行

- **真机**：未验收。触摸选择、返回键关闭、大文本滚动与真实字体表现均未在设备上执行；Robolectric/Compose 只证明行为。
- **外派**：`EXTERNAL` 仍是另存为；#289 落地后，超过 2 MiB 的文本与 PDF/Office 才真正走系统应用。本票不实现外派。
- **无性能测量**：2 MiB 上限只保证单次读入有界，未做设备上的打开耗时/内存测量。
- **未覆盖**：字体是否渲染为等宽的像素级断言、解码的线程断言（代码在 `Dispatchers.IO` 执行，测试观察的是结果）。
- 依赖、wire、数据库与 manifest 未改动；`android/` 本地构建配置（`local.properties`、`google-services.json`）为忽略文件，未入库。
