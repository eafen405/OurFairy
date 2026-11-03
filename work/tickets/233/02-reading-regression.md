## Parent

[#233 Android 呈现：attempt 行身份由后端事实派生](https://github.com/eafen405/OurFairy/issues/233)

## Blocked by

- [T1 呈现接口：attempt 行身份由后端事实派生](https://github.com/eafen405/OurFairy/issues/234)
  （新输入形状与私有行键由 T1 建立）

## What to build

把行身份与延迟排版的回归测试作为本票主体：测试只通过 `RemoteTranscriptPresentation.update`
（或现有 Compose 入口）输入后端事实，并经返回的视觉行观察身份与延迟状态。

- 用 `RemoteChatAttempt`、`RemoteChatSettlement` 与 generation 驱动 `RemoteReadingTransitionTest`
  的全部 live/settled 场景；测试不调用行键构造函数、不预拼 live/settled 行键、不读取私有映射。
- 保留一条行键格式测试：经公开 update 返回的 `RemoteTranscriptRow.key` 观察
  `attempt:<generation>:<attemptId>`，格式漂移会失败。
- 保留阅读中延迟、离开释放、回尾释放、历史不等待、停止/失败保留最终增量、正式消息先于流结束、
  独立投递、同文本不同身份、连续新 attempt 等现有断言。
- 增加否定场景：不同 generation 的 settlement、无关 settlement（seq/role 不匹配）、未观察过的
  live，均不得建立行映射或延迟排版；重叠快照仍按 role+seq 的 singleOrNull 语义处理。
- Compose viewport/copy/tool-call 测试改用 generation 与 `RemoteChatAttempt` 输入，保持原断言；
  如需结算覆盖，直接使用 `RemoteChatSettlement`，不加测试专用 key 入口。
- 若测试暴露呈现实现缺陷，在呈现 module 内最小修复并保留会失败的检查。

## Acceptance criteria

- [ ] 回归测试只使用后端事实与公开更新操作；没有测试侧行键构造函数调用、手拼键或私有状态读取。
- [ ] 行键格式由公开返回行钉住。
- [ ] 现有阅读过渡场景全部保留并通过，至少一条测试证明同一后端身份在 live 与 settlement 两次更新中
      保持同一 key。
- [ ] 不同 generation、无关 settlement、未观察 live 的否定场景通过，证明不会继承映射或延迟。
- [ ] Compose viewport、copy、tool-call 测试使用 generation + attempt 输入，原断言不变。
- [ ] 相关 JVM/Compose 测试通过；证据写
      `work/implementation/evidence/235-reading-regression/README.md`。

## Baseline

- worktree：`.worktrees/235-reading-regression`；分支：`ticket/235-reading-regression`；
  基线：`integration/spec-233`（含 T1）。
- 完成后把 `integration/spec-233` tip 合入本分支并报告冲突处理。
