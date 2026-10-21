# #133 chat 的 inject 与实际依赖对齐：分析与任务图

父票：[#133 chat 的 inject 与实际依赖对齐：删残留、显式化隐性依赖](https://github.com/eafen405/OurFairy/issues/133)。
GitHub issue 是发布权威，原生 blocked-by 是实时状态权威；本目录是实施时读取的工作副本。

基线：`integration/ourfairy-v1` @ `fc5ea92`。本 spec 不拆包、不移动 `test-support` 夹具、不改
`runtime-facade` 的公开方法集、不改 gateway 对 `ourfairyChat` 的依赖。

## 任务图

| 文件 | 票号 | 内容 | 阻塞 |
| --- | --- | --- | --- |
| `01-inject-alignment.md` | [#151](https://github.com/eafen405/OurFairy/issues/151) | `inject` 对齐：删 `identity`/`tools`，声明 `llm`，注明 `agentLoop` 与 `spillStore` | 无 |
| `02-readme-contracts.md` | [#152](https://github.com/eafen405/OurFairy/issues/152) | README 分「传输契约 / 运行时语义」两段，升级复核逐条标注 | 无（与 #151 并行，决定已定） |
| `03-closeout.md` | [#153](https://github.com/eafen405/OurFairy/issues/153) | 夹具归属、全量门禁、证据索引 | #151、#152 |

## 现状审计：16 个 inject 与真实使用处

| 服务 | 使用处（基线 `fc5ea92`） | 处置 |
| --- | --- | --- |
| `webServer` | `src/index.mjs`：9 条 `ctx.webServer.register` | 保留 |
| `connection` | `src/index.mjs`：`ctx.connection.fence` | 保留 |
| `ourfairySessions` | `src/service.mjs`：`authenticate`；`src/runtime.mjs`：`read` | 保留 |
| `ourfairySpaces` | `src/spill-read.mjs`：`contributeReadonlyFiles` | 保留 |
| `agents` | `src/runtime.mjs`：`resume` | 保留 |
| `agentLoop` | 无 `ctx.agentLoop` 调用；`agents.resume` 需要它注册的 Agent 工厂先可用 | **保留并注释：排序/副作用** |
| `agentDefaultModel` | `src/runtime.mjs`：`currentSelection` | 保留 |
| `sessions` | `src/runtime.mjs`：`flush` | 保留 |
| `sessionQuery` | 间接：`src/runtime.mjs` 的 `readSessionEvents(this.ctx, …)` 在 `backend/sessions/src/events.mjs` 调 `ctx.sessionQuery.observeSession` | 保留，README 写明间接使用 |
| `systemPrompt` | `src/runtime.mjs` 的 Agent setup：`agentCtx.systemPrompt.section` | 保留，README 写明经 Agent 上下文使用 |
| `ourfairyAttachments` | `src/service.mjs`：`inputs` | 保留 |
| `identity` | 无 `ctx.identity`；`@ourfairy/dsh-identity/http` 是 POST 信封的模块 import，不是服务 | **删除** |
| `tools` | 无 `ctx.tools` | **删除** |
| `sessionPersistence` | `src/runtime.mjs`：`open` | 保留 |
| `jobs` | `src/jobs.mjs`、`src/units.mjs`：`events`/`list`/`readAt`/`get`/`kill`/`generation` | 保留 |
| `sessionProjections` | `src/units.mjs`：`register`；`src/runtime.mjs`：`stateOf` | 保留 |

删除 `identity`/`tools` 的传递保证：`ourfairySessions` 自己 inject `identity`；`agents`/`agentLoop`
自己 inject `tools`。chat 不再直接读这两个服务，但组合里的可用性仍由保留的声明保证。

## 已定决定

1. **删除 `identity`、`tools`**。依据：#99 把投递行搬走后，chat 内不存在对这两个服务的
   `ctx.<name>` 引用；上面两个传递保证让删除不改变组合可用性。
2. **`agentLoop` 保留并注释**：chat 不调用 `ctx.agentLoop`，但它注册的 Agent 工厂是
   `agents.resume` 的前置；声明它让本行在工厂可用前不接受工作。
3. **`llm` 声明进 `inject`，使用点改为已声明的服务访问**。图片能力检查在带图片的回合开始
   时真正调用 `resolveModelInfo`；缺席应在组合期失败，而不是等图片轮次抛错。`gateway` 与
   `attachments` 已采用同样的声明方式。这是本次唯一的运行时调用点改动；在能跑回合的组合里
   行为不变。
4. **`spillStore` 保持 `ctx.get('spillStore')` 动态读取**，在读取处注释「允许缺席」：
   没有 spill 行就没有 spill 文件，贡献返回空；声明它会让所有 chat 路由等待一个辅助能力。
   shipped composition 仍由 `tests/native-capabilities.test.mjs` 与 `doctor` 要求 `spill-local`
   行存在，所以服务改名/删行不会静默通过。
5. **`sessionQuery`、`systemPrompt` 保留**：分别是经共享读取 helper 与经 Agent 上下文的间接
   使用；README 的服务依赖小节写清，避免下次误删。
6. **不新增断言 `inject` 字面量的测试**（spec Testing Decisions）。接缝是真实启动器加产品
   HTTP/SSE 端点，既有行为套件就是验证。

## README 分节映射（#152）

```text
传输契约（客户端可依赖的线上行为）
  路由与信封：路由表、鉴权、错误形状、requestId/receipt、stop
  投影载荷：字段与数字枚举
  分页与重连：请求/响应、C/L、hasMore/beforeSeq、合并规则
  后台任务端点：/chat/jobs/output 与 /chat/jobs/stop 的形状

运行时语义（服务端如何产生这些值，不是客户端可依赖的线上形状）
  投影单元：stateVersion、fold、inbox 所有权、transcript 行
  投影派生：generation/version/cursor/durableThroughSeq/attempt/settledAttempt/replyStatus/error 的来源与失效
  分页与重连的服务端：冻结截点、窗口只读一次、durable ACK
  后台任务折叠：tasks、注册表 generation、输出环、availability、report.status、保留产品适配层的理由
  跨用户投递：deliver_message、deliveries 协调、文件准备、live/cold；行主人是 delivery/README
  活动：episode、reasons、completed/delivery 摘要
  工具执行路径：spill 目录授权（为何 chat 拥有、attachments 授权不适用、缺席降级）
  服务依赖：inject 规则与逐项依据

dsh 升级复核（跨两侧，逐条标注）
```

跨两侧的条目在两侧各写自己那一半：传输侧写请求/响应/字段与客户端可依赖的规则，运行时侧写
服务端如何冻结、读取、折叠、派生与降级；不复制同一事实。

## dsh 升级复核归属

| 命令/测试 | 归属 | 钉住的接缝 |
| --- | --- | --- |
| `projection-units`、`projection-units-real` | 运行时语义 | fold、`stateVersion`、state schema |
| `chat-read-window`、`chat-page-cut` | 运行时语义 | 事件窗口与截点 |
| `chat-multi-observer` | 运行时语义 | 同一会话共享单元状态 |
| `chat-cold-boundary` | 运行时语义（含 HTTP 观察） | 冷恢复边界 |
| `remote-chat` | 传输契约 | 路由、SSE、鉴权、错误 |
| `reconnect` | 传输契约 | 断线补齐的线上语义 |
| `jobs` | 传输契约（含折叠观察） | 任务端点与任务折叠 |
| `spill-read` | 运行时语义 | 本会话 spill 目录授权 |
| `gateway` 图片能力用例 | 运行时语义 | `llm` 声明的图片能力检查 |
| `bench-projection` | 运行时语义 | 投影成本 |

确实跨两侧的测试写「跨两侧（哪一半为主）」，不硬塞进一侧。

## `test-support` 夹具归属（#153 记录，本次不移动）

| 夹具 | 主人 | 理由 |
| --- | --- | --- |
| `backend/chat/test-support/fail-outlets.mjs` | 投递行 | 故障点是 `delivery/message` 的 durability 与通知出口 |
| `backend/chat/test-support/frame-gap.mjs` | 运行时一侧 | 故障点是 Assistant 帧边界 |
| `backend/chat/test-support/lost-event.mjs` | 运行时一侧 | 故障点是 Session 事件读取边界 |

## 范围外发现

- `backend/chat/package.json` 的 `@deepseek-ai/dsh-tools` peer 在 chat 源码中没有 import；
  这属于 #136「产品包清单真实性」的 peer 一致性范围，本 spec 不顺手修改。
- 不拆 chat 为运行时包与传输包；不移动 `test-support` 夹具；不改 `runtime-facade` 的暴露方法；
  不改 gateway 对 `ourfairyChat` 的依赖。

## 验收口径

- 好测试只断言外部行为：HTTP 端点返回什么、SSE 推送什么、投影里有什么；不断言 `inject` 数组字面量。
- 删 inject 后必须原样通过：`remote-chat`、`chat-cold-boundary`、`chat-multi-observer`、`jobs`、
  `reconnect`；`spill-read` 与 `gateway` 的图片能力用例验证 `llm`/`spillStore` 仍在位。
- 全量门槛：`npm test` 与 `npm run combo:verify`，在 #153 合并后的集成分支上跑。
