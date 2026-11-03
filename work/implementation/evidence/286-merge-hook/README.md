# #286 合并提交不跑门禁：`.githooks` 补 `pre-merge-commit`

- 票：[#286](https://github.com/eafen405/OurFairy/issues/286)
- 分支：`ticket/286-merge-hook`；worktree `.worktrees/286-merge-hook`
- 基线：`integration/fixes-286` @ `67e4402756`（开工时 `git rev-parse HEAD` 与集成分支 tip 相同）
- 交付提交：`b04c239a4c`（钩子 + 结构测试）、`366d89ab7e`（README）、`130aa28893`（`--merge` 判定 + 测试）；
  本证据 README 是其后一个 Markdown-only 提交，`git log --diff-filter=A -1 --format=%h -- work/implementation/evidence/286-merge-hook/README.md` 可复读该 SHA

## 缺陷

仓库把 `core.hooksPath` 设为 `.githooks`，但该目录只有 `pre-commit`。Git 对 merge commit 只运行
`pre-merge-commit`，不会调用 `pre-commit`，所以合并提交从未过门禁；`scripts/precommit.ts` 为合并提交准备的
全量分支也没有入口到达。票面证据（`integration/spec-280` 上四个合并提交 20–30 秒落地、当时手动全量约 100 秒）
与 `work/implementation/evidence/arch-49-search-owner-read/MERGE.md:25` 的现场记录一致。

补上钩子后的第一次真实合并（`work/tmp/286/merge-observation.log`，本机 Git 2.53.0）暴露了票面第二个假设不成立：
门禁跑了，但按 `docs` 分类。诊断脚本在 `pre-merge-commit` 内读到 `MERGE_HEAD` 不存在：

```
DIAG pwd=/home/eafen405/projects/OurFairy/.worktrees/286-merge-hook
DIAG gitdir=/home/eafen405/projects/OurFairy/.git/worktrees/286-merge-hook
DIAG MERGE_HEAD-file: absent
DIAG rev-parse status=1
```

Git 在 `pre-merge-commit` 运行之后才写合并状态，所以 `isMerging()`（`git rev-parse -q --verify MERGE_HEAD`）
在这条路径上永远为假；该判定只在冲突合并后用 `git commit` 收尾时成立，那时 `MERGE_HEAD` 在。

## 修复

| 文件 | 变化 |
| --- | --- |
| `.githooks/pre-merge-commit`（新增，100755） | 与 `pre-commit` 相同的 `cd` / `unset` 前置，末行 `exec node scripts/precommit.ts --merge` |
| `scripts/precommit.ts` | 新增 `--merge`：`merge: isMerging(repoRoot) || argv.includes('--merge')`；`isMerging` 保留给冲突合并后的 `git commit`，注释写明 `pre-merge-commit` 看不到 `MERGE_HEAD` |
| `tests/precommit.test.mjs` | 结构测试固定 `core.hooksPath` 目录的两个入口；新增 `--print --merge` 判定测试 |
| `README.md` | 「提交前钩子」说明改为：`pre-commit` 与 `pre-merge-commit` 都在位、都执行 `scripts/precommit.ts`，合并提交跑全量；结构由测试固定 |

## 结构测试

`tests/precommit.test.mjs` 的 `the hooks directory Git uses provides both commit entry points into the shared gate`：

- 从 `git config --get core.hooksPath` 取 Git 实际使用的目录（未配置时退回 `hooks:install` 指向的 `.githooks`，
  以便未装钩子的 CI 仍检查仓库随附钩子），不存在时失败；
- 逐个固定 `pre-commit`、`pre-merge-commit`：文件存在、可执行位在、末行委托
  （`exec node scripts/precommit.ts` / `exec node scripts/precommit.ts --merge`）、不保留自己的 `npm test`。

同文件另有 `the merge entry point asks for the full gate itself, because MERGE_HEAD is not written yet`：
实跑 `node scripts/precommit.ts --print --merge`，断言 `mode = full` 且命令为 `npm test` + `npm run combo:verify`。

红 → 绿记录（`work/tmp/286/*.log`）：

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| 红（缺 `pre-merge-commit`） | `node --test tests/precommit.test.mjs` | 26 pass / 1 fail：`pre-merge-commit is missing from .githooks` |
| 绿（补同内容钩子） | 同上 | 27 pass / 0 fail |
| 红（`--merge` 未接） | 同上 | 26 pass / 2 fail：钩子缺 `--merge`；`--print --merge` 仍得 `docs` |
| 绿（钩子 + 脚本） | 同上 | 28 pass / 0 fail |

## 真实合并观察

把一次性文件提交在 `scratch/286-merge-check`，从其父提交开 `scratch/286-merge-target`，`--no-ff` 合并；
未用 `--no-verify`。完整原始输出在 `work/tmp/286/merge-observation-2.log`（不入库），命令与门禁自己的输出：

```sh
git checkout -b scratch/286-merge-check 130aa28893
printf '# #286 merge observation\n\nThrowaway file; the scratch branches are deleted after the run.\n' > SCRATCH-286.md
git add SCRATCH-286.md
git commit -m "chore: #286 合并观察用临时改动"
# pre-commit: docs gate (Markdown-only change)          → 1/1 pass，combo verified
git checkout -b scratch/286-merge-target 130aa28893
git merge --no-ff scratch/286-merge-check -m "chore: #286 合并观察用合并提交"
# pre-commit: full gate (1 changed path(s))            ← pre-merge-commit 的 --merge
# ℹ tests 474 / ℹ pass 474 / ℹ fail 0
# combo: combination verified
# Merge made by the 'ort' strategy.
```

合并提交 `e64bd568c3` 的父提交为 `130aa28893` 与 `77f56b760f`；门禁输出行在合并输出之前，退出码 0。
清理：

```sh
git checkout -f ticket/286-merge-hook
git branch -D scratch/286-merge-target scratch/286-merge-check
git branch   # 只剩 integration/*、main 与 ticket/286-merge-hook
git status --porcelain   # 空
```

第一次观察（`merge-observation.log`，修复 `--merge` 之前）也留下记录：合并钩子存在并运行，但输出
`pre-commit: docs gate (Markdown-only change)`——这正是上面「缺陷」里的第二个发现。

## 门禁与收口

| 阶段 | 命令 | 结果 |
| --- | --- | --- |
| 提交 `b04c239a4c` | `git commit`（`.githooks/` 属全量权威） | `pre-commit: full gate`；`npm test` 473/473；`combo: combination verified` |
| 提交 `366d89ab7e` | `git commit`（README） | `pre-commit: docs gate`；`tests/docs.test.mjs` 1/1；combo verified |
| 提交 `130aa28893` | `git commit`（钩子 + 脚本 + 测试） | `pre-commit: full gate`；`npm test` 474/474；combo verified |
| 最终 tip 全量 | `npm test`；`npm run combo:verify` | `npm test` 474/474 pass、exit 0；`combo: combination verified`、exit 0（`work/tmp/286/final-gate-2.log`） |
| 合并集成分支 | `git merge integration/fixes-286` | `67e4402756` 已是 HEAD 祖先，`Already up to date`；无合并提交、无冲突 |
| 合并后受影响测试 | `node --test tests/precommit.test.mjs tests/docs.test.mjs` | 29 pass / 0 fail，exit 0（`work/tmp/286/post-merge-tests.log`） |
| 证据索引 | `node scripts/evidence-index.ts --check` | `evidence index is current`，exit 0 |

最终全量门禁第一次跑（`work/tmp/286/final-gate.log`）在 474 项里失败 1 项：`tests/speech.test.mjs:38` 返回
`speech/timeout`（该用例耗时 13.3 s，单独重跑 3.2 s 通过），是并发负载下的超时，与本票改动无关；
随后整套重跑为上面的 474/474。首次尝试保留在日志里，未用 `--no-verify` 绕过任何提交。

## 未完成

- 证据索引登记（`evidence/index/*.json` 与 `evidence/README.md`）按 Lead 的收口约定在合并时由 Lead 完成；
  本目录没有改动索引文件。
- 本票只改 Node 门禁，未涉及 `android/`、真实云服务或真机，不需要额外产品面验收。

## 文件

| 文件 | 变化 |
| --- | --- |
| `.githooks/pre-merge-commit` | 新增可执行转发钩子 |
| `tests/precommit.test.mjs` | 两个入口的结构固定 + `--merge` 判定测试 |
| `scripts/precommit.ts` | `--merge` 参数与 `isMerging` 注释 |
| `README.md` | 「提交前钩子」与合并提交的实际行为对齐 |
| `work/implementation/evidence/286-merge-hook/README.md` | 本证据 |
