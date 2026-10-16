# T16–T19 Spec review — original findings

固定范围：OurFairy `1807199ffd86b1d1c2bfa816344d4e69f867b5cc...c820386`，Android `3ee4bc26dc2f7627b97fc9bd2800643e29a6c7b6...af9491ecc7437c454c372d924b5769a386e88d9b`；dsh 固定 `fe2bbc3b1c14efd7e1247cdc2990a657ab51f3ee`，本批无改动。只读审查，未修改仓库。

## 确认发现

**P2：长单条回复中部阅读时，纯文本转 Markdown 不能保持原文阅读位置。**

依据：票 `work/tickets/ourfairy-v1/19-presentation.md:23`（验收第5条“切换格式不…破坏阅读位置”）；父规格 `docs/specs/ourfairy-v1.md:121`（故事75）及 `:206`（§7“格式转换时保持阅读位置”）。

Android `app/src/main/java/me/rerere/rikkahub/ui/identity/RemoteTranscript.kt:97–116` 保存消息 key、item index 和 item 内像素 offset，格式切换前仅将原 offset 交给 `requestScrollToItem`。`:231–238` 在整篇后台解析结束后直接替换正文布局，`:246–254` 在 MarkdownBlock 与 Text 间切换。用户停在长单条中部时，上方代码、表格、公式的布局高度变化；同一像素 offset 因而可能对应另一段原文，稳定消息 key 无法修复消息内部的位移。

现有 `RemotePresentationTest.kt:69–73` 只验证 key/px target 与用户滚动优先，未覆盖这次布局转换。T19 owner 经只读核对明确确认此限制。建议最小修复聚焦实际格式切换生命周期，不扩展全局滚动架构。

## 其余结论

未发现 T16 ASR、T17文字PDF、T18页面渲染的确认规格缺陷或本批未经要求的 scope creep。认证、独立 `VOICE_API_KEY`、可编辑草稿及迟到结果隔离、PDF有界按页读取/原件/资格、真实渲染与官方 provider 工具结果序列化均有实际代码及接缝证据。

真实硅基账号/录音容器、官方云模型理解和 vivo S50 帧率/视觉连续性尚未验收；票面允许这些交最终集成/真机票，证据已明确，不能据此判为代码缺陷。此次发现来自源码中缺失的转换策略，不是把缺设备误当失败。
