# #213 会话中呈现工具调用

日期：2026-10-24。票面见 [实施约定](../../../tickets/213-tool-calls.md)。开工基点
`integration/spec-205` 的 `4fb3250984`。

## 结论与范围

工具调用步骤在前端曾经是一行空文本：后端投影把工具步骤的可见文本只取 `text` block，而只请求
工具、没有正文的步骤文本为空；客户端消息模型没有工具字段，也就没有可渲染的内容。修复把**工具名**
放进投影，客户端按序渲染为可见条目。参数与工具输出不进投影、不进界面。

不在本票范围：后端执行器、工具结果消息的呈现、任务报告（`tasks`）与后台任务面板。

## 现状与根因（代码事实）

- `backend/chat/src/units.ts` 的 `messageText` 只拼接 `type === 'text'` 的 content block；
  `assistant/message` 的 message 是原样 `content`，工具步骤因此得到 `text: ''`。
- 客户端 `RemoteChatMessage`（`android/.../data/remote/RemoteChatApi.kt`）只有
  `messageId/seq/requestId/role/status/text/attachments`，投影里也没有工具信息可解。
- 原生日志里工具步骤的形状：`assistant/message` 带 `content: [{type:'tool-call', id, name,
  arguments}, …]`，随后是 `tool/result`；`tests/projection-units-real.test.mjs` 的真实会话日志
  就是这条路（mock 模型发 `todo_write`）。dsh 在**执行工具之前**先 append `assistant/message`
  （`packages/core/agent-loop/src/agent.ts:538` 之后才 `executeToolCalls`），所以条目在工具执行
  期间就已经在会话里。

## 改动

**后端**（`backend/chat/src/units.ts`）

- `transcriptRowSchema` 增加 `tools: string[]`：该消息请求的工具名，按 content block 顺序。
- `toolNamesOf` 只取 `block.name`；`arguments` 与 `tool/result` 不参与。
- `rowAtCut` 在 `tools` 为空时**不输出该字段**，与 `attachments` 在 attempt 行缺席的既有做法一致，
  普通消息的线上形状不变。
- `stateVersion` 3 → 4：行形状变了，registry 丢弃旧版本持久化行并从 `init` 重折历史，旧会话也能
  显示工具名。
- `backend/chat/README.md` 的 `messages` 契约同步为 `{…,attachments,tools?}`。

**客户端**

- `RemoteChatMessage.tools: List<String> = emptyList()`：旧快照与普通消息解码为「没有工具」。
- `RemoteTranscript` 在消息正文之后按序渲染 `调用工具 · <name>` 小号标签行（`labelSmall` +
  `onSurfaceVariant`，与「已停止」「回复失败」同一套文字样式），不新增 chip、图标或动画。

## 验证

后端：

```sh
npm run build
node --test tests/projection-units.test.mjs tests/projection-fold.test.mjs tests/chat-read-window.test.mjs
node --test tests/projection-units-real.test.mjs
node --test tests/chat-multi-observer.test.mjs tests/chat-stream-backpressure.test.mjs
```

- `projection-units`＋`projection-fold`＋`chat-read-window`：25/25 通过。
- `projection-units-real`：1/1 通过。这是**真实产品后端 + mock 模型**的日志：会话里那条
  `seq: 11`、`text: ""` 的 assistant 行现在带 `tools: ["todo_write"]`；冻结期望里的这一行与
  10 个包含它的 cut 一并更新，其余字段逐字未变。
- `chat-multi-observer`＋`chat-stream-backpressure`：3/3 通过。

Android（`android/`，`ANDROID_HOME=/home/eafen405/Android/Sdk`，`--offline`）：

```sh
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.identity.*' \
  --tests 'me.rerere.rikkahub.data.remote.*' --console=plain
```

- 193 项通过，0 失败。包含新增 `RemoteTranscriptToolCallTest`（3 项）与
  `RemoteChatApiTest` 的 `tools` 解码用例。

全量：

```sh
npm test
npm run combo:verify
```

- 全量 `npm test`：**296/296 通过**，0 失败、0 跳过（`pretest` 先 `npm run build`）。
- `npm run combo:verify`：`combo: combination verified`（ourfairy 基于集成分支 tip、dsh 锁定提交、
  Android 来源声明三条 ok）。

## 呈现行为的断言点

- 后端：`tests/projection-units.test.mjs` 断言工具名按块顺序出现在 `messages`，并断言投影文本里
  不含参数与原样工具输出；`projection-units-real` 在真实日志上断言同一事实。
- 客户端：`RemoteTranscriptToolCallTest` 从**渲染结果**断言——两条独立的未合并文本节点分别存在
  （`调用工具 · bash` / `调用工具 · read`）、`bash` 在上、流式期间（`attempt` 非空）仍在。
  断言读的是 Compose 语义树，不是内部状态。

## 未执行项

- 未在真机上目视验收（本票是呈现改动，测试跑在 Robolectric 上）。
- 未改 `tasks`/后台任务面板，也未让工具名进入通知或投屏类摘要。
- 流式过程中的**当前未提交**步骤（模型正在吐 tool-call、消息还没 append 的那一小段）不显示工具名：
  条目随 `assistant/message` 提交出现。工具执行与后续步骤期间条目都在场。
