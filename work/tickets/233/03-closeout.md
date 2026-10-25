## Parent

[#233 Android 呈现：attempt 行身份由后端事实派生](https://github.com/eafen405/OurFairy/issues/233)

## Blocked by

- [T1 呈现接口：attempt 行身份由后端事实派生](https://github.com/eafen405/OurFairy/issues/234)
- [T2 行身份回归：公开更新结果与否定场景](https://github.com/eafen405/OurFairy/issues/235)

## What to build

- 处理 `code-review`（Standards + Spec 两轴）发现的问题：回到所属 module 修复，每条修复配会失败的具体
  检查或复用既有检查并说明断言的是同一事实。
- 新增规格级证据 `work/implementation/evidence/233-closeout/README.md`：实际命令、结果摘要、未完成项；
  按 `scripts/evidence-index.ts` 的约定新增 `work/implementation/evidence/index/` 描述文件并运行
  `npm run evidence:index`，不手改生成的表格。
- 在最终集成状态运行 Android `test`、`lintDebug`、`assembleDebug` 以及 perf 源集编译；运行 `npm test`
  与 `npm run combo:verify`。
- 逐条核对规格中可执行的声称（行身份同源、私有行键、延迟排版释放、历史不等待、否定场景）都有对应
  行为测试；答不出的声称删除，不为它补断言。
- 确认本次增量没有修改 `RemoteChatApi`、`RemoteChatState`、`ChatSyncStore`、`RemoteReceiveState`、
  `conflate`、后端、网络字段、数据库或持久呈现状态；没有新增测试专用 key 入口。
- 证据区分 JVM/Robolectric、Compose、构建与未执行的设备/性能验收。

## Acceptance criteria

- [ ] 两轴评审没有未处理问题；所有修复有测试或更窄接缝支撑。
- [ ] Android `test`、`lintDebug`、`assembleDebug` 与 perf 源集编译在最终集成状态通过，证据记录
      真实命令与结果。
- [ ] `npm test` 与 `npm run combo:verify` 在最终集成状态通过。
- [ ] 证据索引已登记；未完成项如实列出，设备验收未被声称。
- [ ] 规格的每一条可执行声称都能指出失效时会失败的测试或命令。

## Baseline

- worktree：`.worktrees/236-closeout`；分支：`ticket/236-closeout`；基线：`integration/spec-233`
  （含 T1/T2）。
- 评审发现由 Lead 在本票评论或提示中给出。
