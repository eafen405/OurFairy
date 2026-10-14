# dsh 事件消费 / jobs / 客户端补取事实层

> **2026-10-14 复核纠正：本文为保留的旧研究，不能继续当作已验证事实底。** 单传输、throughSeq 增量补取、assistant 重连、一次性 token、原生客户端请求头及多用户授权的表述存在错误或过度推断；以[源码复核](dsh-event-consumption-audit.md)为准。本文末尾“schedule 纳入首版”与正式决议相反：首版纳入 jobs，排除定时任务。

研究日期：2026-10-14。本文件是事实层（不是引用，只复列），由 research 子代理 88011fd8 在 wayfinder 流程中产出的事实清单重组（原始产物因 sandbox 清理丢失，但事实由子代理结束汇报完整保留）。不创造决策、不再现原 OurFairy 已有的研究事实——只补齐 dsh 事件与客户端消费的技术底。

代码基线来自 `/home/eafen405/projects/deepseek-harness`（fork，本地）。每条均给路径与行号。

> **本文件归属**：本研究是为 #10 (grilling) 准备的事实底；写于 grilling 工作流，不是产品决策。grill 结束后由用户决定是否纳入决议或保留为参考资料。

## 0. 大局：Host ↔ Client 传输

- **传输面唯一：WebSocket mux**，路径 `GET /api/remote.mux`。
- **没有原生 SSE**。没有专属 HTTP 推送通道。
- 多个 logical stream 复用单一连接；上行（client → host）同样走此流。
- 心跳 Ping/Pong 2s，由 Gateway 拥有。
- 鉴权：HTTP 与 WS 升级都走 Host/Origin fence + Cookie 签名；launch token 一次性换 cookie。
- wire 上**无 UserScope 字段**；OperatorPeer 是单操作者。

## 1. 消息事件服务端到客户端传输

- **`SessionEventMap`**（surface: system/developer/user/assistant/tool/result；非 surface: turn/step/request/header/assistant/attempt 等）；完整枚举由代码生成于 `packages/core/session/src/known-event-types.ts:22-83`。
- **`@Remote(...)` 暴露**：所有会话事件通过 `@Remote(...)` 暴露，stream 类型（`session.follow`、`session.control`、`session.page` 等）走 Typert Gateway。
- wire 帧 `SessionFollowFrame` 三类：snapshot / event / assistant-stream。
- `SessionWireEvent` 是浏览器线格式（含 surfaceOp / sourceEventSeqs）。

## 2. dsh jobs 事实层

- **`JobEvent` 6 类**：registered / progress / stopping / removed / settled / output。
- **`JobView.status`**：running / stopping / completed / killed / failed。
- 输出：`JobChunk` 带 `at` 字节偏移，**按绝对 offset 续拉**。
- **输出入会话**：`tool-jobs` 装载后把未消费的完成反馈按 Agent 状态投递：
  - busy → inject 进 next step inbox
  - idle → 默认 wakeup（`agent.followup`），可配置 quiet / maxConsecutiveWakes
- source kind = `tool-jobs`，form = `notice`。
- 模型自己的 `job_kill` 不算 notice；live wait 收到的 settlement 也不算。
- **Host Remote 接口**：
  - `job.list` stream：开头 + lifecycle commit 时 coalesced 全集。
  - `job.follow` stream：opened / output / status 三帧，`from` 是字节 offset。
  - `job.kill` unary。
- **jobs 与会话归属**：
  - `JobSpec.owner` = SessionId；owner 必须为 live Agent；**Agent 销毁即取消**。
  - `{ owner }` filter 收该 session 的 jobs + 所有 unowned；unowned job 任何调用者可读。
- jobs 状态在内存，**Host 重启即丢失**。
- backend-skeleton-proposal.md 已将 `dsh-jobs-local` + `dsh-tool-jobs` 纳入首版。

## 3. 断线补取协议事实

### 3.1 durable events
- `session.page({ throughSeq, beforeSeq?, maxMessages?, turnWindow? })` 按事件 ID 补取。
- 或 `session.follow` 重开 + Client 侧 `loadThrough(seq)` 循环拉 Turn-aligned pages。

### 3.2 assistant 流补取
- transient frames 不持久化。
- reconnect 时通过 `SessionAssistantStreamBaseline.nextIndex` / `startedAfterSeq` 续，但**仅在当前 revision 内有效**。
- **无 chunk-index 补取接口**。

### 3.3 jobs 补取
- `job.follow({ sessionId?, jobId, from? })` 按绝对字节 offset 续拉；`from` 必为上次 `next`。

### 3.4 列表 / projection 补取
- 每次 reconnect **全新 baseline**，**不存在 diff 续拉**。
- Client 缓存必须按 Host 整张表刷新。

### 3.5 Client 去重 vs 服务端权威
- 每条 event 自带 `seq`。
- Client `MutableSessionEventSource` 是累加窗口；`RemoteJournalStream.acceptEntry` 拒绝 cursor ≤ lastCursor。
- `session/event` seq 不连续 → `gateway/internal` 并断开。

## 4. 客户端状态机可能需要的接口路径

下表来自子代理事实，每个接口均引到 Host Remote 接口或 Connection.fetch 注册的 HTTP 路径；不在此复述。接入清单（节选）：
- 鉴权 / 单向 RPC / 长连接 / 连接代际 / 会话事件流 / 历史分页
- 列表 / 搜索 / 投递 / 队列编辑
- 模型选择 / 取消 / Fork
- 附件读 / 通用附件下载 / 文件上传
- Job roster / Job 输出 / Job 终止
- 子会话 / Workspace

## 5. Android 对接的事实约束

- **必须实现 WebSocket** 才能消费 follow / control / job.follow / job.list。
- **Cookie 必须持久化**；首次需 `GET /?token=...` 换 Set-Cookie；launch token 由调用方（脚本/登录）一次性提供。
- **必须落在 trust fence 内**：loopback 或 trustedHosts + Origin 匹配 + sec-fetch-site 同站。
- **Assistant 流 transient**；丢失部分无补取。
- **jobs 是进程内状态**，Host 重启即丢。
- **dsh wire 上无 UserScope 字段**，OperatorPeer 是单操作者 → **多用户身份必须由后端在 RPC handler 处补齐归属**。

## 6. 证据空白（事实层明确列出）

1. **Android 原生客户端的现成绑定代码不存在**；Client 端目前是 Cordis 服务 + Web 浏览器侧 TS 实现（`packages/api/gateway/src/client/*`、`packages/api/session-controller/src/client/*`），Android 需要重写等价实现。
2. **投递事件无正式 wire 类型**；`assistant/message` 要求 source.kind = model + turn/step/stream，`user/message` 的 source 由 `MessageSourceMap` 合并扩展；要新增交付事件需要二次适配 SessionEventMap / KNOWN_SESSION_EVENT_TYPES / SessionProjectionStateMap。这与 #9 resolution "新增正式投递事件并投影为 Fairy 发言" 一致——这是**OurFairy 二次适配任务**，不是 dsh 缺漏。
3. **jobs 与 schedule 的边界**：schedule 任务由保存的 sessionId 调 `resolveAgent + followup + flush`（不依赖原手机连接），与 jobs 不同；首版两者都纳入但 wire 上无显式调度任务类型与 jobs 区分。
4. **多用户身份在 wire 上的字段**：OperatorPeer 是单操作者；用户上下文必须由后端在 RPC handler 处补齐归属（不依赖现有 fence 字段）。

## 7. 与 grilling #10 的接口

- **#9 resolution 已收束**的二次适配面与本文 §6 完全对应：投递事件、归属接线都是 OurFairy 任务。
- **客户端**：Android 必须实现 WebSocket；Assistant 流不能信任持久化（仅当前 revision 内的 baseline 续）；jobs 按字节 offset 续拉；多用户身份服务端补齐。
- **不需要再 grill**的事实：传输协议、jobs 模型、客户端去重机制、断线补取方式（按事实即可）。
- **仍要 grill**的事实：①通知粒度（哪些事件类别走系统通知）；②后台权限引导策略；③长任务状态/通知接续；④投递消息 vs 普通消息的 UI 可识别性。
