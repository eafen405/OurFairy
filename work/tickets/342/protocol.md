# #342 会话命令客户端合同

这是 #342 当前客户端合同的维护入口；[chat README](../../../backend/chat/README.md)经 #343 历史证据转到本文，[交付证据入口](../../implementation/evidence/342-session-commands/README.md)也指向本文。来源为 #343 冻结合同及后端交付，#344 已据此接线。原生压缩与 clear 的业务语义见[规格](../../../docs/specs/session-commands.md)；证据中的协议摘录只表示各票交付时的历史快照。

- `POST /chat/commands/execute`：`{sessionId,requestId,command}`；1 compact，2 clear。
- `POST /chat/commands/status`：`{sessionId,requestId}`。
- 均走现有 Bearer、HTTP 信封、Host/Origin 栅栏。响应 `{ok:true,command:<snapshot>|null}`，execute 非 null。
- snapshot：`{sessionId,requestId,commandId,command,status,acceptedSeq,completedSeq?,error?}`。
- 数字 status：1 进行中、2 已压缩、3 当前无需压缩、4 上下文已重置、5 失败。error 为 `{code,message}`，code 1 中断（明确新请求重试），2 执行失败。
- requestId 为非空（不能全是空白）、最多 128 字符的稳定字符串。同会话同 requestId 同 command 查询已有操作，改 command 为 409 `chat/request-conflict`。新命令忙态为 409 `chat/session-busy`，不受理、不排队。参数错误 400 `chat/invalid-command`，沿用现有 401/403/404。
- execute 可返回进行中或终态；网络错误/500 先查询原身份，status null 表示尚无受理事实。不得自动以新身份 clear。明确终态失败后用户显式重试可新建身份。
- projection/page 的 messages 复用系统行：`role:3,kind:3,turn:0`。普通行 status 1 待定、2 完成、4 失败；附加 `requestId,commandId,command,commandStatus,commandError?`，commandError 与上述 error 同形。
- 行 messageId 为 `command:<commandId>`；既有 position 固定首次出现位置，seq 表示状态更新点；已重置系统结果本身即唯一分界。旧聊天行仍保留。
- HTTP 只在终态完成事件经过 durable barrier 后报告终态。观察者终态系统行须按现有 durableThroughSeq 确认，不能将 committed 当作 durable success。

合同最初先于 #343 全部实现交付，使 #344 可以并行接线；当时 #345/#346 仍等待前置实现。现 #343/#344/#345/#347 已合入并关闭，当前进度及验证边界见[任务图](README.md)和[收口证据](../../implementation/evidence/342-session-commands/04-closeout/README.md)。
