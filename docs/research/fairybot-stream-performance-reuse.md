> 2026-10-20 状态：现行。本文记录 2026-10-14 的判断，不描述当前实现。

# Fairybot 流式接收与显示防积压：复用审核

审核对象：本地 `/home/eafen405/projects/Fairybot`，commit `095efdd84fd7ab2215a0b5b03369aac4f1303108`。只读取源码、合同与测试；本轮未运行测试、benchmark 或设备测量，不报告通过或性能数字。未修改 Fairybot，保留已有无关未跟踪文件。

## 结论

Fairybot 已经实现了针对“接收很快，但屏幕一直追赶旧进度”的完整优化链，值得复用。它先收齐所有原始文字，再只处理最新的待显示版本；后端发布、网络阻塞、客户端解码和 Markdown 处理都有对应边界。不能把这些已完成的优化笼统列成尚未解决的问题。

关键差异：Fairybot 的手机协议传的是**累计完整页面快照**，不是逐字增量。它可以跳过中间快照，因为下一份包含之前的全部文字。OurFairy 若直接接收 dsh 原始增量，必须先按顺序无损归并，再在展示层丢弃过时快照，不能直接对原始增量使用 `conflate`。这与 [rikkahub 流式审核](rikkahub-stream-performance.md) 的迁移原则一致。

## 已有实现与来源

以下链接均固定到上述 commit。

| 边界 | Fairybot 做了什么 | 原始依据 |
| --- | --- | --- |
| 原始输入 | 事件总线同步按会话分发；每条 `text/delta` 都先追加到当前正文，再安排显示发布。没有在这层丢文字。 | [live.ts:42](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/live.ts#L42)、[mobile-projection.ts:653](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/mobile-projection.ts#L653) |
| 发布节奏 | 只有一个 16 ms 定时器；后来的文字进入同一份累计状态，不增加定时器，也不反复延后已有定时器。持续输出时仍持续发布，不必等待停流。 | [mobile-projection.ts:550](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/mobile-projection.ts#L550)、[mobile-projection.ts:566](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/mobile-projection.ts#L566) |
| 结束处理 | 最终 `assistant/message` 以完整正文结算并立即发布；`turn/end` 立即发布，再从已经落盘的日志重建持久基底并发布。立即发布会清理待发布计时器。 | [mobile-projection.ts:609](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/mobile-projection.ts#L609)、[mobile-projection.ts:665](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/mobile-projection.ts#L665) |
| 历史重复传输 | 活跃尾部存在时，最多附带一条长度不超过 1024 字符的历史锚点，历史另用游标获取；非活跃页面最多 32 条并用 4096 字符预算限制重复正文，至少返回一条完整历史消息。每份活快照复制可变记录，已发快照不会被后续修改。 | [mobile-projection.ts:21](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/mobile-projection.ts#L21)、[mobile-projection.ts:489](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/mobile-projection.ts#L489) |
| 网络阻塞 | HTTP 写入返回 false 时，只保留一份最新待发快照；`drain` 后再发。另保留待发错误，先发错误再发其后的状态。 | [mobile-stream.ts:4](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/src/server/mobile-stream.ts#L4) |
| 手机接收与解码 | 网络线程只读取完整 SSE 文本；解码前后的通道均只保留最新快照，JSON 解码在后台线程执行。干净 EOF 先排出最后完整快照，随后转为连接关闭错误，由 owner 重连。 | [FiloClient.kt:511](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/remote/FiloClient.kt#L511) |
| 会话状态 | 按当前连接身份接纳页面；相同页面不重复发布。重连跨过旧历史时补到重叠位置，临时 live 身份与持久身份对账；稳定尾部采用局部拓扑更新，全量重建放后台。 | [RemoteSessionReader.kt:166](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/remote/RemoteSessionReader.kt#L166)、[RemoteTopologyProjector.kt:34](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/remote/RemoteTopologyProjector.kt#L34) |
| Markdown 队列 | 每条已渲染消息只有一个持久 worker；最多保留一份最新待处理输入，后台顺序解析。长文等待期间不断取最新版本，结束/停止绕过长文刷新节奏；追加期间允许发布已算好的同代前缀，避免高速输入令界面永远等不到“最新解析”。替换正文或生命周期改变会使旧结果失效。 | [IncrementalStreamingMarkdown.kt:428](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdown.kt#L428) |

## 真实测试范围

- [mobile-stream.spec.ts:48](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/tests/mobile-stream.spec.ts#L48) 用假时钟模拟每 5 ms 一个字符增量；断言发布文本最多落后四个字符、最终正文立即出现、帧数受限、dispose 后不继续发。证明发布算法的行为，不证明真实 CPU、网络或手机延迟。
- 同文件 [73 行](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/tests/mobile-stream.spec.ts#L73) 检查旧帧不被后续文字修改、长历史不反复进入活快照；[139 行](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/tests/mobile-stream.spec.ts#L139) 检查重连时已结算正文不会重复；[251 行](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/tests/mobile-stream.spec.ts#L251) 用模拟 response 检查阻塞只留最新快照与错误次序。
- [FiloClientTest.kt:23](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/test/java/com/newoether/agora/remote/FiloClientTest.kt#L23) 通过本地 HTTP server 一次写 400 份增长快照、保持连接开放，要求十秒内读到 idle 的完整 400 字正文。证明不用等连接关闭才能收敛，不测试 Compose，不给出低延迟 p95 或慢消费者积压长度。
- [benchmark-mobile-stream.ts:9](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/scripts/benchmark-mobile-stream.ts#L9) 以 3000 条、每条 2048 字符历史，目标每秒 200 个字符增量，记录事件总线到序列化 SSE payload 就绪的延迟、帧数和大小。脚本明确排除模型 API、网络、Android 解码、Compose 和屏幕；不能拿它的宿主延迟声称手机已达标。
- 已有 `rx`、`decode`、`apply`、`md`、`mdpub` 与 `present` 阶段标记：[FiloClient.kt:537](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/remote/FiloClient.kt#L537)、[StreamingMarkdownMessage.kt:148](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/StreamingMarkdownMessage.kt#L148)。`present` 是发布后下一帧的近似标记，不等同于屏幕像素真正完成显示的证明。

## OurFairy 迁移落点与剩余边界

优先在会话内容接收与消息呈现的既有职责内迁移旧算法：接收模块先完整归并原始增量，再将累计版本提供给呈现模块；待显示版本最多一份，结束及时结算完整正文。调用者只提供会话身份、内容和运行状态，不各自调刷新频率、维护去重或补写最终文字。这不要求把网络协议和富文本解析集中到同一个万能模块。具体 16 ms 值应根据最终设备路径验证，算法比数值更重要。

用户本轮确定复杂 Markdown 可在输出时显示原始文本、输出完再完整渲染。旧 worker 的后台执行、最新待处理版本和结束结算逻辑仍可复用；但旧合同要求持续富文本解析，不应连同该产品规则照搬。最终 Markdown 处理不能被早先的纯文本结果覆盖，也不能漏掉停止/失败时已经收到的正文。

复用不等于没有成本：旧活快照仍含完整增长正文，序列化和 revision hash 仍随正文长度增长；客户端 SSE 行限制 1 MiB，当前算法不是任意大小文本的保证。旧末尾快照策略可消除过时画面的排队，但不能消除一次重排很长文本本身的耗时。需在最终前端的长回复、突发输入和终态格式恢复上测量，确定是否还要分块排版或更紧凑协议；本报告不据此推断旧版已经卡顿。
