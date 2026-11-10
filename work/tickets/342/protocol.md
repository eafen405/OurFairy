# #342 会话命令客户端合同

来源：#343 实现者已冻结的后端协议。本合同供 #344 在后端最终合入前独立接线，最终实现仍以 #343 的交付记录为准。原生压缩与 clear 的业务语义见 [规格](../../../docs/specs/session-commands.md)。

- `POST /chat/commands/execute`：`{sessionId,requestId,command}`；1 compact，2 clear。
- `POST /chat/commands/status`：`{sessionId,requestId}`。
- 均走现有 Bearer、HTTP 信封、Host/Origin 栅栏。响应 `{ok:true,command:<snapshot>|null}`，execute 非 null。
- snapshot：`{sessionId,requestId,commandId,command,status,acceptedSeq,completedSeq?,error?}`。
- 数字 status：1 进行中、2 已压缩、3 当前无需压缩、4 上下文已重置、5 失败。error 为 `{code,message}`，code 1 中断（明确新请求重试），2 执行失败。
- 同会话同 requestId 同 command 查询已有操作，改 command 为 409 `chat/request-conflict`。新命令忙态为 409 `chat/session-busy`，不受理、不排队。参数错误 400 `chat/invalid-command`，沿用现有 401/403/404。
- execute 可返回进行中或终态；网络错误/500 先查询原身份，status null 表示尚无受理事实。不得自动以新身份 clear。明确终态失败后用户显式重试可新建身份。
- projection/page 的 messages 复用系统行：`role:3,kind:3,turn:0`。普通行 status 1 待定、2 完成、4 失败；附加 `requestId,commandId,command,commandStatus,commandError?`，commandError 与上述 error 同形。
- 行 messageId 为 `command:<commandId>`；既有 position 固定首次出现位置，seq 表示状态更新点；已重置系统结果本身即唯一分界。旧聊天行仍保留。
- HTTP 只在终态完成事件经过 durable barrier 后报告终态。观察者终态系统行须按现有 durableThroughSeq 确认，不能将 committed 当作 durable success。

#344 的实施前置是这份固定协议，已满足；不再把 #343 全部实现/测试关闭作为开工阻塞。#345 仍依赖 #343 的最终运行实现，#346 仍依赖 #344/#345。
