# 06-docs-gate — 票 #334 证据

票面：GitHub [#334](https://github.com/eafen405/OurFairy/issues/334)，本地副本
[`work/tickets/328/06.md`](../../../../tickets/328/06.md)（父规格 #328）。
范围：`tests/docs.test.mjs` 不再导入后端 helper（其模块加载会断言产品构建存在），并在同文件加一条
fixture 回归，证明无 dist、无 dsh 检出的副本里链接检查仍可运行。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `tests/docs.test.mjs` | 删除 `import { repoRoot } from './helpers/backend.mjs'`，改为 `const repoRoot = resolve(import.meta.dirname, '..')`；该文件现在只导入 `node:` 内置。链接检查与 fenced-block 跳过的逻辑一字未动。 |
| `tests/docs.test.mjs` | 新增 1 条 fixture 回归 `the link check runs in a checkout with no build output and no dsh checkout`：把 docs 测试所需最小文件集（自身、`tests/helpers/`、`scripts/`、`combo.json`、`backend/*/package.json`，**不带 dist**）复制到临时目录，`git init` + `git add` 两份 Markdown，在 `OURFAIRY_DSH_DIR=<fixture>/no-such-dsh` 下用 `--test-name-pattern 'every relative link'` 子进程只跑 link test；断言退出码 0，且 stdout 含测试名（Node 的 `--test-name-pattern` 无匹配时也退出 0，故再加该断言防止改名后空转）。 |

**未改**：`tests/helpers/backend.mjs` 的构建守卫（模块加载时 `assertProductBuild`，78 个测试直接、共
81/117 个测试文件经它获得「缺产品构建」早失败）、`scripts/precommit.ts`（`DOCS_COMMANDS` 本来就是一条
`node --test tests/docs.test.mjs` + 一条 `combo:verify`，不经过 `scripts/test.ts`、不构建）、
`tests/precommit.test.mjs`（其 `:42` 有同类 `repoRoot` 导入，属另一张票的收益，见「未完成项」）。

fixture 内所有 git 调用与子进程都清 `GIT_DIR`、`GIT_WORK_TREE`、`GIT_INDEX_FILE`、`GIT_COMMON_DIR`、
`GIT_OBJECT_DIRECTORY`、`GIT_PREFIX`，子进程另清 `NODE_TEST_CONTEXT`（嵌套 runner 先例：
`tests/test-runner.test.mjs`）。fixture 复制 `scripts/`、`tests/helpers/` 不是 link test 需要，而是让
「构建断言导入若回来」时子进程失败于 `backend.mjs:37` 的缺产物消息，而不是 `ERR_MODULE_NOT_FOUND`。

## Red / green

### 1. 旧行为在「无 dist、无 dsh」副本里失败（复现）

```console
$ git clone --quiet <票 worktree> /tmp/334-repro && cd /tmp/334-repro
$ find backend -maxdepth 2 -type d -name dist | wc -l
0
$ OURFAIRY_DSH_DIR=/tmp/no-such-dsh-334 node --test tests/docs.test.mjs
Error: the product build output is missing for 15 package(s): backend/attachments/dist, …,
backend/speech/dist. Run `npm test -- tests/<name>.test.mjs` to build and test under the worktree lock.
    at assertProductBuild (file:///tmp/334-repro/tests/helpers/backend.mjs:37:9)
    at file:///tmp/334-repro/tests/helpers/backend.mjs:42:1
✖ tests/docs.test.mjs
EXIT:1
```

失败面只有产品构建守卫一处；把该导入换掉后，同一副本（仍无 dist、dsh 指向不存在路径）：

```console
$ OURFAIRY_DSH_DIR=/tmp/no-such-dsh-334 node --test tests/docs.test.mjs
✔ every relative link in the repository Markdown resolves
ℹ pass 1 / fail 0      duration_ms 433
```

### 2. fixture 回归的灵敏度：红 → 绿（真实构建后的票 worktree）

先 `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- tests/docs.test.mjs tests/precommit.test.mjs`
构建出 15 个 `backend/*/dist`，然后临时把旧导入 `import { repoRoot } from './helpers/backend.mjs'` 加回
（跑完立即还原；该临时变异未提交）：

RED —— 父测试因 dist 已存在而通过，fixture 子进程在无 dist 副本里失败：

```console
$ node --test tests/docs.test.mjs
✔ every relative link in the repository Markdown resolves
✖ the link check runs in a checkout with no build output and no dsh checkout
ℹ pass 1 / fail 1      EXIT 1
# 失败信息即子进程输出：the product build output is missing for 15 package(s) … backend.mjs:37
```

GREEN —— 还原修复后：

```console
$ node --test tests/docs.test.mjs
✔ every relative link in the repository Markdown resolves
✔ the link check runs in a checkout with no build output and no dsh checkout
ℹ pass 2 / fail 0      EXIT 0      duration_ms 1235
```

同一灵敏度在 /tmp 独立副本（人为补 15 个空 `backend/*/dist` 目录模拟「已构建树」，仍无真实产物）复现：
加回旧导入 → 1 pass / 1 fail；还原最终文件 → 2 pass。

### 3. GIT_* 泄漏（钩子环境）验证

本仓库 `.githooks/pre-commit` 与 `pre-merge-commit` 在进入 `scripts/precommit.ts` 前会
`unset $(git rev-parse --local-env-vars)`；fixture 仍不依赖调用者清理——按 git 交给钩子的形状（绝对
`GIT_DIR` / `GIT_INDEX_FILE`）直接运行：

正例（当前实现，fixture 内清掉 GIT_*）：

```console
$ GIT_DIR=/…/.git/worktrees/334-docs-gate GIT_INDEX_FILE=/…/.git/worktrees/334-docs-gate/index \
    OURFAIRY_DSH_DIR=/tmp/no-such-dsh-334 node --test tests/docs.test.mjs
ℹ pass 2 / fail 0
$ git status --porcelain
 M tests/docs.test.mjs          # 只有本轮改动；调用者 index 未被 fixture 写入
$ git diff --cached --stat      # 空
```

反例（/tmp 副本里只删掉清理循环，其余不变）：

```console
$ GIT_DIR=/tmp/334-repro/.git GIT_INDEX_FILE=/tmp/334-repro/.git/index \
    OURFAIRY_DSH_DIR=/tmp/no-such-dsh-334 node --test tests/docs.test.mjs
$ git status --porcelain
MM README.md
MM docs/README.md               # fixture 的 git add 写进了调用者 index（实测复现）
```

## 验证命令与结果

| 命令 | 环境 | 结果 |
| --- | --- | --- |
| `node --test tests/docs.test.mjs` | 票 worktree（已构建；未设 `OURFAIRY_DSH_DIR`） | 2 tests / 2 pass / 0 fail；duration 1.24s（含 fixture） |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- tests/docs.test.mjs tests/precommit.test.mjs` | 票 worktree | 31 tests / 31 pass / 0 fail；EXIT 0（先构建 15 个包，再跑两个套件） |
| `OURFAIRY_DSH_DIR=/tmp/no-such-dsh-334 node --test tests/docs.test.mjs` | 全新 clone（0 个 dist、0 个相对导入、dsh 路径不存在）；最终文件 | 2 tests / 2 pass / 0 fail；duration 894ms |
| 钩子形状 `GIT_DIR`/`GIT_INDEX_FILE` 直跑 | 票 worktree | 2 pass；调用者 `git status` 只有本票改动，index 无变化 |

耗时：同机交替采样 3 轮（同一 /tmp 副本、同一环境变量），旧门禁 duration_ms 662 / 687 / 863，新门禁
1168 / 1470 / 1318——fixture 约 +0.5–0.7s；采样期机器上有并行任务负载。E3 探索时空闲采样为 0.6s → 0.9s，
量级一致。这是新增回归覆盖的代价，不是变慢。

## 未执行 / 未完成项

- 未跑全量 `npm test`、`npm run combo:verify` 与 Android（本票不涉及 Android）；全量门禁由集成分支收口执行。
- `tests/precommit.test.mjs:42` 只为 `repoRoot` 导入 backend helper，使该文件在无构建机器上同样不能直跑；
  不在本票写范围，未改，已报告 Lead（改它属于另一张票，收益约 0.3s + 去掉 dist 依赖）。
- 未新增 `tests/helpers/repo.mjs` 之类的常量 helper：`precommit.ts` 把 `tests/helpers/` 列为
  `FULL_AUTHORITY`，任何改动都会触发全量套件，且 docs test 会重新依赖本地模块；内联一行 `resolve` 更小。
