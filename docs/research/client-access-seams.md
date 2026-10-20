> 2026-10-20 状态：已被 #26、#28、#29、#38 取代。本文记录 2026-10-14 的判断，不描述当前实现。

# 客户端接入、认证与 HTTP/WS 载体接缝地图（#26 / #28 / #29 / #38）

基线：dsh 与 rikkahub 的上游提交见[研究基线](README.md)；测量时两者的检出分支均为 `product/ourfairy-v1`，工作区干净，只读核实后未改动任何文件。
产出票：#26（邀请码注册/登录/单 APK 身份入口）、#28（远程对话/完整回复/显式停止）、#29（断线继续与历史补齐）、#38（后台通知）。
方法：只读源码实读 + 4 条定向测试实跑（§7 有原始输出）。
证据等级：**实读**＝本人在该检出上打开并引用了原文；**实测**＝本回合实际执行的命令与输出；**未验证**＝未确认，不得当结论使用。

> 全文回答一个问题：**一个多用户产品要复用 dsh 的 HTTP/WS 载体，需要在哪里接、改哪里。**
> 一句话结论：**载体与流式协议可以整体复用；缺的只有"调用者是谁"这一件事，而它恰好卡在唯一的 admission 闸门上（§2、§10-R1）。**

---

## 0. 与既有研究的差异（先读这一节）

对照 `docs/research/v1-client-contract.md`（下称「既有研究」）。既有研究的**方向结论仍然成立**（unary 是 HTTP、stream 是 WS、需要产品 Adapter 完成多用户授权），但它的 seam 清单存在一处重大遗漏与多处行号漂移。与同批次 `dsh-ownership-seams.md` 的 D1–D10 是不同层面（那篇讲会话归属与格式，这篇讲载体与认证），两者不重叠。

| # | 既有研究的说法 | 实测结果 | 影响 |
| --- | --- | --- | --- |
| **S1** | **[D14]「`rpc-host.ts:106` 的 RPC admission 是同一 operator」——只说了结论，没有说认证从哪来** | **重大遗漏。dsh 已经有完整的浏览器会话认证链路，研究完全没有提及**：`packages/client/connection/src/browser-auth.ts` 提供 ① 进程级 launch token（`browser-auth.ts:52-58` 的 `PROCESS_LAUNCH_TOKENS` WeakMap）② `GET /?token=` 兑换 303 + `Set-Cookie`（`browser-auth.ts:250-292`）③ 按 authority 派生 cookie 名 `dsh-auth-<b64url(sha256(authority))>`（`:107-109`）④ 值形如 `v1.<payload>.<hmac-sha256>`（`:137-140`）⑤ 属性 `Max-Age; Path=/; Expires; HttpOnly; SameSite=Strict`（TLS 时加 `Secure`）（`:129-131`）⑥ **签名密钥经 `credentials.modifyRecord` 持久化**（`:169-186`），因此 cookie **跨 dsh 进程重启仍然有效**。 | #26 的工作**不是「从零加认证」**，而是「把已有的单操作者认证泛化成多 principal」。这直接改变 #26 的工作量与风险面：可复用的是 cookie 生命周期/签名/持久 secret 这套机制，必须新增的是凭据种类与 principal→PeerScope 的映射。 |
| **S2** | 「HTTP RPC、WS upgrade/stream open、Fetch/upload/download 必须一致传入授权 Module」 | **需修正定性**。`packages/client/connection/src/api-request-trust.ts:12` 原文：**"Binding policy belongs to the webserver config; this fence never establishes identity."** 该栅栏只做 Host/Origin 反 DNS-rebinding/反跨站（`:121-151`），401 来自 `BrowserAuth.isAuthenticated`，两者都在 `admit` 内（`rpc-host.ts:107-117`）。 | 「一致传入授权 Module」的**唯一现成插入点是 `admit`**，不是每个入口各接一次。这反而更简单：改一处，unary 与 WS upgrade 同时生效（§2 表、§9 路线 A）。 |
| **S3** | [D14] 行号 `rpc-host.ts:106` | 行号漂移 ±1。`:106` 是 `requestRejection` 的**文档注释**；真正的栅栏+认证在 `:107-111`，`admit` 在 `:114-117`。 | 实施时以本文行号为准。 |
| **S4** | [D15]「gateway 载体 `packages/api/gateway/src/index.ts:233`」 | 行号漂移。`:233` 是 `constructor(ctx, config)`；gateway 的**载体挂载**实际在 `:240-246`（unary 拦截器注册）与 `:248-263`（WS upgrade 路由）。WS 路径常量的定义在 `packages/api/gateway/src/stream-protocol.ts:7`，不在 `index.ts`。 | 同上。 |
| **S5** | [D16]「`packages/api/session-controller/src/commands.ts:307` prompt/attachment/cancel」 | **两个问题**：① `:307` 是 `prompt` 的文档注释，方法体在 `:311`；② `commands.ts` 只是**实现**，`@Remote` 端点声明在 `packages/api/session-controller/src/index.ts`（`prompt` 在 `:441`、`cancel` 在 `:472`）。attachment 的 `@Remote` 在 `index.ts:452`。 | 找"客户端能调什么"要看 `index.ts` 的 `@Remote` 表，不是 `commands.ts`。 |
| **S6** | [D7]「`packages/api/job-controller/src/types.ts:18` job 观察 types」 | 行号漂移。`:18` 是空行；`JobListRequest` 在 `:15-17`、`JobListFrame` 在 `:24-27`、`JobKillRequest` 在 `:30-34`、`JobFollowRequest` 在 `:49-60`。 | 同上。 |
| **S7** | [D1]「`packages/api/session-controller/src/types.ts:478` follow/page 与 assistant wire types」 | 行号漂移 ±1：`:478` 是注释，`SessionPageRequest` 在 `:479-492`，`SessionFollowRequest` 在 `:495-499`，assistant baseline 族在 `:501-551`，`SessionFollowFrame` 在 `:560-571`。 | 同上。 |
| **S8** | 研究提到「可信 principal 在登录 admission 产生」 | **今天不存在这个产物**。`admit` 恒定返回 `{ peer: this.operator }`（`rpc-host.ts:114-117`），`operator` 是每个 Connection 实例一个的 `OperatorPeer`（`rpc-host.ts:65`、`operator-peer.ts:18-27`）。`PeerScope` 的类型文档明说 **"Who the Peer is and what it may do are not recorded here."**（`packages/typert/protocol/src/types.ts:380-388`）。 | 「登录 admission 产生 principal」是**要做的事**，不是已有事实。 |

---

## 1. HTTP unary 与 WS stream 的真实入口

### 1.1 通道与路径

| 项 | 位置 | 事实（实读） |
| --- | --- | --- |
| 共享通道前缀 | `packages/client/connection/src/api-path.ts:6` | `export const API_PATH = '/api'` |
| unary 路由挂载 | `packages/client/connection/src/index.ts`（`apply` 内 `ctx.inject(['webServer'], …)` 块） | `WebRoute { kind: 'prefix', path: API_PATH }`；handler 先 `connection.admit(req)`，被拒则 `writeHead(401/403)` + `'unauthorized'`/`'forbidden'`，否则 `webCtx.waterfall('connection/request', req, res, () => bridge(req, res, fetchHandler, maxRequestBodyBytes))` |
| 逻辑端点 → 物理路径 | `packages/client/connection/src/rpc-host.ts:286-295`（`endpointFromPath`） | `/api/<namespace>/<method>`，段字符集 `^[A-Za-z0-9_$.-]+$`，禁止空段与 `.`/`..` |
| 自定义整通道 | `packages/client/connection/src/rpc-host.ts:184-196` | `rpc.handle(channel, handler)` 注册 `kind:'prefix'` 的 `WebRoute`；通道名必须匹配 `^/[A-Za-z0-9._~-]+$` 且**不能是 `/api`**（`rpc-host.ts:320-324` `assertChannel`） |
| WS 多路复用路径 | `packages/api/gateway/src/stream-protocol.ts:7` | `export const REMOTE_STREAM_MUX_PATH = '/api/remote.mux'` |
| WS 升级路由 | `packages/api/gateway/src/index.ts:248-263` | `WebUpgradeRoute { path: REMOTE_STREAM_MUX_PATH }`；handler 内 `admit(req)` → `rejectRemoteStreamUpgrade(socket, admission.rejection)` 或 `mux.handleUpgrade(req, socket, head, admission.peer)`（`:259`） |
| Gateway 内部端点 | `packages/api/gateway/src/stream-protocol.ts:10,13` | `$events`（客户端事件流）、`$events/result`（unary 回执） |

**结论**：unary 与 stream **不是两条独立通道**，而是同一 `/api` 前缀下的两种物理载体（HTTP POST / WebSocket upgrade），并且**共用同一个 `admit`**。这是本报告最重要的结构性事实。

### 1.2 消息编解码

| 方向 | 形状 | 位置 |
| --- | --- | --- |
| 客户端请求信封 | `{ type: 'client-request', rpcId, method, payload }` | `packages/client/connection/src/client/rpc.ts:40-45`（构造）、`packages/client/connection/src/rpc.ts:80-85`（类型） |
| 服务端响应信封 | `{ type: 'server-response', rpcId, result }`，`result` 为 `{ok:true,value}` 或 `{ok:false,error:{code,message,details}}` | `packages/client/connection/src/rpc-host.ts:301-305`、`packages/client/connection/src/rpc.ts:88-92`、`:19-28` |
| 请求体传输 | HTTP `POST`，`content-type: application/json`（必须；否则 **415**） | `packages/client/connection/src/client/rpc.ts:49-57`；服务端校验 `rpc-host.ts:241-244` |
| method ↔ endpoint 一致性 | 服务端强制 `message.method === endpoint`，否则 `gateway/bad-request` | `packages/client/connection/src/rpc-host.ts:258-264` |
| 相关性 | 客户端生成 `rpcId`（`randomUuid`），服务端原样回显；客户端校验不匹配即抛错 | `client/rpc.ts:39,66-68` |
| 二进制/附件响应 | 有 attachments 时响应改为 `multipart/form-data`：`metadata` 部分放 JSON，`bytes-<n>` 部分放字节，JSON 内以 `null` 占位 + `path` 定位 | `rpc-host.ts:306-317`（编码）、`client/rpc.ts:83-139`（解码） |
| 流式帧（WS） | 客户端发 `{ type:'open', streamId, endpoint, payload:{args:{}} }`；服务端帧用 `parseRemoteStreamServerMessage` 解，按 `frame.streamId` 归属，`frame.type === 'item'` 取 `frame.value`，其他类型视为流结束 | `apps/desktop/src/account-backend.ts:107-109`、`:114-123`（实读的生产先例） |
| 心跳 | WebSocket Ping 控制帧；`MAX_MISSED_HEARTBEATS = 2` 后终止 | `packages/api/gateway/src/stream-server.ts:35`、`:72-90` |

### 1.3 监听与配置

| 项 | 位置 | 事实（实读） |
| --- | --- | --- |
| HTTP/HTTPS 服务 | `packages/host/webserver/src/index.ts:261`（`class WebServer extends Service`） | 基于 `node:http` `createServer` / `node:https` `createSecureServer` |
| 绑定配置 | `packages/host/webserver/src/index.ts:76-97` | `Config { host, port, tls?, compression, compressionLevel, compressionThresholdBytes }`；`host` 用 `isIP + ipaddr` 解析，**只接受具体 IP 字面量**，`:263-271` 明确拒绝 unspecified/`0.0.0.0` 通配绑定 |
| 端口默认 | `packages/bundle/web-app/cordis.patch.yml`（webserver 行） | `port: !!js ctx.webStartup.port ?? 3080`；`host: !!js ctx.webStartup.host ?? '127.0.0.1'`；`tls: !!js ctx.webStartup.tls` |
| gateway 行 | `packages/bundle/base/cordis.patch.yml:52` | `typert-gateway` = `@deepseek-ai/dsh-api-gateway`（另有 `:46` typert、`:49` typert-loader、`:120` credentials） |
| connection 行 | `packages/bundle/web-app/cordis.patch.yml`（connection 行） | `@deepseek-ai/dsh-client-connection`，`inject: [webStartup]`，`trustedHosts: !!js ctx.webStartup.trustedHosts` |
| 应用就绪门 | `packages/api/gateway/src/index.ts:264-277` | 有 `appReady` 时 WS 路由延迟到 `ready.onReady()` 才注册（避免旧页面抢连新 Host） |

---

## 2. admission 与 principal

### 2.1 今天如何确定请求者

| 层 | 位置 | 事实（实读） |
| --- | --- | --- |
| ① Host/Origin 信任栅栏 | `packages/client/connection/src/api-request-trust.ts:121-151` | `isTrustedApiRequest(request, trustedHosts, bindHost?, protocol='http:')`：Host 必须是 loopback（`:138` 前段）、或 `trustedHosts` 匹配（`:139`）、或监听器自己的 bind IP（`:140` + `:105-111`）；`sec-fetch-site: cross-site` 直接拒（`:143`）；有 `Origin` 时必须与 Host 同 authority（`:148-150`）。**模块文档 `:12` 原文：「this fence never establishes identity」** |
| ② 浏览器会话认证 | `packages/client/connection/src/browser-auth.ts:300-313` | `isAuthenticated(request, secure)`：取 `cookie` 中 `dsh-auth-<hash(authority)>`（`:107-109`、`:304`），HMAC 验签（`:150-152`）、校验 `payload.authority === authority`（`:307`）、`issuedAt <= now < expiresAt` 且寿命不超过 `maxAgeDays`（`:308-312`） |
| 令牌来源 | `browser-auth.ts:52-58`、`:231-235` | 进程级随机 launch token（`PROCESS_LAUNCH_TOKENS` WeakMap，按 process owner 缓存）；`authenticatedUrl()` 把它作为唯一 query 参数拼到应用 URL |
| 兑换 | `browser-auth.ts:250-292` | 仅 `GET /` 且单 token 时：303 到 `./` + `Set-Cookie`；已有有效 cookie 时同样 303；否则 401（`:315-323` 写 `'dsh web authentication required; reopen the URL printed by dsh web.'`） |
| 签名密钥持久化 | `browser-auth.ts:169-186` | `credentials.modifyRecord(AUTH_RECORD_KEY, …)` 首次创建 `{kind:'grant', payload:{version:1, secret}}`；`AUTH_RECORD_KEY = credentialKey('client-connection','browser-session')`（`:12`）。**实测证据见 §7 第 4 条：重启后 token 变化但旧 cookie 仍 200，且 `.credentials.yaml` 权限 0600** |
| ③ 唯一 admission | `packages/client/connection/src/rpc-host.ts:107-117` | `requestRejection` = 栅栏（403）+ 认证（401）；`admit` = 通过则 **`{ peer: this.operator }`**，否则 `{ rejection }` |
| ④ operator 本体 | `packages/client/connection/src/rpc-host.ts:65`、`:83`；`operator-peer.ts:18-27` | 每个 `HostConnectionService` 实例一个 `OperatorPeer`，`id = randomUUID()`，`ctx` 来自 `createScope(owner, this)`（`operator-peer.ts:25-26`），`dispose()` 随 Connection 生命周期（`rpc-host.ts:84` `ctx.effect(() => () => this.operator.dispose())`） |
| ⑤ peer 传递 | `packages/client/connection/src/rpc.ts:127-132` | `ConnectionRpcHandler = (endpoint, payload, signal, peer) => …`，文档原文：**"`peer` is the Peer the request was admitted as: the operator."** |
| ⑥ peer 落到方法 | `packages/api/gateway/src/index.ts:722` | `request.peer ?? this.operatorPeer()` 传给 `GatewayInvocation`（`:1308`），方法内可读 `this.ctx.invocation.peer`（`packages/typert/protocol/src/types.ts:397-400`）；无 connection 时回退到 `inProcessOperator ??= new OperatorPeer(this.ctx)`（`:471`） |

### 2.2 关键空白：peer 管道已通，但**无人消费**

`packages/typert/protocol/src/types.ts:397-400` 已把 `peer` 放进 `RemoteInvocation`，`gateway/src/index.ts:722` 已把它注入 invocation。但对全仓 `packages/` 搜索 `ctx.invocation` / `invocation.peer` / `RemoteInvocation` 后，**除类型定义、gateway 自身与 `operator-peer.ts:4` 的注释外，没有任何生产代码读取 `invocation.peer`**（实读 grep 结果）。

**这意味着**：#28 需要的"按用户限定范围"的**下行管道已经铺好**，缺的是 ① 上游 admission 产出真实 principal，② 各方法真的去读它。这是本报告对 #26/#28 最有价值的结论（见 §9）。

### 2.3 需要 principal 的入口全表

| # | 入口 | 位置 | 今天如何拿到请求者 | 缺口 |
| --- | --- | --- | --- | --- |
| 1 | unary HTTP `/api/*` | 唯一调用点 `packages/client/connection/src/index.ts:147`（`connection.admit(req)`） | cookie → 恒定 `operator` | `admit` 需返回 per-principal peer |
| 2 | WS upgrade `/api/remote.mux` | 唯一调用点 `packages/api/gateway/src/index.ts:254`（`webCtx.connection.admit(req)`） | 同上；peer 经 `:259` 传给 `mux.handleUpgrade` | 同上 |
| 3 | 每个逻辑 stream open | `packages/api/gateway/src/stream-server.ts:72-83` | **peer 在 upgrade 时一次性固定**，socket 上所有 stream 共用 | 一个 socket 一个 principal；换账号必须重连（`stream-server.ts` 文档：「Every stream the socket opens speaks for the Peer admitted at upgrade, and the socket closes when that Peer's scope is disposed」） |
| 4 | 精确 Fetch 路由 | `packages/client/connection/src/rpc.ts:144-153`；`rpc-host.ts:144-156` | **签名里完全没有 peer**：`fetch: (request: Request) => Promise<Response>`（`rpc.ts:152`） | 需扩展签名，或 handler 内自行解析凭据 |
| 5 | 上传 | `packages/client/file-upload/src/index.ts:72`（`ctx.connection.fetch.register({path: FILE_UPLOAD_PATH, …})`） | 走 #4 | 同 #4 |
| 6 | 下载 / 媒体读取 | `packages/api/session-controller/src/media-references.ts:70`；`packages/client/ui-deliverables/src/present-open.ts:21,26,40`（3 条路由） | 走 #4 | 同 #4 |
| 7 | 会话列表 / 控制流 | `@Remote` `list`（`session-controller/src/index.ts:259`）、`control`（`:557`）等 | 无 principal 形参；方法内可读 `invocation.peer` 但今天恒为 operator | 方法内读 `invocation.peer` 做过滤 |
| 8 | 任务 roster / 观察 / 停止 | `job-controller/src/index.ts:75,90,109` | 同 #7 | 同 #7 |
| 9 | index / 静态资源 | `packages/host/frontend-static/src/index.ts:24-27,109-139`（`inject: ['webServer','connection']`，占 fallback seat） | `authorizeIndex`（`rpc-host.ts:122-124`） | 静态资源本身不需 principal |

**注意 #1 的派生结论**：`/api` 是**整条前缀**先 `admit` 再进 bridge（`packages/client/connection/src/index.ts`），所以**任何挂在 `/api` 下的端点（包括 exact fetch route，其 `assertFetchRoute` 要求路径在 `/api` 之下：`rpc-host.ts:326-336`）都无法在未认证时到达**。→ #26 想要一个"未登录也能访问的登录端点"，**必须改 admission**（见 §10-R1）。

### 2.4 一个容易误用的扩展点

`packages/client/connection/src/index.ts` 声明了 waterfall 事件 `connection/request`（文档：「Admit or wrap an authenticated shared API request, including body transfer」）。但它的调用位置在 `admit` **之后**：

```ts
const admission = connection.admit(req)
if ('rejection' in admission) { res.writeHead(...); res.end(...); return }
await webCtx.waterfall('connection/request', req, res, () => bridge(req, res, fetchHandler, requestBodyBytes))
```

→ 产品**不能**用它给未认证请求放行或建立身份；它只能在已认证流量上做包装/审计。全仓未找到该事件的生产 listener（**未验证**其"wrap"语义能否改写响应）。

---

## 3. 可复用的方法面

### 3.1 session-controller（`@Remote` 声明在 `packages/api/session-controller/src/index.ts`）

| 方法 | 行 | 真实签名（实读） | wire 请求 / 响应（`src/types.ts`） | 复用判定 |
| --- | --- | --- | --- | --- |
| `list` | `:259` | `async list(_request: SessionListRequest, signal): Promise<SessionListValue>` → `{ items: await this.listState.list(signal) }` | — | **必须适配**：直接返回 `ctx.sessions.list()` 全集，无 caller 范围 |
| `search` | `:270` | `search(request: SessionSearchRequest, signal): Promise<SessionSearchValue>` | — | **必须适配** |
| `create` | `:280` | `create(request: SessionCreateRequest): Promise<SessionCreateValue>` | — | 直接复用（归属由新产品字段承担，见 #25/#27） |
| `selectModel` | `:290` | `selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue>` | — | 必须适配（会话资格） |
| `initializeDefaultModel` | `:299` | `async initializeDefaultModel(): Promise<void>` | — | 可直接复用（无会话寻址） |
| `modelCatalog` | `:317` | `modelCatalog(): Promise<ModelCatalog>` | — | 可直接复用 |
| `canOpenWorkspacePath` | `:326` | `canOpenWorkspacePath(): boolean` | — | 首版 Android 不需要 |
| `openWorkspacePath` | `:347` | `async openWorkspacePath(request, signal): Promise<SessionOpenWorkspacePathValue>` | `types.ts:388-399` | 首版 Android 不需要 |
| `workspacePathApplications` | `:377` | `async workspacePathApplications(request: {path}, signal)` | — | 首版 Android 不需要 |
| `rename` | `:410` | `rename(request: SessionRenameRequest): Promise<SessionRenameValue>` | — | 必须适配 |
| `fork` | `:422` | `async fork(request: SessionForkRequest): Promise<SessionForkValue>` | `{sessionId}`（`:333-335`） | 必须适配；**且 `fork()` 不继承归属**（见 `dsh-ownership-seams.md` §1） |
| `prompt` | `:441` | `prompt(request: SessionPromptRequest, signal): Promise<SessionPromptValue>` | `types.ts:338-346` `{requestId, sessionId, mode:'queue'\|'steer', content: readonly PromptContentPart[], clientTimeZone?}` → `types.ts:349-351` `{accepted: true}` | **#28 核心，可直接复用协议**；归属需适配 |
| `attachment` | `:452` | `attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue>` | `types.ts:354-363` `{sessionId, attachmentId}` → `{attachment, data}` | 必须适配（越权面） |
| `updateQueue` | `:462` | `updateQueue(request: SessionUpdateQueueRequest): Promise<SessionUpdateQueueValue>` | `types.ts:366-375` | 必须适配 |
| `cancel` | `:472` | `cancel(request: SessionCancelRequest): SessionCancelValue`（**同步**） | `types.ts:378-385` `{sessionId}` → `{accepted:true}` | **#28「显式停止」直接复用**；归属需适配 |
| `page` | `:483` | `page(request: SessionPageRequest, signal): Promise<SessionPage>` | `types.ts:479-492` `{address, throughSeq, beforeSeq?, maxMessages?, turnWindow?}` → `types.ts:554-557` `{records, hasMore}` | **#29 补齐工具，直接复用** |
| `follow`（stream） | `:495` | `follow(request: SessionFollowRequest, signal): AsyncIterable<SessionFollowFrame>` | `types.ts:495-499` `{address, maxMessages?, turnWindow?, assistantStream?: true}` → `types.ts:560-571` `snapshot \| SessionEventEntry \| {type:'assistant-stream', frame}` | **#28/#29 核心，直接复用** |
| `projections` | `:506` | `async projections(request, signal): Promise<SessionProjectionsValue>` | — | 可直接复用 |
| `control`（stream） | `:557` | `control(signal): AsyncIterable<SessionControlFrame>` | `types.ts:587-589` `{type:'baseline', value} \| {type:'projection'} & SessionProjectionUpdate` | **#38 活动/通知依据，直接复用** |

**assistant baseline 的真实形状（#28/#29 的关键 wire types，`types.ts:501-571`）**：

- `SessionAssistantStreamAttempt { attemptId, startedAfterSeq, turn, step, nextIndex, stream }`（`:502-512`）
- `SessionAssistantStreamBaseline { revision, activeAttempt? }`（`:515-518`）
- `SessionAssistantStreamFrame` 三态（`:521-551`）：`start {attemptId, revision, startedAfterSeq, turn, step}` / `chunk {attemptId, revision, index, time, chunk}` / `end {attemptId, revision, index, outcome}`，其中 `outcome` 为 `{kind:'committed', eventType:'assistant/message'|'assistant/attempt', seq}` 或 `{kind:'abandoned'}`
- `SessionFollowFrame` 的 `snapshot` 携带 `header`、`cursor`、`records`、`hasMore`、`projections`、可选 `assistantStream`（`:560-569`）

→ 这与既有研究 D1/D2/D4 描述的「snapshot 截点 + nextIndex/revision 连续性 + committed end(seq) 对账」**完全一致**，可以放心按其恢复算法实现 #29。

### 3.2 job-controller（`packages/api/job-controller/src/index.ts`）

| 方法 | 行 | 真实签名 | wire types（`src/types.ts`） | 复用判定 |
| --- | --- | --- | --- | --- |
| `list`（stream） | `:75` | `list(request: JobListRequest, signal): AsyncIterable<JobListFrame>` | `:15-17` `{sessionId}` → `:24-27` `{type:'rows', jobs: readonly JobView[]}` | **必须适配**：文档 `:19-23` 明说可见集是「its own jobs **plus every unowned job**」，多用户下 unowned 语义需重定义 |
| `follow`（stream） | `:90` | `follow(request: JobFollowRequest, signal): AsyncIterable<JobFollowFrame>` | `:49-60` `{sessionId?, jobId, from?}` | 直接复用；`sessionId` 省略时表示观察 unowned job（多用户下需收紧） |
| `kill` | `:109` | `kill(request: JobKillRequest): JobKillValue` | `:30-34` `{sessionId, jobId}` → `:37-39` `{outcome:'requested'\|'already-finished'}` | 直接复用协议；owner fence 是 `jobs.get(jobId, sessionId)`，错误 `job/not-found`（`:44`） |

### 3.3 可直接复用 vs 必须适配（汇总）

| 类别 | 内容 |
| --- | --- |
| **可直接复用（协议/语义与调用者无关）** | prompt 的必填校验与 receipt 语义；page 的 `throughSeq/beforeSeq/turnWindow` 向后分页；follow 的 cursor + assistant baseline 的 `revision`/`index` 连续性；cancel 的 receipt；job follow 的字节偏移 `from`；job list 的**整集替换**语义（重连首帧即真相）；job kill 的 owner fence 与 `job/not-found` 形状 |
| **带单操作者假设、必须适配** | 所有以 `sessionId` 为唯一寻址、不含 caller 身份的方法：`list` / `search` / `selectModel` / `rename` / `fork` / `prompt` / `attachment` / `updateQueue` / `cancel` / `page` / `follow` / `projections` / `control` / `job.*`。其中 `list`（`index.ts:261` 返回全集）与 `job.list`（含 unowned）是**默认越权**，不是"忘了过滤" |
| **首版 Android 不需要** | `openWorkspacePath`、`workspacePathApplications`、`canOpenWorkspacePath`（Host 桌面能力） |

---

## 4. `packages/host` 提供什么

`packages/host/` 是**目录分组**而非单一包，含 9 个子包：`directory-picker`、`directory-picker-auto`、`directory-picker-browse`、`directory-picker-native`、`frontend-static`、`open-in-app`、`plugin-inventory`、`product-telemetry-otel`、`webserver`。其中只有两个与载体相关：

| 能力 | 位置 | 事实（实读） |
| --- | --- | --- |
| HTTP/HTTPS 服务器与生命周期 | `packages/host/webserver/src/index.ts:261`（`class WebServer extends Service`，仅 `index.ts` + `injections.ts` 两个源文件） | 基于 `node:http`/`node:https`；只接受具体 IP 绑定（`:263-271` 拒通配） |
| 路由注册 | `packages/host/webserver/src/index.ts:47` `WebRoute { kind: 'exact'|'prefix', path, handler }` | `webServer.register(route)` 返回 disposer |
| 升级注册 | `packages/host/webserver/src/index.ts:56` `WebUpgradeRoute` | `webServer.registerUpgrade(route)`；由 WebServer 做协议协商后把 socket 交给 handler |
| index 注入 | `packages/host/webserver/src/injections.ts`；事件 `webserver/index-inject` | Connection 用它注入 `__DSH_CONNECTION_RECOVERY__` |
| 静态资源 fallback | `packages/host/frontend-static/src/index.ts:24-27`、`:109-139` | `name='frontend-static'`，`inject=['webServer','connection']`，占 webserver 的 **fallback seat** 服务构建后的前端目录；非 GET/HEAD 且无匹配命名路由时 405 |
| TLS 配置 | `packages/host/webserver/src/index.ts:68` `TlsConfig` | 经 `Config.tls` 传入 |

**产品装配要不要挂它**：**要**。
- HTTP/WS 载体本身由 `webserver` + `connection` + `typert-gateway` 三行提供（§1.3），产品**不应**自建第二个 HTTP 服务器。
- 产品 profile 需要负责的是：`webserver` 的 `host`/`port`/`tls`（通常来自 `webStartup`）、`connection.trustedHosts`（**必须包含产品对外 authority**，否则非 loopback 的 Android 请求一律 403，见 `api-request-trust.ts:138-140`）、以及按需覆盖 `frontend-static`（Android 首版不需要浏览器前端，可以不下发 dist）。
- 注意 `packages/host/webserver` 的 `Config.host` **不能是通配地址**，容器/云端署要显式给具体 IP 或经 `webStartup` 注入。

---

## 5. 产品自定义路由/方法的扩展点

dsh **提供**注册自定义 unary 方法/路由的机制，共 5 种。**身份模块不需要自带 HTTP 层**。

| # | 机制 | API 位置 | 能做什么 | 先例 | 拿得到调用者身份吗 |
| --- | --- | --- | --- | --- | --- |
| **A** | `@Remote` 服务方法 | `packages/typert/protocol/src/index.ts:149`（`bindTypertRemote`）、`:166`（`TypertRemoteService`）、`:198-208`（`Remote` 装饰器，支持 `@Remote` / `@Remote('name')` / `@Remote({mode:'stream'})`） | 自定义 unary **与** stream 方法，wire 端点 = `<namespace>/<exportName>`；由 gateway 的 `collectSrcClaims`（`packages/api/gateway/src/index.ts:335-349`）遍历 `ctx.reflect.props` 里带 `typertRemote` 绑定的 service 自动认领 | `packages/api/account-controller/src/index.ts:10-13`（`super(ctx,'accountController',{namespace:'account'})`，含 `startSignIn`/`cancelSignIn`/`signOut` 等，**最接近 #26 的先例**）；`packages/api/job-controller/src/index.ts:43,59`；`packages/experimental/api-speech-to-text/src/index.ts:28,36`（`namespace:'speech'`）；测试 fixture `packages/api/gateway/tests/gateway.host.spec.ts` 的 `GoalService`（`bindTypertRemote(this,'goals')` + `@Remote create(...)`） | handler 第 4 参恒为 operator（`rpc.ts:127-132`）；但**方法内可读 `this.ctx.invocation.peer`**（`types.ts:397-400`，管道见 §2.2） |
| **B** | 精确 Fetch 路由 | `packages/client/connection/src/rpc.ts:144-153`（`ConnectionFetchRoute`）、`:162`（`HostConnectionFetch.register`） | 注册 `/api` 之下的**精确路径**，限 `GET`/`HEAD`/`POST`（`:138`），可选 `requestBody: 'buffered'\|'streaming'`；用于非 JSON 信封的端点 | `packages/client/file-upload/src/index.ts:72`；`packages/api/session-controller/src/media-references.ts:70`；`packages/client/ui-deliverables/src/present-open.ts:21,26,40` | **不能**：`fetch: (request: Request) => Promise<Response>` 无 peer 形参（`rpc.ts:152`） |
| **C** | 自有 RPC 通道 | `packages/client/connection/src/rpc.ts:173-176`（`HostConnectionRpc.handle(channel, handler)`） | 注册整条 `/<channel>` 前缀通道（非 `/api`），走与 `/api` 相同的信封与 admission | **未找到生产使用者**（未验证） | 同 A（handler 收 peer） |
| **D** | `/api` 拦截器 | `packages/client/connection/src/rpc.ts:185-189`（`intercept('/api', matches, handler)`）；唯一性检查 `rpc-host.ts:217-220` | 按 endpoint 匹配器认领 `/api` 上的端点；未认领则落回 404 | `packages/api/gateway/src/index.ts:240-246`（**唯一生产使用者就是 gateway 自己**） | 同 A |
| **E** | 请求中间件（waterfall） | `packages/client/connection/src/index.ts` 的 `connection/request` 事件声明 | 「Admit or wrap an authenticated shared API request, including body transfer」 | **未找到生产 listener**；且**在认证之后**才到达（§2.4） | 不适用（拿不到 peer，且不解决身份） |

**结论**：
1. #26 的身份端点用 **A** 即可（`namespace:'identity'`，形如 `identity/createInvite`、`identity/register`、`identity/signIn`、`identity/verify`），先例是 `account-controller` 的 `namespace:'account'`。日常"加一个端点"在这个仓库是**廉价操作**。
2. 真正贵的不是"注册端点"，而是**端点内没有调用者身份**。A/D 的 handler 第 4 参恒为 operator；B 连 peer 都没有。→ 见 §9。
3. **但如果登录端点必须未认证可达，则 A/B/C/D 都不够**：`/api` 整条前缀先 `admit`（§2.3 注意），未认证请求到不了任何 handler。这是 #26 的硬约束。

---

## 6. 首个可用的最小链路：Android 登录 → 凭据 → 发消息 → 流式回复

目标链路：**Android 登录 → 拿到凭据 → 发一条消息 → 看到流式回复**。以下只列**装配层需要的行与自定义代码清单**，不写实现。

### 阶段 0：载体（复用，不新增）

| 序 | 要做的事 | 位置 |
| --- | --- | --- |
| 0.1 | base bundle 四行：`typert`、`typert-loader`、`typert-gateway`、`credentials` | `packages/bundle/base/cordis.patch.yml:46,49,52,120` |
| 0.2 | `webserver` 行，`host`/`port`/`tls` 来自 `webStartup` | `packages/bundle/web-app/cordis.patch.yml`（webserver 行） |
| 0.3 | `connection` 行，**`trustedHosts` 必须含产品对外 authority**（Android 不可能走 loopback） | 同上（connection 行）；判定逻辑 `api-request-trust.ts:138-140` |
| 0.4 | `api-remotes` 行（`inject: ['typertGateway']`，注册 forward 事件源） | `packages/api/remotes/src/index.ts:37,40` |
| 0.5 | `session-controller` + `job-controller` 行（#28 的方法面） | web-app patch 的对应两行 |

### 阶段 1：#26 身份（需要自定义代码）

| 序 | 要做的事 | 依据 |
| --- | --- | --- |
| 1.1 | **泛化 admission**：让 `admit` 按解析出的凭据返回对应的 principal `PeerScope`，而不是恒定 `this.operator` | `rpc-host.ts:107-117`；见 §9 路线 A |
| 1.2 | **新增凭据种类**：在 `BrowserAuth` 之外支持第二种凭据（如 `Authorization: Bearer <principal-token>`），与现有 cookie 并存 | `browser-auth.ts:300-313`（cookie 路径）、`api-request-trust.ts:121`（栅栏顺序） |
| 1.3 | **让登录端点未认证可达**：给 `admit`/`/api` 路由加显式白名单，否则 `identity/signIn` 会被 401 拦掉 | `packages/client/connection/src/index.ts`（`admit` 在 bridge 之前）；§2.3 注意 |
| 1.4 | 新增身份 Module（dsh 扩展包）：`class IdentityController extends TypertRemoteService`，`super(ctx, 'identityController', { namespace: 'identity' })`，方法 `@Remote createInvite()` / `@Remote register()` / `@Remote signIn()` / `@Remote verify()` | 机制 A；先例 `account-controller/src/index.ts:10-13` |
| 1.5 | 在 profile patch 里 `insert` 一行挂载身份 Module | `packages/bundle/web-app/cordis.patch.yml` 的 `- insert:` 段 |
| 1.6 | 凭据持久化（服务端）：邀请码/账号/凭据落库或落 `.credentials.yaml` 同类机制 | `browser-auth.ts:169-186` 是"经 credentials 持久化 secret"的现成先例 |
| 1.7 | Android 侧：凭据安全存储（rikkahub 今天**无**加密存储，见 §8） | 产品决策点，见 §10-R9 |

### 阶段 2：#28 远程对话

| 序 | 要做的事 | 依据 |
| --- | --- | --- |
| 2.1 | 归属过滤：`list` 必须过滤（今天 `index.ts:261` 返回全集）；其余会话方法在返回内容前核对 `invocation.peer` | §3.1、`types.ts:397-400` |
| 2.2 | Android 封 unary 客户端：`POST /api/<ns>/<method>`，信封 `{type:'client-request', rpcId, method, payload}` | `client/rpc.ts:40-57` |
| 2.3 | Android 连 WS：`ws(s)://<authority>/api/remote.mux`，带凭据 header；发 `{type:'open', streamId, endpoint, payload:{args:{}}}` | `apps/desktop/src/account-backend.ts:103-110` |
| 2.4 | 发消息：`session/prompt`（`{requestId, sessionId, mode:'queue', content}`）→ 拿 `{accepted:true}` | `types.ts:338-351` |
| 2.5 | 收流：`session/follow`（`assistantStream: true`）的 `snapshot` → `assistant-stream` 的 `start`/`chunk`/`end`；用 `attemptId` + `revision` + `index` 去重与接续 | `types.ts:495-571` |
| 2.6 | 停止：`session/cancel`（`{sessionId}` → `{accepted:true}`）；注意它**不**给 job 设终态 | `types.ts:378-385`；job 侧独立 `job/kill` |
| 2.7 | 任务卡片（可选，若首版要展示后台任务）：`job/list` + `job/follow` + `job/kill` | `job-controller/src/types.ts:15-60` |

### 阶段 3：#29 / #38（依赖前两阶段）

| 序 | 要做的事 | 依据 |
| --- | --- | --- |
| 3.1 | 断线补齐：#29 用 `follow` 的 `snapshot.cursor` 为补页目标 `throughSeq`，缺口用 `page` 向后读，按 `(sessionId, seq)` 去重 | `types.ts:479-499,554-571`；既有研究 D2/D3 的算法成立 |
| 3.2 | 重连基线：`assistantStream` 的 `revision`/`activeAttempt.nextIndex` 用于接续当前 attempt，不重复追加前缀 | `types.ts:502-518` |
| 3.3 | #38 活动/通知：消费 `session/control` 的 `{type:'projection'}` 帧 + job 事件，不在客户端自行扫描事件造活动 | `types.ts:587-589`；既有研究"活动与统一通知"节 |

**顺序约束（重要）**：#26 的 1.1–1.3 是 #28 的前置——没有真实 principal，2.1 的归属过滤无从下手。因此**先做 admission 泛化，再做身份 Module，最后做远程对话**。

---

## 7. 测试接缝

### 7.1 配置与 lane

| lane | 配置文件 | include | 需要先构建吗 |
| --- | --- | --- | --- |
| 单元 | `vitest.config.ts` | 各包 `tests/*.spec.ts` | **不需要**：`vite-tsconfig-paths` 经 `tsconfig.base.json` 的 `paths` 解析到 `src` |
| e2e | `vitest.e2e.config.ts` | `packages/*/*/tests/**/*.e2e.ts`、`apps/cli/tests/**/*.e2e.ts`、`apps/desktop/tests/**/*.e2e.ts` | 视用例而定（见 7.3 第 4 条） |
| web 浏览器 | `vitest.web.config.ts` | `apps/web/tests/**/*.e2e.ts` + `*.snapshot.ts` | **需要**构建后的前端 dist |

`vitest.e2e.config.ts` 关键设置（实读）：`setupFiles: ['./scripts/test-proxy-environment.ts']`、`testTimeout: 120_000`、`retry: 2`、`DSH_E2E_MAX_WORKERS` 默认 4。命令：`corepack pnpm@11.28.5 run test:e2e` / `run test:web:built`。

### 7.2 「在一个测试里启动真实 HTTP+WS 并断言」的现成模板

| 想要覆盖 | 模板 |
| --- | --- |
| 真实 HTTP + 真实 cookie 认证 + 真实 Typert gateway + 自定义 `@Remote` 服务 | `packages/api/gateway/tests/gateway.host.spec.ts`：`serveRoute(route)`（`:167-176`，真实 `createServer` + `listen(0,'127.0.0.1')`）；`browserCookie(ctx.connection, origin)`（`packages/api/gateway/tests/browser-credentials.ts`，经 `authorizeIndex` 真造 cookie）；主用例 `:1311` 起用真实 `fetch` 打 `/api/goals/create` 并断言整段 server-response 信封 |
| 真实 HTTP + 真实 WS mux | `packages/api/gateway/tests/stream-server.host.spec.ts`（真实 `createServer` + `RemoteStreamMuxServer` + `ws` 客户端，20 个用例含心跳/终止） |
| 真实 CLI 端到端（token 交换 + cookie + 跨重启） | `apps/cli/tests/web-auth.e2e.ts`（spawn 真 `dsh web`，断言 401/303/200/重启后 cookie 仍有效/`.credentials.yaml` 0600） |
| 自定义 unary 端点被 gateway 认领的单元级验证 | `packages/api/gateway/tests/gateway.host.spec.ts` 的 `collectSrcClaims` / `claimsEndpoint` 相关用例 |

### 7.3 实测命令与原始输出（本回合实际执行）

**① 真实 HTTP+WS 载体 + 浏览器认证（单元 lane，通过）**

```
$ corepack pnpm@11.28.5 exec vitest run packages/api/gateway/tests/stream-server.host.spec.ts packages/client/connection/tests/browser-auth.host.spec.ts
 RUN  v4.1.11 /home/eafen405/projects/deepseek-harness

 ✓ |thread-safe| packages/client/connection/tests/browser-auth.host.spec.ts (8 tests) 17ms
 ✓ |thread-safe| packages/api/gateway/tests/stream-server.host.spec.ts (20 tests) 1038ms

 Test Files  2 passed (2)
      Tests  28 passed (28)
   Start at  21:01:58
   Duration  1.40s (transform 331ms, setup 97ms, import 331ms, tests 1.05s, environment 0ms)

EXIT=0
```

**② 同一命令未清代理时：假失败（1 个用例红）**

```
$ corepack pnpm@11.28.5 exec vitest run packages/api/gateway/tests/gateway.host.spec.ts
     × dispatches claimed invocations through /api and leaves unclaimed endpoints to its fallback 2285ms

▒▒▒ Failed Tests 1 ▒▒▒
 FAIL  |thread-safe| packages/api/gateway/tests/gateway.host.spec.ts > TypertGatewayService > dispatches claimed invocations through /api and leaves unclaimed endpoints to its fallback
TypeError: fetch failed
Caused by: SocketError: other side closed
Serialized Error: { code: 'UND_ERR_SOCKET', socket: { localAddress: '127.0.0.1', localPort: 59627, remoteAddress: '127.0.0.1', remotePort: 7890, remoteFamily: 'IPv4', timeout: undefined, bytesWritten: 724, bytesRead: 39 } }

 Test Files  1 failed (1)
      Tests  1 failed | 46 passed (47)
   Start at  21:03:41
   Duration  3.10s (transform 468ms, setup 48ms, import 523ms, tests 2.41s, environment 0ms)

EXIT=1
```

注意 `remotePort: 7890`：请求被发到了本机 Clash 代理而不是 127.0.0.1 的目标端口。

**③ 清掉代理环境变量后同一用例全绿（本报告最强的接缝证据）**

```
$ env -u NODE_USE_ENV_PROXY -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
    corepack pnpm@11.28.5 exec vitest run packages/api/gateway/tests/gateway.host.spec.ts
 RUN  v4.1.11 /home/eafen405/projects/deepseek-harness

 ✓ |thread-safe| packages/api/gateway/tests/gateway.host.spec.ts (47 tests) 180ms

 Test Files  1 passed (1)
      Tests  47 passed (47)
   Start at  21:04:00
   Duration  886ms (transform 483ms, setup 51ms, import 549ms, tests 180ms, environment 0ms)

EXIT=0
```

这条 47 用例的 spec 覆盖：真实 HTTP 监听 → 真实 `/api` 路由 → 真实 cookie 认证 → 真实 Typert 认领与分发 → 自定义 `@Remote` 服务真实执行并回包（含 `gateway/definition-unavailable`、未认领端点 404）。

**④ 真 `dsh web` e2e：未通过，未修复（环境前置条件缺失）**

```
$ corepack pnpm@11.28.5 exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-auth.e2e.ts
 ❯ apps/cli/tests/web-auth.e2e.ts (1 test | 1 failed) 8922ms
     × rejects a forged loopback Host and preserves the browser cookie across restart 8920ms (retry x2)

▒▒▒ Failed Tests 1 ▒▒▒
 FAIL  apps/cli/tests/web-auth.e2e.ts > dsh web authentication through the real CLI > rejects a forged loopback Host and preserves the browser cookie across restart
Error: dsh web exited before readiness (1):
    Error: client-modules: client bundle not found; run `pnpm run build` before launch:
      package: @deepseek-ai/dsh-client-ui-sidebar-terminal
      path: /home/eafen405/projects/deepseek-harness/packages/client/ui-sidebar-terminal/lib/client.js
    ...
    Error: ENOENT: no such file or directory, stat '.../packages/client/ui-sidebar-terminal/lib/client.js'
    （同型错误另有 ui-sidebar-files、ui-settings 等）

 Test Files  1 failed (1)
      Tests  1 failed (1)
   Start at  21:02:25
   Duration  9.56s

EXIT=1
```

根因（实读确认）：`packages/client/*/lib` 只有 **21/63** 个存在，真 `dsh web` 在 `ClientModuleRegistry` 阶段因缺 `lib/client.js` 拒绝启动。**这是环境前置条件，不是接缝缺陷**；本回合未运行重型构建（遵守"机器有负载、不跑重型"的约束），因此该 e2e 的**状态是「未通过且未修复」**，不得当作接缝结论的否证。

### 7.4 两条环境纪律

1. **跑任何涉及真实 loopback HTTP/`fetch` 的 dsh 测试前，必须先清代理**：

   ```bash
   env -u NODE_USE_ENV_PROXY -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
     corepack pnpm@11.28.5 exec vitest run <path>
   ```

   原因：本机环境同时导出 `http_proxy=127.0.0.1:7890` 等与 `NODE_USE_ENV_PROXY=1`；Node 在**进程启动时**采样代理配置，`scripts/test-proxy-environment.ts` 的自身文档说明「A shell that exports it must unset it before running the suite」（setup 文件清不掉已生效的内建 fetch 代理）。单元 lane 没有 `setupFiles`，所以只能在外层 shell 清。不清就会得到像上面 ② 那样的**假失败**。

2. **`dsh web` 的端到端 e2e 需要先完整构建**：`corepack pnpm@11.28.5 run build`（或至少 `build:lib:client` + `build:web`）生成全部 63 个 client bundle，否则 `packages/client/modules` 的 `ClientModuleRegistry` 会拒绝启动。当前检出只有 21 个，`web-auth.e2e.ts` 因此未通过。

3. 另记：vitest 4 **无 `--reporter=basic`**（会 `ERR_LOAD_URL` 失败）；管道会吞退出码，跑门禁用 `set -o pipefail` 或看 `${PIPESTATUS[0]}`。

---

## 8. rikkahub 客户端侧

固定提交见[研究基线](README.md)（分支 `product/ourfairy-v1`，工作区干净）。

### 8.1 网络层现状：三套 HTTP 栈并存

| 栈 | 版本 | 声明位置 | 用在哪 |
| --- | --- | --- | --- |
| **OkHttp**（主力） | 5.5.0 | `gradle/libs.versions.toml:120`（`okhttp`）、`:121`（`okhttp-sse`）、`:122`（`logging-interceptor`）；`ai/build.gradle.kts:41-43`、`common/build.gradle.kts:19-21`、`app/build.gradle.kts:208-209` | 所有 LLM provider、search、speech、mediagen、MCP、oauth；**唯一共享实例见 8.2** |
| **Retrofit** | 3.0.0 | `gradle/libs.versions.toml:123-124`；`app/build.gradle.kts:210-211` | **只有两个端点**：`RikkaHubAPI` 与 `SponsorAPI` |
| **Ktor** | 3.5.2 | `gradle/libs.versions.toml:61,170-172,183`；`app/build.gradle.kts:213-217` | 客户端：S3/WebDAV 云同步（`di/DataSourceModule.kt:250-263` 的 `single<HttpClient>`）；服务端：`:web` 模块与 `:oauth` 模块的本地 Ktor server（`web/build.gradle.kts:53-65`、`oauth/build.gradle.kts:17-18`） |

JSON 统一为 **kotlinx.serialization**（`gradle/libs.versions.toml:31,135`）；**全仓无 Moshi、无 Gson**。

其他相关：`slf4j-api`/`slf4j-android`（`app/build.gradle.kts:293-294`，注释「Ktor/SLF4J logs」）；Koin 4.2.2（`:29,131-134`）；DataStore Preferences 1.2.1（`:30,116`）；Room 2.8.5（`:28`）。

### 8.2 唯一的 OkHttpClient 单例（新客户端的挂载点）

`app/src/main/java/me/rerere/rikkahub/di/DataSourceModule.kt:51` 起是**中央 DI 模块** `dataSourceModule`；其中：

```kotlin
158:    single<OkHttpClient> {
160:        val acceptLang = AcceptLanguageBuilder.fromAndroid(get()).build()
162:        java.net.Authenticator.setDefault(SettingsSocks5Authenticator(settingsStore))
172:        client = OkHttpClient.Builder()
173:            .proxySelector(SettingsProxySelector(settingsStore))
174:            .proxyAuthenticator(SettingsProxyAuthenticator(settingsStore))
175-177:        connectTimeout 20s / readTimeout 10min / writeTimeout 120s
178-180:        followSslRedirects / followRedirects / retryOnConnectionFailure = true
181-204:        .addInterceptor { ... AcceptLanguage + UserAgent ... }
205-221:        .addNetworkInterceptor { ... 归一化 Content-Type ... }
222:            .addNetworkInterceptor(RequestLoggingInterceptor())
223:            .addInterceptor(AIRequestInterceptor())
224-227:        .addInterceptor(HttpLoggingInterceptor().apply { redactHeader("Proxy-Authorization"); level = HEADERS })
229:        client.also { SearchService.init(it, get()) }
```

同模块内的既有同类单例可直接照抄结构：`SponsorAPI.create(get())`（`:232-234`）、`WebDavSync`（`:242-248`）、`single<HttpClient>`（Ktor，`:250-263`）、`S3Sync`（`:265-271`）、`RemoteFileStore`（`:273-279`）、`single<Retrofit>`（`:285-290`）、`single<RikkaHubAPI>`（`:292-294`）。

注入先例（实读）：`RouteActivity.kt:150` `private val okHttpClient by inject<OkHttpClient>()`；`ui/pages/setting/SettingPreferencesNetworkPage.kt:69`、`ui/hooks/ASR.kt:32`、`ui/pages/chat/VoiceMode.kt:44` 用 `koinInject<OkHttpClient>()`。
Koin 模块声明：`di/AppModule.kt:24`、`di/DataSourceModule.kt:51`、`di/RepositoryModule.kt:22`、`di/ViewModelModule.kt:30`。

### 8.3 既有"远程后端"这件事：**不存在**

| 项 | 位置 | 事实 |
| --- | --- | --- |
| `RikkaHubAPI` | `app/src/main/java/me/rerere/rikkahub/data/api/RikkaHubAPI.kt:3-5` | **空接口**（`interface RikkaHubAPI { }`），无任何端点。Retrofit baseUrl `https://api.rikka-ai.com`（`di/DataSourceModule.kt:286`） |
| `SponsorAPI` | `app/src/main/java/me/rerere/rikkahub/data/api/SponsorAPI.kt:11-22` | 唯一真实的 Retrofit 端点：`@GET("/sponsors")`；`companion object { fun create(httpClient: OkHttpClient): SponsorAPI }` 用 `Retrofit.Builder().client(httpClient).baseUrl("https://sponsors.rikka-ai.com").addConverterFactory(JsonInstant.asConverterFactory("application/json".toMediaType()))` |
| 账号/登录/token | 全仓搜索 | **无任何"登录/账号/后端 token"概念**；`RikkaHubAPI` 是空壳 |
| 云同步（非后端） | `data/sync/S3Sync.kt`、`data/sync/webdav/WebDavClient.kt`、`data/sync/BackupManager.kt`、`data/files/RemoteFileStore.kt` | 用户自带 S3/WebDAV 凭据的备份同步，不是产品后端 |

### 8.4 WebSocket 先例（**已存在，可直接抄**）

`speech` 模块的 ASR realtime 控制器用 OkHttp 原生 WebSocket：

| 文件 | 关键行 |
| --- | --- |
| `speech/src/main/java/me/rerere/asr/providers/DashScopeASRController.kt` | `:54` `private var webSocket: WebSocket?`；**`:88` `httpClient.newWebSocket(request, object : WebSocketListener() {`**；`:89` `onOpen`；`:101` `onMessage`；`:107` `onFailure`；`:119` `onClosed` |
| `speech/src/main/java/me/rerere/asr/providers/OpenAIRealtimeASRController.kt` | `:53`、`:86-87`、`:99`、`:103`、`:111` |
| `speech/src/main/java/me/rerere/asr/providers/VolcengineASRController.kt` | `:56`、`:92-93`、**`:108`（二进制 `onMessage(webSocket, bytes: ByteString)`）**、`:116`、`:124` |

→ 新增后端 WS 客户端**不需要引入新库**，照 `DashScopeASRController.kt:88` 的形状即可；二进制帧先例在 `VolcengineASRController.kt:108`。

### 8.5 SSE 先例

| 文件 | 关键行 |
| --- | --- |
| `common/src/main/java/me/rerere/common/http/SSE.kt` | `:16` `sealed class SseEvent`（`Open` :20 / `Event(id,type,data)` :28 / `Closed` :33 / `Failure(throwable,response)` :40）；**`:52` `fun OkHttpClient.sseFlow(request: Request): Flow<SseEvent>`**，用 `callbackFlow`（:53）+ `EventSources.createFactory`（:84）+ `awaitClose { eventSource.cancel() }`（:89） |
| `ai/src/main/java/me/rerere/ai/util/SSE.kt` | `:9-11`、`:122` |
| provider 使用者 | `ai/.../openai/ResponseAPI.kt:69-71,199`、`ai/.../openai/ChatCompletionsAPI.kt:70-72,216`、`ai/.../claude/ClaudeProvider.kt:76-78,422`、`ai/.../google/GoogleProvider.kt:75-77,334`、`ai/.../google/InteractionsAPI.kt:67-69,163`；TTS 侧 `speech/.../MiMoTTSProvider.kt:12,184`、`VolcengineTTSProvider.kt:14,59,110`、`MiniMaxTTSProvider.kt:12,79` |

（注意：dsh 的 stream 是 **WebSocket 多路复用**，不是 SSE。SSE 只是 rikkahub 现有"把流包成 `Flow`"的写法参考，不要照搬协议。）

### 8.6 会话/消息模型与发送路径

| 项 | 位置 | 形状（实读） |
| --- | --- | --- |
| 消息模型 | `ai/src/main/java/me/rerere/ai/ui/Message.kt:18` | `data class UIMessage(id: Uuid, role: MessageRole, parts: List<UIMessagePart>, annotations: List<UIMessageAnnotation>, createdAt, finishedAt: LocalDateTime?, modelId: Uuid?, modelSnapshot: ModelSnapshot?, usage: TokenUsage?, translation: String?, isContextCheckpoint: Boolean, @Transient isSynthetic: Boolean)`（`:16` 注释：公共消息抽象，具体 provider 转换为 API DTO） |
| 会话模型 | `app/src/main/java/me/rerere/rikkahub/data/model/Conversation.kt:19` | `data class Conversation(id: Uuid, …, messageNodes: List<MessageNode>, …)`（`:23`）；`:51` `currentMessages` |
| 会话运行时 | `app/src/main/java/me/rerere/rikkahub/service/ConversationSession.kt:23` | `class ConversationSession(id, initial, scope, onIdle, onGenerationFinished)`；`:31-32` `private val _state = MutableStateFlow(initial)` / `val state: StateFlow<Conversation>`；`:95` `processingStatus`；`:98-100` `generationJob`；`:44` 注释提到「页面切换和 SSE 重连」 |
| 发送入口 | `app/src/main/java/me/rerere/rikkahub/service/ChatService.kt:184`（class）、**`:386` `fun sendMessage(conversationId: Uuid, content: List<UIMessagePart>, answer: Boolean = true)`** | 内部：`sessionManager.getOrCreate(conversationId)` → `messageQueue.enqueue(content, answer)` → `dispatchNextQueuedMessage(conversationId)`；`:397` `enqueueVoiceMessage`；`:415` `dispatchNextQueuedMessage`；`:859` `generateTitle`；`:912` `generateSuggestion` |
| 生成循环 | `app/src/main/java/me/rerere/rikkahub/data/ai/GenerationLoop.kt:73` | `:67` `sealed interface GenerationChunk`；`:78` `fun generateText(settings, model, messages, inputTransformers, outputTransformers, assistant, memories, tools, maxSteps, processingStatus, conversationSystemPrompt, conversationId, workspaceCwd): Flow<GenerationChunk>`；`:420` `providerImpl.streamText(...)` |
| Provider 接口 | `ai/src/main/java/me/rerere/ai/provider/Provider.kt:17` | `interface Provider<T : ProviderSetting>`；`:18` `listModels`；`:24-28` `generateText(...): TextGenerationResult`；**`:30-34` `streamText(providerSetting, messages, params): Flow<StreamChunk>`** |

→ 「发送 → 流式回调」的现有形状是 **`Flow<GenerationChunk>`**（`GenerationLoop.kt:92` 起），远端实现最自然的接法是新增一个 provider/后端实现产出同样的 `Flow`，或在 `ChatService`/`ConversationSession` 层按 `state: StateFlow<Conversation>` 的既有约定替换数据来源。既有研究 R1–R4 关于「rikkahub 需接线到远端 StateFlow 而非保留本地执行」的判断与此一致。

### 8.7 凭据存储现状：**全仓无加密**

| 项 | 位置 | 事实 |
| --- | --- | --- |
| 加密存储 | 全仓 grep `EncryptedSharedPreferences` / `security-crypto` / `MasterKey` / `AndroidKeyStore` / `KeyStore` | **零命中**（实读） |
| API key 今天怎么存 | `ai/src/main/java/me/rerere/ai/provider/ProviderSetting.kt:26`（`sealed class ProviderSetting`）；`:66`、`:132`、`:201` `var apiKey: String = ""` | **明文**在 DataStore |
| DataStore 落盘 | `app/src/main/java/me/rerere/rikkahub/data/datastore/PreferencesStore.kt:63` | `val file = context.preferencesDataStoreFile(SETTINGS_STORE_NAME)` |

→ #26 若要求"可信身份"，需产品决策是否引入加密存储（见 §10-R9）；首版若沿用现状，等于把后端凭据与现有 API key 同等对待（明文）。

### 8.8 新增认证后端客户端应当落在哪个模块

**建议落点**：新包目录 `app/src/main/java/me/rerere/rikkahub/data/remote/`（与既有的 `data/api/`、`data/sync/`、`data/network/` 同级），并在 `di/DataSourceModule.kt` 内注册 `single<RemoteBackendClient>`（紧邻 `:158` 的 OkHttp 单例与 `:232` 的 `SponsorAPI.create(get())`）。

**最接近的 3 个结构先例**：

| 抄什么 | 文件 | 理由 |
| --- | --- | --- |
| HTTP 客户端构造 | `data/api/SponsorAPI.kt:16-22` | `fun create(httpClient: OkHttpClient)` + 复用共享 OkHttpClient 的既有形状；Retrofit 也可不用（直接 OkHttp + kotlinx.serialization 封 dsh 信封） |
| 有状态远端同步对象 | `data/sync/S3Sync.kt`、`data/sync/webdav/WebDavClient.kt`、`data/files/RemoteFileStore.kt`（均在 `di/DataSourceModule.kt:242-279` 注册） | 「远端有状态服务 + scope + 凭据 + 在 DI 内 `single`」的现成模式 |
| WebSocket 长连接 | `speech/.../DashScopeASRController.kt:54,88-124` | OkHttp `newWebSocket` + `WebSocketListener` + 二进制/文本帧处理的唯一现成先例 |

**不推荐**：把后端客户端放进 `:ai` 或 `:common` 模块。`RikkaHubAPI`/`SponsorAPI` 都在 `app` 模块的 `data/api`，`:ai` 的职责是 provider 抽象与 UI 消息模型，`:common` 是通用 HTTP 工具（`SSE.kt` 住在那里）。

---

## 9. 对 #26 / #28 的实现建议与顺序

### 9.1 两条路线

**路线 A（推荐）：扩展 admission 接受第二种凭据，返回 per-principal `PeerScope`。**

| 步 | 动作 | 位置 |
| --- | --- | --- |
| A1 | `admit` 从"恒定返回 `this.operator`"改为"按解析出的凭据返回对应 principal 的 `PeerScope`" | `packages/client/connection/src/rpc-host.ts:107-117` |
| A2 | 新增第二种凭据的解析（如 `Authorization: Bearer <principal-token>`），与现有 cookie 路径并存；cookie 仍是浏览器路径 | `browser-auth.ts:300-313` 旁路；栅栏顺序见 `api-request-trust.ts:121` |
| A3 | 维护 principal → `PeerScope` 注册表，每个 principal 一个 scope（照 `operator-peer.ts:24-27` 的 `createScope(owner, this)` 模式），被拒/登出时 `dispose()` | `packages/core/scope/src/index.ts:137`（`createScope`）、`:154`（`scopeOf`）、`:170`（`scopeTarget`） |
| A4 | 未认证白名单：让 `identity/signIn` 这类端点在未认证时可到达 | `packages/client/connection/src/index.ts`（`admit` 在 bridge 之前）；**或**另开一个不经过 `/api` 前缀的通道（机制 C，需自行做栅栏与限流） |
| A5 | 下游收益：`invocation.peer` 立即携带真实身份，`session-controller` 方法内 `this.ctx.invocation.peer` 可用于归属过滤 | `gateway/src/index.ts:722`、`typert/protocol/src/types.ts:397-400` |

**优点**：改一处（`admit`），**unary 与 WS upgrade 同时生效**（两者的唯一调用点都走它：`client/connection/src/index.ts:147`、`gateway/src/index.ts:254`）；`PeerScope` 的 `ctx` 生命周期天然可用于"会话/连接吊销"（`stream-server.ts:72-83` 文档明说 socket 随 peer scope dispose 而关闭）。
**代价**：改 dsh 公共包 `packages/client/connection`；需处理逗号/并存（浏览器 cookie + Android bearer）；exact fetch route（`rpc.ts:152`）仍无 peer，要么扩签名要么在 handler 内自行解析。

**路线 B（退路）：产品自带 HTTP 层。**

自建 HTTP 服务，自行验 token 后以固定 operator 身份调用 dsh。**缺陷**：
- `invocation.peer` 恒为 operator，服务端无法区分调用者；多用户归属只能靠"客户端填写的 `sessionId` + 产品层自查"，而这正是既有研究警告的点（「job 自带 owner fence 不代表用户拥有客户端填写的 sessionId」）。
- WS 载体要么自建，要么让 Android 直连 dsh 的 `/api/remote.mux` —— 后者仍然绕不开 admission，于是又回到路线 A。
- 每个方法入口都要重做归属校验（`list` 返回全集、`job.list` 含 unowned、`attachment`/`media-references` 走无 peer 的 fetch route）。
**适用**：仅当"不允许改 dsh 公共包"成为硬约束时使用。

### 9.2 建议顺序（有硬依赖）

| 序 | 工作 | 票 | 为什么必须在这个位置 |
| --- | --- | --- | --- |
| 1 | admission 泛化（A1–A3），**先写红测试**：同一服务两个不同凭据 → 两个不同 `PeerId`；无凭据 → 401；白名单端点未认证可达 | #26 | 这是唯一的身份闸门；不先做，后面所有归属过滤都没有输入 |
| 2 | 身份 Module（`namespace:'identity'`）：生成邀请码 / 注册 / 登录 / 校验凭据（机制 A，先例 `account-controller`） | #26 | 依赖 1；端点本身可以先以 operator 身份跑通，但"登录后拿到可用身份"依赖 1 |
| 3 | Android 侧：凭据存储 + 后端客户端骨架（`data/remote/`，`di/DataSourceModule.kt` 注册）+ unary 封包 + WS 连接 | #26 | 与 2 可并行（不同仓库） |
| 4 | 归属过滤：`session/list` 必须过滤（今天返回全集）；其余会话方法在返回内容前核对 `invocation.peer` | #28 | 依赖 1；不做则多用户默认越权 |
| 5 | 远程对话链路：`session/prompt` → `session/follow(assistantStream:true)` 的 snapshot + `start/chunk/end` → `session/cancel` | #28 | 依赖 4（否则能跨用户操作） |
| 6 | 断线补齐：`follow` 的 `snapshot.cursor` 作 `throughSeq`，缺口用 `page` 向后读并按 `(sessionId,seq)` 去重；`revision`/`nextIndex` 接续当前 attempt | #29 | 依赖 5 |
| 7 | 活动/通知：消费 `session/control` 的 `projection` 帧 + job 事件 | #38 | 依赖 6（重连期间只累积、补齐后合并发布） |

**一句话**：**先泛化 admission，再建身份，最后才是远程对话**；#28 的方法面本身几乎不用改（协议已就绪），真正的工作量在"每个方法真的去读 `invocation.peer`"和 `list` 的过滤。

---

## 10. 会阻塞 #26 / #28 的风险

| # | 风险 | 证据 | 后果 |
| --- | --- | --- | --- |
| **R1** | **`/api` 是整条前缀先 `admit` 再进 bridge，且 exact fetch route 也必须挂在 `/api` 之下** → **未认证的登录端点在当前结构下无法存在** | `packages/client/connection/src/index.ts`（`admit` 在 `waterfall`/`bridge` 之前）；`rpc-host.ts:326-336` `assertFetchRoute` 要求路径在 `/api` 下 | #26 的 `identity/signIn` 会被 401 拦掉。**必须**改 admission 或另开非 `/api` 通道——这是 #26 的硬前置，不是可选项 |
| **R2** | **exact Fetch route 的签名没有 principal** | `packages/client/connection/src/rpc.ts:152` `fetch: (request: Request) => Promise<Response>` | 上传（`file-upload/src/index.ts:72`）、媒体读取（`media-references.ts:70`）、附件打开（`present-open.ts:21,26,40`）在多用户下是越权面；必须扩签名或 handler 内自查 |
| **R3** | **WS 的 peer 在 upgrade 时一次性固定** | `packages/api/gateway/src/stream-server.ts:72-83`；`gateway/src/index.ts:259` | Android 换账号/改身份必须重连，不能在同一 socket 上切换 |
| **R4** | **`BrowserAuth` 是进程级单密钥 + authority 绑定的单一 cookie** | `browser-auth.ts:12,107-109,137-140,300-313` | 同一 authority 下所有浏览器 cookie 都是同一 principal，无法区分用户；多用户**必须**新增凭据种类，不能靠现有 cookie |
| **R5** | **`connection/request` waterfall 在认证之后** | `packages/client/connection/src/index.ts`（先 `admit` 再 `waterfall`） | 产品无法用它给未认证请求放行或建身份；也不能用它做登录端点 |
| **R6** | **`trustedHosts` 未配则非 loopback 的 Android 请求一律 403** | `api-request-trust.ts:138-140`；`:12`「fence never establishes identity」 | 装配漏配 `connection.trustedHosts` 时，Android 连不上而浏览器（127.0.0.1）正常，症状具有迷惑性 |
| **R7** | **`session/list` 今天返回 `ctx.sessions.list()` 全集** | `packages/api/session-controller/src/index.ts:259-262` | 不修则多用户越权是**默认行为**（不是"忘了过滤"，是"没有过滤所需的输入"） |
| **R8** | **`job.list` 的可见集显式包含 "every unowned job"** | `packages/api/job-controller/src/types.ts:19-23`；`index.ts:75` 文档 | 多用户下 `unowned` 语义需重新定义，否则任务 roster 跨用户泄漏 |
| **R9** | **rikkahub 全仓无加密凭据存储** | grep `EncryptedSharedPreferences`/`security-crypto`/`AndroidKeyStore` 零命中；`ai/.../ProviderSetting.kt:66,132,201` 明文 `apiKey`；`PreferencesStore.kt:63` | #26 的"可信身份"若沿用现状则是明文落盘，需产品明确接受或引入加密 |
| **R10** | **`fork()` 不继承归属** | 见 `dsh-ownership-seams.md` §1（`core/session/src/index.ts:1391-1395`） | #28/#29 的派生/子会话会丢归属，在"不默认用户 1"下会被拒 |
| **R11** | **真 `dsh web` e2e 需要完整构建**（本回合实测未通过） | §7.3 第 4 条；`packages/client/*/lib` 仅 21/63 | 不能用该 e2e 作为 #26 的验收入口，除非先跑 `run build`；且 CI/本地要预留构建时间 |
| **R12** | **本地测试环境的代理会制造假失败** | §7.3 第 2 条（`remotePort: 7890`）；`scripts/test-proxy-environment.ts` 自述 | 不清 `NODE_USE_ENV_PROXY` 会得出"接缝坏了"的错误结论；CI 上也需确认 Runner 无 ambient proxy |

---

## 11. 未验证（勿当结论使用）

1. **机制 C（`HostConnectionRpc.handle(channel, handler)`，`rpc.ts:173-176`）未找到生产使用者**。它是否适合承载产品身份通道（是否能自定义栅栏、是否能拿到 admission 之前的请求）**未验证**。
2. **机制 E（`connection/request` waterfall）未找到生产 listener**。文档称可 "wrap"，但能否改写已生成的响应体/状态码**未验证**（只确认了它在 `admit` 之后）。
3. **`packages/host/webserver` 的 index 注入渲染顺序与 `tapIndex` 语义**未逐行读（只读了 `WebRoute`/`WebUpgradeRoute`/`Config`/`WebServer` 的表面与 `injections.ts` 的存在）。
4. **rikkahub `:web` 模块（本地 Ktor server）的鉴权实现未找到**：`web/src/main/java/me/rerere/rikkahub/web/Entry.kt`（43 行）只见到 `install(Compression)`、`install(CORS){ allowHeader(HttpHeaders.Authorization) }`（`:27`）、`install(SSE)`、`install(DefaultHeaders)`，**没有 token/auth 逻辑**。是否有别处的本地 token 校验（可作为 #26 的现成先例）**未验证**。`api-remotes` 之外，`apps/desktop` 如何取得 Electron cookie 也未读。
5. **rikkahub `SettingsStore` / `PreferencesStore` 的完整字段与 DataStore 名称常量**未完整读（只确认了 `preferencesDataStoreFile(SETTINGS_STORE_NAME)` 与 `ProviderSetting.apiKey` 的存在）。
6. **`ConversationSessionManager`、`MessageQueue`、`ChatNotificationManager` 的完整行为未读**（只读了 `ConversationSession` 头部与 `ChatService.sendMessage`/`dispatchNextQueuedMessage` 的片段）。#38 的通知链路（既有研究 R4 引用的 `ChatNotificationManager.kt:44`）**本轮未复核行号**。
7. **`job-controller` 的 `observe.ts` / `view.ts` 未读**（既有研究 D8/D10 的行号未复核）。
8. **Android 侧未做任何真机/模拟器验证**；§8 全部结论均为静态阅读。
9. **dsh 是否有"给单个 principal 发事件"的现成能力未验证**：`scopeTarget(subject, peer)`（`packages/core/scope/src/index.ts:170`）与 `OperatorPeer` 的 scope 语义暗示可以按 peer 定向投递事件，但 `api-remotes` 的转发事件源（`packages/api/remotes/src/index.ts:40-90`）是否按 peer 过滤**未核实**。这对 #38「按用户范围推活动」可能关键。

---

## 12. 证据与环境（本回合实际执行）

| 项 | 值 |
| --- | --- |
| 工作目录 | `/home/eafen405/projects/OurFairy` |
| dsh 检出 | `/home/eafen405/projects/deepseek-harness`，提交见[研究基线](README.md)，分支 `product/ourfairy-v1`，`git status --porcelain` 空 |
| rikkahub 检出 | `/home/eafen405/projects/rikkahub`，提交见[研究基线](README.md)，分支 `product/ourfairy-v1` |
| 包管理器 | `corepack pnpm@11.28.5`（PATH 上的 pnpm 12 未使用） |
| vitest | `v4.1.11`（无 `--reporter=basic`） |
| 本回合改动 | **仅本文件**；dsh 与 rikkahub 均未改动 |
| 未执行 | 未运行重型构建（`run build` / `build:lib:*` / `build:web`）；未运行 Android/Gradle 构建；未跑真 `dsh web` 的成功路径（见 §7.3 第 4 条） |

**实跑命令清单**（原始输出见 §7.3）：

```bash
# ① 真实 HTTP+WS carrier + BrowserAuth（通过 28/28）
corepack pnpm@11.28.5 exec vitest run \
  packages/api/gateway/tests/stream-server.host.spec.ts \
  packages/client/connection/tests/browser-auth.host.spec.ts

# ② 未清代理：gateway 真实 HTTP 用例假失败（1 failed | 46 passed）
corepack pnpm@11.28.5 exec vitest run packages/api/gateway/tests/gateway.host.spec.ts

# ③ 清代理后同一用例全绿（47/47）——本报告最强接缝证据
env -u NODE_USE_ENV_PROXY -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy \
  corepack pnpm@11.28.5 exec vitest run packages/api/gateway/tests/gateway.host.spec.ts

# ④ 真 dsh web e2e：未通过（缺 63 个 client bundle 中的 42 个），未修复
corepack pnpm@11.28.5 exec vitest run --config vitest.e2e.config.ts apps/cli/tests/web-auth.e2e.ts
```

**给后续实施者的一句话**：跑任何涉及真实 loopback HTTP/`fetch` 的 dsh 测试前，先加 `env -u NODE_USE_ENV_PROXY -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u all_proxy`；否则你会看到 §7.3 第 ② 条那种指向 7890 端口的假失败。
