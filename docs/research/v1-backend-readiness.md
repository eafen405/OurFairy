# 首版后端适配：装配闭包、会话归属与投递写入

日期：2026-10-14。研究票：[研究首版后端适配：装配闭包、会话归属与投递写入](https://github.com/eafen405/OurFairy/issues/19)。

## 结论与证据等级

所选能力在源码结构上能形成闭包：22 个已选插件加 OurFairy 的 `fs`、`sandbox` Adapter，必需注入没有要求子代理、记忆、定时任务或技能。还需要显式 launcher/profile、路径与配置、产品插件及启动断言，不能把插件名单当作已经启动成功。

永久归属和正式投递不是外围投影就能补齐的能力。必须先修改 dsh Session/格式/消息与 surface 的公共表示，再接查询、文件执行、客户端；投递窄写入必须复用已有 writer 生命周期，并把持久化屏障与观察事件分开。

本次实际运行：离线 22 包注入扫描、Node SQLite FTS5 最小探针成功；Loader import 因无安装依赖失败。未运行 Loader profile、模型请求、格式往返、bubblewrap 或产品集成。后述“建议”均为工程输入，不替代已定产品决议。

## 基线、范围和增量

- dsh：`d743267388641bc76f17c45ce8b4c231aed1d32c`，本地 checkout HEAD 已核对。
- Fairybot：`095efdd84fd7ab2215a0b5b03369aac4f1303108`，本地 checkout HEAD 已核对。
- OurFairy 报告分支从 `57ea2d113e7656b0bfe120cc37ec61408b063514` 建立；主工作区草稿只读。
- 产品约束来自[后端最小装配最终决议](https://github.com/eafen405/OurFairy/issues/9#issuecomment-6163738839)。本报告不重选投递角色、自动推理、身份、空间、后台任务或通知通道。
- 已读未提交资料：`docs/backend-skeleton-proposal.md`、`docs/research/session-owner-execution.md`、`dsh-sandbox-reuse.md`、`message-model.md`。它们作为研究上下文，固定提交源码和最终决议作为事实与产品要求的权威。

增量是完整服务注入闭包、live/cold writer 生命周期、正式格式与消息消费传播、跨 JSONL/业务库故障恢复不变量、实施依赖顺序；不重复既有“有 exec.agent/sessionId”结论。

## 显式装配闭包

下表包名省略 `@deepseek-ai/dsh-`，服务名保持原样。空依赖表示入口没有声明必需 inject，不表示没有 npm 代码依赖。

| 挂载插件 | 提供/消费的必需服务 | 处理方式 |
| --- | --- | --- |
| agent、session、llm、system-prompt、session-projection | 提供 agents、sessions、llm、systemPrompt、sessionProjections | 可直接挂载基础实现；Session 内容需原生适配 |
| tools | systemPrompt → tools | 可直接挂载 |
| agent-loop | agents、sessions、llm、tools、systemPrompt、sessionProjections → agentLoop | 可直接挂载机制；创建/恢复和窄写入整合需适配 |
| llm-deepseek-api-key | llm → deepseek-official 路由 | 可挂载，无密钥时注册不等于生成可用 |
| agent-default-model | 提供 agentDefaultModel；settings 为可选注入 | 可挂载；调用方创建 Agent 时读取模型配置 |
| session-persistence-jsonl | 提供 sessionPersistence | 显式 root；适配格式，安装 live 事件路由 |
| session-checkpoint-policy | llm、sessionPersistence、sessions、tools | 必须挂载，模型/工具副作用前等待日志屏障 |
| session-query-sqlite | sessions → sessionQuery；sessionPersistence 可选 | 显式 path、openAt；首版必须同时挂持久化 |
| working-directory | fs、sessionProjections、systemPrompt → workingDirectory | 需适配身份接线，含工具外 ensure/set |
| tool-fs | tools、fs、systemPrompt、workingDirectory | 保留工具，替换 fs；attachments 启用 read_image |
| subprocess-local、shell-env | 提供 subprocess、shellEnv | 可直接挂载底层进程/环境机制 |
| sandbox-policy | sessionProjections → sandboxPolicy | 保留策略机制，禁止权限扩大成跨用户读取 |
| bash-sandbox | subprocess、sandbox、sandboxPolicy → shell | 保留机制，受控 sandbox Adapter 替换默认实现 |
| tool-bash | tools、shell、systemPrompt、shellEnv、workingDirectory | jobs 可选；首版挂 jobs，仍须监测前台回退路径 |
| jobs-local、tool-jobs | 提供 jobs；工具依赖 tools、jobs、systemPrompt | jobs-local 是内存实现；不能据此承诺跨重启续跑 |
| attachment-local | 提供 attachments | 显式 dshHome；业务访问资格由 OurFairy 落实 |
| OurFairy fs / sandbox Adapter | 提供 fs / sandbox | 必需新增装配项；接口复用不等于旧实现编译兼容 |

关键源码：[agent-loop inject L342][D-loop]、[tools L809][D-tools]、[working-directory L63][D-cwd]、[tool-fs L23][D-fs]、[tool-bash L34][D-bash]、[bash-sandbox L46][D-shell]、[checkpoint-policy L18][D-checkpoint]、[query L204][D-query]。

依赖顺序是服务可用性驱动，非 YAML 行顺序。Loader 将 entry inject 和插件 inject 合成，缺服务插件可能 pending；应逐项检查 fiber 活性和预期服务/工具/投影，而非只确认 Loader 未抛异常。[Loader L134][D-loader]、[base patch 行顺序说明][D-base]。

源码扫描覆盖 22 个入口的 `static inject` / `export const inject`，额外阅读了其基类与可选注入。基础服务不会自动调用 Loader 挂载 base；TypertRemoteService 只做服务注册/远程绑定，不要求挂 Gateway。[TypertRemoteService L166][D-remote]。

**默认配置的精确差异：** query 插件自身 `openAt` 默认为 `startup`，`never` 来自 base patch；不加载 base 时不能说插件默认关闭。首版仍应明确选择 `startup` 或 `first-search` 与独立持久路径，避免变更 profile 时意外关闭。[query L94/L207][D-query]、[base query 行][D-base]。

不用整套 base；它还挂 skill、goal、subagent 等排除能力及遥测等额外实现。npm 依赖含某接口包不等于运行时启用该能力。完整 npm/原生依赖安装可行性尚未验证。[base patch][D-base]。

DeepSeek provider 只必需 llm，credentials 可选；无 credentials 时从 launchEnvironment 解析凭据引用，缺 key 在鉴权/发现路径处理。无须为共用 key 拉入个人设置系统。首版显式模型路由、launchEnvironment 与无意外真实请求的 profile 是启动检查前提。[provider L17][D-provider]。

模型默认值也必须显式：agent-default-model 的 provider/model 是 required，无自身 pro/flash 默认；base patch 配的是 `deepseek-official/deepseek-flash`，不能在裁剪 base 后假称继承。OurFairy 已定“共用官方 DeepSeek”，未在本研究选定 pro/flash；部署实现可按该范围与图片输入要求配置、必要时交路线票汇总，不需重开个人模型选择。固定版本 provider 走 Anthropic Messages，catalog 支持图片的模型与文件访问细节由输入链路研究继续核对。[default-model L51][D-default-model]、[base patch][D-base]。

attachment-local 的目录来自 dshHome，query path/root 等由 launcher 配置；不要让新 profile 默认写宿主真实 home。agent-loop 可挂工厂而不配置自动启动 Agent；隔离启动探针应空 agents，不发送用户输入。[attachment L148/L173][D-attachment]、[loop L365][D-loop]。

## owner 与 delivery 的共同原生改动集合

| 路径 | owner 必须贯穿 | 正式 delivery 必须贯穿 | 未改时后果 |
| --- | --- | --- | --- |
| core Session 类型/校验/prepare | header 永久 owner，CreateSessionOptions.meta，冻结与缺失拒绝 | SessionEventMap、事件 data 校验和 seed/replay | 类型可编译也可能创建/恢复丢字段 |
| Agent 工厂 | create/createAgent 的 meta、resume 的持久 header、live 命中授权 | 窄追加不走 send/inject/followup | 恢复 setup 太晚，live 请求或 resume 修复先有副作用 |
| JSONL 格式与 catalog | 编解码、header 显式映射、版本/历史迁移政策 | 正式必读事件、event codec/校验、词汇/catalog | 旧 reader 拒绝或忽略；owner 往返丢失 |
| 单 writer | 同会话 owner 校验，创建/恢复/关闭统一仲裁 | seq 连续、live/cold 共用独占写所有权 | 冲突、重复 seq、重复投递 |
| surface 与消息 | header 不按消息重复归属 | SurfaceEventType/识别/fold/Message source/角色表示 | 新事件不可进模型历史或冒充模型生成 |
| 模型上下文与 provider | sessionId/附件解析继续带执行归属 | 真实来源、文本/附件的请求投影、无 replay 伪造 | 文件/image assistant 内容在 provider 不支持 |
| query corpus/index | header 一致性、行字段/映射/迁移、授权前过滤 | 正文提取、surface、区间读取/导出解释 | 越权排名或投递正文漏检索 |
| 客户端网关/历史 | 外部请求主体核实，list/read/control/subscribe 全覆盖 | 持久消息、来源、seq、deliveryId、附件资格 | 实时与恢复历史不同事实、提前通知 |

SessionHeader 当前无 owner；`create()` 的 meta 仅 `Pick<SessionHeader,'cwd'>`，createAgent 会向 prepare 传 meta。resume 在拿 write handle 后会补 interrupted-turn closers，再调用 setup；因此 external resume 必须在修复前核对归属，不把 setup 当唯一守门。[types L94][D-types]、[loop L687/L748/L844][D-loop]。

JSONL header 的允许键与 `fromHeaderLine` 都显式列字段；仅拓宽 TypeScript header 不会完成物理保存。当前格式 v4，catalog 有静态当前与历史链。保留已发布世代，选择明确后继格式/相邻迁移或应用专用格式读者；不能原地改已发布 v4 后宣称旧版安全兼容。旧日志 owner 缺失的处理要明确拒绝或有显式迁移证明，不能推测用户。[format L96/L142][D-format]、[catalog current][D-catalog]。

新增事件若是未来模型可见内容，不可作为 `ignorable` plugin record 回避格式；SurfaceEventType 当前为显式联合，runtime SurfaceEvent 集合和 data 校验也需同步。registerMessageProjection 是纯事件解释扩展，不负责给未知事件创造合法 surface 和物理 codec。[types L440][D-types]、[surface L49/L118][D-surface]、[Session L1066][D-session]。

AssistantMessage 当前固定 `ModelMessageSource`，assistant/message 还含 turn/step/stream。正式 delivery 应保留 sender/source、deliveryId 与收件 Fairy 的展示语义；不要填虚假的 provider/model/stream。需要扩展合法非模型来源的 assistant 表示或明确请求投影表示，消费者共同更新。[message L23/L166][D-message]、[Session data validation L326][D-session]。

新增附件约束：DeepSeek Messages serializer 的 assistant 只支持 text/reasoning/tool-call；image/file 不能原样作为 assistant 内容发送。`readReplay` 对非 model source 返回无 replay，这部分适合真实投递来源，但附件仍需合法请求投影（如真实文件句柄文本、获准图片访问表达），同时持久日志保留完整附件引用。当前普通文件请求转换不能被假定覆盖新 assistant 分支。[serialize L32/L54][D-serialize]、[replay L45][D-replay]。

query `assertSessionHeadersCompatible` 当前不比较 owner，SQLite live/persisted session 行也无 owner。两者一起改；搜索必须先选本人 corpus/SQL 条件再限额排名，区间读取独立核对。delivery 正文需纳入 extraction；字段筛选无法代替授权。[sources L11][D-sources]、[schema L113][D-schema]、[extraction L15][D-extraction]。

SDK/Python/Web 原生消费端有封闭 switch 和格式投影，应在改公共表示时一起 typecheck/更新；首版可以不部署这些入口，但不能将不再编译的原生消费者留作“插件式可兼容”的依据。OurFairy Android 网关最终以统一提交事实投影，不暴露未授权单操作者 remote 方法。

## live/cold 窄写入与跨存储协调

事实：Session.append 同步接受、发布 `session/event`，I/O 异步；observer 错误不撤销内存事件。JSONL install 把 live event 路由到该 id 的 writer 队列。`sessions.flush(session)` 按 live carrier 等待所有 flush listeners，JSONL listener 执行 `drainLive()` 后 `writer.flush()`。[Session L767/L1318][D-session]、[storage L535][D-storage]。

因此不能将 `session/event` 当“已保存”通知。flush 返回 boolean 仅证明存在至少一个 listener；装配必须保证目标 JSONL writer 已注册，避免把其他 listener 的存在当作日志屏障。checkpoint-policy 已覆盖模型和工具前置，但不会自动为新 delivery 产生业务提交通知。[checkpoint][D-checkpoint]。

事实：JSONL 同一进程只允许一个 write handle；open(write) 获取 kernel lease，已有 live Agent 持有 handle。append 连续批次在 resolution 后已 durable；close 排空 buffered live suffix 后释放。resume 先拿 write 所有权再恢复，避免并发恢复。[persistence L322/L348][D-persistence]、[storage L187/L203][D-storage]、[loop L879][D-loop]。

建议由会话 Module 隐藏如下 Interface，不让投递持有通用绕权读取能力：

```text
appendDeliveryToMain(recipientUserId, stableDeliveryId, authorizedContentAndRefs)
  -> { sessionId, seq, deliveryId }    // 返回意味着目标事件已 durable
```

- 先固定收件主会话关系并核对其 header owner；投递 Module 可取得内部窄写入 capability，不能拿对方上下文读取能力。
- live：沿现有 Session.append 与同一个 writer 路由，捕获已接受 seq，等待 sessions.flush；不要另 open(write) 或直接写 JSONL 绕开 Session。
- cold：由同一会话写入仲裁取得独占 handle，read/prepare/replay 后生成合法连续事件并 await handle.append；不实例化 Agent、不调用推理。
- cold 写入与 resume/create 必须共享每 sessionId 生命周期仲裁；单 writer 锁是底层拒绝保障，不能让正常并发操作靠冲突失败作为协议。
- live→cold 关闭要等待排空；cold→live 恢复必须看到已写 delivery。cold 非正常结束的 turn 要沿现有语义修复规则处理，不能让投递伪造 turn，也不能顺手启动推理。
- 会话当前生成中追加的事件按真实 seq 保存；已准备好的模型请求不会追溯改写，后续模型历史必须包含它。忙时是否在下一次请求看到由 request snapshot 决定，验证不可丢失和不可重复即可。

建议稳定 deliveryId 在任何附件复制/重试前产生并写入业务 SQLite；同一 id 的目标和内容不可变。幂等核对在拿到目标 writer 仲裁后进行，以日志内该 id 的事件为“内容已送达”证据。

| 故障窗口 | 恢复不变量 |
| --- | --- |
| 业务 pending 已写、附件未完成 | 同 id 重试准备；不可提交半附件消息 |
| 附件内容存储完成、日志尚未接受 | 重试同 id；未引用 blob 可后续清理，不假称送达 |
| live 内存已接受、flush 失败或结果未知 | 禁止通知/成功确认；仲裁下检查已有事件并重试 flush，不再 append 同 id |
| JSONL 已 durable、业务 delivered 更新前崩溃 | 按 id 重建业务状态/通知依据，不追加第二条消息 |
| 业务 delivered 已更新、客户端通知失败 | 内容不回滚；重试/重连从持久日志恢复，客户端按事件身份去重 |

JSONL 与业务 SQLite 无共同事务，不承诺“恰好一次网络通知”。逻辑单次送达来自 stable id + writer 仲裁 + 日志核对，通知允许重放。若保留业务送达索引，它是协调索引，不成为正文或归属第二权威。

客户端共同 Interface 建议区分 observedSeq 与 durableThroughSeq：可实时观察流，但恢复 cursor 只能跨过明确已提交前缀；flush 前捕获截点，flush 成功后确认该截点，实际写入更晚前缀无妨。cold await append 可直接确认批次末 seq。deliveryId 与 sessionId+seq 职责不同，不能替代游标。

## 文件、sandbox 和 jobs 的实施前接线缺口

旧 ProcessingFileSystem 捕获 tools/execute 的异步范围身份；OurFairy 应从永久 header owner 计算空间范围，不搬旧外部 owner 表。当前 workingDirectory.ensure 直接 fs.resolve/stat 且不提供 cwd，set/系统提示/启动 setup 也可能在工具 waterfall 外；旧按 cwd 合法根校验不能直接照搬。[旧 fs L120/L204][F-fs]、[cwd L134][D-cwd]。

必要入口清单：普通 read/write/edit/read_image；workingDirectory.ensure/set 与 fallback；附件上传下载/模型附件访问；内部投递文件准备；后台 job 的实际 shell launch；HTTP 文件入口。每入口都需明确执行 owner 或内部获准能力。不是增加全局当前用户，也不是为无身份入口默认用户。

bash-sandbox 的 danger-full-access 会跳过 confine；当前 tools 的 escalation 路径也可能请求更宽 policy。必须在实际执行实现/入口维持用户文件限制，不能只在模型 schema 或旧 gate 屏蔽。[bash-sandbox L89][D-shell]、[tool-bash L207][D-bash]。旧 bubblewrap 与 `/proc/self/fd` 是 Linux 特定实现，允许联网要改变旧断网配置，目录挂载与网络分别验证。[旧 bwrap L152/L228][F-bwrap]。

jobs 接线额外事实：tool-bash 在 jobs 注册失败时有前台 timeout 回退；tool-jobs 通过 jobs.events 为 busy owner inject、idle owner followup。任务完成与跨用户投递不能共用“所有事件均唤醒 Agent”的出口。[tool-bash L505/L521][D-bash]、[tool-jobs L271/L297][D-jobs-tool]。

jobs-local 状态是内存，任务输出/完成消息只在对应工具或后续 Agent 处理后成为日志内容。若 Android 要重连还原活动/终态通知，应让 owning Module 将最小 job-start/job-settle 事实写回原会话日志并持久化后通知；不另建活动权威日志，不据此恢复真实进程。工具结果已记录的事实可复用，尚未产生的终态须补记，具体字段由共同契约适配决定。[jobs Interface][D-jobs]。

## Module Interface 和实施依赖顺序建议

| Module | 调用方必须知道的 Interface | 内部隐藏的复杂性 |
| --- | --- | --- |
| 身份 | 验证请求主体、查有效收件用户；无正文权限 | 邀请/凭据/短编号事务 |
| 会话 | 授权后的创建/读取/控制/本人检索；内部 durable delivery 追加 | owner、writer/live-cold、主会话、格式和持久游标 |
| 空间 | 按明确用户计算当前空间范围 | 群组成员、撤权后的新操作范围 |
| 文件/执行 | fs/sandbox 原生 Interface + 明确执行 Session | 实际打开对象检查、目录挂载、网络、进程生命周期 |
| 投递 | 指定收件编号、内容和可用文件，稳定重试结果 | 附件准备、幂等、跨库协调；不读收件上下文 |
| 接入/通知 | 认证后的命令与提交事实订阅/补取 | 用户路由、连接生命周期、通知恢复；断线不 dispose Agent |

建议顺序：

1. 固定 dsh 源版本和显式 profile；装好隔离依赖，无凭据启动，断言所有 services/tools/projections 活性及排除项。
2. 原生 owner + delivery 正式表示/格式往返/恢复/surface/provider 请求投影，是共同前置；writer 窄写入跟随同一变化落地。
3. 两用户纵向验证：create→durable header→restart/read→越权拒绝，live 命中和 external resume 在副作用前检查。
4. query、旧 fs/sandbox Adapter、身份/空间与 Android 编码可按已定 Interface 并行；owner 类型和物理恢复必须先稳定。
5. delivery live/cold/忙时/重试/崩溃窗口纵向路径，再接 durableThroughSeq、通知和客户端历史一致性；jobs 终态事实走相同持久出口。

最小纵向验证不需付费模型：两个用户、固定主会话、文本+文件投递，收件方无 Agent 也能保存；cold/live 切换后历史一致、同 id 重试仅一条、落盘后通知失败可补取、无模型 stream 调用。模型请求形状以无网络 serialize fixture 检查；真实 provider、文件隔离与 vivo 验收保留集成阶段。

组织建议：因公共 Session/format/Message 类型改动跨包，优先对固定 fork 做一组连贯原生修改，并以 workspace 或固定产物被 OurFairy 消费。纯产品 Modules 放 OurFairy，provider Adapter 在真正变化的 seam 替换。只有迁移工具链/发布策略明确需要时再 vendoring；本研究不迁目录或启用新包仓库。单独“delivery 插件 + 原版 npm dsh”不够。

## 已运行与未验证

- Python 离线扫描 22 个入口：必需 inject 未命中排除能力；此探针不运行 TS、不验证 inherited 动态服务或插件活性。
- Node `v24.18.0`，`node:sqlite` 内存 `CREATE VIRTUAL TABLE ... USING fts5(body)` 成功；只证明当前 Node 的 FTS5 可用，不证明 dsh schema/query/中文命中效果。
- 动态 import `@deepseek-ai/cordis-plugin-loader`：`ERR_MODULE_NOT_FOUND`；dsh checkout 无 `node_modules`。未安装联网依赖，因此未做 Loader 启动，不假称 profile 注册成功。
- 无真实凭据、无模型/付费调用、无产品代码修改；仅研究报告保留在隔离分支。
- 未验证：新格式编译/往返、Loader 真实闭包、新消息到官方模型的支持、旧 Adapter 编译与 bubblewrap 权限、业务崩溃协调、jobs 持久终态、Android/vivo 真机。

这些缺口已有明确实现验证门槛，不需要继续为普通字段/版本编码无限开研究票。现有产品要求未发现必须重选的冲突；研究支撑“可开始有顺序的工程实施”，不支撑“无需原生改动或已经可部署”。

## 固定提交源码索引

[D-loop]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-loop/src/index.ts#L342
[D-tools]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/tools/src/index.ts#L809
[D-cwd]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session/working-directory/src/index.ts#L63
[D-fs]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/fs/tool-fs/src/index.ts#L23
[D-bash]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/shell/tool-bash/src/index.ts#L34
[D-shell]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/shell/bash-sandbox/src/index.ts#L46
[D-checkpoint]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session/session-checkpoint-policy/src/index.ts#L18
[D-query]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session-query/session-query-sqlite/src/index.ts#L204
[D-loader]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/vendor/loader/src/index.ts#L134
[D-base]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/bundle/base/cordis.patch.yml
[D-remote]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/typert/protocol/src/index.ts#L166
[D-provider]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek-api-key/src/index.ts#L17
[D-default-model]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/agent-default-model/src/index.ts#L51
[D-attachment]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/attachment/attachment-local/src/index.ts#L148
[D-types]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/types.ts#L94
[D-format]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session/session-persistence-jsonl/src/format.ts#L96
[D-catalog]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session/session-format-catalog/src/current.ts
[D-surface]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/surface.ts#L49
[D-session]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/index.ts#L767
[D-message]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm/src/message.ts#L23
[D-serialize]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek/src/serialize.ts#L32
[D-replay]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/llm/llm-deepseek/src/replay.ts#L45
[D-sources]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session-query/session-query/src/sources.ts#L11
[D-schema]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session-query/session-query-sqlite/src/schema.ts#L113
[D-extraction]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session-query/session-query/src/extraction.ts#L15
[D-storage]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session/session-persistence-jsonl/src/storage.ts#L187
[D-persistence]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session/session-persistence-jsonl/src/index.ts#L322
[D-jobs-tool]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/jobs/tool-jobs/src/index.ts#L271
[D-jobs]: https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/jobs/jobs/src/index.ts#L1
[F-fs]: https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/processing/fs-provider.ts#L120
[F-bwrap]: https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/processing/bwrap.ts#L152
