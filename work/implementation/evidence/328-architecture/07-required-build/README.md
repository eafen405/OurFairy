# #335 让 requiredBuild 驱动 CI 并校准 doctor 声称

2026-11-08，spec #328 子票 [#335](https://github.com/eafen405/OurFairy/issues/335) 的交付证据。

## 范围与版本

- 基线：`integration/spec-328` @ `e8350e4`；票分支 `ticket/335-required-build-ci`，worktree
  `/home/fatfish/OurFairy/.worktrees/335-required-build-ci`。
- 提交：`47f893e`（本票行为改动）；`f5ced1e`（合入 `integration/spec-328` @ `bc0972b`，无冲突）。
- 环境：Node `v24.22.2`；dsh 检出 `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2`（HEAD 与 `combo.json`
  锁定的 `ae2adffd8d67773e125b8048120cf9ad2ba7edf3` 一致）。
- 未改：`combo.json`（数据结构与内容都不变）、`scripts/precommit.ts`、`tests/precommit.test.mjs`、
  `scripts/ourfairy-composition.ts`、Android 工程。

## 改动与理由

1. **`scripts/combo.ts` 新增 `build` 子命令**（[scripts/combo.ts](../../../../../scripts/combo.ts)）：
   - `requiredBuildSteps({ root })` 遍历 `combo.json` 的 `repos.*`，收集带 `requiredBuild` 的条目，用既有的
     `repoPath` 解析 checkout（`OURFAIRY_DSH_DIR` 优先、相对路径按主检出锚定）。记录缺失（整个组合没有任何链）、
     空数组、非字符串命令都以含 `combo.json` 路径与 `repos.<key>.requiredBuild` 的错误失败，不静默跳过。
   - `runRequiredBuild({ root, run })` 逐条以 `bash -c` 在对应 checkout 内执行，按记录顺序、首条非零即停并抛出
     含 repo key、命令原文与退出码的错误。`run` 可注入，测试用替身记录调用而不真跑 pnpm。
   - `node scripts/combo.ts build --print` 只解析并打印 checkout 与命令，不执行；正常 `build` 也先打印执行计划，
     所以 CI 日志在命令输出之前就写明每条命令。
2. **`.github/workflows/check.yml`** 的 `Build the locked dsh combination` 步骤从 15 行 bash `for step in`
   循环改为 `corepack enable` + `node scripts/combo.ts build`，删掉 `working-directory`：脚本自己用上一步写入
   `GITHUB_ENV` 的 `OURFAIRY_DSH_DIR` 定位 checkout，并为每条命令设 `cwd`。检出与 HEAD 比对、`npm test` +
   `combo:verify` 步骤、Android job 均未动。
3. **新增 `tests/combo-build.test.mjs`**（[测试](../../../../../tests/combo-build.test.mjs)）：免产品构建、免 dsh
   检出，直接 `import { … } from '../scripts/combo.ts'`。
4. **`README.md` 收窄 doctor 声称**：先决条件一节删掉「`dsh CLI build` 一项会先替你确认（四条）」的过宽暗示，
   改为只承诺确认 `build:lib:host` 的 CLI 产物（`apps/cli/lib/bin.js`）与锁定提交，并写明
   `build:lib:client`/`build:native-system` 没有前置检查、缺失时的运行期症状；命令表里把「四条构建产物齐全」
   改成「`build:lib:host` 的 CLI 产物存在」。
5. **`scripts/ourfairy-backend.ts`** 的 `dsh CLI build` 成功态 detail 追加 `; build:lib:host only`，让 doctor
   输出自述覆盖范围（失败态与检查名未变，`tests/lifecycle.test.mjs` 的断言不受影响）。

## 为什么 combo.ts 从 verifier 变成 verifier + executor

- **唯一权威**：改动前 `requiredBuild` 只有「人读 + CI 里一份字面副本」两个消费者，改记录不会改变 CI，删一步也
  不会让 `combo:verify` 或 `backend:doctor` 变红——这正是票面的漂移面。执行器让记录成为唯一权威。
- **复用既有接缝**：`combo.ts` 已拥有 `readCombo`、`repoPath`（含 `OURFAIRY_DSH_DIR` 覆盖与主检出锚定）、
  `spawnSync` 导入和 CLI 分派；`precommit.ts` 已把它列为 `FULL_AUTHORITY`，改它本就触发全量门禁，无需扩白名单。
  新增子命令是改动最小的位置；`verify`/`show` 的代码与行为一字未动，`combo:verify`（登记表自洽）与
  `backend:doctor`（本机可用）的分工也不变。
- **备选被否**：新建 `scripts/dsh-build.ts` 职责更分离，但要多一个文件、一处 `precommit.ts` 白名单（及可能的
  package script），且 `combo.ts` 仍缺 `requiredBuild` 读取方；本票规模下收益不抵成本。
- **边界**：执行只发生在显式 `build` 子命令；`verify` 仍是只读检查。`bash -c` 与旧 CI 循环的 shell 语义等价，
  命令仍来自仓库内受审的 `combo.json`，没有引入新机制。

## 漂移测试覆盖什么 / 只有真 CI 能证明什么

`tests/combo-build.test.mjs`（10 例）覆盖：

- **行为**：记录的顺序就是执行顺序、每条命令经 `bash -c` 在解析出的 checkout 执行；遍历组合内所有记录
  `requiredBuild` 的 repo（不只 `dsh`）；从记录里删一步，下一次执行就少一步；首条失败即停，错误含 repo key、
  命令与退出码；记录缺 checkout 时在 spawn 前失败并点名目录与覆盖变量；整个组合没有记录、空数组、非字符串都
  是配置错误；`build --print` 解析并打印四条命令后以 0 退出（真执行会因空目录失败，故 0 退出证明是干跑）；
  未知子命令的错误列出 `build`。
- **结构**（沿用 `tests/precommit.test.mjs` 读 YAML 文本的先例）：切出 `Build the locked dsh combination` 步骤，
  断言含 `node scripts/combo.ts build`、不含 `corepack pnpm@`、不含 `for step in`、不含当前 `combo.json` 里任何
  一条 `requiredBuild` 字面量，且该步骤在 dsh 检出步骤之后、`npm test` 之前。

只有真实 CI 推送才能证明的：GitHub Actions runner 真的执行该步骤（`corepack enable`、`$RUNNER_TEMP/dsh` 上的
`OURFAIRY_DSH_DIR` 传递、shell 行为），以及四条构建确实让后续全量套件通过。本机不演练真 CI：真跑
`node scripts/combo.ts build` 会在共享 dsh 检出里重跑 install/三条 build（违反主检出纪律），本地只用 `--print`
与注入 `run` 的测试验证。

## 验证（本票分支，最终集成前）

| 命令 | 结果 |
| --- | --- |
| `node --test tests/combo-build.test.mjs` | **10/10 通过**，~3.1s；无产品构建、无 dsh 检出 |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- tests/precommit.test.mjs tests/combo-merge-gate.test.mjs tests/dsh-checkout.test.mjs` | **exit 0**；三文件合计 36/36 通过（`precommit` + `combo-merge-gate` + `dsh-checkout`） |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 node scripts/combo.ts build --print` | 打印 dsh checkout 与四条命令，exit 0 |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 node scripts/combo.ts verify` | 三行全部 ok，`combo: combination verified` |
| `npm run typecheck` | exit 0（scripts 项目含本次改动） |
| js-yaml 解析 `.github/workflows/check.yml` | 可解析；`full-gate` 步骤顺序完好，build 步骤 `run` 为 `set -euo pipefail` + `corepack enable` + `node scripts/combo.ts build` |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm run backend:doctor` | **全部检查通过**；`dsh CLI build` detail = `/home/fatfish/dsh-d80522d2/apps/cli/lib/bin.js (ae2adffd8d67); build:lib:host only`，其余检查（组合、产品构建、profile、包、插件兼容、原生能力）不变 |

## 提交门禁与合并钩子（Lead 统一口径，负载原因跳过）

功能提交按正常钩子执行；但本机当时有 4–6 个并行 worktree 在跑重型套件（Load average 峰值约 18），
commit 钩子的全量 `npm test` 出现 10 例负载敏感型失败（超时／回复未返回／待决 Promise 类），全部落在与本票
改动面无关的套件：

| 文件 | 失败用例 |
| --- | --- |
| `tests/conversation-search.test.mjs` | native index rebuild preserves Chinese search scope and independently authorized range reads |
| `tests/groups.test.mjs` | concurrent duplicate membership updates stay singular and restart preserves group access |
| `tests/jobs.test.mjs` | an awaited result and a failed report both settle without holding terminal tasks active |
| `tests/jobs.test.mjs` | configured quiet completion leaves context for later without inventing pending inference |
| `tests/skill-learning.test.mjs` | an ambiguous signal is resolved by one independent review child and then counts as success |
| `tests/skill-learning.test.mjs` | a failure signal never counts toward the two-session creation threshold |
| `tests/skill-learning.test.mjs` | an uncertain review is stored as uncertain and never triggers creation |
| `tests/skill-learning.test.mjs` | the creation prompt carries the user's recently rejected skills as dedupe context |
| `tests/skill-learning.test.mjs` | a revocation after the claim settles as no improvement and never names a candidate |
| `tests/skill-learning.test.mjs` | a detection interval that spends its budget is given up and only a newer closed turn releases it |

隔离复跑（同一 worktree、同一命令入口）：

| 命令 | 结果 |
| --- | --- |
| `npm test -- tests/conversation-search.test.mjs tests/groups.test.mjs tests/jobs.test.mjs tests/skill-learning.test.mjs`（并行 4 文件） | exit 1，36/43；conversation-search、groups 转绿，jobs 2 例与 skill-learning 5 例仍红（机器仍有其它并行全量在跑） |
| `npm test -- --test-concurrency=1 tests/jobs.test.mjs tests/skill-learning.test.mjs`（串行 2 文件） | exit 1，24/32；失败项仍为超时型（9s 等待、检测间隔 49.5s），换成了另一组 skill-learning 用例 |
| `npm test -- --test-concurrency=1 --test-name-pattern "an awaited result and a failed report\|configured quiet completion\|an ambiguous signal is resolved" tests/jobs.test.mjs tests/skill-learning.test.mjs` | **3/3 通过**（上面 jobs 两例与 skill-learning 一例） |
| `npm test -- --test-concurrency=1 --test-name-pattern "a failure signal never counts\|two independent sessions reach the threshold\|a failed creation retries only its claim\|a late correction inside a later interval\|a detection interval that spends its budget" tests/skill-learning.test.mjs` | **5/5 通过**（其余失败用例） |

结论：这些用例在本机并行负载下不可靠（同一用例逐个跑即绿、成文件并发跑即红），与本票改动无关；仓库既有证据
也有同型记录（[312-network-persona](../../312-network-persona/README.md) 记录 skill-learning 用例在资源争用时失败、
单独复跑通过）。

按 Lead 统一口径处理（并行 worktree 负载 + 全量权威留给收口）：

- 功能提交 `47f893e` 以 `git commit --no-verify` 落盘：**Lead 授权跳过本地 commit 门禁，全量留给收口在集成分支
  独占运行时产出**；失败清单与隔离复跑结果即上表。
- `git merge --no-verify integration/spec-328`（tip `bc0972b`）：merge 的 pre-merge-commit 钩子会再跑一次约 40
  分钟全量，按同一口径跳过；合并无冲突。
- 本票**相关**测试仍在 worktree 里真实跑绿后才报告：`tests/combo-build.test.mjs`、`tests/docs.test.mjs`、
  `tests/precommit.test.mjs` 等，见上表与下节。

## 合并后复跑（最终集成前）

| 命令 | 结果 |
| --- | --- |
| `node --test tests/combo-build.test.mjs` | **10/10 通过** |
| `node --test tests/docs.test.mjs`（#334 合入后） | **2/2 通过**（docs 门禁已不需要构建） |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 npm test -- tests/precommit.test.mjs tests/combo-merge-gate.test.mjs tests/dsh-checkout.test.mjs` | **exit 0**；三文件合计 36/36 通过 |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 node scripts/combo.ts build --print` | 打印 dsh checkout 与四条命令，exit 0 |
| `OURFAIRY_DSH_DIR=/home/fatfish/dsh-d80522d2 node scripts/combo.ts verify` | 三行 ok（ourfairy 基于 `f5ced1e`、dsh `ae2adffd8d67`、Android 来源一致），`combo: combination verified` |

## 未完成 / 风险

- **真 CI 未演练**：Actions 上的执行留待集成分支推送后由一次 CI run 证明（`AGENTS.md` 的 CI 低频纪律）。
- **本地未跑出一次全量绿**：commit 与 merge 钩子按 Lead 口径跳过（原因见上）；全量权威结果由收口在集成分支
  独占运行时产出，本票只保证相关套件在 worktree 内真实跑绿。
- **client/native 缺构建仍无前置检查**：这是本票有意接受的事实——`requiredBuild` 是唯一权威，CI 跑全四条覆盖；
  收窄后的 README 已明说 doctor 不验证这两条。
- **观测**（非本票问题）：同一 worktree 的 doctor 与全量测试互斥（构建锁），本机多 worktree 并发跑门禁时耗时明显变长，
  不影响结论。
