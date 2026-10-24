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
- `assistant/attempt` 行与实时 `attempt` 叠加层也从 stream 的 `tool-call-chunks` 取工具名
  （`attemptTools`，按 call id 去重、跳过尚无名字的记录）。被中止的步骤没有消息，名字因此不会丢。
- 只有 `assistant/message` 带工具名：`delivery/message`（任务报告）一律为空，呈现不变。
- `stateVersion` 3 → 4：行形状变了，registry 丢弃旧版本持久化行并从 `init` 重折历史，旧会话也能
  显示工具名。
- `backend/chat/README.md` 的 `messages` 契约同步为 `{…,attachments,tools?}`。

**客户端**

- `RemoteChatMessage.tools: List<String> = emptyList()`：旧快照与普通消息解码为「没有工具」。
- `RemoteChatAttempt.tools` 同理；`RemoteChatPanel` 把 `attempt.tools` 传进 `RemoteTranscript`。
- `RemoteTranscript` 在消息正文之后按序渲染 `调用工具 · <name>` 小号标签行（`labelSmall` +
  `onSurfaceVariant`，与「已停止」「回复失败」同一套文字样式），不新增 chip、图标或动画。实时行
  （还没有消息）用 `attemptTools` 渲染同一套行。

## 验证

后端：

```sh
npm run build
node --test tests/projection-units.test.mjs tests/projection-fold.test.mjs tests/chat-read-window.test.mjs
node --test tests/projection-units-real.test.mjs
node --test tests/chat-multi-observer.test.mjs tests/chat-stream-backpressure.test.mjs
```

- `projection-units`＋`projection-fold`＋`chat-read-window`：25/25 通过（评审修补后含新增的被中止
  步骤、重复 call id、投递不带工具名、跨消息顺序四条用例）。
- `projection-units-real`：1/1 通过。这是**真实产品后端 + mock 模型**的日志：会话里那条
  `seq: 11`、`text: ""` 的 assistant 行现在带 `tools: ["todo_write"]`；冻结期望里的这一行与
  10 个包含它的 cut 一并更新，其余字段逐字未变。
- `chat-multi-observer`＋`chat-stream-backpressure`：3/3 通过。

Android（`android/`，`ANDROID_HOME=/home/eafen405/Android/Sdk`，`--offline`）：

```sh
./gradlew :app:testDebugUnitTest --tests 'me.rerere.rikkahub.ui.identity.*' \
  --tests 'me.rerere.rikkahub.data.remote.*' --console=plain
```

- 194 项通过，0 失败。包含新增 `RemoteTranscriptToolCallTest`（4 项）与
  `RemoteChatApiTest` 的 `tools` 解码用例。
- 客户端的构建与静态检查按 `android/AGENTS.md` 的验证入口另跑一次：

```sh
ANDROID_HOME=/home/eafen405/Android/Sdk ./gradlew lintDebug assembleDebug \
  -Pourfairy.identityEndpoint=https://measurement.invalid --offline --console=plain
```

  `BUILD SUCCESSFUL`（约 1 分 32 秒）：单测、lint 与 debug APK 构建都实际执行。

全量：

```sh
npm test
npm run combo:verify
```

- 全量 `npm test`：**300/300 通过**，0 失败、0 跳过（`pretest` 先 `npm run build`）。
- `npm run combo:verify`：`combo: combination verified`（ourfairy 基于集成分支 tip、dsh 锁定提交、
  Android 来源声明三条 ok）。

## 呈现行为的断言点

- 后端：`tests/projection-units.test.mjs` 断言工具名按块顺序出现在 `messages`，并断言投影文本里
  不含参数与原样工具输出；`projection-units-real` 在真实日志上断言同一事实。
- 客户端：`RemoteTranscriptToolCallTest` 从**渲染结果**断言——两条独立的未合并文本节点分别存在
  （`调用工具 · bash` / `调用工具 · read`）、`bash` 在上、流式期间（`attempt` 非空）仍在。
  断言读的是 Compose 语义树，不是内部状态。

## 两轴评审

Standards 与 Spec 各一轮，范围 `git diff 29f6d71ad2...HEAD`。

- Standards 抓到的硬问题都已修：`backend/chat/README.md` 仍写 transcript 版本 3（现为 4）；
  「stateVersion 绑定 README」的测试其实只断言手写常量（现在真的读 README 的句子）；客户端只跑了
  定向单测、缺 `lintDebug`/`assembleDebug` 证据（已补跑并记录）；`RemoteChatApiTest` 里
  `DELIVERED_SNAPSHOT` 的 KDoc 被新 fixture 挤成了孤儿注释（已归位）。
- Spec 抓到的问题也已修：被中止/仍在流的步骤原本没有工具名（现在从 stream 取，attempt 行与实时
  叠加层都带）；`delivery/message` 不该长 `tools`（现在只给 `assistant/message`）；`tools` 混进
  冻结的「纯捕获」期望却说成捕获值（`projection-units-real.test.mjs` 的头注已说明这是唯一例外）。
- 未改的两条评审意见：`messageText` 与 `toolNamesOf` 的过滤器形状相近（两者都是一行的
  filter/map，抽公共函数要引入按块类型收窄的泛型守卫，收益低于复杂度）；行字段用 zod
  `z.infer` 已经让漏字段变成类型错误，没有再引入行工厂。

## 未执行项

- 未在真机上目视验收（本票是呈现改动，测试跑在 Robolectric 上）。
- 未改 `tasks`/后台任务面板，也未让工具名进入通知或投屏类摘要。
- 一步之内 text 与 tool-call 交错时，界面固定先显示正文再列出工具名（投影只保留 `text` 合并
  文本与工具名数组，不保留块间交错）。模型常见的「先正文后调用」不受影响。
