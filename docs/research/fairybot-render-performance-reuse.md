# Fairybot 消息呈现性能优化的复用审核

审核日期：2026-10-14。只读源码研究；Fairybot 基线 `095efdd84fd7ab2215a0b5b03369aac4f1303108`，rikkahub 基线 `0966502c4d65c1ee4b2a3e49a19703bb1978016c`。未修改这两个项目，未运行测试、构建或设备测量。下列测试证据指现存测试的断言，不能表述为本轮已通过。

## 结论

用户所说旧版已经优化过，有明确源码依据。Fairybot 已经解决了「每次新增都重新解析前面所有已完成段落」和「慢解析时不断排队旧版本」两类问题，也专门处理了终态、手势和展示连续性。应优先继承这些调度与归属原则，由一个消息呈现模块承担，避免业务调用处各自补丁。

用户本次明确的新策略是流式期间先显示保留 `##` 等符号的纯文本，输出结束后完整呈现格式。这不是 Fairybot 当前旧行为：旧版在流式期间也渲染 Markdown，并有保持同一组件树的合同。新策略应表达为同一消息呈现模块内部的两个阶段，不能让旧合同覆盖本次选择。研究本身没有实施新策略。

## 旧版实际做了什么

下文 `F` 指 `/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/`，`T` 指该项目 `mobile/app/src/test/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdownTest.kt`。所有行号均对应上述固定 commit。

| 已有机制 | 直接证据 | 对用户痛点的作用与边界 |
| --- | --- | --- |
| 一个 UI 入口，内部持有工作线程、解析结果和组件身份；会话列表和详情复用 | [合同](/home/eafen405/projects/Fairybot/docs/client/streaming-markdown.md:5)、[入口](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/StreamingMarkdownMessage.kt:47) | 优化由模块内部完成。入口接收内容与流式状态，不要求业务调用方安排线程、节流、稳定块。 |
| 增量扫描新增字符；段落闭合后解析一次，保留块对象；只反复解析未闭合尾部 | [文档更新](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdown.kt:292)、[扫描与围栏](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdown.kt:336)、[块解析](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdown.kt:383) | 已完成的前半篇不用随着后面增长重新解析。长未闭合代码、没有空行的巨型段落仍可能是很大的活动尾部，不能声称所有工作量都恒定。 |
| 单个持久 worker，`Channel.CONFLATED` 仅保留最新待处理的完整文本快照，解析在 `Dispatchers.Default` | [worker](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdown.kt:437)、[解析](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdown.kt:517) | 处理慢时不会把每个旧画面逐一排队。合并的是完整文本；原始增量仍必须先无损合并，不能对原始 delta 做有损丢弃。 |
| 允许同一次追加生成中较早完成的前缀结果先发布；文本替换或生命周期变化使旧结果失效 | [输入身份](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdown.kt:462)、[发布判定](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdown.kt:528) | 避免持续高速输入时，每次解析完成都因为不是最新版而丢弃，导致屏幕长时间不更新。流变为终态后旧流式结果不能覆盖终态。 |
| 8,000 字符以上流式文档按至少 16 ms 间隔处理；每次等待先取最新输入；终态不受此节奏限制 | [常量](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdown.kt:28)、[调度](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdown.kt:490) | 可继承按帧合并原则；16 ms 是旧版参数，不是新设备已达标证明。终态免除节流等待，但不能中断已在执行的同步解析。 |
| 代码/展示公式横向手势期间冻结可见快照，只保存最新待发布结果，所有手势结束后发布一次 | [gate](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/StreamingMarkdownInteractionCommitGate.kt:9)、[解锁发布](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdown.kt:476)、[合同](/home/eafen405/projects/Fairybot/docs/client/streaming-markdown.md:15) | 避免滑动中的内部内容被新布局替换；这不是整个会话列表滑动期间停止接收内容。 |
| 流式与完成保留稳定块、尾块 key 和选择容器，不因结束重建整棵 Markdown 子树 | [流式路径连续性](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/StreamingMarkdownMessage.kt:108)、[稳定块与尾块 key](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/StreamingMarkdownMessage.kt:165)、[尾块终态](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdown.kt:314) | 旧版针对结束时闪动、短暂零高度、代码横向滚动状态丢失的处理值得继承。新纯文本转格式必然可能改变排版，需要模块内部处理位置连续性，不能机械照搬旧路径。 |
| 字形淡入只改变绘制透明度，原文和布局保持稳定；发布时记录出生时间 | [纯文本入口](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/StableStreamingText.kt:12)、[tracker](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdown.kt:173)、[合同](/home/eafen405/projects/Fairybot/docs/client/streaming-markdown.md:37) | `k=2 s^-1`、500 ms 达到完全不透明是既有视觉决定；文字已发布后的淡入与未发布积压须分别计量，不能把淡入自动归因为 bug 或默认取消。 |

增量扫描不等于整条处理链的工作量都只与新增字符有关。`startsWith` 校验、完整快照字符串、`toRenderableMarkdownText()`、活动尾部解析和 Compose 文本测量仍有长度相关成本。纯文本策略可去掉流中 Markdown 解析与富文本布局的大部分反复成本，但一条无限增长的纯文本本身也仍需布局，不能仅凭策略承诺任意长度都不慢。

## 与 rikkahub 的复用边界

rikkahub [Markdown.kt:95](/home/eafen405/projects/rikkahub/ui/src/main/java/me/rerere/ui/markdown/Markdown.kt:95) 首次同步全文解析，后续 `snapshotFlow → conflate → parse → Default`；[MarkdownParser.kt:41](/home/eafen405/projects/rikkahub/ui/src/main/java/me/rerere/ui/markdown/MarkdownParser.kt:41) 经 Markdown AST、HTML、Jsoup DOM 转成自己的 `MarkdownDocument`。Fairybot 则将 JetBrains AST 直接交给 Mike Penz Markdown Compose 的组件树（[适配](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/StreamingMarkdownMessage.kt:225)）。

可直接借鉴的是完整快照合并、一个 worker、结果身份校验、终态调度、手势期间只留最新结果，以及模块统一入口。旧版 AST/组件、淡入注入、选择容器和自定义 LaTeX/代码接入需要适配，不能复制文件后宣称可用。稳定块扫描思想可以复用，但新选择流中纯文本后，无需先移植一套流式 Markdown AST 系统才能实现此策略。

完成时可利用 rikkahub 已有 [Markdown(document=...)](/home/eafen405/projects/rikkahub/ui/src/main/java/me/rerere/ui/markdown/Markdown.kt:57)：模块在后台对完整原文做一次完整解析，再提交预解析结果。完整文档解析还可让引用链接等跨段语义使用全篇上下文；机械把段落各自解析再拼接不能自动保证这一点。

## 完整终态格式防漏的必要约束（新策略建议，尚未实现）

1. 原始文本始终是权威输入。流中纯文本保留 Markdown 符号、代码围栏和公式定界符；不能先剥掉格式，再试图从展示文本还原。
2. 处理身份包含消息归属、内容版本与阶段。最后一个 token 到达和输出结束可以没有文本差异；终态变化仍须触发最终格式处理，不能只用「字符串未变化」跳过。Fairybot 的输入 generation 已将 `isStreaming` 变化计入身份；新模块应保留该性质。
3. 正常完成、停止、错误等结束路径都对已收到的完整内容执行终态处理；恢复历史也应直接得到终态格式。不能只监听一个“成功结束”事件。
4. 最终解析和提交必须对应最新终态版本；旧流式工作不能随后把纯文本盖回来。终态结果未准备好时保留已有纯文本，避免空白帧或漏掉末尾内容。
5. 完整格式处理成功后原子发布整份结果，列表与详情共用。解析失败须保留全文并有可恢复路径，不能吞掉异常后把永久纯文本当作“格式完成”。rikkahub 当前 `mapNotNull(runCatching(...).getOrNull())` 只静默忽略失败，不能单独充当防漏机制。
6. 验收包含文本不变的终态切换、末个增量紧邻结束、流式结果晚于终态返回、停止/失败、重连历史、长代码/表格/公式、跨段引用，以及格式化前后阅读位置与全文完整性。这些是新策略验收要求，不是旧测试已有结论。

## 测试与实测证据边界

现存 [增量扫描测试](/home/eafen405/projects/Fairybot/mobile/app/src/test/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdownTest.kt:25) 断言只增加新字符的扫描计数且稳定块对象复用；[围栏测试](/home/eafen405/projects/Fairybot/mobile/app/src/test/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdownTest.kt:44) 断言围栏内空行不错误结束代码块；[终态测试](/home/eafen405/projects/Fairybot/mobile/app/src/test/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdownTest.kt:60) 断言稳定块复用、尾块起点保留和终态状态；[gate 测试](/home/eafen405/projects/Fairybot/mobile/app/src/test/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdownTest.kt:418) 覆盖最新结果覆盖和多手势全部释放。

这些是算法/状态断言，不证明真实界面不卡、不证明新纯文本阶段最终格式一定完整，也未覆盖完整 worker 的持续高速输入表现。代码有 `md`、`mdpub`、`present` trace 点（[worker](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/IncrementalStreamingMarkdown.kt:519)、[首帧](/home/eafen405/projects/Fairybot/mobile/app/src/main/java/com/newoether/agora/ui/chat/message/StreamingMarkdownMessage.kt:149)），可继承为解析、发布、呈现的分段测量。目标端还需分别测内容收到到发布/呈现的延迟、持续输出期间的滚动掉帧与最终格式转换成本。本轮没有查旧临时档案，没有把用户的旧体验或源码存在当成设备性能数字。
