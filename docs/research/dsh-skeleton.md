> 2026-10-20 状态：日期化记录。本文记录 2026-10-13 的判断，不描述当前实现。

# dsh 骨架能力研究：用户作用域、共享能力与替换点

研究票：[研究 dsh 骨架能力：用户作用域、共享能力与插件替换点](https://github.com/eafen405/OurFairy/issues/4)。

2026-10-13，核查本地 `/home/eafen405/projects/deepseek-harness`，版本 `d743267388641bc76f17c45ce8b4c231aed1d32c`。本文为源码研究，不是采用方案或数据库设计。没有修改、运行 dsh，也没有完成跨用户装配验证。

## 结论

dsh 已有服务接口与实现替换、服务实例隔离、作用域注册、会话日志与恢复、模型凭据、后台工作和跨 agent 投递等可复用基础。缺的是 OurFairy 的产品用户身份与这些能力之间的装配关系，不能把已有“operator / agent scope”直接等同于法厄同或代理人。[S1–S6]

最有价值的接缝是已有 `Context`、服务提供者和 agent `setup`，而不是再建一套会话历史。仍需决策：用户世界包含哪些服务实例、共享哪些提供者，以及入口如何选择该世界。仅在请求上下文挂 `userId` 不足以使原插件自动成为多用户插件；但也没有证据要求逐一修改所有接口。[S2–S5]

## 能力与依赖矩阵

“可复用”指源码已有对应能力；不是已证实整套 OurFairy 装配可以不改运行。

| 能力 / 接口 | 实现提供者与主要消费者 | 已有作用域或状态 | 可复用与缺口 |
|---|---|---|---|
| 插件、依赖、服务替换 `ctx.<service>` | Cordis `Service` / `inject`；所有能力插件 | 同名服务按 isolation label 查找；插件 fiber 管生命周期 | 原样复用。按需选提供者，不要求接受默认产品组合。[S1–S2] |
| 连接认证与调用身份 `PeerScope` | `client-connection` BrowserAuth / HostConnectionService；Remote controllers | 一个 Connection 持有一个 OperatorPeer，所有获准请求都是它 | 已有认证，但不提供邀请码、多用户、产品角色；需要改变身份与路由实现，不能说已有用户系统。[S6] |
| 注册作用域 `createScope` / `ScopedLayers` | `core/scope`；tools、prompt、jobs 等 | opaque object key，父链、作用域事件与注册生命周期 | 可装配用户层注册，但作用域标签本身不自动过滤所有数据或替换服务。[S3] |
| live agent `ctx.agents` | AgentRegistry 定义、AgentLoop 工厂；API、subagent、team | live registry 与工厂绑定；create/resume 支持 publication 前 `setup` | 工厂与 setup 可复用；如何与用户服务世界绑定待决定。[S4–S5] |
| live session `ctx.sessions` | SessionStore；loop、query、API | 一个提供者内部 Map，以 SessionId 索引 | 原会话机制可复用；不含产品 user 字段，list/get 不自动按注册 scope 过滤。[S7] |
| 持久化 `ctx.sessionPersistence` | 抽象接口；JSONL 提供者；loop、query | JSONL root 可配置，内部缓存以 SessionId 索引 | 保留恢复/分叉/句柄协议。用户 root 装配或用户感知实现均有接缝；不另建权威 messages 表。[S8] |
| 历史与搜索 `ctx.sessionQuery` | SessionQueryEngine + SQLite 提供者；API、query tool | 构造时持有 corpus/observation 的 Context，扫描对应 live/persisted 集合；派生 SQLite path 可配置 | 可按服务世界复用；共享实现须真实缩小 corpus，不能只过滤返回 list。索引是派生物而非应用数据库。[S9] |
| 模型与凭据 `ctx.llm` / `ctx.credentials` | LLM adapters；CredentialProvider / credentials-local | 本地凭据路径可配；环境变量优先；adapter 闭包保留装配 Context | 单独 API key 有现成 seam，不必改模型接口；共享 adapter 若捕获共享 credentials，不会因请求身份自动切换 key。[S10] |
| 文件 `ctx.fs` | LocalFileSystem / SandboxedFileSystem；file tools | fs-sandbox 按调用策略限制写和编辑，读取直接透传 | 复用文件接口与操作实现；现有 sandbox 不是公有/群组/私有读权限实现。[S11] |
| shell 与执行隔离 `ctx.shell` / `ctx.sandboxPolicy` / `ctx.sandbox` | bash/pwsh providers、sandbox providers；工具 | policy 按 session 解析模式及 workspace root；sandbox confine 属于执行提供者 | 可保留接口；所有工具遵循空间权限还需落实到真正执行世界，不是 cwd 或提示词即可完成。[S11–S12] |
| 附件 `ctx.attachments` | AttachmentStore / attachment-local；prompt、API、LLM | 不可变二进制、内容引用、本地 home/cache | 存储与引用可复用；用户下载入口及跨用户引用可达性是装配问题。Fairy 指定附件投递即授权，不加分享审批。[S13] |
| 后台任务 `ctx.jobs` | JobRegistry / jobs-local；异步工具 | jobs-local 是内存注册表；owner Agent 生命周期和 scoped controller | 可复用后台任务管理，但不能据此宣称重启后任务自动恢复。[S14] |
| 定时工作 `ctx.schedule` | schedule + storageDomain + sessionController + persistence | 持久 domain、按 sessionId 关联目标，由 controller 激活恢复目标 | 是现成可选插件。身份需随 session 重新绑定，不能依赖原 HTTP 请求仍存在；主动机制取舍归其他研究。[S15] |
| 跨会话消息 | Agent.send/followup/steer/inject；agent-team 的工具与服务 | inbox 记录为 UserMessage；team 解析成员并添加发送者文本，steer 会唤醒 | 底层队列/持久化可复用；团队目标解析和展示语义不符合 Fairy 向 B 发自身消息，不能原样套用整个 team 插件。[S16] |
| 客户端接口与事件 `ctx.remote` | Typert / api-remotes / API controllers | 显式挂载 namespace、转发事件；controller 保存装配 Context | 可复用协议与按需 API。多用户 namespace 选择、订阅范围和配置入口需要装配，不应把所有 controller 暴露给代理人。[S6,S17] |

## 两种作用域机制不能混用理解

**Cordis `ctx.isolate(serviceName, label)`** 决定同名服务在哪个服务世界可见。相同 label 可以加入同一服务世界；这是分配不同服务实例的基础。[S2]

**dsh `createScope` / `scopeTarget` / `ScopedLayers`** 决定注册和事件的可见范围与生命周期。注册可以沿父链继承，事件向祖先传播；未标记 scope 的监听者被允许全局接收。它不会自动给 SessionStore、SQLite corpus 或 attachment store 加用户过滤。[S3,S7,S9,S13]

因此，“用户域装配”至少要明确选择哪种机制用于哪项能力。不要给一个 Context 打 scope 标签，就把它当成所有存储与执行都已隔离。

## 身份在生命周期中的连续性

AgentRegistry 的 create/resume 接口已经传 `ownerCtx` 到工厂；`setup(agentCtx, agent)` 在发布前运行，恢复也有相同接缝。ownerCtx 决定生命周期归属，创建信号在创建完成后解除，并不要求 agent 随 HTTP 请求断开。[S4–S5]

但当前 AgentLoop 用 `this.runtime.ctx.sessions.prepare()` 建 session，用 `this.runtime.ctx` 获取 persistence，并在 `prepare()` 中以 `this.runtime.ctx` 创建 ReactLoopAgent；后者 `createScope(loopCtx, this)`。**调用者 ownerCtx 与执行服务世界不是同一个概念。** 入口调用来自用户 Context，不能据此推断机器会自动继承该 Context 的 llm/fs/credentials。[S5]

这提供三条证据支持的候选路径：

| 路径 | 复用程度 | 必须解决的具体问题 |
|---|---|---|
| 按用户装配相关服务实例，loop 也在该世界装配 | session/query/persistence/loop 大部分可原样使用，root/path 可配置 | 确定共享服务清单；同用户多个客户端不重复装配；避免用户层卸载导致在途工作被关闭 |
| 共享服务，实现内部识别用户范围 | 保留消费者接口，但共享 store/query/factory 需要用户感知实现 | live map、cold load、search corpus、缓存与后台恢复都需一致绑定，不能仅入口过滤 |
| 共享运行内核，以现有 setup + 必要工厂适配组成每 agent 的世界 | tools/prompt/job 注册已有 scope seam，可较细地共享 | 当前 loopCtx 不自动采用 ownerCtx；setup alone 是否足够要通过最小装配探针验证，不能先宣称零改动 |

以上不是推荐顺序或最终选型。每用户独立实例也不等于每用户部署进程、容器或一整套后端。

恢复时 agent scope 是新对象，持久日志不是保存 JavaScript Context。后端需要根据会话归属重新选择/装配用户世界；schedule 的 controller 激活及子 agent 创建同样需要遵循这个绑定。[S3–S5,S15]

## 共享监听、缓存和注册表的检查结果

- SessionStore、AgentRegistry 的 live 状态、JSONL 的 cold memo、query corpus/index 均由服务提供者持有。服务 isolate 能选择不同实例；注册 scope 不会自动把这些 Map 变成用户分区。[S4,S7–S9]
- dsh scope 允许未标记监听者观察所有作用域；tools 的 `tools/changed` 明确是未过滤的注册表变化通知。共享观察者可以存在，但“每个事件天然只有本人可见”不成立。[S3,S18]
- session-controller 注册 session/agent 监听并转为 `api-session/*`，api-remotes 转发所装配的业务事件。选择用户服务世界时要一起检查客户端订阅，不只检查命令返回。[S17]
- credentials-local 以进程环境为最高优先层。若每用户用相同 ref 名且进程有该变量，分开凭据文件也可能仍解析到共享 key；需要明确共享 fallback 的行为。[S10]

这些是现成组件的真实语义，需在决策时列入装配范围；不意味着必须增加新的权限框架。

## Fairy 从 A 向 B 投递

已确定产品语义：发起者是 Fairy；A 是生成上下文；显式选择 B、正文、附件的工具调用即授权。本文不引入发送用户、不要求二次共享审批，也不自动搬运 A 的历史。

agent-team 已能投递 ContentBlock[]，但 `sendAdmitted` 查 Team membership、解析同一 team 的 active member，加 `Team message from …`，并调用 `steer` 或子 agent continuation helper。它绑定团队关系，且目标收件是模型输入并可能唤醒执行。[S16]

应区分三件事：

1. **消息展示**：B 用户看到 Fairy 的消息。
2. **进入上下文**：B 后续请求包含这条消息，并能在恢复后保持。
3. **激活循环**：B 是否马上开始一次模型执行。

底层 `send(message, target, wakeup)` 已区分收件边界和唤醒；`inject` 不唤醒，仍是 pending **UserMessage**，不是 assistant 输出。现有正常 assistant/message 事件由 loop 连同 turn/step/stream 信息提交；本文没有验证一个“任意插入 Fairy 输出”公开 API。不能把 `inject` 改个 UI 标签便视为已实现需求，也不能随意 append 一个旧格式 assistant event 绕开 projection/inbox。[S16,S19]

可复用消息内容类型、附件引用、Session 持久化与 projection；需要单独决定符合产品语义的事件/投递接缝以及是否激活 B。独立投递插件仍属于 dsh 装配，不必兼容整个 team 的身份模型。

## 给后续决策票的输入

1. 用户作用域包含哪些服务，采用服务实例隔离、实现替换或有限工厂适配？
2. 会话归属在哪里持久记录、恢复时如何选世界？这是尚未设计的内部实现，不是已定数据库表。
3. 共享模型适配器与用户凭据是否能按已有接缝装配，还是先共享 key？需一个小型装配验证。
4. 空间的读写范围怎样由 fs 与执行提供者共同落实？现有 workspace-write 不足以表达私有空间读限制。
5. 向 B 投递怎样同时保持 Fairy 展示语义与持久上下文，并选择激活行为？
6. 哪些 API/观察者属于用户域，哪些属于法厄同系统配置？配置权限不意味着个人内容可见。

最小验证应聚焦两用户、各一会话、一次恢复和一次 A→B 附件投递；研究阶段没有编写这个原型。它验证装配接缝，不扩展成全面审计。

## 一手源码与文档

以下均固定到研究版本，行号可在 GitHub 页面查看。每项结论对应上文标号。

- **S1**: [docs/cordis-primer.md](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/docs/cordis-primer.md)
- **S2**: [vendor/cordis/src/context.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/vendor/cordis/src/context.ts), [vendor/cordis/src/service.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/vendor/cordis/src/service.ts), [vendor/cordis/src/reflect.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/vendor/cordis/src/reflect.ts)
- **S3**: [packages/core/scope/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/scope/src/index.ts), [packages/core/scope/src/store.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/scope/src/store.ts)
- **S4**: [packages/core/agent/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent/src/index.ts)
- **S5**: [packages/core/agent-loop/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-loop/src/index.ts), [packages/core/agent-loop/src/agent.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-loop/src/agent.ts)
- **S6**: [packages/client/connection/src/browser-auth.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/client/connection/src/browser-auth.ts), [packages/client/connection/src/operator-peer.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/client/connection/src/operator-peer.ts), [packages/client/connection/src/rpc-host.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/client/connection/src/rpc-host.ts), [packages/credentials/authorization/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/credentials/authorization/README.md)
- **S7**: [packages/core/session/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/index.ts)
- **S8**: [packages/session/session-persistence/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session/session-persistence/src/index.ts), [packages/session/session-persistence-jsonl/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session/session-persistence-jsonl/src/index.ts)
- **S9**: [packages/session-query/session-query/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session-query/session-query/src/index.ts), [packages/session-query/session-query/src/corpus.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session-query/session-query/src/corpus.ts), [packages/session-query/session-query-sqlite/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session-query/session-query-sqlite/src/index.ts)
- **S10**: [packages/credentials/credentials/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/credentials/credentials/src/index.ts), [packages/credentials/credentials-local/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/credentials/credentials-local/src/index.ts), [packages/llm/llm-deepseek-api-key/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek-api-key/src/index.ts)
- **S11**: [packages/fs/fs-sandbox/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/fs-sandbox/src/index.ts), [packages/fs/fs/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/fs/src/index.ts)
- **S12**: [packages/sandbox/sandbox-policy/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/sandbox/sandbox-policy/src/index.ts), [packages/sandbox/sandbox/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/sandbox/sandbox/src/index.ts), [packages/shell/bash-sandbox/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/shell/bash-sandbox/src/index.ts)
- **S13**: [packages/attachment/attachment/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/attachment/attachment/src/index.ts), [packages/attachment/attachment-local/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/attachment/attachment-local/src/index.ts)
- **S14**: [packages/jobs/jobs/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/jobs/jobs/src/index.ts), [packages/jobs/jobs-local/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/jobs/jobs-local/src/index.ts)
- **S15**: [packages/schedule/schedule/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/schedule/schedule/src/index.ts)
- **S16**: [packages/experimental/agent-team/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/experimental/agent-team/src/index.ts), [packages/experimental/agent-team/src/types.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/experimental/agent-team/src/types.ts), [packages/core/agent/src/runtime-types.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent/src/runtime-types.ts)
- **S17**: [packages/api/session-controller/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/api/session-controller/src/index.ts), [packages/api/remotes/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/api/remotes/src/index.ts), [packages/api/remotes/README.md](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/api/remotes/README.md)
- **S18**: [packages/core/tools/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/tools/src/index.ts)
- **S19**: [packages/core/agent-loop/src/inbox.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-loop/src/inbox.ts), [packages/core/agent-loop/src/agent.ts](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-loop/src/agent.ts)
