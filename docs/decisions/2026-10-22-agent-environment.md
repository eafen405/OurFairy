> 2026-10-22 状态：日期化记录。本文记录 2026-10-22 对 131–137 实施波次的复盘结论与三项环境改动。

# 代理环境：状态视图、提交门禁与 CI

2026-10-22。复盘 131–137 的实施波次（82 个会话、5,398 次工具调用）后，按影响排序改了三处环境。
下面的数字来自 `~/.dsh/sessions` 的会话日志统计，不是印象。

## 观察到的问题

| 问题 | 数据 |
| --- | --- |
| spec 收口状态没有单一视图 | 6 个集成分支里 3 个从未推送（spec-132/135/137），6 个 worktree 遗留；后续会话为确认「#136 是否做过」花了约 30 次 `git log --all` / `reflog` / `merge-tree` / `gh issue view` |
| 门禁可以被绕过 | 仓库没有 CI；唯一门禁是 pre-commit 钩子，波内 `--no-verify` 27 次 |
| 提交等待主导时间 | 272 次 commit/merge 共 1.9 小时，单次约 100 秒（全量 `npm test` + `combo:verify`），`--amend` 再付一次 |
| sleep 轮询 | 193 次 `sleep N; git log …` 共 7.2 小时，占波内 bash 时间的一半以上 |

## 三项改动

1. **状态视图**：`npm run specs:status`（`scripts/specs-status.ts`）从 git 与 tracker 派生每张 spec 的
   分支 tip、是否已推送、是否已落地、遗留 worktree、落地分支漂移与孤儿 worktree；`--offline` 跳过 tracker。
   检查：`tests/specs-status.test.mjs` 在临时仓库里固定每条派生规则。
2. **提交门禁分流**：`scripts/precommit.ts` 让只改 Markdown 的提交跑 `tests/docs.test.mjs` 与
   `combo:verify`，其余改动仍跑全量 `npm test`；`CODING_STANDARDS.md` 的交付前全量要求不变。
   检查：`tests/precommit.test.mjs` 固定分类与命令表。
3. **CI**：`.github/workflows/check.yml` 在 push 到 `main` / `integration/**` 与 PR 上按 `combo.json`
   的锁检出并构建 dsh，再跑全量门禁；本地 `--no-verify` 跳过的内容在服务器上仍会跑。

## 组合锁

同一波里 dsh 前进到 `42133b30`（`fix(loader): reject cyclic entry ids instead of spinning` 及其测试修正），
而 `combo.json` 仍锁 `5b8ec0f`，于是本地门禁整体变红（37 处测试直接以漂移失败），提交只能靠 `--no-verify`。
锁已更新到 `42133b30`，与 fork 的 `product/ourfairy-v1` tip 和已构建产物一致。
