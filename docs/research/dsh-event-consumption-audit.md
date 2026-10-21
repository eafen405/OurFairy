> 2026-10-20 状态：日期化记录。本文记录 2026-10-14 的判断，不描述当前实现。

# dsh 事件消费研究的源码复核

复核日期：2026-10-14。被复核文件：[dsh-event-consumption.md](dsh-event-consumption.md)。主证据为本地 `/home/eafen405/projects/deepseek-harness`，commit `d743267388641bc76f17c45ce8b4c231aed1d32c`；复核时工作树干净。已阅读该仓库根目录、`packages/`、`packages/client/` 的 AGENTS.md。本次仅只读相关源码，未运行产品、测试或修改 dsh。

本报告限定为 Session history / assistant reconnect、jobs output / ownership、Connection authentication / admission；不构成整个仓库的安全审计。以下源码链接使用本地绝对路径及行号，适合当前工作区核查。

## 结论

原研究中的 jobs 进程内状态、字节 offset、Session follow snapshot、单 operator 等基础方向成立，但存在会影响客户端设计和多用户架构的实质误判。不能将原研究 §7「断线补取方式按事实即可」「不需要再 grill」直接作为已验证结论：需要先纠正补取与身份边界，再明确既定产品责任下的具体协议实现；本报告不重开已定的产品责任与共用装配决策。

| 原研究表述 | 审计结果 | 对后续决策的影响 |
| --- | --- | --- |
| 传输面唯一 WebSocket mux | 不成立：unary RPC 走 HTTP POST，stream 走 mux | Android 需分别实现 HTTP RPC 与 WS stream carrier |
| `throughSeq` 按事件 ID 补取 | 不准确：它是 snapshot 所确定的包含式历史上界，API 向后分页 | 不能当成 `afterSeq` 或断线增量续传接口 |
| assistant transient 丢失部分无补取 | 过度概括：当前 active attempt 的累计 stream 在重连 baseline 中恢复 | 需要区分进程仍存活的重连、attempt 完成、Host 重启 |
| launch token 一次性换 cookie | 错误：代码没有兑换即失效，token 随 process owner 保存并可重复兑换 | 配对凭证生命周期与撤销不能按一次性设计 |
| Android 必須 Origin 匹配 + sec-fetch-site 同站 | 不成立：缺省两个 marker 可以通过，Host fence 仍必需 | 原生客户端无需伪造浏览器 marker |
| 无 UserScope → RPC handler 补齐归属 | 不足以推出完整方案：现有认证把所有请求归入同一个 operator | 必须设计可信身份与所有资源入口的服务端授权 |
| jobs offset 可续拉 | 成立但有保留窗口，可能 `lossy`；不是无限完整日志 | 客户端必须展示/处理输出缺失，跨重启另需持久业务状态 |

## Session durable history：向后分页，不是增量续传

`SessionPageRequest` 的注释明确称其为 backwards-history request；`throughSeq` 是 corresponding follow opening frame 提供的 inclusive log cut（[types.ts:478](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/types.ts:478)）。`paginate` 的结束位置为 `min(throughSeq + 1, beforeSeq ?? throughSeq + 1)`，随后从尾向前扫描、返回 `events.slice(cut, end)`（[history.ts:392](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/history.ts:392)）。例如以旧的 `lastSeenSeq` 作为 throughSeq 只会读到它及其之前，读不到它之后的新事件。

`SessionFollowRequest` 没有 `afterSeq` 或 last cursor 字段，只有 address、history window、assistantStream（[types.ts:494](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/types.ts:494)）。重开 follow 会按当前 source cursor 生成新 snapshot，含尾部 history page、hasMore、projections 与可选 assistant baseline，之后从 `cursor + 1` 连续发送新 durable event（[history.ts:179](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/history.ts:179)、[history.ts:213](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/history.ts:213)）。服务端注释在 follow 方法处提及 caller cursor，但实际请求类型和实现未接收该值；本报告以可执行实现为准。

Client 的 `loadThrough(seq)` 也明确向后分页：只有当前窗口 baseSeq 大于目标才调用 `events.prepend({ beforeSeq })`，不断向更早历史移动（[session.ts:427](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/client/sessions/session.ts:427)）。Client readPage 才将 stream 所持 throughSeq 和该向后请求一起发给 page（[transport.ts:222](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/client/transport.ts:222)）。因此 follow 重建 baseline + history paging 可以重建窗口，但不能表述为 dsh 已提供「从本地 lastSeenSeq 增量补取全部错过事件」的接口。若通知需保证所有断线事件均被消费，需额外明确扫描范围、持久 cursor 与历史重叠的处理。

服务端对 follow 新事件跳号抛 `gateway/internal` 确实成立（[history.ts:226](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/history.ts:226)），这是同一次 live generation 的连续性检测，不等于跨重连增量协议。

## Assistant：baseline 含累计前缀，而非只含 index

`SessionAssistantStreamAttempt` 除 nextIndex / startedAfterSeq 外还有 `stream`，其定义是 compact detached stream accumulated at opening revision（[types.ts:501](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/types.ts:501)）。Host accumulator 累计 chunk，snapshot 返回 activeAttempt.stream.snapshot()（[assistant-stream.ts:61](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/assistant-stream.ts:61)、[assistant-stream.ts:84](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/assistant-stream.ts:84)）。Client `replace` 会展开 baseline.stream、重建可见 transient chunk，并采用 nextIndex 继续接收（[client/sessions/assistant-stream.ts:52](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/client/sessions/assistant-stream.ts:52)）。

因此同一 Host / Agent 仍存活且 attempt 未结束时，重连可以恢复其断线前后累计的展示前缀；没有单独 chunk-index pull API 并不意味着累计内容无法恢复。revision 是 live 帧连续性序列，Client 要求下一 revision 恰为之前值 + 1（[transport.ts:206](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/client/transport.ts:206)），不宜描述为只能在「同一个固定 revision」内恢复。

限制仍然存在：Host 收到 end 后清除 activeAttempt（[assistant-stream.ts:73](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/assistant-stream.ts:73)），Agent disposed 删除 accumulator（[history.ts:62](/home/eafen405/projects/deepseek-harness/packages/api/session-controller/src/history.ts:62)）。baseline 是 process-local；它不保证已经结束的 transient attempt 或 Host 重启后仍可按原 live 帧重放。durable 历史与未完成 attempt baseline 应分别处理。

## Jobs：绝对 offset 成立，完整补取有条件

LocalJobRegistry 使用内存 Map（[index.ts:160](/home/eafen405/projects/deepseek-harness/packages/jobs/jobs-local/src/index.ts:160)），Owner dispose 会 cancel、等待 settlement、删除所有 owner records（[index.ts:614](/home/eafen405/projects/deepseek-harness/packages/jobs/jobs-local/src/index.ts:614)）；服务 teardown 同样清空（[index.ts:644](/home/eafen405/projects/deepseek-harness/packages/jobs/jobs-local/src/index.ts:644)）。jobs 的 live records 不具备跨 Host 重启恢复保证，此结论成立。

`job.follow` 以 request.from 或 output.earliest 开始，后续 cursor 更新为 read.next（[observe.ts:47](/home/eafen405/projects/deepseek-harness/packages/api/job-controller/src/observe.ts:47)、[observe.ts:68](/home/eafen405/projects/deepseek-harness/packages/api/job-controller/src/observe.ts:68)）。协议约定传上一个 output frame 的 next 来续拉，但服务端只验证非负 safe integer，没有要求必须等于此前返回的 next。`JobChunk.at` / next / total 都是 UTF-8 字节 offset。

OutputRing 有容量淘汰和超大 chunk 裁剪；`readFrom` 返回重叠的整块，不一定将块裁切到 from；`from < earliest` 时返回 lossy（[ring.ts:71](/home/eafen405/projects/deepseek-harness/packages/jobs/jobs-local/src/ring.ts:71)、[ring.ts:95](/home/eafen405/projects/deepseek-harness/packages/jobs/jobs-local/src/ring.ts:95)）。正常保存 frame.next 可以维持 chunk 边界；若任意给块内 offset，客户端应理解可能有重叠而非假设文本一定从该 byte 精确起始。`JobFollowFrame.output` 明确携带 lossy 标志（[types.ts:79](/home/eafen405/projects/deepseek-harness/packages/api/job-controller/src/types.ts:79)）。断线过久即使 Host 未重启也可能丢失输出。

## 现有 Web 认证不能直接定义 OurFairy Android / 多用户契约

Connection 先执行 Host/Origin fence 再检查 signed browser cookie，通过后统一返回同一个 operator peer（[rpc-host.ts:106](/home/eafen405/projects/deepseek-harness/packages/client/connection/src/rpc-host.ts:106)）。这准确描述 dsh 当前 Web Host 的 admission，并不自动决定 OurFairy 的 Android 登录、配对和身份方案。

Host fence 可接受 loopback、configured trustedHosts 或 listener 自己的 bind IP。`sec-fetch-site` 只有明确 cross-site 才拒绝；Origin 缺省直接通过，若附带则必须匹配 Host（[api-request-trust.ts:113](/home/eafen405/projects/deepseek-harness/packages/client/connection/src/api-request-trust.ts:113)）。所以「Android 必须 Origin + 同站 metadata」错误；原生客户端可不带两者，仍需有效 cookie 和获准 Host。Host / Origin 是浏览器攻击防护，不是用户身份与资源权限的替代物。

BrowserAuth 的 processLaunchToken 保存在 WeakMap，不因兑换移除（[browser-auth.ts:52](/home/eafen405/projects/deepseek-harness/packages/client/connection/src/browser-auth.ts:52)）；root GET token 匹配就签发 cookie，兑换路径不消耗 token（[browser-auth.ts:250](/home/eafen405/projects/deepseek-harness/packages/client/connection/src/browser-auth.ts:250)）。它是当前 process owner 的 reusable launch token，不是一次性 token。cookie 绑定 authority、签名与期限（[browser-auth.ts:300](/home/eafen405/projects/deepseek-harness/packages/client/connection/src/browser-auth.ts:300)），持久 secret 由 credential provider 存储（[browser-auth.ts:169](/home/eafen405/projects/deepseek-harness/packages/client/connection/src/browser-auth.ts:169)）。持久保存 cookie 能改善重连体验，但「必须持久化」属于客户端产品选择：一个内存 cookie 的当前进程仍能访问，失去 cookie 后也可重新配对。

若 Android 直接兼容这个未经修改的 Web Host，它必须适配 cookie admission；若 OurFairy 新增可信移动端认证层，是否沿用 cookie / launch token 应是设计决策，不能由 dsh 当前浏览器实现宣布为 Android 的必然契约。

## 多用户：补字段不等于完成授权

OperatorPeer 自述为 Host 唯一操作者，每个调用携带该 peer（[operator-peer.ts:1](/home/eafen405/projects/deepseek-harness/packages/client/connection/src/operator-peer.ts:1)）；Gateway 将 admission peer 放入 invocation（[gateway/index.ts:719](/home/eafen405/projects/deepseek-harness/packages/api/gateway/src/index.ts:719)）。这说明一个 Host 的所有获准浏览器请求目前共享 operator 身份。检索的 Session / jobs 请求没有 OurFairy UserScope，但不能从缺少该字段推出「只在 RPC handler 补齐归属即可」。

jobs 的 session owner fence 只检查 owner.id 是否等于 caller SessionId（[jobs-local/index.ts:401](/home/eafen405/projects/deepseek-harness/packages/jobs/jobs-local/src/index.ts:401)）。JobController follow 直接把 request.sessionId 传给 registry；kill 也是以客户端提供的 sessionId 做 lookup / kill（[job-controller/index.ts:80](/home/eafen405/projects/deepseek-harness/packages/api/job-controller/src/index.ts:80)、[job-controller/index.ts:109](/home/eafen405/projects/deepseek-harness/packages/api/job-controller/src/index.ts:109)）。它验证「job 属于这个 session」，没有建立「当前登录用户有权使用这个 session」。unowned job 在 registry 中向所有 caller 开放（[jobs-local/index.ts:306](/home/eafen405/projects/deepseek-harness/packages/jobs/jobs-local/src/index.ts:306)），在共享多用户 Host 中也需要重新决定谁能读取与取消。

OurFairy 若共享 Host，至少需让可信认证产生 principal，校验 principal 到 session / child session / job 的所有权关系，并覆盖列表、follow / page、kill 等读写入口；附件/文件 Fetch 等其他首版入口是否复用授权也需要专项盘点。schedule 已排除首版，其后台授权不属于本次首版决策范围。本报告未审计这些其他入口，不声称发现完整漏洞清单。身份与权限不应从客户端可提交的 UserScope/sessionId 直接采信。在已定的共用装配下，服务端 handler / gateway 的认证与授权实现需要覆盖性证据；目前研究不能证明 handler 一处补字段足够。

## 传输纠正

Gateway 同时注册 `/api` RPC interceptor 和 WS stream upgrade（[gateway/index.ts:233](/home/eafen405/projects/deepseek-harness/packages/api/gateway/src/index.ts:233)）。Web Client `call` 使用 POST、JSON request envelope 与 fetch（[client/rpc.ts:34](/home/eafen405/projects/deepseek-harness/packages/client/connection/src/client/rpc.ts:34)）。因此 WS mux 是 Remote stream 的传输，不是所有 Host↔Client 传输的唯一面。沿用 dsh follow / control / job.follow / job.list stream 时 WS 的要求仍成立。

## 建议交给后续决策的待定项

1. Android 重连是尾窗重建，还是需要持久消费全部错过的 durable events；后者如何确定补读范围与通知去重。
2. OurFairy 自己的登录 / 配对凭证与用户到 Host、Session 的可信绑定；直接继承 Web cookie 的范围。
3. jobs 输出丢失标志与重启后长期任务状态如何向用户表达；哪些业务结果另行持久化。
4. 在已定共用装配下，验证可信认证身份与 RPC / stream / Fetch 等首版入口授权的覆盖性，以及资源归属如何形成闭环；不重选独立 Host / 共享 Host。schedule 的后台授权属于首版范围外。
