## Parent

[#229 Profile 安装：恢复与模板复用的生命周期回归](https://github.com/eafen405/OurFairy/issues/229)

## Blocked by

- [T1 确定性安装恢复：fake corepack 进程替身与重试验证](https://github.com/eafen405/OurFairy/issues/230)
- [T2 模板复用闭环：真实安装发布、跨 home 复制与缓存命中](https://github.com/eafen405/OurFairy/issues/231)

## What to build

- 处理 `code-review`（Standards + Spec 两轴）中提出的问题：回到所属测试或 helper 修复，每条修复配会失败的具体检查或复用既有检查并说明断言的是同一事实。
- 新增规格级证据 `work/implementation/evidence/229-closeout/README.md`：实际命令、结果摘要、未完成项；按证据索引约定登记，不手改生成的表格。
- 在最终集成状态运行 `npm test` 与 `npm run combo:verify`。
- 逐项核对规格中恢复、验证、发布与缓存声称都有对应行为测试；答不出的声称删除，不为它补断言。
- 确认本次增量没有修改生产 launcher、composition、构建器、安装逻辑、Android、数据库结构或 bundle 行。

## Acceptance criteria

- [ ] 两轴评审没有未处理问题；所有修复有测试或更窄接缝支撑。
- [ ] `npm test` 与 `npm run combo:verify` 在最终集成状态通过，证据记录真实命令与结果。
- [ ] 证据索引已登记；未完成项如实列出。
- [ ] 规格的每一条可执行声称都能指出失效时会失败的测试或命令。
- [ ] 证据明确区分 fake corepack 的确定性替身结果与真实 pnpm/CLI 结果。

## Baseline

- worktree：`.worktrees/229-closeout`；分支：`ticket/229-closeout`；基线：`integration/spec-229`（含 T1/T2）。
- 评审发现由 Lead 在本票评论或提示中给出。
