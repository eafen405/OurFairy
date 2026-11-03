# #233 Android 呈现：attempt 行身份由后端事实派生

父票：[#233 Android 呈现：attempt 行身份由后端事实派生](https://github.com/eafen405/OurFairy/issues/233)。
GitHub issue 是发布权威，原生 blocked-by 是实时状态权威；本目录是实施时读取的工作副本。

基线：`main` @ `6662bef17e`，集成分支 `integration/spec-233`。
本规格只改 Android transcript 的呈现 interface 与对应测试/性能 caller，不改后端、网络 DTO、同步存储或持久状态。

## 目标

让 `RemoteTranscript` 的 caller 只提供后端已有事实：消息、generation、可空 attempt 与可空 settlement。
呈现实现私有派生 live 行键与 settlement 对齐键，使同一 attempt 的 live 行与正式消息保持同一视觉行，
并继续拥有行映射、可见行与延迟排版状态。

## 任务图

| 文件 | 票号 | 内容 | 阻塞 |
| --- | --- | --- | --- |
| `01-presentation-identity.md` | [#234](https://github.com/eafen405/OurFairy/issues/234) | T1 呈现接口：attempt 行身份由后端事实派生 | 无 |
| `02-reading-regression.md` | [#235](https://github.com/eafen405/OurFairy/issues/235) | T2 行身份回归：公开更新结果与否定场景 | T1 |
| `03-closeout.md` | [#236](https://github.com/eafen405/OurFairy/issues/236) | T3 收口：两轴评审、证据与全量门禁 | T1、T2 |

T2 依赖 T1：新输入形状、私有行键与 caller 迁移由 T1 建立，T2 在同一 seam 上深化行为回归。
T3 在 T1/T2 合入并完成两轴评审后开始。

## 约定

- 每票在自己的 worktree 里工作，分支 `ticket/<票号>-<slug>`，证据在
  `work/implementation/evidence/<票号>-<slug>/`，由 merger 合入集成分支。
- 实现前先调用 `tdd` skill，按测试先行推进。
- 验证节奏按 [`AGENTS.md`](../../../AGENTS.md)：实施期按改动面跑相关 Android JVM/Compose 测试；
  全量 Android `test`、`lintDebug`、`assembleDebug` 与 `npm test`、`npm run combo:verify` 留到 T3 收口。
- 本规格不改 `RemoteChatApi`、`RemoteChatState`、`ChatSyncStore`、`RemoteReceiveState`、`conflate`、
  后端 SessionRuntime、消息 position、网络字段、数据库结构或持久呈现状态。

## 范围外

- 不改变用户可见的正常流式、结算、Markdown、阅读位置、复制、工具名或附件行为。
- 不传入整份 `RemoteChatProjection`，不把任务、活动、事件窗口或权限知识引入 transcript。
- 不按文本相似度、时间、列表位置或内容推断 attempt 与正式消息的关系。
- 不重构整个 `RemoteTranscript`、`RemoteChatPanel`、`RemoteReceiveState` 或性能测量体系。
- 不处理 #223/#224/#225/#229 的实施、分支、证据或交付。
