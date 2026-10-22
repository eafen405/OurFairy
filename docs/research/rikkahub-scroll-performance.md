> 2026-10-20 状态：日期化记录。本文记录 2026-10-14 的判断，不描述当前实现。

# rikkahub 滑动与富文本渲染性能复用审核

日期：2026-10-14。只读源码基线：`/home/eafen405/projects/rikkahub`，commit `0966502c4d65c1ee4b2a3e49a19703bb1978016c`。本调查不运行设备基准，不据源码宣称帧率、首字延迟或 vivo S50 上的实际流畅度。

## 结论

rikkahub 已有值得完整复用的 Markdown 解析/渲染模块，能把流式更新的解析移出 UI 线程、丢弃过时的待解析版本、跳过内容相等的块。消息列表也有懒加载布局、稳定消息身份和不打断正在滚动用户的跟随逻辑。不能据此认定性能问题已经解决：历史长消息初次渲染仍同步解析；一条消息内的块、表格、代码行并未按视口虚拟化；高亮仍可能在 UI 线程计算；会话内历史消息并未真正按阅读位置分页加载。

建议复用单位是“消息列表及滚动行为”和“富文本呈现模块”，由模块内部承担解析调度、过时更新合并、稳定块、重内容降级，不把线程选择、节流参数、缓存策略分别暴露给每个业务调用方。既有 app 层 `MarkdownBlock` 对图片/公式/高亮的接入可留作视觉与能力适配层；后端传输与事件合并需单独适配，不能把这里的优化等同于网络流式链路已经优化。

## 已有优化及边界

| 代码事实 | 可复用价值 | 实际边界 |
|---|---|---|
| `ChatListNormal` 使用 `LazyColumn`，消息条目 key 为 `node.id`。只有最后一条在 loading 时收到 `loading=true`。 | 视口级消息布局复用、稳定身份；减少 loading 状态对所有消息的直接影响。 | 懒布局不等于数据分页；消息条目未声明 `contentType`。不能保证所有历史消息完全不重组。见 [ChatList.kt:313](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/ui/pages/chat/ChatList.kt:313)。 |
| Markdown 后续变化通过 `snapshotFlow → conflate → filter → parseMarkdown → flowOn(Dispatchers.Default)`，解析完才发布文档。 | UI 不等待每一份流式中间版本解析；最新内容能继续追上。 | `conflate` 不取消正在运行的解析；已启动的旧解析仍要结束。不是固定时间节流，也不是增量 AST 解析。见 [Markdown.kt:94](/home/eafen405/projects/rikkahub/ui/src/main/java/me/rerere/ui/markdown/Markdown.kt:94)。 |
| Markdown 文档和块是 `@Immutable` data class；单块以独立 Composable 呈现，内容相等时可跳过重组；行内分段使用 `remember(content)`。 | 尤其适合长回复前部已经完成、只增长末尾的情形。 | 后台解析仍重建全文文档；块的相等比较、容器布局和变化末块的文本测量仍有成本。并非复用旧 AST 的增量解析。见 [MarkdownNode.kt:14](/home/eafen405/projects/rikkahub/ui/src/main/java/me/rerere/ui/markdown/MarkdownNode.kt:14)、[MarkdownBlocks.kt:63](/home/eafen405/projects/rikkahub/ui/src/main/java/me/rerere/ui/markdown/MarkdownBlocks.kt:63)。 |
| `Markdown(document=...)` 接受预先解析的文档。 | 可在呈现模块内部为历史长消息安排提前后台解析，调用方无需管理渲染细节。 | 当前 `Markdown(content=...)` 初次解析在 `remember` 中同步执行，进入视口的历史长消息有潜在停顿风险。见 [Markdown.kt:57](/home/eafen405/projects/rikkahub/ui/src/main/java/me/rerere/ui/markdown/Markdown.kt:57)、[Markdown.kt:95](/home/eafen405/projects/rikkahub/ui/src/main/java/me/rerere/ui/markdown/Markdown.kt:95)。 |
| `CodeHighlightText` 按 code、language、colors、highlighter 使用 `remember`，长度超过 4096 时直接纯文本。代码块可只显示折叠的前 10 行。 | 内容不变时不重复高亮；默认整块路径已有复杂内容降级，折叠减少显示成本。 | 高亮在 Composable 的 `remember` 计算中同步执行；4096 是单次调用的字符阈值。行号+换行路径每行单独调用高亮，整个巨大代码块不会因总长度超过阈值而一起降级。见 [Highlighter.kt:20](/home/eafen405/projects/rikkahub/highlight/src/main/java/me/rerere/highlight/Highlighter.kt:20)、[Highlighter.kt:59](/home/eafen405/projects/rikkahub/highlight/src/main/java/me/rerere/highlight/Highlighter.kt:59)、[HighlightCodeBlock.kt:182](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/ui/components/richtext/HighlightCodeBlock.kt:182)、[HighlightCodeBlock.kt:254](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/ui/components/richtext/HighlightCodeBlock.kt:254)。 |
| 自动跟随仅在 loading、用户没有正在滚动、可见内容在底部时 `requestScrollToItem`。 | 流式输出时尽量跟随底部；手指正在滑动时不抢夺滚动。 | 每次布局变化都可能检查，底部附近停手后的具体体验仍需实测；不能据代码认定完全不会跳动。见 [ChatList.kt:238](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/ui/pages/chat/ChatList.kt:238)、[ChatList.kt:286](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/ui/pages/chat/ChatList.kt:286)。 |
| 图片使用 Coil `AsyncImage`，聊天图片关闭 crossfade，非导出允许 hardware bitmap；应用配置 singleton ImageLoader 与共享 OkHttp 网络 fetcher。 | 复用异步图片加载与同一加载器，避免自己在 UI 上下载、解码图片；减少图片淡入动画。 | 本次只确认这些设置，未审计 Coil 默认缓存实现或测量命中率；请求在组合中构造，并未自定义聊天图片尺寸/缓存容量策略。见 [ZoomableAsyncImage.kt:34](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/ui/components/richtext/ZoomableAsyncImage.kt:34)、[RouteActivity.kt:186](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/RouteActivity.kt:186)。 |

## 容易误判的“分页”与“缓存”

1. 会话列表有 Paging，`pageSize=20`、`initialLoadSize=40`，以 `LightConversationEntity` 转为不带消息节点的摘要。这是会话选择列表的优化，不是单个会话消息历史分页。见 [ConversationRepository.kt:38](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/data/repository/ConversationRepository.kt:38)、[ConversationRepository.kt:67](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/data/repository/ConversationRepository.kt:67)、[ConversationRepository.kt:466](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/data/repository/ConversationRepository.kt:466)。
2. 消息读取按 64 个节点查询数据库，但循环读到结束、解码每页并返回完整 `List<MessageNode>`。这是分批数据库读取，不是按用户阅读位置按需读取、淘汰旧页的消息窗口。见 [MessageNodeDAO.kt:22](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/data/db/dao/MessageNodeDAO.kt:22)、[ConversationRepository.kt:479](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/data/repository/ConversationRepository.kt:479)。
3. Markdown 和高亮的 `remember` 是当前组合位置中的复用，不能当作持久的跨消息解析缓存。Markdown 首次同步解析与 `parseMarkdown` 全文处理的事实可从 [Markdown.kt:95](/home/eafen405/projects/rikkahub/ui/src/main/java/me/rerere/ui/markdown/Markdown.kt:95)、[MarkdownParser.kt:41](/home/eafen405/projects/rikkahub/ui/src/main/java/me/rerere/ui/markdown/MarkdownParser.kt:41) 核对。

## 用户滑动时的剩余风险

- **单条巨大回复**：外层 LazyColumn 只虚拟化消息，内部 `MarkdownBlocks` 是普通 Column 全部遍历；进入视口时整条内容都可能涉及初次解析和块组合。不能仅靠保留外层列表解决。见 [MarkdownBlocks.kt:63](/home/eafen405/projects/rikkahub/ui/src/main/java/me/rerere/ui/markdown/MarkdownBlocks.kt:63)。
- **大代码块与代码流式增长**：未超过高亮阈值的当前变化代码仍同步重新高亮，逐行模式的整块成本没有统一阈值；文本布局成本即使降级纯文本也仍存在。见上述 Highlighter 与 HighlightCodeBlock 来源。
- **流式时布局动画**：助手气泡、思考链以及默认代码文本使用 `animateContentSize()`；这是现有视觉行为，可能增加同时流式增长与滑动的布局工作，尚不能认定为实际瓶颈。见 [ChatMessage.kt:327](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/ui/components/message/ChatMessage.kt:327)、[ChatMessage.kt:397](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/ui/components/message/ChatMessage.kt:397)、[HighlightCodeBlock.kt:339](/home/eafen405/projects/rikkahub/app/src/main/java/me/rerere/rikkahub/ui/components/richtext/HighlightCodeBlock.kt:339)。
- **高频全文解析**：后台化保护了主线程，但越来越长的全文持续解析仍消耗 CPU、分配内存，并可落后于接收速度。`conflate` 只限制过时版本积压；没有源码证据保证任意文本长度下的显示延迟。Markdown → HTML → Jsoup DOM → 块模型整条转换见 [MarkdownParser.kt:27](/home/eafen405/projects/rikkahub/ui/src/main/java/me/rerere/ui/markdown/MarkdownParser.kt:27)。

## 复用后的验证要求

至少在目标 vivo S50 上用 release/profileable 构建覆盖：长历史快速上滑、单条很长 Markdown、长代码且行号+换行、图文消息、后台仍在流式增长时阅读历史，以及回到底部继续跟随。把“手指滑动掉帧”与“已经收到内容却迟迟未显示”分别测量；前者看 frame timing，后者记录接收→呈现时间，不能用请求总耗时替代。当前只读研究未执行这些验证，因此无法给出通过结论或数值承诺。

仓库已有 Baseline Profile 模块与发送 Markdown 的采集脚本，可复用构建基础；脚本未覆盖上述快速滚动/长消息场景，本次也未验证其实际产物、运行结果。见 [app/build.gradle.kts:253](/home/eafen405/projects/rikkahub/app/build.gradle.kts:253)、[BaselineProfileGenerator.kt:44](/home/eafen405/projects/rikkahub/app/baselineprofile/src/main/java/me/rerere/baselineprofile/BaselineProfileGenerator.kt:44)。
