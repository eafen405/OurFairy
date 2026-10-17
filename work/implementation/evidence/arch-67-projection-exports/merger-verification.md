# arch-67 merger verification — projection 多余导出删除

- 票：<https://github.com/eafen405/OurFairy/issues/67>（地图 #69）
- 票分支：`arch/67-projection-exports`
- 实现者 FINAL_SHA：`f16ca68c2fedccf2effbf1c7e8da4741adfed4d2`（worktree HEAD 核对一致；原基于 `1c95299`）
- 集成分支合并前 tip：`4ab87ded178992fe927e86aaf0c1584e6d901457`
- 合并前先把集成分支 tip 合入票分支：`3465d1dfac6d723eb94a1530d5ebbe0f819829e6`（`Merge branch 'integration/ourfairy-v1' into arch/67-projection-exports`，无冲突，证据目录/实现均无重叠）
- 合并提交：`9756c01cf6242752d4d29f62ecf2ac67f7aa2a31`（`Merge branch 'arch/67-projection-exports' into integration/ourfairy-v1`，`--no-ff`，无冲突）
- 合并树 = 票分支合并后树（`git diff --quiet 9756c01 3465d1d` 通过），即验证的正是票分支实现者验收过的同一棵树

## 合并后验证（主 checkout `/home/eafen405/projects/OurFairy`，合并提交之上）

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npm test` | **128/128 通过**，`fail 0`，耗时 41.1s，exit 0 | `merger-full.log` |
| `npm run combo:verify` | **三项 ok**：ourfairy based on integration tip `9756c01c`、dsh `fe2bbc3b`、rikkahub `189648274`；`combo: combination verified`，exit 0 | `merger-combo-verify.log` |

128 = 合并进来的 arch-50（+3）/arch-66（+1）/arch-67（+1）与原有基线之和；与实现者记录的 125（`1c95299` 时点）差异来自合并期间集成分支前进，不是本票行为变化。

## 已知无关 flake（实现者记录，merger 本次未复现）

- `tests/pdf.test.mjs` 的 `worker-unavailable` vs `resource-limit`：既有并发负载 flake，实现者隔离重跑 5/5 通过（`pdf-rerun.log`），未改 PDF 代码。
- `tests/product-sources.test.mjs` 在共享源码树临时创建/删除 `backend/identity/src/staleness-probe.mjs`，与 launcher staleness hash 遍历存在竞态；属既有测试设计问题，范围外。
- 本次合并后独立全量运行未命中上述两者；未使用 `--no-verify`。

## 范围与未完成项

- 实现代码：merger 未改动；合并冲突：无。
- 本票不改 `combo.json`、不涉 rikkahub/dsh。
- 未完成项：无。
