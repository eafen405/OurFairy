# merger verification — arch-62-interface-width（地图 #69）

- 票：#62（后端 / OurFairy，interface 宽度收敛）
- 票分支：`arch/62-interface-width`（worktree `/home/eafen405/projects/OurFairy/.worktrees/arch-62-interface-width`）
- 期望 / 实际 FINAL_SHA：`ae50e37`（`docs(evidence): name the evidence commit as the branch tip, not the merge`，父提交 `11039ee` 为合入集成分支 `7a6fb26` 的 merge）
- 集成分支：`integration/ourfairy-v1`，合并前 tip `7a6fb26`
- 合并执行：2026-10-17，merger（串行，单票）

## 1. 前置核对（全部满足）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 主 checkout 干净且位于集成分支 | `git -C /home/eafen405/projects/OurFairy status --porcelain` / `git branch --show-current` | 空输出 / `integration/ourfairy-v1` |
| 主 checkout tip | `git log --oneline -1` | `7a6fb26` |
| 票分支 HEAD 等于报告 FINAL_SHA | `git -C.worktrees/arch-62-interface-width log --oneline -3` | `ae50e37`（= FINAL_SHA），`11039ee`，`7a6fb26` |
| 票分支已含集成分支 tip | `git merge-base --is-ancestor 7a6fb26 HEAD` | 退出码 0（`11039ee` 为 merge） |
| 外部证据 md5 对齐 | `md5sum` 逐文件比较两目录 | 9 个文件全部 SAME；以分支内 `work/implementation/evidence/arch-62-interface-width/` 为准 |

## 2. 合并

```bash
cd /home/eafen405/projects/OurFairy
git merge --no-ff arch/62-interface-width \
  -m "Merge branch 'arch/62-interface-width' into integration/ourfairy-v1"
```

- 结果：`ort` 策略，无冲突（冲突已由实现者在票分支的 `11039ee` 内解决；本次只合 tip）。
- **合并提交：`3346cfda623bcb5a587952d88a9899803317964b`**
- 父提交：`7a6fb26068a24b95f930ddeade044a5a3511ecff`（集成分支）+ `ae50e370dfd33d2329d3d5d495796b92bcd2f2d6`（票分支）
- 树等价：`git diff --quiet ae50e37 3346cfd` → 退出码 0，即**合并后源树与实现者验收的 FINAL_SHA 树逐字节相同**。
- 改动范围：21 文件 / +692 −49（后端 12 个源码与测试文件 + 票内证据 9 个文件），未改 rikkahub、dsh、`combo.json`。

## 3. 合并后验证（OurFairy 主 checkout，合并提交 `3346cfd` 状态）

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npm test` | **123/123 pass**，6 suites，0 fail（duration 26150.86 ms） |  |
| `npm run combo:verify` | **ok**：ourfairy `3346cfd` = integration tip；dsh `fe2bbc3b`、rikkahub `18964827` 均 ok；`combo: combination verified` |  |

> 条数说明：实现者 README 的 `120/120` 是集成分支停在 `ce225bb` 时的计数；票分支 `11039ee` 又合入了含 #64 的 `7a6fb26`，因此最终状态为 **123/123**（全部通过，非回归）。票内证据提交 `ae50e37` 的真实 pre-commit hook 日志同样记录 123/123。

## 4. 证据收录

- 证据已随票分支合入：`work/implementation/evidence/arch-62-interface-width/`（README + 9 个原始日志），本次合并后为准。
- 外部暂存目录 `/home/eafen405/ourfairy-evidence/arch-62-interface-width/` 的 9 个文件与分支内 md5 全部一致；merger 另把上述两份合并后验证日志复制进本目录（仅新增，未改实现者文件）。
- 实现者已如实记录（见同目录 `README.md`）：① 首轮证据原在 `/tmp/ourfairy-arch/evidence/...`，被系统清空后在当前合并后状态重跑重建（跑完已逐字节还原）；② 票分支的 merge 提交 `b01c746` 曾用一次 `--no-verify`（merge 提交运行时 HEAD 仍为旧票 tip，combo 的 based-on-integration 检查必然失败），随后在同一状态复跑 `combo:verify` 与 `npm test` 全绿，后续证据提交走真实 hook 通过。以上由 merger 复核并写入 #62 resolution。

## 5. 未完成项 / 偏差

- 无实现代码改动，无冲突，无验证失败。
- 本票不涉及 rikkahub/dsh 变更，`combo.json` 无需更新。
- `gh issue close #62` 与地图 #69 Decisions so far 回填、`integration/ourfairy-v1` 推送见 #62 resolution。
