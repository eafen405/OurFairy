## Parent

[#225 会话读取：完整页操作与任务身份访问](https://github.com/eafen405/OurFairy/issues/225)

## Blocked by

- T1 [#226](https://github.com/eafen405/OurFairy/issues/226)
- T2 [#227](https://github.com/eafen405/OurFairy/issues/227)

## What to build

- 处理 Lead 在 `code-review`（Standards + Spec 两轴）中提出的问题：回到所属 module 修复，每条
  修复配会失败的具体检查或复用既有检查并说明断言的是同一事实。
- 新增规格级证据 `work/implementation/evidence/225-closeout/README.md`：实际命令、结果摘要、
  未完成项；在 `work/implementation/evidence/README.md` 登记入口。
- 在最终集成状态运行 `npm test` 与 `npm run combo:verify`；必要时运行 `npm run backend:doctor`。
- 逐条核对规格中可执行的声称都有对应行为测试；答不出的声称删除，不为它补断言。
- 确认本次增量没有修改 Android、数据库结构、projection 持久 state/stateVersion、dsh fork、
  bundle 行、路由/字段/数字编码/SSE transport。

## Acceptance

- [ ] 两轴评审没有未处理问题；所有修复有测试或更窄接缝支撑。
- [ ] `npm test` 与 `npm run combo:verify` 在最终集成状态通过，证据记录真实命令与结果。
- [ ] 证据索引已登记；未完成项如实列出。
- [ ] 规格的每一条可执行声称都能指出失效时会失败的测试或命令。

## Baseline

- worktree：`.worktrees/225-closeout`；分支：`ticket/225-closeout`；基线：
  `integration/spec-225`（含 T1/T2）。
- 评审发现由 Lead 在本票评论或提示中给出。
