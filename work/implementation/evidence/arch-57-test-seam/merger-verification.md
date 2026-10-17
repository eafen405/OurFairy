# #57 merger 验证记录

- 集成分支：`integration/ourfairy-v1`，合并前 tip `06e16db`。
- 合并：`git merge --no-ff arch/57-test-seam`，merge commit **`4ee6b39`**
  （`Merge branch 'arch/57-test-seam' into integration/ourfairy-v1`）。
- 实现者报告 FINAL_SHA `38c67d0`；实际合并的票分支 tip 为 `38c67d0`。合并后集成分支 tip 为 `4ee6b39`。
- **合并后源树与实现者验收树完全相同**：`git diff --quiet 38c67d0 4ee6b39` exit 0
  （两者 tree sha 均为 `4b635171a35910fac6b39f76f7938dcd48c7515a`）。因此实现者在本票的定向/全量证据即对应
  合并后的源树；merger 仍在合并后 tip 上独立复跑全量，不依赖复用。

## 合并后实测（集成分支 tip `4ee6b39`）

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `npm test`（合并后首跑） | 118 pass / 0 fail，EXIT 0 |  |
| `npm run combo:verify`（合并后首跑） | 3 仓全 ok，EXIT 0 |  |
| `npm test`（证据目录静止后复跑，排除并发干扰） | 118 pass / 0 fail，EXIT 0 |  |
| `npm run combo:verify`（同上） | 3 仓全 ok，EXIT 0 |  |

`combo:verify` 输出：`ourfairy ok (worktree is the integration tip) / dsh ok / rikkahub ok`，
rikkahub pin `189648274074846e`、dsh pin `fe2bbc3b1c14efd7` 均未变，本票（后端）不需要改 `combo.json`。

## 并发情况说明（如实记录）

收集证据期间（16:06–16:09）发现另一进程仍在 `arch-57-test-seam` worktree 内跑验收并改写本目录：
 被覆盖为一次 118 tests / 117 pass / 1 fail 的运行，失败为
`groups` 启动时 ENOENT `backend/identity/src/staleness-probe.mjs`——该文件由同跑的
`product-sources.test.mjs` 临时创建并在 `after` 删除，两个测试文件并行时被误删（实现者记为并发 flake，
见 README 与：单独复跑 `groups` 4 pass，全量复跑 118 pass / 0 fail）。
随后该 worktree 分支被集成分支快进到 `4ee6b39`（reflog: `merge integration/ourfairy-v1: Fast-forward`）。

merger 的两次全量都是在该目录静止之后跑的，均 118/0， 为排除并发后的干净记录。
未据此改动任何实现代码。
