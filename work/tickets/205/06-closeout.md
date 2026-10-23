> 发布权威：[#211](https://github.com/eafen405/OurFairy/issues/211)。本文件是工作副本。

## Parent

[#205 TypeScript 全量迁移：施工](https://github.com/eafen405/OurFairy/issues/205)

## Blocked by

- 05

## Scope

收口：`scripts/` 迁 `.ts`、研究文档索引、全量门禁、清理。

## Steps

- `scripts/` 10 个 `.mjs`→`.ts`；根 solution 加 `./scripts` 叶子 project（`noEmit` + `allowImportingTsExtensions` + `erasableSyntaxOnly`）；scripts 相对 import 写 `.ts`；npm scripts、`.githooks`、precommit 调用后缀更新；tests 对 scripts 的 import 改 `.ts`。
- 三份研究文档（#199/#200/#202 的分支）落 `docs/research/` 并更新 `docs/research/README.md`。
- README/AGENTS/CONVENTIONS/CODING_STANDARDS 的路径与命令更新；不留「无构建」旧声称。
- 全量 `npm test`、`combo:verify`、`backend:doctor`、`bench:projection` 一次；类型漂移实例证据；清理 `.worktrees/research-*` 与试点 worktree。

## Acceptance

- 全绿；`backend/`、`scripts/` 下不再有 `.mjs` 源码；`tsc -b` 覆盖全图；文档索引完整。
- 类型漂移实例：给 pinned dsh 的 `JobStatus` 加成员或改 `kill()` 返回形状，`tsc` 失败并点名符号。

