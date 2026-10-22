# 远程对话接口

本模块有两类契约，读法不同。**传输契约**是客户端可依赖的线上行为：路由、请求/响应、SSE
快照、字段与数字枚举；客户端只按这一半实现。**运行时语义**是本模块作为 dsh 插件如何注册
投影单元、派生读取值、折叠任务、投递与降级；它解释传输侧的值从哪里来，不是客户端协议。
跨两侧的事实各写自己那一半：传输侧写客户端看到什么，运行时侧写服务端如何产生、冻结、读取、
折叠与失效，不重复同一句话。

## 传输契约（客户端可依赖的线上行为）

所有路由均为 POST，JSON 请求体，`Authorization: Bearer <身份凭据>`，与 `/sessions/*`
同一端点、同一 Host/Origin 校验。归属只来自凭据。流式开始前的错误为
400/401/404/409/500，响应体 `{ok:false,error:{code,message}}`；会话不存在或不属于调用方统一
404 `sessions/unknown-session`，未认证为 401 `chat/unauthorized`。

### 路由与信封

| 路由 | 请求体 | 响应 |
| --- | --- | --- |
| `/chat/send` | `{sessionId,requestId,text,uploadIds?}` | `{ok:true,receipt:{sessionId,requestId,messageId,acceptedSeq}}` |
| `/chat/receipt` | `{sessionId,requestId}` | `{ok:true,receipt:<同上>\|null}` |
| `/chat/read` | `{sessionId,maxEvents?}` | `{ok:true,projection:<投影>}` |
| `/chat/page` | `{sessionId,throughSeq,beforeSeq,maxEvents?}` | `{ok:true,page:<页>}` |
| `/chat/checkpoint` | `{sessionId}` | `{ok:true,sessionId,durableThroughSeq}` |
| `/chat/stop` | `{sessionId}` | `{ok:true}` |
| `/chat/observe` | `{sessionId,maxEvents?}` | `text/event-stream`，见下 |
| `/chat/jobs/output` | `{sessionId,taskId,from}` | `{ok:true,output}` |
| `/chat/jobs/stop` | `{sessionId,taskId}` | `{ok:true,outcome}` |

`requestId` 是客户端生成的稳定非空字符串（≤128 字符），与 `text`、有序 `uploadIds` 一起构成
请求身份：同一身份重发返回同一 receipt（进程重启后亦然），内容不同则 409
`chat/request-conflict`。网络错误或 500 表示接受状态未知，应保留原身份重发或调用
`/chat/receipt`。receipt 在 writer flush 之后返回。

`/chat/stop` 调用原生 cancel 停止当前回复并保留已排队的输入；关闭订阅不停止任何工作。

### 投影载荷

```text
{sessionId,generation,version,cursor,durableThroughSeq,throughSeq,fromSeq,
 beforeSeq,hasMore,events,messages,attempt,settledAttempt,tasks,activity,replyStatus,error}
```

`throughSeq`/`fromSeq`/`beforeSeq`/`hasMore`/`events` 是一次读取或一条 SSE 观察的窗口，规则见「分页与重连」。
`tasks` 与 `activity` 的字段和数字编码见下。

- `generation`：服务端 Agent 生命周期 UUID，不是永久身份。`version`：同一 generation 内的
  快照序号，客户端用它丢弃过时快照。
- `cursor`：最近观察到的原生事件 seq，空会话为 -1。`durableThroughSeq`：writer 屏障已确认
  的前缀，未知为 -1；它不表示客户端已应用该前缀。
- `messages`：`{messageId,seq,requestId,role,status,text,attachments}`。`role` 1 用户、
  2 Fairy；`status` 1 待定、2 完成、3 中断、4 失败。文本是原始文本，含空白与 Markdown。
  没有原生消息的 assistant 结算使用确定性身份 `attempt:<sessionId>:<seq>`。`messages` 按
  首次出现顺序排列，不是 seq 顺序。
- `attempt`：`{attemptId,revision,text}`。`attemptId` 只在同一 generation 内唯一，`text` 是
  累计原始可见文本。最终持久消息取代它，终止消息使用完整富文本渲染。
- `settledAttempt`：`{attemptId,seq}|null`，本 generation 最近一次已提交的 assistant 流结束。
- `replyStatus`：0 空闲、1 运行中、2 停止中。`error` 是最近一次执行失败；连接中断不是模型错误。
- `tasks`：任务列表，每项含 `taskId`、`kind`、`label`、`status`、`availability`、`startedAt`、
  `output:{earliest,total}` 与 `report`；`finishedAt`、`detail`、`progress` 在存在时出现。
  `status`：0 未知、1 运行中、2 停止中、3 完成、4 被终止、5 失败；`availability`：
  0 不可用、1 可用；`report.status`：0 无计划报告、1 待处理、2 执行中、3 完成、4 取消、
  5 失败、6 未知。
- `activity`：呈现与通知共用的后端摘要。`status`：0 未知、1 静默、2 活跃。
  `reasons`：1 实际执行、2 运行或停止中的任务、3 真正待处理的报告、4 属于当前 episode 的
  投递输出（本身不保持执行活跃）。`episodeId`/`startedSeq` 标识当前或最近 episode，
  `throughSeq` 是本次摘要对应的读取截点；可选的 `completed` 与 `delivery` 只是摘要，消费者
  用自己持久化的每会话消费位置合并追补内容。

### 分页与重连

`maxEvents` 是原生事件数（1..256，默认 64），不是消息数：system/context/tool/inbox 事件
可能不产生气泡。

打开 read/observe 时冻结包含式截点 `throughSeq=C=cursor`，并给出
`fromSeq=L=max(0,C-maxEvents+1)`。`hasMore=L>0`，此时 `beforeSeq=L`，否则为 null。该连接后续
每个 SSE 快照保留 C/L，并包含 L 到当前 cursor 的全部正式事件。attempt 累计内容始终完整，
即使其起点早于 L。

`events` 是原生不可变 Session 事件，身份为 `(sessionId,seq)`，重叠的 seq 必须载荷相同。
快照只能替换本连接范围内的旧快照，不能抹掉独立回填的更早历史；合并同一 `messageId` 时取
较新的 seq。

`/chat/page` 请求 `{sessionId,throughSeq:C,beforeSeq:L,maxEvents?}`，返回
`{sessionId,throughSeq,fromSeq:K,beforeSeq:K|null,hasMore,events,messages}`；其中
`end=min(C+1,L)`、`K=max(0,end-maxEvents)`，返回事件恰为 K..end-1。`L=0` 时是空的终止页。
页不包含 attempt 或回复状态。

客户端需区分三个位置：已观察的 cursor、writer 已确认的 `durableThroughSeq`、以及已应用且
本地已提交的消费前缀。只有所需覆盖连续且 writer ACK 覆盖之后才推进消费前缀；页丢失或
ACK 失败不改变已确认位置。缺少缓存正文时不能跳过历史，必须重新回填。

### 后台任务端点

`/chat/jobs/output` 与 `/chat/jobs/stop` 的 `taskId` 取自投影 `tasks[].taskId`。

`/chat/jobs/output` 接受绝对 UTF-8 字节偏移 `from`，chunks 保留原生
`{at,text,channel?,gapBefore?}`；`next` 与 `earliest` 指向原生输出环，`gapBefore` 标记源侧
丢失。终止状态不代表输出完整。`/chat/jobs/stop` 返回数字 `outcome`：0 不可用、1 已请求取消、
2 已结束。只映射原生 `JobRegistry.kill` 的 `requested`（1）与 `already-finished`（2）；原生返回
其它值时是 500 `chat/unknown-stop-outcome`，消息带原始值，不会折叠成 2。映射表与原生返回类型的
对账见 `tests/native-job-stop-outcome.test.mjs`。

## 运行时语义（服务端如何产生这些值）

这一半说明传输契约里的值如何由 dsh 运行时产生：注册、fold、读取时叠加、冻结截点、任务
折叠、投递与降级。它不是客户端协议；客户端不应依赖这里的模块名、fold 细节或内部状态。

### 投影单元

`src/units.mjs` 把 transcript 与「任务 + 活动」注册到原生 `ctx.sessionProjections`
（key `ourfairyTranscript` / `ourfairyWork`，均无 `wire`，只用公开的 `register` / `stateOf`）。
两个单元都是同步纯 fold，state 为纯 JSON；不关心的事件返回同一 state 引用。
每个单元声明 `key`、`stateVersion`、zod `stateSchema`、`init(header)` 与 `apply(state,event)`：
`apply` 必须同步且纯，未解释的事件返回同一引用；state 必须能被 registry 做 JSON checkpoint。
每个单元的 `stateVersion` 在折叠语义或 state 形状变化时递增，旧版本的持久化行会被丢弃并从
`init` 重折。当前 transcript 为 `3`（不可变首次出现 + 有序 transitions + move 索引），work 为
`2`（窄的 pending id/来源索引）。

- 任务与活动是同一次 fold：activity 依赖每个事件后的任务/report 快照，拆开会形成第二套
  report 状态机。
- durable state 只含日志派生事实；live 值在读取时叠加，来源见「投影派生」
  （`tests/chat-read-window.test.mjs` 的 `live values are overlaid at read time and never
  written into durable state`）。
- 原生 `inbox` 投影拥有 pending 消息内容；work 单元只保留每条 pending 的 id 与来源 kind，
  用于重放 report 消费和活动 episode 边界，不复制消息内容、不对外提供 pending。这里是
  历史重放所需的窄索引，不是第二份 pending 消息存储。
- transcript 行记首次出现位置与后续状态转移（`first` / `transitions`），因此任意 `throughSeq`
  都能还原该行的 `seq` 与 `status`，无需重折前缀。`transitions` 按事件 seq 排序；只有会移动
  行位置的 transition 进入 `moves` 索引。read/page 从 `fromSeq` 开始只取窗口行，不再遍历
  整份历史。
- receipt 由 transcript 单元的 `receipts` 回答（`receiptFrom`），`/chat/send` 的幂等与冲突检测
  从该映射取值。
- `/chat/read` 与 `/chat/observe` 从这两个单元读 durable 值；同一会话的所有观察者共享同一份
  单元状态（`tests/chat-multi-observer.test.mjs`）。

### 投影派生

传输契约里的 live 字段不在 durable state 里，由 `src/runtime.mjs` 的 `LiveSession` 在读取时
叠加：

- `generation`：每次 live 会话（含冷恢复）新建的 UUID。`version`：每次已发布输入变化时递增
  （`src/runtime.mjs` 的 `changed()`）。
- `cursor`：已种子事件窗口的最后一个 seq；首次读取前为 `session.seq - 1`。
- `durableThroughSeq`：`barrier` 在 await 前捕获 `session.seq - 1`，`ctx.sessions.flush` 后只
  向前推进；投影返回 `min(cursor, durableThroughSeq)`。
- `attempt`：来自原生 history seam 的 `assistantStream`；`needsResync` 时撤回，不把两段
  attempt 拼成一段；文本取原生 stream 的 interrupted text blocks，chat 不另做一份 fold。
- `settledAttempt`：来自原生 `agent/assistant-stream` 的 end 帧；只有 `committed` 记录
  `{attemptId,seq}`，否则为 null。它不从消息文本推断，generation 重启后为 null。
- `replyStatus`：读取时由 Agent status 与 `stopping` 计算，不写入 durable state。
- `error`：最近一次执行失败，来自 `agent/error`、失败的 barrier 或图片能力拒绝；新 attempt
  开始时清空。

### 分页与重连的服务端

observe 的观察者范围对象在打开时冻结 `throughSeq`/`fromSeq`；后续快照沿用同一范围，不重新
取截点。read 的每次调用各自取当时的 cursor 作为截点。

事件窗口在每个会话首次读取时只读一次日志（`contiguousEvents` 的一次连续读取），之后由提交
事件增量维护；流式片段不读日志，单元只在提交事件上推进。首次读取前不建窗口，只写不读的
会话不付日志读取成本。

页读取：窗口已种子时直接切片；未种子时用 `sessionPersistence.open(…, 'read')` 只读请求范围，
不读整份日志。

`barrier` 在 await 前捕获 `session.seq - 1`，`ctx.sessions.flush` 成功后只向前推进
`durableThroughSeq`；之后追加的事件不被这次 barrier 声称为 durable。页由客户端传入的
`throughSeq`/`beforeSeq` 决定，重试同一对参数得到同一页（`tests/reconnect.test.mjs` 的
lost-page 用例）。

连续读取：`readSessionEvents` 观察一个精确的 append-only 前缀；原生 cursor 发现跳号时，从新的
观察重开一次，不把缺口折成连续历史；第二次缺口是读取缺陷，不是可恢复截点。

### 后台任务折叠

`tasks` 折叠原生 `jobs/lifecycle`、`jobs/report`、收件箱 splice 与 turn 结束事件；注册表仍在时
补充输出、进度与可用性。任务 id 由注册表 generation 与原生 job id 组成，服务器重启后旧任务
不会解析到新注册表中的同名任务。

`availability` 是读取时按 generation + id 查询 live registry 的结果；不可用时，非终止状态
显示 0，输出读取返回空 chunks、`next=output.total`、`lossy: true`，`report.status` 1/2 变为 6
（恢复的队列不自行调度推理）。`report.status` 由原生 `jobs/report` 的 delivery、收件箱消费
记录与对应 turn 的结束状态派生。

输出读取在可用时走 `ctx.jobs.readAt`/`ctx.jobs.get`；偏移与输出环位置由原生注册表给出。

`/chat/jobs/output` 与 `/chat/jobs/stop` 保留为产品适配层：原生 `jobController` 是进程内的
Typert 传输，不提供本投影的耐久任务折叠；保留理由与漂移信号见
[原生能力依赖记录](../../docs/decisions/native-capability-dependencies.md#job-output-and-stop)。

### 跨用户投递

`deliver_message({recipientShortId,text,files?})` 把指定文本与可选文件写入收件人的固定主
会话，返回 `{deliveryId,sessionId,messageId,acceptedSeq}`。它不读取收件人历史，也不启动收件人
推理。投递行本身的入口、禁用行为与表归属见 [delivery README](../delivery/README.md)。

投递身份由发送方会话 id 与原生工具调用 id 派生。业务表 `deliveries` 在追加前固定收件人与
内容：状态 0 待协调、1 已持久送达、2 正在准备文件。原生 `delivery/message` 事件是送达事实，
携带同一投递身份与真实发送方会话，外观为普通 Fairy 消息。重试按该身份核对：同一身份找到
同一条消息，内容或收件人不同则拒绝；启动时按该身份核对未完成的行。

文件项为发送方当前可写范围内的 `{path}`，或本会话已接纳原件的 `{messageId,index}`，
最多 8 个、单个 32 MiB、合计 64 MiB。`attachments_json` 保存有序的 `{selector,prepared}`：
每准备完一个文件就提交该快照，重试跳过已提交项，清单完整后状态才变为 0。收件消息只保留
选中的文本与原始附件清单，不含发送方私有路径。

live 投递沿用现有 Agent 的 Session 并 flush writer；cold 投递取得原生独占写句柄，追加、
flush 后关闭，不为投递创建 Agent。通知失败不回滚正文。

### 活动

`activity` 与 `tasks` 由 work 单元的同一份 fold 产生，读取时再叠加 live running。episode 由
现有 Session 事件、收件箱队列与 `tasks` 使用的同一份报告解释折叠而来，`episodeId` 为
`<sessionId>/<startedSeq>`。读取时 `reasons` 由 live running、任务状态与 report 状态计算；
投递输出只在属于当前 episode 时加入 4。没有其他原因且存在未知任务时 `status` 为 0。activity
的 `throughSeq` 是当前读取的 cursor，不是观察者冻结的 C。

`completed` 与 `delivery` 分别总结最近的已关闭 episode 与最近一次保存的投递；该前缀不变时，
两者跨重连与重启保持稳定。

### 工具执行路径：spill 目录授权

spill 文件来自工具执行（超长工具结果落到原生 spill 目录），不属于传输逻辑；chat 没有为它
增加 HTTP 路由。模型在后续 `read` 中按 locator 取回文件时，需要把执行会话自己的 spill 目录
作为一个只读根。

chat 拥有这个授权，因为 chat 拥有产生 spill 文件的回合与工具执行。`src/spill-read.mjs` 通过
`ctx.ourfairySpaces.contributeReadonlyFiles` 只贡献当前会话的 `sessionDir`（realpath），不贡献
spill 根、`DSH_HOME` 或 attachments 数据目录。贡献按文件操作求值，目录在会话第一次 spill 后
才存在；从未 spill 的会话不授予任何路径。

不复用 attachments 的授权：attachments contribution 的权威是已接纳的消息附件，spill 文件
不是消息附件。

缺席降级：根从 `ctx.get('spillStore')?.root` 动态读取，不声明进 `inject`。没有 spill 行就没有
spill 文件，贡献返回空；声明它会让所有 chat 路由等待一个辅助能力。shipped composition 由
`tests/native-capabilities.test.mjs` 与 `doctor` 要求 `spill-local` 行（行 id + 包名）存在；
检索行为由 `tests/spill-read.test.mjs` 钉住。

### 服务依赖

`inject` 的取舍规则：只声明缺席会让 chat 契约错误的服务；需要理由的例外列在下表，完整声明以
`src/index.mjs` 为准。本 spec 按 Testing Decisions 不新增 inject 字面量断言，因此最小性由审查
与提交说明承担，没有自动守卫。

| 服务 | 声明 | 依据 |
| --- | --- | --- |
| `agentLoop` | `inject` | 不为调用，只为排序：它注册的 Agent 工厂必须先于本行可用；chat 内没有 `ctx.agentLoop` 调用。 |
| `llm` | `inject` | 图片能力检查在带图片的回合开始时调用 `resolveModelInfo`；缺席时本行不会进入工作状态（未满足 inject 的行保持 pending），而不是等图片轮次抛错。 |
| `sessionQuery` | `inject` | 不直接调用；经 `src/runtime.mjs` 的 `readSessionEvents(this.ctx, …)`，由 `backend/sessions/src/events.mjs` 调 `ctx.sessionQuery.observeSession`。 |
| `systemPrompt` | `inject` | 不直接调用；Agent setup 里通过 `agentCtx.systemPrompt.section` 使用。 |
| `spillStore` | 不声明，动态读取 | `ctx.get('spillStore')?.root`；缺席是受支持的降级，理由见读取处注释。 |
| `identity`、`tools` | 不声明 | chat 内没有 `ctx.identity`/`ctx.tools` 引用；可用性由保留声明传递：`ourfairySessions` 自己 inject `identity`，`agentLoop` 自己 inject `tools`（`AgentLoop.inject`）。 |

其余条目在源码里各有使用处；新增或删除 `inject` 时，以 `src/index.mjs` 的声明与注释为准，并在
提交说明里写明依据。`spillStore` 的动态读取与缺席语义写在 `src/spill-read.mjs` 的读取处；本节
只做索引。

## dsh 升级复核

本模块依赖公开的 `sessionProjections.register/stateOf`、`SessionEvent` 的 inbox/turn/jobs
形状、`isAppendSurfaceEvent`、`assembleAssistantStream`，以及
`@deepseek-ai/dsh-agent/session-history` 的 assistant stream 与 event cursor。升级 dsh 后
按表复核：

| 测试/命令 | 归属 | 钉住的接缝 |
| --- | --- | --- |
| `node --test tests/projection-units.test.mjs tests/projection-units-real.test.mjs` | 运行时语义 | fold、`stateVersion`、state schema；真实日志重放。 |
| `node --test tests/chat-read-window.test.mjs tests/chat-page-cut.test.mjs` | 运行时语义 | 事件窗口与截点。 |
| `node --test tests/chat-multi-observer.test.mjs` | 运行时语义 | 同一会话共享单元状态。 |
| `node --test tests/chat-cold-boundary.test.mjs` | 跨两侧（运行时语义为主；含 HTTP 观察） | 冷恢复边界。 |
| `node --test tests/remote-chat.test.mjs` | 传输契约 | 路由、SSE、鉴权、错误。 |
| `node --test tests/reconnect.test.mjs` | 传输契约 | 断线补齐的线上语义。 |
| `node --test tests/jobs.test.mjs` | 跨两侧（传输契约为主；含折叠观察） | 任务端点与任务折叠。 |
| `node --test tests/native-job-status.test.mjs tests/native-job-stop-outcome.test.mjs` | 运行时语义 | 原生任务状态与停止返回值的逐项对账。 |
| `node --test tests/spill-read.test.mjs` | 运行时语义 | 本会话 spill 目录授权。 |
| `node --test tests/gateway.test.mjs`（图片能力用例） | 运行时语义 | `llm` 声明的图片能力检查。 |
| `node scripts/bench-projection.mjs --label after-upgrade --out /tmp/projection-upgrade.json` | 运行时语义 | 投影成本。 |

若 registry 接口、事件形状或 `stateOf` 消失，插件会在 `inject`/`stateOf` 处失败、相关测试
报错，不能靠保留第二套 fold 绕过。两条对账用例 `native job status vocabulary matches the
projection` 与 `native job stop outcome vocabulary matches the adapter` 分别读取 pinned dsh 的
任务状态声明与停止返回类型，与产品的映射逐项比较；上游增删状态或返回值时它们先失败并点名成员，
而不是让 `undefined` 或「已结束」静默进入投影（运行期对未知值分别显式记为未知与 5xx 响亮失败）。
行为测试与基准通过只证明当前组合兼容，不能当作长期兼容承诺。
