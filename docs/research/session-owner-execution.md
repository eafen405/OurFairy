> 2026-10-20 状态：现行。本文记录 2026-10-14 的判断，不描述当前实现。

# 会话归属如何贯穿执行与访问

取证日期：2026-10-14。dsh commit：`d743267388641bc76f17c45ce8b4c231aed1d32c`。仅阅读源码，未运行测试或原型，未修改产品代码。本文区分现有事实、OurFairy 已确认的要求和设计推论。

## 已确认的要求

每个会话在创建时确定唯一且永久的所属用户，归属直接由会话携带。Fairy 只能检索当前用户的会话；跨用户投递只将明确选定的内容和可能存在的文件送入对方固定主会话，不授予读取对方会话的权限。检索输入保持 query；区间读取输入保持 sessionId、startSeq、endSeq，内容排除工具结果；检索片段约 50–100 字，限于命中消息本身。用户身份由内部确定，不增加模型需要填写的当前用户参数。

## 事实：普通工具已有取得当前会话的通道

`executeToolCalls` 从当前执行作用域取得 Agent，把它放入每次工具执行的 `exec.agent`；工具运行器原样交给 `tool.execute(args, exec)`。工具内部可以取得 `exec.agent.session.header`。当前 header 尚无用户字段；补齐字段及持久化链路后，普通工具链不需要仅为传递归属而新增一个模型参数。

证据：[构造执行参数](/home/eafen405/projects/deepseek-harness/packages/core/agent-loop/src/tool-calls.ts:68)、[执行 handler](/home/eafen405/projects/deepseek-harness/packages/core/tools/src/index.ts:1584)。

工具底层接口允许 agent 缺省，不是所有直接工具调用都保证有会话。现有实验性检索工具已经会拒绝无 Agent 的调用，可参照其处理方式；不能将身份缺失默认解释为用户 1。

证据：[可缺省的 agent](/home/eafen405/projects/deepseek-harness/packages/core/tools/src/index.ts:340)、[检索 callerOf](/home/eafen405/projects/deepseek-harness/packages/experimental/tool-session-query/src/workspace-access.ts:56)。

## 事实：现有检索权限不是用户权限

实验性检索工具根据调用者与目标会话的 cwd 是否一致来授权；跨会话搜索也加入 cwd 条件。它读取的是会话 header，因此替换为归属规则有明确位置，但目录相同不能作为 OurFairy 的用户授权依据。

证据：[目标授权与再次核对](/home/eafen405/projects/deepseek-harness/packages/experimental/tool-session-query/src/workspace-access.ts:75)、[搜索 cwd 条件](/home/eafen405/projects/deepseek-harness/packages/experimental/tool-session-query/src/operations.ts:90)。

底层 session-query 的 listSessions 列出整个逻辑会话集合；observeSession 只接收会话 ID 和观察选项，没有用户参数。会话过滤器已有 id、cwd、创建时间、父会话和可用性，但没有用户归属；搜索接口支持在排名前应用 sessionFilters。

证据：[查询接口](/home/eafen405/projects/deepseek-harness/packages/session-query/session-query/src/index.ts:140)、[过滤器类型](/home/eafen405/projects/deepseek-harness/packages/session-query/session-query/src/types.ts:206)、[搜索接口](/home/eafen405/projects/deepseek-harness/packages/session-query/session-query/src/types.ts:253)。

设计推论：用户范围应在搜索排名及截断前确定，区间读取也必须单独核对目标归属，不能仅依赖“这个 sessionId 之前从搜索返回过”。已有 id 过滤可作为候选接缝；直接增加 owner 过滤和索引列是另一种实现路径，尚未比较规模、性能与维护成本。不能仅隐藏原生工具，便宣称其他调用路径已受约束。

## 事实：恢复和后台执行可以回到持久化会话

恢复路径从持久化 handle 读取 header，将其复制进入会话创建参数。字段经过类型、格式、创建映射完整保存之后，可从恢复的会话取得归属。恢复时会先取得日志写入权、读取事件并修复中断记录，之后才执行 setup；所以不能把外部访问授权仅放在 setup 中。

证据：[恢复顺序](/home/eafen405/projects/deepseek-harness/packages/core/agent-loop/src/index.ts:843)、[恢复前的 API 解析路径](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/agent.ts:407)。

定时任务执行器主动清除原 initiating Agent，通过任务保存的 sessionId 调用 sessionController.resolveAgent，之后向目标会话 followup 并 flush。这条路径不依赖原手机连接；补齐归属后，可以从目标会话重新取得身份。该现有 followup 行为不代表已选定 OurFairy 的跨用户投递或推理激活策略。

证据：[后台清除 initiator](/home/eafen405/projects/deepseek-harness/packages/schedule/schedule/src/runtime.ts:51)、[恢复并投递](/home/eafen405/projects/deepseek-harness/packages/schedule/schedule/src/runtime.ts:101)。

会话 fork 与子 Agent 创建都是逐字段构造新 meta，当前分别继承 cwd 等字段，不会自动继承一个新加入的用户字段。两处都需要纳入归属继承检查；这不代表首版必须启用子 Agent。

证据：[fork](/home/eafen405/projects/deepseek-harness/packages/core/session/src/index.ts:1388)、[childSessionMeta](/home/eafen405/projects/deepseek-harness/packages/subagent/subagent/src/child-agent.ts:137)。

## 事实：外部访问入口仍按单一操作者组织

连接接纳请求后返回同一个 OperatorPeer，它表示当前 Host 服务的单一操作者，不是 OurFairy 用户编号。会话 API 的列表、搜索、历史跟随、恢复都需要对应的用户归属限制；仅增加登录认证不能自动完成这一点。

证据：[OperatorPeer](/home/eafen405/projects/deepseek-harness/packages/client/connection/src/operator-peer.ts:1)、[接纳结果](/home/eafen405/projects/deepseek-harness/packages/client/connection/src/rpc-host.ts:114)、[列表](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/list.ts:132)、[搜索](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/list.ts:189)、[历史跟随](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/index.ts:497)。

搜索代码中的 authorized 是现有实现自己的可见性检查，不能解读为已有多用户授权：当前 visibleIds 来自整体列表并以 cwd 存在为条件，之后按这些 ID 接受命中。

文件上传 HTTP 路径从 URL 取得 sessionId，通过 resolveAgent 找到目标；上传回执确实按 Session 保存，避免跨会话使用回执，但这不证明请求者有权访问该 Session。另有 `/api/file?path=...` 路径，通过注册时的 ctx.fs 读文件，不带会话参数。当前 Fetch handler 类型只接收 Request，没有显式 Peer 参数。

证据：[上传 HTTP](/home/eafen405/projects/deepseek-harness/packages/client/file-upload/src/http-route.ts:22)、[上传和回执](/home/eafen405/projects/deepseek-harness/packages/client/file-upload/src/index.ts:118)、[解析 live Agent](/home/eafen405/projects/deepseek-harness/packages/client/file-upload/src/index.ts:212)、[文件读取](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/media-references.ts:22)、[Fetch 接口](/home/eafen405/projects/deepseek-harness/packages/client/connection/src/rpc.ts:144)。

会话控制器从 session/agent 事件发布 added、removed、status、error；当前发布点没有用户归属路由。手机通知需要将接收用户与会话归属关联，并检查下游订阅和事件分发。本轮未完成整条 Remote Event 投递链及离线手机推送验证，不能据这些发布点直接宣称整条链会广播或已隔离。

证据：[事件发布](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/index.ts:175)。

## 事实：文件、shell、模型凭据的接缝不同

| 路径 | 当前取得的上下文 | 本轮能确定的边界 |
| --- | --- | --- |
| 文件工具 | 从 exec.agent 得到工作目录，交给 ctx.fs | 有会话通道，但 cwd 不等于访问权限；此处传给文件系统的选项仅 cwd/signal |
| shell | 用 exec.agent.session 解析 sandboxPolicy，再执行 shell 请求 | 已有按会话解析策略的入口；仍须核查具体 provider 是否限制所有路径及子进程 |
| 后台 shell | 启动时解析执行 spec，job owner 使用 Agent ID | 能保留已解析执行条件；job 的 owner 不是用户编号 |
| DeepSeek API-key provider | 从注册时捕获的 ctx/config 解析 credentials reference | 此显式凭据调用没有传 Session；加 header 字段不会自动变成按用户选凭据 |

证据：[文件选项](/home/eafen405/projects/deepseek-harness/packages/fs/tool-fs/src/session-cwd.ts:17)、[shell 策略](/home/eafen405/projects/deepseek-harness/packages/shell/tool-bash/src/index.ts:214)、[shell 请求](/home/eafen405/projects/deepseek-harness/packages/shell/tool-bash/src/index.ts:477)、[后台 job](/home/eafen405/projects/deepseek-harness/packages/shell/tool-bash/src/index.ts:266)、[凭据解析](/home/eafen405/projects/deepseek-harness/packages/llm/llm-deepseek-api-key/src/index.ts:17)。

这些事实不能单独证明必须为每个用户建立完整 runtime，也不能证明一个共享 runtime 已经满足隔离。插件捕获 ctx 本身不等于已经跨用户共享，仍取决于装配位置及实际 provider。

## 本轮结论与下一步

会话承载归属有可复用的执行通道，当前证据不要求扩大 Fairy 的三个工具接口。必要工作分为：完整保存归属、派生会话继承归属、外部请求核对归属、后台从会话恢复归属、各访问操作执行权限。原生目录授权需要适配为用户授权，不能直接照搬。

下一步优先沿文件工具和 shell 的实际 provider 追踪：同一用户执行普通读取与脚本读取，是否受到同一套空间权限限制；这会帮助判断应替换哪些原生实现。其次核查归属如何约束手机订阅与附件读取。模型凭据是否按用户提供属于后续能力共享决策；本轮只记录其接缝，不预设产品要求。
