> 2026-10-20 状态：日期化记录。本文记录 2026-10-14 的判断，不描述当前实现。

# 首版共同 Interface：会话投影、恢复与活动

2026-10-14。解决[研究跨端共同接口：会话投影、断线恢复与活动状态](https://github.com/eafen405/OurFairy/issues/20)。
本文是工程建议与静态轨迹，未选定或实施线协议、UI、持久格式，未编译、运行模型请求或真机测试。
产品规则继承[前端首版决议](https://github.com/eafen405/OurFairy/issues/10#issuecomment-6165782525)。具体活动聚合与首次消费点初始化是待实施路线采纳、核验的工程建议，不能声称用户已逐项确认。

## 结论

建议让一个会话同步 Module 提供统一会话投影：消息、回复状态、任务状态、活动及同步批次由同一组事实导出。
调用页面只订阅会话状态、发送输入和分别停止回复/任务；分页、流结算、身份对账、通知依据归并留在 Module 内。
原生 dsh 能复用 follow/page、assistant baseline、cancel、job list/follow/kill；需要产品 Adapter 完成多用户授权、投递 surface、任务生命周期持久事实及持久截点确认。
Fairybot 的最新完整快照与重连重叠机制适合复用，协议与投影类型不能整体搬入 rikkahub。

最小新增持久事实进入原有会话日志，活动和通知游标是投影/客户端消费记录，不建立第二套聊天日志或通知队列。
需要新增事实的原因是：投递不是模型产出；原生 jobs 内存 roster 无法提供跨重启的已知终态及断线活动依据。
一般 turn 活动可直接由已有 turn/start、turn/end 派生，不为每次通知再写一个业务事件。

## 证据基线与范围

固定版本：dsh `d743267388641bc76f17c45ce8b4c231aed1d32c`；rikkahub `0966502c4d65c1ee4b2a3e49a19703bb1978016c`；Fairybot `095efdd84fd7ab2215a0b5b03369aac4f1303108`。
源码只读自本地同名 checkout，HEAD 与上述提交一致。已读相关 AGENTS.md。
已读本地主工作区未提交的 dsh-event-consumption-audit.md、message-model.md、fairybot-stream-performance-reuse.md、frontend-v1-boundary.md；它们不是本分支发布资产。
已读[rikkahub 架构研究](https://github.com/eafen405/OurFairy/issues/17#issuecomment-6163757503)。以下主张直接引用固定提交源码。

- [D1：follow/page 与 assistant wire types](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/api/session-controller/src/types.ts#L478)
- [D2：snapshot 截点、buffer 与 live 连续性](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/api/session-controller/src/history.ts#L179)
- [D3：向后 paginate](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/api/session-controller/src/history.ts#L392)
- [D4：assistant 结算 fold](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/api/session-controller/src/client/sessions/assistant-stream.ts#L52)
- [D5：消息、attempt、turn/end 的区别](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/types.ts#L285)
- [D6：surface 与 deriveEventMessage](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/surface.ts#L49)
- [D7：job 观察 types](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/api/job-controller/src/types.ts#L18)
- [D8：输出 drain 后终态](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/api/job-controller/src/observe.ts#L47)
- [D9：有界输出与重叠整块](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/jobs/jobs-local/src/ring.ts#L71)
- [D10：JobView 状态及输出窗口](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/jobs/jobs/src/view.ts#L16)
- [D11：Session append/publication](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/index.ts#L798)
- [D12：sessions.flush 屏障](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/core/session/src/index.ts#L1306)
- [D13：JSONL flush listener](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/session/session-persistence-jsonl/src/index.ts)
- [D14：RPC admission 是同一 operator](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/client/connection/src/rpc-host.ts#L106)
- [D15：unary HTTP](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/client/connection/src/client/rpc.ts#L34)／[gateway 载体](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/api/gateway/src/index.ts#L233)
- [D16：prompt/attachment/cancel](https://github.com/deepseek-ai/deepseek-harness/blob/d743267388641bc76f17c45ce8b4c231aed1d32c/packages/api/session-controller/src/commands.ts#L307)
- [R1：UIMessage](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/ai/src/main/java/me/rerere/ai/ui/Message.kt#L17)
- [R2：ConversationSession 本地生成任务与 StateFlow](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/service/ConversationSession.kt#L23)
- [R3：ChatService 本地发送/执行入口](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/service/ChatService.kt#L386)
- [R4：前后台及来源特定通知入口](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/service/ChatNotificationManager.kt#L44)
- [F1：无损累积、最终正文结算](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/mobile-projection.ts#L653)
- [F2：按连接 generation 补至重叠](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/remote/RemoteSessionReader.kt#L166)
- [F3：阻塞只留最新完整快照](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/mobile-stream.ts#L4)

## 三类状态与共同身份（建议）

| 类别 | 权威及最小内容 | 消费规则 |
| --- | --- | --- |
| 持久事实 | 后端唯一会话日志；sessionId、seq、time、消息/来源、turn 边界；必要的 delivery 与 job lifecycle 扩展 | seq 排序；确认落盘前不推进可恢复游标 |
| 临时流状态 | 当前 Host 的 attemptId、revision、index、累计 stream；实时 job 输出窗口与 roster | 严格有序归并；重连用 baseline 替换，不能宣称跨重启存在 |
| 本地呈现/消费 | 缓存正文、列表位置、render revision、通知已处理位置、已读位置 | 用户/设备隔离；不修改后端历史；通知处理与已读分开 |

稳定 identity 建议为 `(accountId, sessionId, seq, part)`；临时输出为 `(connectionGeneration, sessionId, attemptId)`。
任务的产品 taskId 需稳定且不跨 Host 实例复用；原生 job id 为 `<kind>-N`（D10），Adapter 保留 taskId→当前实例 jobId 映射，不能以重启后的同名字替换旧任务。
`deliveryId` 是后端业务幂等键，`requestId` 是发送相关身份；它们都不替代会话 seq。
UI 可保持一个稳定 rowKey，在 attempt→最终事件对账时改绑定持久 identity，避免同一正文跳动或出现两条。
不能以 role=assistant 推断模型实际产出，普通 Fairy 外观仍保留事件 kind、真实投递来源与 persona。
模型历史与手机聊天投影可各有过滤，但必须从同一正式事件语义导出。system/developer/tool 不是一律聊天气泡，user/message 也可能是注入上下文（D5、D6）。

## 对调用方的 Interface（示意，非已选 wire schema）

```typescript
interface Conversations {
  observe(sessionId): Flow<ConversationView>
  send(sessionId, { requestId, content }): Promise<Admission>
  loadOlder(sessionId): Promise<void>
  stopReply(sessionId): Promise<Admission>
  stopTask(sessionId, taskId): Promise<Admission>
  observeTaskOutput(sessionId, taskId): Flow<TaskOutputView>
}
interface ConversationView {
  sessionId; rows; tasks;
  reply: 'idle' | 'running' | 'stopping' | 'unknown';
  activity: { episodeId?, phase: 'quiet' | 'active' | 'unknown', reasons };
  sync: { generation, phase, observedSeq, durableThroughSeq, batchId? };
}
interface MessageView {
  rowKey; identity; provenance; originalParts;
  contentVersion; outputPhase: 'streaming' | 'final' | 'interrupted' | 'failed' | 'unconfirmed';
}
interface TaskOutputView {
  taskId; status; chunks; nextByte; earliestByte; totalByte;
  gaps; availability: 'live' | 'retained' | 'unavailable';
}
```

Admission 只是请求已接纳，不等于最终消息落盘、回复结束或任务停止成功；原生 prompt/cancel/kill receipts 已有这个区别（D7、D16）。
`send` 的本地待发送项以 requestId 对账；不要把原生 requestId 字段存在误当完整网络重试幂等已实现，需产品 Adapter 明确接受/重试窗口。
`observe` 供聊天、会话列表、眼睛动效与通知共同消费，页面不得自行扫描原生事件生成活动或提醒。
附件上传/下载 Module 在同一可信账号与会话资格下工作，得到 receipt/reference 后交 send；不把字节传输细节塞进每个页面。
通知 Module 另接受应用级 foreground 与同步完成批次，呈现 Module 消费 MessageView；它们不各自控制连接和补页。
这里的 Depth 来自隐藏跨重连归并、结算和状态派生，而非再包一层 dsh methods 的浅透传。

## 原生事件到投影（事实 → 建议）

| 原生事实 | 共同投影建议 |
| --- | --- |
| turn/start、turn/end（D5） | reply 原因开/闭；turn/end 不是“所有 jobs 都完成” |
| assistant start/chunk + baseline（D1、D4） | 建立 attempt，累积完整正文；仅累计后的展示快照可合并覆盖 |
| assistant/message + committed end(seq)（D4） | 用完整 message 结算关联 attempt；正常、interrupted 都触发最终格式，随后不被旧版本覆盖 |
| assistant/attempt（D5） | 失败/未成 surface 的 trace；保留可展示前缀时明确失败语义，不伪造成功模型消息 |
| tool/call、tool/result（D5） | 根据具体工具事实形成活动卡；不是每条工具消息都成为 Fairy 正文 |
| job.list rows（D7） | 原生整集替换实时 roster；允许 UI 直接恢复当前 live 状态，不能推出已消失 job 曾如何结束 |
| job.follow output/status（D8、D9） | 输出字节坐标与缺失范围；收到终态前排完保留输出，独立于回复是否结束 |
| delivery/message（必要扩展） | 正式持久投递、普通 Fairy row、内部真实来源；不启动推理；之后可进入模型历史 |
| job start/settle（必要扩展建议） | 只持久任务身份、owner、起止/结果事实；原文日志仍用有界输出，不承诺完整永久保存 |

原生 surface 认可集合和 deriveEventMessage 有明确分支（D6）；新增 delivery 不能只向一个 registry 注册 projector。
需要后端同时扩展正式格式、surface、模型请求投影、query、持久读写及客户端识别，具体方案交[后端可实施性研究](https://github.com/eafen405/OurFairy/issues/19)。
未识别的必读事件必须显式报告不兼容，不能静默跳过后仍称“已完整同步”；ignorable 的扩展按正式 reader 规则处理（D1）。

## 活动与统一通知（建议）

建议活动按会话聚合正在进行的 reply 与 jobs；因而同会话有 job 运行时 turn/end 不使它静默。这是对既定“运行状态”的工程解释，会影响提醒时机，需按下列场景核验后采纳。
episode 从 quiet→active 的持久原因起点派生，建议 identity 使用起点 seq；并发原因加入同 episode，最后原因闭合才回 quiet。
静默收到投递是短 episode：内容正式提交后形成输出事实，随即静默，不为这个展示过程启动模型或写一套通知事件。
在已经 active 的会话中收到投递加入现有活动；不要凭投递来源单独创建一轮通知。
实时 jobs 当前 roster 用于运行事实，start/settle 持久记录用于历史恢复；Host 重启后未闭合任务变为 unavailable/unknown，不假装继续运行或成功。
单独停止回复使用 session.cancel，停止任务使用 job.kill；取消 stream/退出页面只停观察，不取消远端执行（D7、D16）。

通知 Module 消费上述活动和正式内容：后台静默投递输出提醒一次，随后静默不再提醒；后台执行最后归静默提醒一次。
本地以 `(account, session, episode/batch)` 和已处理 seq 记消费；一 episode 已提醒只更新位置，下一 episode 可再次响铃。
前台同步把这些依据记为已处理，随后切后台不重放；未读位置独立保留。
重连期间只累积摘要依据，在补齐截点后按会话发布一次合并通知，不逐个执行历史活跃/静默转换。
恢复前处于后台、恢复后前台时，以实际发布时应用状态抑制；generation 和账号变化使旧批次失效。
本地消息/游标/通知待消费投影可在一个数据库事务结算；Android notify 与该事务没有天然原子性。
因此不能由这个方案声称系统通知严格恰好一次；崩溃窗口须验收并明确内部重试方式，沿用已有产品限制。

## 恢复算法与持久截点（建议）

区分 `observedSeq`（已收到）与 `durableThroughSeq`（后端确认已保存且客户端完整应用的前缀）。
原生 append 同步 publication，follow 会观察它；append 返回和 turn/end 不等于已完成持久化（D5、D11）。
产品 Adapter 须提供持久确认：捕获 seq P，等待 `sessions.flush(session)` 成功，再确认这个已知前缀 P（D12、D13）。
`flush()` 返回 true 只说明有 listener，装配还须证明实际 JSONL writer 存在；失败不得 ACK，不能继续发“送达且可恢复”。
冷会话持久 append 则在其写入承诺完成后确认。实际 flush 保存更晚前缀不妨碍只 ACK P。
这可由批次 ACK/确认截点表达，不需要逐 token flush；流正文可及时展示但保持 unconfirmed 语义。

设客户端持久消费点 W，重开 follow 获得 snapshot.cursor=C；原生 request 没有 afterSeq（D1、D2）。
1. 先接纳新 generation、保持旧可读正文，冻结本次补齐目标 C，记录 assistant baseline 及其 nextIndex/revision。
2. snapshot 的尾窗若最早 seq 大于 W+1，用 `page(throughSeq=C,beforeSeq=最早seq)` 向后补页，直到与已存前缀重叠或到日志起点（D3）。
3. 将页按升序应用，按 `(sessionId,seq)` 去重；同 identity 内容不一致视为日志/版本不兼容，不能随意覆盖。
4. 与补页并发到来的 seq>C 有序归并到独立尾部；原始事件不得 conflate。若有界内存压力，保留已持久部分并重开新的 baseline，不静默丢数据。
5. 缺失区间全覆盖且 C 已获持久确认，才能事务推进消费点至 C，并结算到 C 的合并通知批次；C 之后再接续实时处理。
6. 流 revision/index 不连续时废弃该临时 generation、重开 baseline；断线本身不把正文标成 final（D4）。

W 是已完整消费前缀，不是“屏幕最后一条消息 seq”；事件不是消息，不能靠消息数量推断遗漏。
应用可能持久通知消费投影而只保留有限正文；补通知不必在 UI 展开所有历史，但仍须扫描遗漏的正式事实。
聊天拓扑须处理 surfaceOp 替换及 sourceEventSeqs；投影依赖早于 W 的节点时，利用已保存 fold 或补到所需前缀，不能只把消息按 seq 追加（D6）。
建议初次登录无 W 时初始化当前截点，历史按需向前加载；这假定首次设备历史无需逐次提醒，须路线核验。已有设备的断线恢复不能借此跳过未消费积压；本地记录丢失也不能未经判断就当新设备。
若重启丢失未确认前缀导致 C<W（不应发生于有效持久 ACK），暂停恢复并报告一致性错误，不减小 W 后悄悄成功。

## 四条静态轨迹

### 正常生成

`send(requestId)` → 接纳 → turn/start → user/message → assistant start/chunks → assistant/message(seq M) → committed end(M) → step/end → turn/end。
同步 Module 无损累计文字，暂存匹配的持久 settlement，end 明确命名 M 后关联最终全文；dsh 原生已有这段 fold（D4）。
消息结束即使文字未变也发布新的 outputPhase/version，呈现 Module 从完整原文后台解析格式；旧纯文本工作不得覆盖它。
turn/end 后如无 job，活动回 quiet；后台未提醒 episode 提醒一次。只有持久确认后 M/turn/end 才进入可恢复消费前缀。
停止发生在 chunks 后时，`assistant/message.interrupted` 可保留前缀（D5），同样执行终态格式收尾；cancel receipt 本身不充当终态。

### 长断线恢复

已确认 W=100；断线期间产生 101..350；重连尾窗 300..350，C=350，同时新事件 351..360 到来。
保持 351..360 尾部，固定 throughSeq=350 向后读到覆盖 101；按 seq 去重重叠页，回放 101..350 更新消息/活动。
如果生成仍在进行，baseline 已含当前 attempt 累计前缀，从 nextIndex 接后续，不能又把前缀当 delta 追加。
如果生成已经结束，正式 assistant/message 恢复完整正文；不要求重新拉已退休 attempt 的 live chunks（D1、D4）。
确认 C 落盘并应用完整后按会话只发一条积压摘要；前台不发。351..360 接续处理，不能被补页旧状态覆盖。
任何页失败则保留 syncing/不确定，不推进 W 到350也不提早称积压已处理；下次重连再次从有效 W 对账。

### 生成中收到投递

会话 S 正在 attempt A，delivery/message 在 S 的 seq D 提交；它直接成为普通 Fairy row，内部保存 deliveryId、发送身份及 persona。
A 的临时 row 以 attemptId 标识，D 的 row 以持久 identity 标识；不能用“最后 assistant 气泡”定位增量，否则后续 A chunks 会误写进 D。
最终 end 指向 M，与 A 的 turn/step 对账，D 独立保留；活动仍为原 episode，随后 reply 结束而 job 未结束仍 active。
投递写入收件方固定主会话；本轨迹的 S 即该主会话。投递不调用收件方 agent.prompt/inject 启动推理；之后用户回复进入该会话时，正式投递由后端模型历史投影提供上下文。
通知仅消费会话活动，不由投递 handler 再发一次；若同次活动已提醒，结尾只更新原通知。

### 任务输出缺失

客户端保存 job J 的 nextByte=1024，重连 opened 显示 earliest=4096、total=8192；follow(from=1024) 返回 lossy 输出和 next。
详情保留已缓存前缀，标出 1024..4096 的缺口，再按 chunk.at/UTF-8 字节追加保留段；不能拿 Kotlin 字符长度充当 byte offset（D9、D10）。
正常记录每帧 next 避免块内重叠；任意块内 cursor 可能获得重叠整块，必须去重/裁剪并尊重 UTF-8 边界（D9）。
status 在保留输出 drain 后到达（D8）；卡片终态与缺失说明同时保留，不能因 completed 就宣称日志完整。
Host 重启导致 J 不存在时，利用原会话生命周期/结果事实显示已知信息和当前 unavailable；不轮询旧 ID 当作 running，不宣称自动续跑。
停止任务走 job.kill(S,J)，停止回复走 cancel(S)，任一 receipt 不给另一个对象设终态。

## 可信接线与实施验证

原生 unary 是 HTTP、stream 是 WS；Fairybot 是 SSE 累计快照（D15、F1、F3）。建议首版产品 Adapter 复用 dsh 载体，Android 实现对应 codec，暂不重造 transport。
可信 principal 在登录 admission 产生，HTTP RPC、WS upgrade/stream open、Fetch/upload/download 必须一致传入授权 Module。
每次资源调用校验 principal→session owner→job/attachment 资格；job 自带 owner fence 不代表用户拥有客户端填写的 sessionId（D7、D14）。
会话列表/控制流也须过滤用户范围，不能先推全部会话再让 UI 隐藏；持续 stream 应按会话权限撤销关闭，旧账号 generation 不能写入新账号缓存。
通知点击先验证当前账号与目标会话，附件 receipt 不成为跨会话能力；群组资源资格在实际文件操作时复核。
用户补充首版不做音视频附件兼容；通用文件引用不代表模型可直接理解文件全文，用户已确认 PDF 由后端提取文字并按需读取扫描页/图表图片；客户端只提交同资格的 PDF 引用，内容读取接线由输入链路研究负责，ASR 输入保留。
这份接线要求不选择登录 token 形状、不让连接 Module 决定业务角色；普通 Fairy 外观不能抹去服务器来源和人格归属。

路线采纳前需核验两组假设：同会话回复结束但任务仍运行、任务最后结束无新正文、活跃时插入投递的提醒时机；首次新设备登录与通知记录丢失后的积压消费方式。若上述活动聚合或初始化建议无法满足已定提醒行为，报告具体冲突再决定，而非将建议自动当作产品确认。

以下验证仍必须在产品集成完成后做，不能把本报告视为通过记录：
- 固定截点/并发 append/flush 失败、分页重叠、surface replacement、连接代际切换及进程崩溃恢复。
- 送达落盘再确认；投递来源的模型请求转换、附件限制、重复 delivery/request 的幂等范围及越权拒绝。
- activity 与 job lifecycle 记录的一致性、Host 重启不确定态、缺失日志与分别停止的实际效果。
- 前台抑制、长断线每会话合并、提醒消费崩溃窗口、账号切换和点击定位。
- rikkahub 接线到远端 StateFlow，而非保留 ChatService 本地执行；列表/详情共享终态格式与滚动连续性（R1–R4、F2）。
- vivo S50 release 中长正文、持续输入、突发重连的接收到呈现延迟及内存/帧耗时；源码中的快照合并不证明真机达标。
