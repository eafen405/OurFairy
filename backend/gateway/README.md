# 法厄同共用配置网关

所有路由均为 POST，JSON 请求体，`Authorization: Bearer <身份凭据>`，与 `/sessions/*`
同一端点、同一 Host/Origin 校验。未认证为 401 `gateway/unauthorized`；非管理员为
403 `gateway/forbidden`（后端判定，不依赖客户端隐藏入口）。

配置的唯一持久化权威是 dsh 的活动 profile：`agent-default-model` 行保存共用选模，
`llm-pi-ai` 行的 `providers` 保存自定义供应商路由，`speech` 行保存 ASR 连接。网关不建
自己的配置表，也不接受密钥值——路由只携带凭据**引用**（环境变量名），由原生凭据 seam
每次请求解析；读取只报告该引用是否已配置。

## 路由

| 路由 | 请求体 | 响应 |
| --- | --- | --- |
| `/gateway/read` | `{}` | `{ok:true,gateway:{selection,selectionApplies,routes,asr,inUse,editable,saved}}` |
| `/gateway/selection` | `{provider,model,reasoningEffort?}` | `{ok:true,selection,applies:"next-turn"}` |
| `/gateway/route` | `{provider,displayName?,api?,baseURL?,apiKeyEnv?,models?}` | `{ok:true,route}` |
| `/gateway/route/delete` | `{provider}` | `{ok:true,provider}` |
| `/gateway/asr` | `{model,endpoint,apiKeyEnv?,maxDurationMs?,maxAudioBytes?,timeoutMs?,maxGlobalInFlight?,maxUserInFlight?}` | `{ok:true,asr}` |

### 读取

- `selection`：当前共用选择 `{provider,model,reasoningEffort?}`；`selectionApplies` 固定
  `"next-turn"`。
- `routes`：已注册的路由。`editable` 表示该路由由 `llm-pi-ai` 的 `providers` 配置，
  可由本网关改写；官方 `deepseek-official` 路由为 `false`。可编辑路由返回 `api`、`baseURL`、
  `apiKeyEnv`（未设置为省略），`models` 每项 `{id,name,contextWindow?,maxTokens?,input?}`；
  官方路由的 `models` 来自适配器当前目录。`credential` 为
  `{ref,configured,writable,source?}`，永远不含密钥值。`inUse` 表示有正在运行的回复使用该路由。
- `asr`：`speech` 行的连接设置、`available`（引用的凭据能否解析）与凭据状态。
- `editable`：`{selection,routes,asr}`，表示相应行是否挂载。缺少整个配置编辑器时读取返回
  503 `gateway/configuration-unavailable` 并说明原因，而不是假装只读。
- `saved`：`{selection,routes,asr}`，表示 profile 用户层是否已有覆盖；`false` 表示仍在使用
  组合声明的初始值。

### 共用选模

`/gateway/selection` 先确认 provider 已注册、model 在适配器提供的模型清单内，再经原生
`agentDefaultModel.saveSelection(...)` 写入 `agent-default-model`；网关不再直接写该行。保存的
调用路径由 `tests/gateway-service.test.mjs` 的单元测试固定：原生入口收到完整选择、
`settings().mutate` 未被调用。重叠保存的串行化是原生 `agent-default-model` 服务自己的契约，
由上游测试 `serializes overlapping saves and continues after a rejected write` 固定，不是产品
HTTP 测试的断言——`consecutive selection saves commit in submission order` 固定的是按提交顺序
完成两次保存时最后一次的值生效。缺少配置编辑器时返回 503
`gateway/configuration-unavailable`：原生入口在没有编辑器时保持组合入口、不落盘，网关不能因此
假装保存成功（同一单元测试断言此时不调用原生保存）。选择对**所有会话**从各自下一轮回复开始生效：每个 turn
开始时读取一次并固定到该 turn 结束，包括工具调用后的模型续请求；正在执行的回复不切换。
保存选择不受在用状态限制。省略 `reasoningEffort` 会清除该字段的 profile 覆盖，回到组合声明的
默认值；网关从同一设置行的继承层（`base.reasoningEffort`）取出该默认值，随完整选择一起提交
（与旧实现中 `unset` 取继承值一致），因此保存值等于组合声明时 profile 行仍会被移除。显式值按
保存值回显，响应回显的是生效值。`minimax-cn` / `MiniMax-M3.1-Flash` 需要自适应思考，默认
`max`；带空格的别名会被服务端静默降级，写入时请使用连字符 id。

### 供应商路由

`/gateway/route` 接受 `provider`、`displayName`、`api`、`baseURL`、`apiKeyEnv`、`models`。
其余字段返回 400 `gateway/invalid-route`，不会被静默丢弃。`models` 每项接受 `id`、`name`、
`contextWindow`、`maxTokens`、`input`。`input` 的取值以 pinned dsh 的
`@deepseek-ai/dsh-llm-pi-ai` 目录模块导出的 `MODALITIES` 为唯一权威：网关直接导入该运行时
列表，不维护本地词表，原生新增模态无需产品改动即可接受；不在列表中的值返回 400
`gateway/invalid-route`。该包是网关声明的 peer，不回退到本地列表：模块级加载失败被
`GatewayService` 构造函数重新抛出，因此启动失败并指出缺失的包/子路径，而不是只报「加载失败」。
`loadNativeModalities(...)` 导出同一段加载逻辑，`tests/gateway-service.test.mjs` 的
`a missing native catalog fails naming the peer and the module specifier` 用一个不存在的子路径
直接构造该失败并断言消息点名子路径与 peer（不需要整机启动），同一用例断言默认加载返回原生
列表。保存时以同 id 的先前模型条目为底，只覆盖这五个可编辑
字段；其余字段（如部署声明的思考能力 `reasoningEfforts`、协议兼容开关 `compat`，以及上游
将来新增的模型级字段）默认保留，不会因保存而丢失。草稿省略的可编辑字段按「未设置」清除，
不继承旧值；新模型 id 没有可保留的先前条目，按草稿原样写入。路由级部署字段（例如
`retryPolicy`）仍由部署层拥有，不会因为这次保存被复制进用户层。适配器仍是协议与配置合法性
的权威，其拒绝信息原样返回。写回时只发送上述六个字段；读取附带的 `editable`、`declared`、
`credential`、`inUse` 是只读事实，写回时若一并发送会被 400 `gateway/invalid-route` 拒绝，
而不是静默忽略。

修改会影响**正在运行的回复所用路由**时返回 409 `chat/route-in-use`，消息列出会话与模型；
删除未在用的路由不受影响。按实际受影响范围判定：改端点、协议、凭据引用等路由级字段影响该
路由全部模型；只改某个模型的清单项时只影响该模型（读到的配置含适配器默认值，比较只看草稿
拥有的字段）。写入期间开始的回复会在首个模型请求前重新读取已提交的选择；这条时序路径尚未由
计时测试固定，已被测试固定的是：运行中回复所用路由的修改被拒绝，结束后重试成功。路由是共用
选择的 provider 时不能删除
（409 `gateway/route-selected`），先切换选择。

### ASR 连接

`/gateway/asr` 写入 `speech` 行：`model`、`endpoint` 必填，其余为可选正整数限制；
`apiKeyEnv` 是凭据引用名（默认 `VOICE_API_KEY`），不是密钥。下一次录音使用新设置；
正在进行的转写保留自己的请求。

## 生效与重启

保存写入活动 profile 的用户层（`cordis.patch.yml`），重启后由 profile 覆盖组合声明的初始
值，启动装配不会用 `combo.json` 的初始模型覆盖已保存的选择。密钥保存在后端
（环境或凭据存储），不会出现在本接口的任何响应中。

## 未纳入

插件安装、启停与装配由部署维护，本接口不提供；dsh 自带的 Web 设置界面不挂载。普通代理人
仍可正常对话，只是没有本接口的调用资格，也读不到他人的正文、私有文件或未加入群组的内容。
