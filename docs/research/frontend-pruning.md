> 2026-10-20 状态：现行。本文记录 2026-10-13 的判断，不描述当前实现。

# 前端 fork 模块价值与剪枝候选

研究日期：2026-10-13。对应决策票：[研究前端 fork 的模块价值：保留、适配与剪枝候选](https://github.com/eafen405/OurFairy/issues/6)。这是源码事实和候选矩阵，不是已确认的功能取舍，也不实施剪枝。

## 结论

RikkaHub 可复用的价值集中在 Android 对话呈现、输入、媒体与平台设施；其核心聊天链路同时承担模型调用、工具循环和本地权威存储。前后端分离需要改变这条链路的职责，不能只把 provider 的地址改为 OurFairy API，也不能直接删除整个 `ai` 模块。

Fairybot 前端已经是远端客户端，可提供交互行为、视觉资源和验收用例。但其协议和状态实现依赖旧后端的单主会话、反馈投影、上传和文件交付规则；保留视觉与行为不意味着接受旧架构。

当前目标：先 Android；法厄同入口称为网关，提供对话和配置，代理人入口提供 agent 对话。用户明确希望保留 Fairybot 视觉。以下所有其他产品取舍仍待讨论。

## 证据范围

- RikkaHub 本地提交 `0966502c4d65c1ee4b2a3e49a19703bb1978016c`。
- Fairybot 本地提交 `095efdd84fd7ab2215a0b5b03369aac4f1303108`。
- 直接读取源码、Gradle 配置和客户端合同；源码定位见末尾。固定提交链接供复查，未逐个验证 GitHub 是否保留这些提交。
- 通知能力沿用主工作区 `docs/research/android-notifications.md` 的核查，未重复选择推送机制。未编译、未做设备或视觉验收，因此“较独立”只表示源码依赖较少，不保证拷贝即编译或交互性能相同。

## 候选矩阵

“剪枝”指从客户端运行职责或入口中移除；不必物理删除整个上游模块。“适配”指保留有价值的行为，改变数据来源或依赖。每项均需后续人工决策。

| 能力 / 模块 | 现有职责和证据 | 候选 | 前后端分离后的边界及依赖影响 |
| --- | --- | --- | --- |
| Fairy 主题、字体、背景、回复面板、眼睛 | Fairybot `FairyTokens`、`Theme`、`FairyEyeMotion`、`FairyDialogPanel`；固定海军蓝主题和字体合同 [F1–F3] | 保留视觉；适配组件连接 | token、绘制、字体适合优先复用；事件驱动眼睛的 `RemoteConversationFairy` 依赖旧 `ChatMessage`/连接/工具状态，需接新展示状态。字体资源和署名一起保留 |
| 消息 Markdown、代码高亮、数学、媒体预览 | RikkaHub `ChatMessage` 与 richtext；Fairybot 增量 Markdown 与详情 [R3, F4] | 保留/适配 | 复用展示能力；选一套主渲染路径，避免两个并行解析器。RikkaHub 消息组件依赖 `MessageNode`、`UIMessage`、`Model`、`Assistant`、导航与设置，整块不是纯 UI 黑盒 |
| 流式输出、列表、历史分页与滚动 | RikkaHub `ChatVM` 从 `ChatService` 获取生成 Job/会话 Flow；Fairybot 远程分页和 live overlay [R1, F5] | 适配 | 进度改来自后端；客户端生命周期只管理观察。Fairybot“整页 SSE、nodes/messages 同序、live-* 对 e<seq>”是旧协议假设，不应自动固定为新协议 |
| 输入、草稿、附件选择 | RikkaHub `ChatInput`、`ChatAttachmentPicker`；Fairybot `RemoteAttachmentDrafts` [R4, F5] | 保留/适配 | 选择、草稿、拍照等是设备职责；上传完成后的附件引用由后端定义。旧三阶段上传及特定限额只是现有实现，不是新需求 |
| 文件卡、下载、预览、保存 | Fairybot `RemoteFileDownloads`/`RemoteFileStore` 与 Android SAF [F5] | 保留行为、适配协议 | 文件 ID/引用来自后端；本地缓存和保存仍在手机。不能用后端路径替代客户端 URI。跨会话附件展示可复用文件卡，不必把旧 `relayFrom` 用户来源语义搬入新产品 |
| 本地 provider 与 agent loop | RikkaHub `GenerationLoop` 调 provider、处理 tool calls/审批、执行工具 [R2] | 客户端执行职责剪枝 | 由 dsh 后端执行；`ChatService` 还承载会话状态和 UI Flow，不能直接删除后指望 `ChatVM` 保持可用；需先换清晰的数据与操作入口 |
| 本地工具、MCP、搜索、workspace、记忆蒸馏 | `ChatService` 导入工具工厂、MCP、workspace、transformers、记忆调度 [R1, R2, R7] | 执行部分剪枝；对应展示暂缓 | 首版主要后端执行，不把手机 shell/workspace 工具链带进来。`search/workspace` 等项目删除前须移除 DI、配置、页面和模型依赖；工具活动展示可以保留，工具执行实现无需留在手机 |
| `ai` 消息表示 | `UIMessage` 包含文本、附件、推理、工具、模型快照；`ChatMessage` 直接引用 [R3] | 先保留必要类型，后评估拆分 | 展示与 provider 实现同处一个 Gradle 模块。保留类型或做一次后端数据到展示模型映射都可讨论；不可把整个 provider SDK 的依赖代价当作零，也不应按每个类型加转发层 |
| Room 会话树、搜索、分叉、收藏 | `ConversationRepository` 操作 Room、FTS、分页；消息节点表示分支 [R5] | 权威存储剪枝；缓存适配；额外功能暂缓 | 后端拥有权威会话。Room 是否仍作缓存是独立问题；分支选择、重生成、编辑、删除必须有后端语义才能保留按钮，不能仅因为 UI 有就默认实现第二套会话状态 |
| 配置、provider key、Assistant/skills/MCP | RikkaHub 以本地 Settings/Assistant 会话配置快照驱动执行 [R1, R6]；Fairybot 有管理入口 [F6] | 法厄同配置适配；代理人管理入口剪枝候选 | 本地字体/显示偏好和后端配置区分归属。个人 API key 是否支持未决；不因已有 provider 编辑页就默认让手机保管或直接用 key。法厄同系统管理权限不代表能读代理人个人内容 |
| 登录、邀请码、连接恢复 | Fairybot 已有 `/api/register`、`/api/login`、cookie 持久化与账号角色 [F5, F6] | 复用体验/测试；适配实现 | 认证合同等后端骨架确定。旧包名、cookie 名、单 main-session gate、兼容检查常量不自动成为 OurFairy 契约 |
| 通知展示、点击到会话 | RikkaHub 本地生成通知；Fairybot 远端通知同步 [N, F7] | 呈现保留/适配；传输待研究 | RikkaHub 本地生成前台服务不是后端推送通道；其读取其他应用通知未发现实现。Fairybot 远端通知同步值得参考，但不据此定推送或主动策略 |
| 语音输入/输出 | RikkaHub `speech`；Fairybot `SpeechSessionController`、`RemoteSpeechInput` [R7, F8] | 输入交互保留候选；ASR/TTS执行位置待定 | 麦克风、录音/取消是设备职责，识别可经后端。语音功能不要求保留客户端模型调用链；VOICE_API_KEY 是硅基流动识别服务，不在客户端复制密钥 |
| 嵌入 Web server 与 web-ui | RikkaHub Android Ktor routes 调同机 `ChatService`/Room [R8] | 首版安卓剪枝候选；React/TS 暂缓 | 现有方向是浏览器调用手机运行的服务，不是手机调用中央服务。不能因已有 Web UI 就当成中央后端网关；可另评估组件，但不作为本票实施工作 |
| 图片/媒体生成、翻译、备份、多主题、收藏等外围页 | settings includes mediagen/oauth/web/search 等模块；页面树包含上述入口 [R6, R7] | 暂缓、逐项取舍 | 用途未确认；媒体显示不等于需要生成页，缓存不等于要同步完整本地库。删页面后仍须检查导航、DI、Gradle、资源和通用类型消费，不能按目录整块删除 |

## 最重要的依赖边界

1. **展示模型与执行模型目前混在一起。** RikkaHub UI 不是无依赖组件库；可保留有用底层 UI 模块和渲染逻辑，但 `ChatVM → ChatService → GenerationLoop/Room/Settings` 这条主链需换为远端会话来源。是否保持现有客户端服务接口以减少 UI 修改，应在前端取舍票讨论，不能先发明大量仓库/控制器。
2. **视觉可以沿用，协议不可顺带继承。** Fairy 颜色、字体、面板、绘制动效较接近独立资产；眼睛的触发条件、流式列表、附件卡依赖状态模型。Fairybot 已实现远端形态，是需求与测试证据，不是强制架构模板。
3. **展示保留与执行移走分别判断。** 工具活动、推理状态、文件结果仍可显示；这并不要求在 Android 保留工具循环、搜索 SDK、workspace 或记忆蒸馏。

## 与后端协商的最小契约问题

- 用户进入哪些会话，如何列出/创建/恢复？旧 Fairybot 单主会话不能替代当前多会话需求。
- 发消息、停止、继续执行及服务器接纳后的消息身份如何表达？流式片段怎样回到同一条权威消息？传输协议由后端研究决定。
- Fairy 从 A 向 B 投递的正文和附件，在 B 中是 Fairy 消息。前端应消费普通会话消息，不引入发送用户确认或二次授权界面。
- 附件上传和下载引用如何表示；哪些是消息内容，哪些是设备临时草稿？不要求复制旧路径/交付数据结构。
- 法厄同可配置的后端能力是什么；代理人的显示偏好是否仅在设备？个人 key、空间界面、记忆界面均待相应决策。
- 客户端需要哪些运行状态和工具展示数据？RikkaHub 的完整 tool payload 与 Fairybot 的 curated label 代表不同选择，应明确再适配。
- 后端主动消息如何成为可补取的会话消息，手机如何收到提示？通知采集 hook、Fairy 激活策略与消息展示分开研究。

这些是设计问题清单，不是在本票中制定接口、数据库、推送或同步协议。

## 一手来源

RikkaHub 链接均固定到上述提交；目录和文件即本地实际核查定位。

- **R1**：[ChatVM](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/ui/pages/chat/ChatVM.kt)、[ChatService](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/service/ChatService.kt)。
- **R2**：[GenerationLoop](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/data/ai/GenerationLoop.kt)。
- **R3**：[ChatMessage](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/ui/components/message/ChatMessage.kt)、[UIMessage](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/ai/src/main/java/me/rerere/ai/ui/Message.kt)。
- **R4**：[ChatAttachmentPicker](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/ui/components/ai/ChatAttachmentPicker.kt)。
- **R5**：[ConversationRepository](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/data/repository/ConversationRepository.kt)。
- **R6**：[页面树](https://github.com/rikkahub/rikkahub/tree/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/ui/pages)、[AGENTS.md](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/AGENTS.md)。
- **R7**：[settings.gradle.kts](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/settings.gradle.kts)、[app/build.gradle.kts](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/build.gradle.kts)。
- **R8**：[ConversationRoutes](https://github.com/rikkahub/rikkahub/blob/0966502c4d65c1ee4b2a3e49a19703bb1978016c/app/src/main/java/me/rerere/rikkahub/web/routes/ConversationRoutes.kt)。
- **F1**：[视觉合同](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/docs/client/fairy-visual.md)。
- **F2**：[主题](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/ui/theme/Theme.kt)、[Tokens](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/ui/theme/FairyTokens.kt)。
- **F3**：[眼睛动效](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/ui/components/FairyEyeMotion.kt)、[会话动效连接](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/ui/remote/RemoteConversationFairy.kt)。
- **F4**：[流式 Markdown 合同](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/docs/client/streaming-markdown.md)。
- **F5**：[远端会话合同](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/docs/client/remote-sessions.md)、[RemoteProtocol](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/remote/RemoteProtocol.kt)。
- **F6**：[FiloClient](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/remote/FiloClient.kt)。
- **F7**：[RemoteNotificationSync](https://github.com/eafen405/Fairybot/blob/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/service/RemoteNotificationSync.kt)。
- **F8**：[语音源码目录](https://github.com/eafen405/Fairybot/tree/095efdd84fd7ab2215a0b5b03369aac4f1303108/mobile/app/src/main/java/com/newoether/agora/speech)。
- **N**：OurFairy 主工作区已有 `docs/research/android-notifications.md`（2026-10-13）；本票复用其结论，平台来源与限制见该报告。

## 研究后的下一步

在“确定前端保留与剪枝范围”人工票中选择首版入口和展示能力；之后结合后端会话/身份骨架确定最小远端契约。届时再评估删哪些 Gradle 模块以及能原样复用哪些组件。本票只解决候选模块、依赖和职责变化的信息缺口。
