# #229 Profile 安装：恢复与模板复用的生命周期回归

父票：[#229 Profile 安装：恢复与模板复用的生命周期回归](https://github.com/eafen405/OurFairy/issues/229)。
GitHub issue 是发布权威，原生 blocked-by 是实时状态权威；本目录是实施时读取的工作副本。

基线：`main` @ `6662bef17e`，集成分支 `integration/spec-229`。
本规格只补测试，不改生产 launcher、composition、构建器与安装逻辑。

## 目标

以现有后端 launcher CLI 为最高测试 seam，以 PATH 上的 fake corepack 作为 pnpm 进程替身，在临时
仓库副本和隔离 home 中驱动真实安装编排。固定过期 lockfile 的一次有界恢复、linked bundle 缺失的
响亮失败、模板发布与跨 home 复用的完整闭环；同时保留现有真实 pnpm/CLI 证据。

## 任务图

| 文件 | 票号 | 内容 | 阻塞 |
| --- | --- | --- | --- |
| `01-install-recovery.md` | [#230](https://github.com/eafen405/OurFairy/issues/230) | T1 确定性安装恢复：fake corepack 进程替身与重试验证 | 无 |
| `02-template-reuse.md` | [#231](https://github.com/eafen405/OurFairy/issues/231) | T2 模板复用闭环：真实安装发布、跨 home 复制与缓存命中 | T1 |
| `03-closeout.md` | [#232](https://github.com/eafen405/OurFairy/issues/232) | T3 收口：两轴评审修复、证据与全量门禁 | T1、T2 |

T2 依赖 T1：fake corepack 的调用记录 helper 由 T1 抽取，T2 用它证明复制阶段没有执行 `pnpm install`。
T3 在 T1/T2 合入并完成两轴评审后开始。

## 约定

- 每票在自己的 worktree 里工作，分支 `ticket/<NN>-<slug>`，证据在
  `work/implementation/evidence/<NN>-<slug>/`，由 merger 合入集成分支。
- 实现前先调用 `tdd` skill，按测试先行推进。
- 复用 `tests/helpers/backend.mjs` 的临时仓库、隔离 home 与 launcher 调用，不建立第二套测试基础设施。
- 验证节奏按 [`AGENTS.md`](../../../AGENTS.md)：实施期按改动面跑相关测试，全量 `npm test` 与
  `npm run combo:verify` 留到 T3 收口。
- 本规格不改生产安装编排、composition、Android、数据库结构或 bundle 行；不导出 `installProfile`，
  不为测试新增生产入口。

## 范围外

- 不修改生产 launcher、composition、构建、哈希、模板目录、复制、发布、stamp、权限、隔离、命令集、
  CLI 输出结构或数据库结构。
- 不把安装生命周期搬进 composition，不新增生产 process adapter 或安装 interface。
- 不引入新的测试框架、通用 retry、新的安装状态或第二份模板权威。
- 不接管 #223/#224/#225 的实施、分支、证据或交付。
