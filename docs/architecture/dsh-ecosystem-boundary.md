# dsh 生态边界：并行传输与保留的产品实现

2026-10-19。本文是 [#73 dsh 插件生态兼容](https://github.com/eafen405/OurFairy/issues/73) 的子票 [#97](https://github.com/eafen405/OurFairy/issues/97) 交付的书面边界：产品以 dsh profile 的插件组合运行，但有几处刻意不接入原生接缝，或保留原生能力更弱处的产品实现。本文记录这些例外、它们各自缺什么、为什么这样选，以及什么条件下重新评估。

本文不列行清单和包清单。行集合的唯一权威是 `backend/v1-bundle/cordis.patch.yml`（loader
实际读取的文件），产品包集合的唯一权威是 `backend/v1-bundle/package.json`；缺席行的期望
由 `tests/baseline-boot.test.mjs` 的 `FORBIDDEN_ROW_IDS` 拥有。新增或拆分行时改的是这些
文件，不是本文；只有边界本身变化时才改本文。

产品不是把所有能力都交给原生接缝的插件组合。下面每一项都是**采用**的限制或例外，不是待办；
每项都指明一个在它不再成立时会失败的检查（`CODING_STANDARDS.md`「声称须可执行」）。

## 1. 并行传输例外

### 1.1 产品传输用了什么

| 组成 | 实现 |
| --- | --- |
| 载体 | 原生 Web 载体服务 `ctx.webServer`，产品模块注册 `exact` 路由（身份、会话、对话、网关、附件、语音） |
| 路径 | `/identity/*`、`/sessions/*`、`/chat/*`、`/gateway/*`、`/attachments/*`、`/speech/*`，全部在 `/api` 之外 |
| 鉴权 | 请求头 `Authorization: Bearer <session token>`；调用者只由凭据派生，不接受请求体里的用户字段 |
| 栅栏 | 每个产品路由先调 `ctx.connection.fence(request)`（与原生 `/api` 同一个 Host/Origin 栅栏），再读请求体；JSON 路由共用同一个 `postHandler` 包装 |
| 错误 | `{ ok: false, error: { code, message } }`，code 以模块前缀区分（如 `chat/unauthorized`） |
| 流 | `/chat/observe` 返回 `text/event-stream`；断线补齐用 `/chat/read` 与 `/chat/page` |

### 1.2 没有使用的原生接入面

| 原生能力 | 状态 |
| --- | --- |
| Connection 的 `/api` Fetch bridge 作为产品调用面 | 未使用：产品路由不经 `/api`，也不注册为 Fetch 路由 |
| Typert Gateway 的 unary 调用与 `/api/remote.mux` WebSocket 流 | 未挂载、未使用 |
| Typert 装饰器与生成的 `Remote` 描述符 | 未使用：产品模块是 `name`/`inject`/`apply` 插件，不是 `TypertRemoteService` |
| api-remotes 的客户端装配、session-controller/job-controller 命名空间 | 未挂载、未使用 |
| `/api` 上有什么 | 该前缀由挂载的原生 connection 行实现准入；准入之后没有 Gateway 或 controller 认领端点，因此已认证请求得到 404，匿名请求在门口得到 401 |

Connection 行是挂载的，但用途只有两个：产品路由复用的 Host/Origin 栅栏，以及 dsh 自身
`/api` 的准入（产品会话凭据是它的第二种凭据，见 3 节）。这不等同于接入 Remote 调用面。

### 1.3 为什么

- **客户端不是 dsh 的 Web 客户端。** 首版客户端是 Android 的 HTTP 客户端，没有 dsh Client
  的浏览器装配；Remote 提供的是浏览器侧的生成式类型与 mux 流，产品侧拿不到这部分价值。
- **准入口径不同。** 原生 `/api` 准入表达的是一个 operator Peer；产品要求按 Bearer 凭据
  得出多用户主体，并在产品路由内以会话归属和角色（法厄同/代理人）判定，判定发生在任何
  业务副作用之前。把这些判定搬进 `/api` 会先经过一层与本产品无关的 operator 语义。
- **`/api` 是整条前缀先准入的。** 见 3 节：登录路由因此只能留在外面。
- **SSE 契约已经交付，Android 客户端按它实现。** 迁移传输会改变响应形状与流语义，等于要求
  客户端同步改版；本 spec 明确不做，也不需要 Android 改动。
- **维护成本按 ADR-0001 计入。** 产品只借用原生 Web 载体与 Connection 的 Host/Origin 栅栏，不复制
  Remote 的类型图、生成物和浏览器装配；升级 dsh 时这部分不产生新的适配面。

### 1.4 重新评估的条件

出现下列任一事实时重开这个决定，而不是默认迁移：

1. Android 需要复用 dsh 的共享 Web UI 或 Remote 事件面（同一套 Client 装配成为需求），
   客户端因此需要改版。
2. 上游准入能在 handler 之前表达任意产品主体，且产品归属/角色仍可执行地前置。
3. 产品路由的形状超出 exact 路由可维护的范围（例如按会话的双向流式控制），且 SSE +
   `read`/`page` 无法表达断线补齐语义。
4. 上游把 `/api` 的逐端点准入豁免做成可验证语义，使登录端点不再需要站在外面。

### 1.5 本节的可执行检查

| 声称 | 检查（失效即失败） |
| --- | --- |
| 产品会话路径不在 `/api` 下，已认证 token 也无法经 `/api/sessions/*` 读到会话 | `tests/owned-sessions.test.mjs`：`cold ownerless and foreign sessions are refused without changing durable artifacts` |
| `/api` 在 handler 之前整体准入：匿名 401，已准入后无端点 404 | `tests/identity-http.test.mjs`：`a session credential admits dsh /api while an anonymous request is refused at the door` |
| 产品流式面是自建 SSE，断开观察不停止后端回复 | `tests/remote-chat.test.mjs`：`SSE preserves every text prefix and disconnecting observation leaves the backend reply running` |
| 产品路由拒绝匿名与越权（含法厄同），且早于冷恢复 | `tests/remote-chat.test.mjs`：`all remote paths reject anonymous and foreign owners, including administrator, before cold resume` |
| 每个产品模块的代表入口都在解析请求体或读取凭据之前拒绝不受信的 Host | `tests/identity-http.test.mjs`：`every product module entry point rejects an untrusted Host before parsing the body or reading the credential` |
| 组合不挂载 Gateway、Remote/Typert 与 plugin manager 行 | `tests/ecosystem-boundary.test.mjs`（解析 bundle 行集合，任一包名出现即失败） |

## 2. 登录路径留在 `/api` 之外

`/identity/*` 的注册、登录、邀请、会话与退出路由与其余产品路由同址，但**不能**放进 `/api`：
`/api` 是整条前缀先准入再进 bridge，匿名请求到不了任何 handler。放在前缀内，第一件事
「未认证用户提交邀请码注册或登录」就无从表达。

代价是登录路径自己负责栅栏与凭据解析，而不是复用 `/api` 的准入。这个代价是刻意的：产品
路由的准入规则由产品自己拥有，登录是规则的入口而不是例外分支。会话凭据签出后仍作为第二种
凭据注册给原生 connection，使该 token 也能准入 dsh 自己的 `/api`——这是连接点，不是产品路由
迁入 `/api`。

重新评估条件同 1.4 第 4 条：只有上游提供可验证的逐端点豁免、且客户端协议整体升版时，才考虑
把登录并入 `/api`。

| 声称 | 检查（失效即失败） |
| --- | --- |
| 未认证请求可以完成登录（登录路由不在 `/api` 的准入之后） | `tests/identity-http.test.mjs`：`the provisioned Phaethon signs in as short number 1` |
| 调用者由凭据派生，请求体不能自选用户 | `tests/identity-http.test.mjs`：`the credential names its own holder with no user field in the request` |
| 注册在单一事务内分配编号，失败不留下半个身份 | `tests/identity-http.test.mjs`：`concurrent registrations never share a short number and never half-succeed` |

## 3. 保留的产品实现

### 3.1 业务 SQLite（身份库）

**原生有什么。** `ctx.storageDomain` 提供按 schema 校验的 KV 域，写入在 resolve 前落盘，可
路由到 JSON 或 SQLite 后端；会话事实走 session 持久化日志。**缺什么。** 它按记录读写：没有
跨表事务、二级索引或多段键（其 README 的已知限制），也就无法把「校验邀请 → 校验用户名 →
分配编号 → 建用户 → 核销邀请 → 建会话」放进一个不可分割的提交。

**为什么保留。** 身份、群组、上传生命周期与投递协调共享一个 SQLite 文件、一个同步连接和一
条迁移阶梯；对小规模受邀部署，单写者 + `BEGIN IMMEDIATE` 是这里的杠杆。库规则（逻辑删除、
关联人员与时间戳、数字枚举）也按 `AGENTS.md` 落在业务表上，而不是塞进会话日志。

**重新评估条件。** 业务域被拆成彼此没有跨表不变式的独立 KV 域，或上游 domain 层提供事务
语义且能表达上面这条注册序列。

| 声称 | 检查（失效即失败） |
| --- | --- |
| 并发注册在一个事务内完成，不会重复编号或部分成功 | `tests/identity-http.test.mjs`：`concurrent registrations never share a short number and never half-succeed` |

### 3.2 身份（账号、邀请、编号、角色）

**原生有什么。** 凭据 seam 保存密钥引用；`authorization` 是「人机对话换取凭据」的流程注册
表；connection 接受注册的第二种凭据并解析出 principal。**缺什么。** 没有用户账号、邀请码、
短编号、管理员角色与吊销语义；`authorization` 解决的是拿到一个凭据，不是「谁是谁、谁能做
什么」。

**为什么保留。** 这些是产品域（见 `GLOSSARY.md` 的法厄同、代理人、用户编号、邀请码），并且
是产品路由与 `/api` 准入共用的身份来源。换成原生 authorization 会把账号系统降成凭据流程，
丢掉邀请与角色这两条产品规则。

**重新评估条件。** 上游出现独立于 operator 的多用户账号模型，且能承载邀请、编号与角色。

| 声称 | 检查（失效即失败） |
| --- | --- |
| 凭据只代表其持有人，请求体不能指定用户 | `tests/identity-http.test.mjs`：`the credential names its own holder with no user field in the request` |
| 越权（含管理员）在产品路由上被拒绝 | `tests/remote-chat.test.mjs`：`all remote paths reject anonymous and foreign owners, including administrator, before cold resume` |

### 3.3 scoped 文件系统与 sandbox provider

**原生有什么。** `fs-sandbox` 按会话 sandbox 模式限制写与编辑，**读保持不受限**；
`sandbox-local` 在宿主内核上限制进程，失败时报 `SANDBOX_UNAVAILABLE`；`ctx.sandboxPolicy`
解析每会话模式。**缺什么。** 没有按会话归属派生的私有/公有/群组根，没有按归属限制的读，没有
无会话调用一律拒绝的规则，也不拒绝 `danger-full-access` 绕过。原生 fs 的 fence 是策略层
检查，不处理已打开对象与路径替换之间的 TOCTOU。

**为什么保留。** 空间范围是产品语义（公有/私有/群组空间），而「文件实际访问和命令启动分别
落实限制」是必要保障（`AGENTS.md`「精简不减保障」）：产品 provider 每次操作重算允许根，用
`/proc/self/fd` 核对实际打开的对象，脚本在只绑定这些根与只读附件的 bwrap 命名空间内运行，
并在原生执行器之前拒绝提权。这些不能由「原生能力更弱」的替换保住。

**重新评估条件。** 上游出现按会话归属提供读隔离的 fs/sandbox provider，且无会话调用、提权
拒绝与路径替换语义都有等价保障。

这些 provider 是产品包，由 bundle 挂载；具体行与包以 `backend/v1-bundle/cordis.patch.yml`
和 `backend/v1-bundle/package.json` 为准，本文不重复。

| 声称 | 检查（失效即失败） |
| --- | --- |
| 两个用户（含管理员）的私有文件互相不可读，公有文件可共享 | `tests/spaces.test.mjs`：`chat tools write own private files, share public files, and deny another user including administrator` |
| 请求 `danger-full-access` 提权得到拒绝而不是无约束执行 | `tests/spaces.test.mjs`：`real child processes share public files, keep private boundaries after cd, and retain networking` |
| 符号链接不能把授权范围内的路径变成对外部路径的读写 | `tests/spaces.test.mjs`：`directory changes, edits, image reads and symlinks retain the same owner boundary` |
| 没有会话身份的文件与脚本调用直接拒绝，而不是继承默认用户 | `tests/spaces.test.mjs`：`agentless filesystem and script Interface calls refuse instead of inheriting a default user` |

### 3.4 附件生命周期

原生 attachment store 拥有不可变字节，且**从不自动删除**对象；产品 `uploads` 表只拥有上传
生命周期（数字状态：0 上传中、1 完成、2 过期），完成后的原件按认证归属与目标会话限定。保留
它的原因是原生 store 没有上传预登记、过期状态与「哪条消息有权取原件」的规则——这些是产品
语义，不是存储能力。

检查：`tests/attachments.test.mjs` 的
`unfinished and foreign receipts never grant message or download access, including identical stored bytes`。

## 4. 不在范围

| 事项 | 现在的可执行事实 | 失效即失败的检查 |
| --- | --- | --- |
| 挂载 plugin manager、提供运行时插件安装/启停 | 组合不挂载 plugin manager 行；插件装配由部署（bundle 与 profile）负责 | `tests/ecosystem-boundary.test.mjs`（bundle 行集合中不出现 plugin manager 包） |
| npm 发布、registry 与版本发布流程 | 产品包全部 `private`，仓库里没有发布步骤；安装与启动只走本地 checkout 生成的 profile | `tests/ecosystem-boundary.test.mjs`（`backend/` 下任一产品包 `private` 不为 true 即失败） |
| 把 Android API 迁到 `/api` | 本仓库的产品路径都在 `/api` 之外（见 1.1）；已观察到 `/api/session.list` 与 `/api/sessions/*` 在准入后返回 404，没有产品端点认领它们（客户端在 `android/`，但调用的是产品路径，不是 `/api`） | `tests/identity-http.test.mjs`：`a session credential admits dsh /api while an anonymous request is refused at the door`（断言 `/api/session.list` 已准入后 404）；`tests/owned-sessions.test.mjs`：`cold ownerless and foreign sessions are refused without changing durable artifacts`（断言 `/api/sessions/*` 为 404） |
| 把业务 SQLite 换成 storage-domain、把身份换成 authorization、把 fs/sandbox 换成更弱的原生实现 | 见 3 节；这些是产品能力差异，不是生态兼容缺口 | 见 3 节各表 |

Android 客户端在本仓库 `android/`，本文不对其代码做检查声明；本仓库能固定的是它会调用的 HTTP/SSE
形状与上述路由集合。

## 5. 维护规则

- 行与包只有一个权威：`backend/v1-bundle/cordis.patch.yml` 与
  `backend/v1-bundle/package.json`。本文提到「bundle 挂载的产品包」时指这两处，不复制。
- 本文的每个例外都附一个检查；删除或改名检查时，同一次改动必须改写或删除对应声称
  （`CODING_STANDARDS.md`）。`tests/ecosystem-boundary.test.mjs` 会把本文引用的检查
  与真实测试标题对账，也会把本文与 bundle 的行/包集合对账。
- 边界变化（例如开始使用 Remote，或换掉 scoped provider）是一次架构决定，应先改检查与
  ADR，再改本文，而不是让文档先漂移。
