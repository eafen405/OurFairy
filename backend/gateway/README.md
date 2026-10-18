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
| `/gateway/read` | `{}` | `{ok:true,selection,selectionApplies,routes,templates,asr,inUse,editable,saved}` |
| `/gateway/selection` | `{provider,model,reasoningEffort?}` | `{ok:true,selection,applies:"next-turn"}` |
| `/gateway/route` | `{provider,profile}` | `{ok:true,route}` |
| `/gateway/route/delete` | `{provider}` | `{ok:true,provider}` |
| `/gateway/asr` | `{model,endpoint,apiKeyEnv?,maxDurationMs?,maxAudioBytes?,timeoutMs?,maxGlobalInFlight?,maxUserInFlight?}` | `{ok:true,asr}` |

### 读取

- `selection`：当前共用选择 `{provider,model,reasoningEffort?}`；`selectionApplies` 固定
  `"next-turn"`。
- `routes`：已注册的路由。`editable` 表示该路由由 `llm-pi-ai` 的 `providers` 配置，
  可由本网关改写；官方 `deepseek-official` 路由为 `false`。`profile` 只含网关拥有的字段，
  不含适配器默认值。`models` 是适配器当前提供的模型与输入模态。`credential` 为
  `{ref,configured,writable,source?}`，永远不含密钥值。`inUse` 表示有正在运行的回复使用该路由。
- `templates`：尚未配置的起步草稿（当前为 MiniMax 中国站）。它们是可编辑草稿，不是对该
  账号套餐或模型能力的声明。
- `asr`：`speech` 行的连接设置、`available`（引用的凭据能否解析）与凭据状态。
- `editable`：`{selection,routes,asr,reason}`；缺少配置编辑器或相应行时为 `false` 并给出原因。
- `saved`：`{selection,routes,asr}`，表示 profile 用户层是否已有覆盖；`false` 表示仍在使用
  组合声明的初始值。

### 共用选模

`/gateway/selection` 先确认 provider 已注册、model 在适配器提供的模型清单内，再写入
`agent-default-model`。选择对**所有会话**从各自下一轮回复开始生效：每个 turn 开始时读取一次
并固定到该 turn 结束，包括工具调用后的模型续请求；正在执行的回复不切换。保存选择不受
在用状态限制。

### 供应商路由

`/gateway/route` 接受 `displayName`、`api`、`baseURL`、`apiKeyEnv`、`models`、
`modelOverrides`、`compat`、`defaultContextWindow`、`defaultMaxTokens`、
`requestImagePixelBudget`、`requestImageMaxBytes`、`maxRequestImageBytes`、`retryPolicy`。
其余字段返回 400 `gateway/invalid-route`，不会被静默丢弃。`models` 每项接受 `id`、`name`、
`contextWindow`、`maxTokens`、`input`、`reasoningEfforts`。适配器仍是协议与配置合法性的
权威，其拒绝信息原样返回。

修改会影响**正在运行的回复所用路由**时返回 409 `chat/route-in-use`，消息列出会话与模型；
删除未在用的路由不受影响。按实际受影响范围判定：改端点、协议、凭据引用等路由级字段影响该
路由全部模型；只改某个模型的清单项时只影响该模型。写入与新回复开始相互协调：在写入期间开始
的回复会等写入提交后再读选择与路由，不会跨两份定义。路由是共用选择的 provider 时不能删除
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
