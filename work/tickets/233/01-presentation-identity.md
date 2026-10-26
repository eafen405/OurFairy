## Parent

[#233 Android 呈现：attempt 行身份由后端事实派生](https://github.com/eafen405/OurFairy/issues/233)

## What to build

深化 Android transcript 的呈现 interface：调用方只提供后端已有事实——消息、`generation`、可空
`RemoteChatAttempt` 与可空 `RemoteChatSettlement`——不再分别提供 attempt 文本、工具名、预拼的 live
行键或 settled 行键。

- `RemoteTranscript` 与 `RemoteTranscriptPresentation.update` 接收同一组事实。呈现实现私有派生 live
  行键，并从 settlement 的 `attemptId` 与同一 generation 派生对齐行键；行键格式仍为
  `attempt:<generation>:<attemptId>`，构造函数不再暴露给 caller 或测试。
- attempt 为空时没有实时行；attempt 存在时按现有规则呈现文本与工具名，包括空文本行。settlement
  仍按 role=Fairy 且 seq 精确相等的唯一消息匹配。
- 生产 panel 直接传 `projection.generation`、`projection.attempt`、`projection.settledAttempt`；
  性能测量 caller 使用相同输入，不保留性能路径专用的行键拼接。
- 保留 rowKeys / deferred / observedLiveKey 的现有瞬态状态与释放顺序，不改变阅读位置、延迟排版、
  历史、停止/失败、复制、附件、下载与最终呈现回调行为。
- 现有测试按新输入形状迁移到可编译并保持原断言；测试不自行拼行键。

## Acceptance criteria

- [ ] `RemoteTranscript` 的 attempt 输入只有 generation、可空 attempt 与可空 settlement；不再有
      attemptText、attemptKey、attemptTools 或预拼 settled key 参数。
- [ ] 行键只在呈现实现内派生，外部无法调用行键构造函数。
- [ ] 生产 panel 与两个性能测量 caller 都直接传后端事实，没有 caller 侧行键转换。
- [ ] attempt 存在时仍产生一行（空文本也可见）；attempt 为空时没有实时行；工具名从 attempt 读取。
- [ ] 现有行为场景（延迟排版、离开/回尾释放、历史、停止/失败、正式消息先到、独立投递、连续 attempt）
      在迁移后的输入下全部保持。
- [ ] Android debug 与 perf 源集编译通过；相关 JVM/Compose 测试通过；证据写
      `work/implementation/evidence/234-presentation-identity/README.md`。

## Blocked by

None (can start immediately).

## Baseline

- worktree：`.worktrees/234-presentation-identity`；分支：`ticket/234-presentation-identity`；
  基线：`integration/spec-233`。
- 完成后把 `integration/spec-233` tip 合入本分支并报告冲突处理。
