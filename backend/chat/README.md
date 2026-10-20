# 远程对话接口

所有路由均为 POST，JSON 请求体，`Authorization: Bearer <身份凭据>`，与 `/sessions/*`
同一端点、同一 Host/Origin 校验。归属只来自凭据。流式开始前的错误为
400/401/404/409/500，响应体 `{ok:false,error:{code,message}}`；会话不存在或不属于调用方统一
404 `sessions/unknown-session`，未认证为 401 `chat/unauthorized`。

## 路由

| 路由 | 请求体 | 响应 |
| --- | --- | --- |
| `/chat/send` | `{sessionId,requestId,text,uploadIds?}` | `{ok:true,receipt:{sessionId,requestId,messageId,acceptedSeq}}` |
| `/chat/receipt` | `{sessionId,requestId}` | `{ok:true,receipt:<同上>\|null}` |
| `/chat/read` | `{sessionId,maxEvents?}` | `{ok:true,projection:<投影>}` |
| `/chat/page` | `{sessionId,throughSeq,beforeSeq,maxEvents?}` | `{ok:true,page:<页>}` |
| `/chat/checkpoint` | `{sessionId}` | `{ok:true,sessionId,durableThroughSeq}` |
| `/chat/stop` | `{sessionId}` | `{ok:true}` |
| `/chat/observe` | `{sessionId,maxEvents?}` | `text/event-stream`，见下 |
| `/chat/jobs/output` | `{sessionId,taskId,from}` | `{ok:true,output}` |
| `/chat/jobs/stop` | `{sessionId,taskId}` | `{ok:true,outcome}` |

`requestId` 是客户端生成的稳定非空字符串（≤128 字符），与 `text`、有序 `uploadIds` 一起构成
请求身份：同一身份重发返回同一 receipt（进程重启后亦然），内容不同则 409
`chat/request-conflict`。网络错误或 500 表示接受状态未知，应保留原身份重发或调用
`/chat/receipt`。receipt 在 writer flush 之后返回。

`/chat/stop` 调用原生 cancel 停止当前回复并保留已排队的输入；关闭订阅不停止任何工作。

## 投影

```text
{sessionId,generation,version,cursor,durableThroughSeq,throughSeq,fromSeq,
 beforeSeq,hasMore,events,messages,attempt,settledAttempt,tasks,activity,replyStatus,error}
```

- `generation`：服务端 Agent 生命周期 UUID，不是永久身份。`version` 在其内单调递增，
  用于丢弃过时回调。
- `cursor`：最近观察到的原生事件 seq，空会话为 -1。`durableThroughSeq`：writer 屏障已确认
  的前缀，未知为 -1；它不表示客户端已应用该前缀。
- `messages`：`{messageId,seq,requestId,role,status,text,attachments}`。`role` 1 用户、
  2 Fairy；`status` 1 待定、2 完成、3 中断、4 失败。文本是原始文本，含空白与 Markdown。
  没有原生消息的 assistant 结算使用确定性身份 `attempt:<sessionId>:<seq>`。
- `attempt`：`{attemptId,revision,text}`。`attemptId` 只在同一 generation 内唯一，`text` 是
  累计原始可见文本。最终持久消息取代它，终止消息使用完整富文本渲染。
- `settledAttempt`：`{attemptId,seq}|null`，本 generation 最近一次已提交的 assistant 流结束。
  它复制自原生结算结果，不从消息文本推断；generation 重启后为 null。
- `replyStatus`：0 空闲、1 运行中、2 停止中。`error` 是最近一次执行失败；连接中断不是模型错误。

## 分页与重连

`maxEvents` 是原生事件数（1..256，默认 64），不是消息数：system/context/tool/inbox 事件
可能不产生气泡。

打开 read/observe 时冻结包含式截点 `throughSeq=C=cursor`，并给出
`fromSeq=L=max(0,C-maxEvents+1)`。`hasMore=L>0`，此时 `beforeSeq=L`，否则为 null。该连接后续
每个 SSE 快照保留 C/L，并包含 L 到当前 cursor 的全部正式事件。attempt 累计内容始终完整，
即使其起点早于 L。

`events` 是原生不可变 Session 事件，身份为 `(sessionId,seq)`，重叠的 seq 必须载荷相同。
快照只能替换本连接范围内的旧快照，不能抹掉独立回填的更早历史；合并同一 `messageId` 时取
较新的 seq。

`/chat/page` 请求 `{sessionId,throughSeq:C,beforeSeq:L,maxEvents?}`，返回
`{sessionId,throughSeq,fromSeq:K,beforeSeq:K|null,hasMore,events,messages}`；其中
`end=min(C+1,L)`、`K=max(0,end-maxEvents)`，返回事件恰为 K..end-1。`L=0` 时是空的终止页。
页不包含 attempt 或回复状态。

客户端需区分三个位置：已观察的 cursor、writer 已确认的 `durableThroughSeq`、以及已应用且
本地已提交的消费前缀。只有所需覆盖连续且 writer ACK 覆盖之后才推进消费前缀；页丢失或
ACK 失败不改变已确认位置。缺少缓存正文时不能跳过历史，必须重新回填。

## 跨用户投递

`deliver_message({recipientShortId,text,files?})` 把指定文本与可选文件写入收件人的固定主
会话，返回 `{deliveryId,sessionId,messageId,acceptedSeq}`。它不读取收件人历史，也不启动收件人
推理。

投递身份由发送方会话 id 与原生工具调用 id 派生。业务表 `deliveries` 在追加前固定收件人与
内容：状态 0 待协调、1 已持久送达、2 正在准备文件。原生 `delivery/message` 事件是送达事实，
携带同一投递身份与真实发送方会话，外观为普通 Fairy 消息。重试按该身份核对：同一身份找到
同一条消息，内容或收件人不同则拒绝；启动时按该身份核对未完成的行。

文件项为发送方当前可写范围内的 `{path}`，或本会话已接纳原件的 `{messageId,index}`，
最多 8 个、单个 32 MiB、合计 64 MiB。`attachments_json` 保存有序的 `{selector,prepared}`：
每准备完一个文件就提交该快照，重试跳过已提交项，清单完整后状态才变为 0。收件消息只保留
选中的文本与原始附件清单，不含发送方私有路径。

live 投递沿用现有 Agent 的 Session 并 flush writer；cold 投递取得原生独占写句柄，追加、
flush 后关闭，不为投递创建 Agent。通知失败不回滚正文。

## 后台任务

`/chat/read` 与 `/chat/observe` 的 `tasks` 折叠原生 `jobs/lifecycle`、`jobs/report`、收件箱
splice 与 turn 结束事件；注册表仍在时补充输出、进度与可用性。任务 id 由注册表 generation 与
序号组成，服务器重启后旧任务不会解析到新注册表中的同名任务。

`/chat/jobs/output` 接受绝对 UTF-8 字节偏移 `from`，chunks 保留原生
`{at,text,channel?,gapBefore?}`；`next` 与 `earliest` 指向原生输出环，`gapBefore` 标记源侧
丢失。终止状态不代表输出完整。`/chat/jobs/stop` 返回数字 `outcome`：0 不可用、1 已请求取消、
2 已结束。

任务状态：0 未知、1 运行中、2 停止中、3 完成、4 被终止、5 失败；`availability`
0 不可用、1 可用。`report.status`：0 无计划报告、1 待处理、2 执行中、3 完成、4 取消、
5 失败、6 未知。

`/chat/jobs/output` 与 `/chat/jobs/stop` 保留为产品适配层：原生 `jobController` 是
进程内的 Typert 传输，不提供本投影的耐久任务折叠；保留理由与漂移信号见
[原生能力依赖记录](../../docs/decisions/native-capability-dependencies.md#job-output-and-stop)。

## 活动

投影的 `activity` 是呈现与通知共用的唯一后端摘要。`status`：0 未知、1 静默、2 活跃。
`reasons`：1 实际执行、2 运行或停止中的任务、3 真正待处理的报告、4 属于当前 episode 的
投递输出（本身不保持执行活跃）。

episode 由现有 Session 事件、收件箱队列与 `tasks` 使用的同一份报告解释折叠而来，
`episodeId` 为 `<sessionId>/<startedSeq>`。`completed` 与 `delivery` 分别总结最近的已关闭
episode 与最近一次保存的投递；该前缀不变时，两者跨重连与重启保持稳定。消费者用自己持久化的
每会话消费位置合并追补内容，这些字段只是摘要。
