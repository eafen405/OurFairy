> 2026-10-20 状态：现行。本文记录 2026-10-20 的判断，不描述当前实现。

# 研究索引与研究基线

本目录是日期化调查，不描述当前状态。每篇保留当时的判断，首行标注状态与记录日期，正文不改写；被后续票取代的部分在文内单独标出。要看当前实现，读[父规格](../specs/ourfairy-v1.md)与版本组合的唯一权威 [`combo.json`](../../combo.json)。

## 研究基线

本目录的调查以下列三个固定上游提交为基线。

**研究上游 SHA 不是产品提交。** 产品组合由 [`combo.json`](../../combo.json) 记录（dsh 的产品提交、客户端快照来源），任何报告不得把下面的上游 SHA 当作已含产品改动。

| 角色 | 提交 | 说明 |
| --- | --- | --- |
| dsh 上游基线 | `d743267388641bc76f17c45ce8b4c231aed1d32c` | dsh fork 的产品改动从其之上开始；本目录的 dsh 源码调查以此为准 |
| rikkahub 研究基线 | `0966502c4d65c1ee4b2a3e49a19703bb1978016c` | 客户端的调研基线，不是产品提交；客户端已内联为快照，来源声明见 [`android/ourfairy-source.json`](../../android/ourfairy-source.json) |
| Fairybot 只读参考 | `095efdd84fd7ab2215a0b5b03369aac4f1303108` | 上一代产品的只读参考，不改 |

本节是这三个研究基线的唯一声明处：各篇调查在正文里引用它们，只是记录当时读的是哪个提交。规格与 `work/implementation/CONVENTIONS.md` 里的副本由 #127、#129 收敛为指向本节的指针。

## 目录

| 文件 | 日期 | 主题 |
| --- | --- | --- |
| [2026-10-20-luo-relay-diagnosis.md](2026-10-20-luo-relay-diagnosis.md) | 2026-10-20 | luo 中转站故障诊断：伪造 `finish_reason: length`、空响应与特殊 token 混入正文的根因定位。 |
| [android-notification-audit.md](android-notification-audit.md) | 2026-10-14 | Android / vivo 通知结论审计：纠正 Force Stop、Doze 维护窗口、FGS 超时与 vpush 资格的误述。 |
| [android-notifications.md](android-notifications.md) | 2026-10-13 | rikkahub 现有通知能力核查：系统通知构建、点击定位与会话入口的源码位置。 |
| [backend-references.md](backend-references.md) | 2026-10-13 | Koishi、Open WebUI、LibreChat 的后端骨架参考，以及没有可直接照搬的结论。 |
| [domestic-android-background-delivery.md](domestic-android-background-delivery.md) | 2026-10-14 | 国内 Android 后台消息通道核查：无 Google 依赖的前台服务、vivo 推送与 UnifiedPush 的能力边界。 |
| [domestic-android-notification-vivopush-revival.md](domestic-android-notification-vivopush-revival.md) | 2026-10-14 | vivo S50 通知通道能力边界的旧研究，部分结论已被[通知审计](android-notification-audit.md)纠正。 |
| [dsh-event-consumption-audit.md](dsh-event-consumption-audit.md) | 2026-10-14 | dsh 事件消费研究的源码复核：纠正单传输、`throughSeq`、token 兑换与授权等误判。 |
| [dsh-event-consumption.md](dsh-event-consumption.md) | 2026-10-14 | dsh 事件消费、jobs 与客户端补取的事实层旧研究，结论已被[源码复核](dsh-event-consumption-audit.md)取代。 |
| [dsh-sandbox-reuse.md](dsh-sandbox-reuse.md) | 2026-10-14 | Fairybot 空间权限与 dsh sandbox 的复用边界：可复用的授权逻辑与受限文件系统。 |
| [dsh-skeleton.md](dsh-skeleton.md) | 2026-10-13 | dsh 骨架能力研究：用户作用域、共享能力与插件替换点。 |
| [fairybot-features.md](fairybot-features.md) | 2026-10-13 | Fairybot 已有功能清单：作为候选需求来源，条目默认待取舍。 |
| [fairybot-render-performance-reuse.md](fairybot-render-performance-reuse.md) | 2026-10-14 | Fairybot 消息呈现性能复用的审核：增量扫描、终态收尾与调度原则。 |
| [fairybot-stream-performance-reuse.md](fairybot-stream-performance-reuse.md) | 2026-10-14 | Fairybot 流式接收与显示防积压的复用审核：快照发布链与迁移边界。 |
| [frontend-handoff-audit.md](frontend-handoff-audit.md) | 2026-10-14 | 前端 wayfinder 交接与既有结论审核：区分已定决议、推断与待选 UI。 |
| [frontend-pruning.md](frontend-pruning.md) | 2026-10-13 | 前端 fork 模块价值与剪枝候选：rikkahub 与 Fairybot 的可复用部分。 |
| [message-model.md](message-model.md) | 2026-10-13 | dsh 消息模型与会话关键词检索的事实层。 |
| [persona-context-and-injection-resistance.md](persona-context-and-injection-resistance.md) | 2026-10-14 | 人格上下文工程、多用户隔离与提示词注入抵抗力：结构侧与措辞侧的区分。 |
| [proactive-agents.md](proactive-agents.md) | 2026-10-13 | 主动式 agent 的任务触发与通知决策论文研究。 |
| [rikkahub-architecture.md](rikkahub-architecture.md) | 2026-10-14 | rikkahub 客户端架构图与模块说明：接线事实层。 |
| [rikkahub-scroll-performance.md](rikkahub-scroll-performance.md) | 2026-10-14 | rikkahub 滑动与富文本渲染性能的复用审核及其边界。 |
| [rikkahub-stream-performance.md](rikkahub-stream-performance.md) | 2026-10-14 | rikkahub 流式输出性能：可复用能力与瓶颈边界。 |
| [session-owner-execution.md](session-owner-execution.md) | 2026-10-14 | 会话归属如何贯穿执行与访问：事实、已确认要求与推论。 |
| [v1-backend-readiness.md](v1-backend-readiness.md) | 2026-10-14 | 首版后端适配：装配闭包、会话归属与投递写入的可行性研究。 |
| [v1-client-contract.md](v1-client-contract.md) | 2026-10-14 | 首版共同 Interface：会话投影、恢复与活动的工程建议。 |
| [v1-input-path.md](v1-input-path.md) | 2026-10-14 | 首版输入链路：ASR、附件与 PDF 的兼容性研究。 |

本文件是索引本身，不在上表内：`docs/research/` 现有 26 个 Markdown 文件＝上表 25 篇日期化调查 ＋ 本索引。
