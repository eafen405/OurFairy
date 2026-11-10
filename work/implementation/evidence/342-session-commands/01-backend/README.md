# #343 会话命令后端证据与协议快照

本文保留 #343 交付时的基线、协议摘录和验证事实；当前客户端合同统一维护在[协议入口](../../../../tickets/342/protocol.md)，最终组合与收口状态见 [#342 证据入口](../README.md)。

基线：`integration/spec-342` @ `520e1b1`；独立分支 `ticket/343-session-command-backend`。原生 DSH 固定 `ae2adffd8d67773e125b8048120cf9ad2ba7edf3`，不改 DSH。

## 客户端协议

沿 chat 现有认证、Host/Origin 栅栏与错误信封，均为 POST JSON。

- `/chat/commands/execute` 请求 `{sessionId,requestId,command}`，`command` 数字：1 compact、2 clear。
- `/chat/commands/status` 请求 `{sessionId,requestId}`。
- 两者响应 `{ok:true,command:<操作快照>|null}`；execute 总是非 null。快照：`{sessionId,requestId,commandId,command,status,acceptedSeq,completedSeq?,error?}`。
- `status` 数字：1 进行中，2 已压缩，3 当前无需压缩，4 上下文已重置，5 失败。失败 `error:{code,message}`：1 已中断（需新 requestId 显式重试），2 执行失败。
- requestId 为非空、最多 128 字符的稳定操作身份，同会话同身份必须沿用原 command；不同 command 为 409 `chat/request-conflict`。新命令忙态为 409 `chat/session-busy`，不受理、不排队。参数错误为 400 `chat/invalid-command`；原有 401/403/404 语义保留。
- execute 可返回进行中或终态；网络错误/500 先以同 requestId 查 status，不能直接换身份 clear。status 的 null 表示尚无受理事实。
- 投影复用 `messages`：`role:3,kind:3,turn:0`，普通 `status` 仍为 1 待定、2 完成、4 失败；附加 `commandId,command,commandStatus,commandError?`。`requestId` 是操作身份。`text` 是系统反馈文案，clear 成功为“上下文已重置”。`messageId=command:<commandId>`，现有 position 首次出现排序和 seq 更新、固定截点分页、observe 规则适用。
- 结果只在完成事件经过 durable barrier 后对 HTTP 报终态；观察者按现有 durableThroughSeq 确认成功行。原始 command/run、command/done 均为 log-only，无普通聊天回合。

## 实施与验证记录

TDD 接缝沿父规格已确认的认证 HTTP + 确定性模型替身；本票测试为 `tests/session-commands.test.mjs`，不更改 Android、记忆库、技能库或 DSH。实现的结构：

- `backend/chat/src/commands.ts` 在既有 `runSession` 队列和 native maintenance 中受理；`compactNow` 使用其公开最小 agent seam 的 `runMaintenance`，在真正占有租约后写 run+flush，不嵌套维护。clear 保留 system head，按 surface.nodes 位置顺序整段替换其余节点，紧邻写 prune shadow-price。空/仅 system surface 只写 done。
- 命令期间队列保留至结果 barrier；新消息与投递沿原队列在其后写入。新命令按 active admission、原写队列、原生 inbox、回复与 session-owned job 检查即时拒绝；status 不进该长写队列，可在摘要模型等待中读取耐久进行中。
- 原 command/run 的 args 存 `{requestId,command}`；done.text 存数字 `{status,error?}`。无新 event discriminator、业务表或命令注册服务。`ourfairy-context-reset` 是 user/message 来源，含 stable commandId。
- 恢复先读 done，再找 clear replacement 或完整匹配 compaction/start、summary、checkpoint、无错误 end；仅补 done+flush。只有 run 时返回 code 1 中断，不能沿原身份重新执行。原生 sourceCommandId 仅作关联。
- transcript stateVersion 10，命令行复用原先的 first appearance、transition、move 索引和分页截点，不增加第二套排序或聊天历史。

原生手动压缩与自动保留预算不同：固定 DSH `compaction-basic/src/index.ts:405` 调用 `selectCompactableRange(...,0)`，手动操作保留末尾安全节点，最近已闭合用户输入也可被纳入摘要；自动压缩继续使用部署的 retainTokens。本票直接复用原生，不承诺保留固定轮数或字数。

### 实际验证

- 首条 clear HTTP 测试先因新入口 404 红灯，接线后通过；compact 无需压缩先因返回 reset 状态红灯，调用原生后通过。
- 缺 done 的压缩冷恢复先返回 interrupted（红灯），补完整原生效果恢复后通过；使用停机隔离日志截断模拟 crash window，保留 JSONL 每条记录一帧的 zstd 格式。
- 原生维护夹具在 public idle 时先错误受理 200（红灯），改为租约内受理后对两类命令都在 run 前返回 409。
- `npm test -- tests/session-commands.test.mjs tests/projection-units.test.mjs tests/route-inventory.test.mjs tests/identity-http.test.mjs`：67/68 通过，唯一失败是新增路由后矩阵旧 POST 计数；已同步该计数。
- 随后 `npm test -- tests/session-commands.test.mjs tests/route-inventory.test.mjs`：12/12 通过，包括进行中查询在 1s 超时内返回、新命令即时拒绝、原输入在命令之后受理、回复忙态拒绝和权限/冲突。
- 最终 `npm test -- tests/session-commands.test.mjs`：8/8 通过，新增 clear replacement 已存在而 done 丢失的恢复、run-only code 1 中断且后续新输入不被重清。
- 最后 `npm test -- tests/docs.test.mjs tests/route-inventory.test.mjs tests/projection-units.test.mjs`：53/53 通过；`git diff --check` 通过；`git merge --ff-only integration/spec-342` 报 Already up to date。
- `npm run combo:verify`：三行通过，产品基于 `integration/spec-342` @ `377e863`，DSH 与 Android 来源匹配锁定值。
- 收口 `npm run specs:status -- --offline`：副本均 ok；返回 1 的唯一原因是 Lead 集成分支 #342 的两个文档提交尚未推送（unpushed），不是本票失败。推送由 Lead 收口。
- 提交门禁例外：Lead 于本轮明确要求本票相关测试与 combo 通过后用 `git -c core.hooksPath=/dev/null commit`，避免共享资源重复全量；最终 integration 的全量 `npm test`、`combo:verify`、Android test/lint 由 Lead 统一执行。本票未运行全量，也不将先前 Lead 文档 gate 的全量结果当成本票结果。该例外是本轮 Lead 协调决定，并非默认跳过门禁。

开工 `npm run specs:status -- --offline` 返回 1：当时 Lead 的 #342 任务图未提交，报告 stale-worktree / copies MISSING。随后已 `git merge --ff-only integration/spec-342` 至 `377e863`，取得正式票面、规格与冻结协议。

### 未执行与交接

完整印象/长期记忆/技能保留、维护/学习水位、投递竞争、任务与排队边界扩展、多观察者/固定截点分页、真实文件写失败矩阵由 #345 沿已确认 HTTP seam 扩展；本票不新增其测试文件。真模型服务、Android 单测/lint与真机验收未执行，分别由后继票与集成收口记录。当前证据均为真实产品启动器与确定性模型替身，不是云模型或真机结论。
