> 2026-10-20 状态：现行。本文记录 2026-10-13 的判断，不描述当前实现。

# 当前 dsh 消息模型与会话关键词检索

核实日期：2026-10-13。范围仅为本地源码阅读；未执行测试、未修改上游仓库。以下“事实”来自当前 checkout，不代表 OurFairy 已经选定这些行为。

源码版本：

- deepseek-harness：`d743267388641bc76f17c45ce8b4c231aed1d32c`，本地 `/home/eafen405/projects/deepseek-harness`。
- Fairybot：`095efdd84fd7ab2215a0b5b03369aac4f1303108`，本地 `/home/eafen405/projects/Fairybot`。

## 事实：一条消息是什么

当前 dsh 的消息不是单个文本字符串，而是不可变的结构，公共字段为 `id`、`role`、`content`、`source`。其中 `content` 为内容块数组，`source` 表示生产来源。`id` 由构造函数生成 UUID；消息构造会复制并深度冻结值。消息本体没有统一的 `userId`、`sessionId`、`time` 字段。

来源：[公共字段与 roles](/home/eafen405/projects/deepseek-harness/packages/llm/llm/src/message.ts:138)、[构造与 UUID](/home/eafen405/projects/deepseek-harness/packages/llm/llm/src/message.ts:212)。

| role | 含义与额外字段 |
|---|---|
| `system` | 系统提示；`source.kind = 'system-prompt'` |
| `developer` | 会话中的增量能力变化等信息 |
| `user` | 用户角色输入，但不保证是真人直接发送 |
| `assistant` | 模型产出；source 包含 `kind: 'model'`、`provider`、`model`，以及可选的 `replayState` |
| `tool` | 一个工具调用的结果；额外有 `toolCallId`、可选 `isError`；source 包含 `kind: 'tool'` 和 `callId` |

来源：[来源类型](/home/eafen405/projects/deepseek-harness/packages/llm/llm/src/message.ts:9)、[角色定义](/home/eafen405/projects/deepseek-harness/packages/llm/llm/src/message.ts:150)。

**role 不等于真实说话人或用户归属。** `user/message` 可以来自真人输入，也可以是 `agent.inject()` 注入的文件变化通知、指令、技能、定时通知或目标继续信息；具体来源通过 `source` 区分。`MessageSourceMap` 可扩展；当前源码没有共享的兜底 `plugin` kind，各生产者声明自己的 kind。`form` 是独立的语义维度，如 `notice`、`relay`、`recall`。

来源：[来源扩展规则](/home/eafen405/projects/deepseek-harness/packages/llm/llm/src/message.ts:103)、[form 词汇](/home/eafen405/projects/deepseek-harness/packages/llm/llm/src/message.ts:39)、[user/message 注入语义](/home/eafen405/projects/deepseek-harness/packages/core/session/src/types.ts:302)。

## 事实：content 的内容块

| type | 主要数据 |
|---|---|
| `text` | `text: string` |
| `reasoning` | `text: string`，独立于可见正文 |
| `image` | `attachment: ImageAttachmentRef`，可选 `offloaded: true` |
| `file` | `attachment: FileAttachmentRef` |
| `tool-call` | `id`、`name`、`arguments`；arguments 是模型给出的原始 JSON 字符串 |
| `tool-addition` | `toolName`，工具定义由历史 request header 持有 |
| `tool-removal` | `toolName` |

内容块类型可扩展。图片/文件块存的是附件引用，不是把文件全文直接存进正文。图片引用有附件 ID、媒体类型、字节数、尺寸、可选名称；文件引用有附件 ID、名称、字节数。文件发送给模型时会被投影成名称、大小和只读保存路径组成的文本句柄。

来源：[内容块定义](/home/eafen405/projects/deepseek-harness/packages/llm/llm/src/types.ts:61)、[工具与内容块联合](/home/eafen405/projects/deepseek-harness/packages/llm/llm/src/types.ts:104)、[附件引用](/home/eafen405/projects/deepseek-harness/packages/attachment/attachment/src/types.ts:10)。

## 事实：消息与持久化事件不同

Session 的权威数据是追加式事件日志，模型消息历史从日志推导。事件共有 `type`、会话内连续的 `seq`、毫秒时间 `time`、类型对应的 `data`；模型可见事件另有 surface 信息。

- `user/message` 的 data 直接是一条 UserMessage。
- `assistant/message` 的 data 除 message 外，还有 turn、step、原始流记录、可选 usage 和 interrupted。
- `tool/result` 的 data 除 message 外，还有 turn、step、可选 error/meta。
- `tool/call`、turn/step 边界、失败的 assistant attempt、request header 等也是事件，但不是各自都对应一条模型消息。

因此不能把事件数量当成消息数量，也不能把整个事件日志当成聊天正文。追加时 Session 生成 seq/time，校验 JSON 数据并冻结。JSONL 持久化实现将每个当前事件编码成一行；模型原始流嵌套在事件数据中。

来源：[事件日志定义](/home/eafen405/projects/deepseek-harness/packages/core/session/src/types.ts:275)、[消息事件数据](/home/eafen405/projects/deepseek-harness/packages/core/session/src/types.ts:330)、[事件公共字段](/home/eafen405/projects/deepseek-harness/packages/core/session/src/types.ts:480)、[追加过程](/home/eafen405/projects/deepseek-harness/packages/core/session/src/index.ts:798)、[JSONL 编码](/home/eafen405/projects/deepseek-harness/packages/session/session-persistence-jsonl/src/format.ts:308)、[模型可见事件集合](/home/eafen405/projects/deepseek-harness/packages/core/session/src/surface.ts:49)。

## 事实：现有检索搜索哪些文本

现有 session-query 的语义文本提取范围大于“聊天正文”：

- 用户和助手消息：提取 `text`；也提取 `tool-call` 的工具名和参数。
- `tool/call` 事件：提取工具名和原始参数。
- `tool/result` 事件：提取结果消息文本，以及 error 的 name/code。
- todo 写入：提取状态与内容；部分 turn 结束状态也会进入文本。
- **排除 reasoning**；不索引原始流、request header、结构边界和未知事件。
- **image/file 块不贡献检索文本**：没有自动 OCR、附件全文读取，甚至块中的文件名也不会通过此提取函数进入搜索。附件内容若另被工具转成 text，那个文本结果可以被索引。

来源：[事件文本提取](/home/eafen405/projects/deepseek-harness/packages/session-query/session-query/src/extraction.ts:15)、[块文本提取](/home/eafen405/projects/deepseek-harness/packages/session-query/session-query/src/extraction.ts:70)。

SQLite 实现使用 FTS5，调用者的查询被引用成一个字面短语，不直接开放 FTS 查询语法。搜索命中包含 sessionId、seq、type、time、surface、snippet；默认每页 20 个命中、最大 100 个，摘要默认最多 240 个 Unicode 码点。这些是现有后端默认值，并非已设计好的 Fairy 工具契约；也不能直接假定中文分词和多个关键词的相关性满足产品需要。

来源：[查询转义](/home/eafen405/projects/deepseek-harness/packages/session-query/session-query-sqlite/src/query.ts:218)、[结果默认上限](/home/eafen405/projects/deepseek-harness/packages/session-query/session-query-sqlite/src/index.ts:78)、[搜索命中形状](/home/eafen405/projects/deepseek-harness/packages/session-query/session-query-sqlite/src/index.ts:753)。

## Fairybot 旧实现参照

Fairybot 的 relay 注释与实现明确将投递落为 `user` role 的插件来源消息，用来源标记和委托人信息区分真人输入；收件人主会话由内部解析，工具只回送达确认。但旧工具参数是 username/text，投递会驱动接收方一轮，且有旧任务域限制。这些是旧产品决策，不能直接当作本轮 OurFairy 的投递语义；当前上游 source 形状也已与其旧插件约定不同。

来源：[旧 relay 语义与来源](/home/eafen405/projects/Fairybot/src/server/relay.ts:10)、[工具参数与投递](/home/eafen405/projects/Fairybot/src/server/relay.ts:62)。

## 建议，尚未形成决策

同用户检索工具可以保持简单关键词输入，但内部需要固定用户范围、正文优先策略以及总输出预算。现有全文检索会命中工具参数和结果，可能带回大量代码/日志；直接暴露其全部默认行为会增加上下文噪声。可先返回少量带出处的短片段，按需扩大原消息邻近窗口；用户 ID、会话归属、权限校验应由后端上下文提供，不让模型用工具参数选择读取其他用户。

附件投递可在内部保存结构化来源与附件引用，外部工具继续仅暴露接收用户 ID、内容、可选文件。接收方消息采用什么 role、是否触发一轮、检索是否纳入这些通知，仍需以本轮产品行为决定，不能从现有类型名字推出答案。
