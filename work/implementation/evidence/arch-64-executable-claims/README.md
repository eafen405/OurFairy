# arch-64-executable-claims — 票 #64 证据

票面：流程/通则票——「凡『A 与 B 不能不一致』必须落实为可执行断言，或删除该声称」。
三处实例 #46/#47/#48 已分别由 `c878d6c`、`7b4e66d`、`bbd0774` 修复并合入 `integration/ourfairy-v1`；
本票不再修那三处，只把通则落地为可执行规则 + 可执行检查。

## 改了什么

| 文件 | 改动 |
| --- | --- |
| `CODING_STANDARDS.md` | 新增一条「**声称须可执行**」：凡声称「A 与 B 不能不一致」「X 已被检查/保证」「清单由 Y 派生」，同一次改动必须给出会因该声称失效而失败的可执行检查及其路径，给不出就删除该声称；清单指向唯一权威或由生成物派生；引用已有检查须说明它断言的是同一事实；审查判定 = 要求作者指出「哪条命令或测试在该声称失效时失败」，答不出即不通过，另立新票不算落实。 |
| `work/implementation/CONVENTIONS.md` §8 | 在既有 stage-review 检查点（A–D）中固定增加「可执行声称检查」三步：列出本次增量的全部声称 → 指出失效时失败的具体命令/测试并核对是同一事实 → 重复清单改为指向唯一权威或派生。 |
| `tests/executable-claims.test.mjs`（新增，3 条） | 把仓库现存的两类「不能不一致」声称钉到执行侧。 |

新测试的三条断言（全部经公开入口观察，不 import launcher 内部）：

1. `the bundle row declares the pair combo.json locks` —— 直接解析 `backend/v1-bundle/cordis.patch.yml` 的
   `agent-default-model` 行与 `combo.json backend.agentModel`，两者 provider/model 必须相等。
2. `doctor runs the "bundle agent model" check the README and combo.json promise` —— `doctor --json` 必须仍有
   `bundle agent model` 这项检查、必须通过、且 detail 里报出 combo.json 锁定的那一对。
   （`combo.json backend.agentModelNote` 与 `backend/v1-bundle/README.md` 都声称 doctor 做这个比对。）
3. `the bundle declares the patch file its README calls the row set` —— `backend/v1-bundle/package.json` 的
   `dsh.bundle.patch` 必须是 `./cordis.patch.yml`。README 说「`cordis.patch.yml` **is** the row set：profile
   加载的就是它」，真正让它成立的是这条声明；`tests/bundle-readme.test.mjs` 比较的也是这个文件。

第 1 条是独立的第二道检查，理由见下方「范围外发现」。

## 提交

- `31705c1` docs(standards): require an executable check for every "cannot disagree" claim
  （3 files changed, 144 insertions(+)）
- `00a4a13` Merge branch 'integration/ourfairy-v1' into arch/64-executable-claims（合并 `704a1a9`，无冲突）
- 证据提交即本文件所在提交，其父提交是 `00a4a13`；分支 tip 见报告里的 FINAL_SHA。

合并后的状态工作树干净（`git status --short` 无输出），`npm test` 121/121、`combo:verify` ok。

## Red / green

Green（合并后状态，定向）：

```
$ node --test tests/executable-claims.test.mjs
✔ the bundle row declares the pair combo.json locks
✔ doctor runs the "bundle agent model" check the README and combo.json promise
✔ the bundle declares the patch file its README calls the row set
ℹ tests 3 / pass 3 / fail 0
```
`green-executable-claims.log`

Red 用变异重建（每次只改一处、跑完立刻还原；还原后 `git status --short` 均为空）：

| 变异 | 失败断言 | 日志 |
| --- | --- | --- |
| 从 `commandDoctor` 删掉 `check('bundle agent model', ...)` 整块 | 断言 2：`doctor must run a "bundle agent model" check ... doctor ran ["node version",...,"model double"]` | `red-doctor-check-unwired.log` |
| `cordis.patch.yml` 的 model 改成 `deepseek-flash-drifted` | 断言 1：`the agent-default-model row declares model deepseek-flash-drifted, combo.json locks deepseek-flash` | `red-model-drift.log` |
| `backend/v1-bundle/package.json` 的 `dsh.bundle.patch` 改成 `./other.patch.yml` | 断言 3：`must declare dsh.bundle.patch ./cordis.patch.yml ... actual './other.patch.yml'` | `red-bundle-patch-pointer.log` |

说明：`/tmp/ourfairy-arch` 在会话中断期间被清空，原始 red 日志丢失；上表是按同一变异重新跑出来的，
不是原始那一次的拷贝。变异方法与结论与首次一致（首次另有一处混合变异同时触发两条断言，未保留）。

基线对比（临时移走新测试文件后跑全量，随后还原）：`tests 118 / pass 118 / fail 0`
（`baseline-without-new-test.log`）；带新测试为 121 条。差值 3 = 本票新增断言数。

## 验收命令与结果

```
$ npm test
ℹ tests 121 / pass 121 / fail 0
```
`final-full-npm-test.log`（合并 `704a1a9` 之后跑）

```
$ npm run combo:verify
ourfairy  integration/ourfairy-v1  00a4a1385012  ok (worktree is based on the integration tip)
dsh       product/ourfairy-v1      fe2bbc3b1c14  ok
rikkahub  product/ourfairy-v1      189648274074  ok
combo: combination verified
```
`combo-verify.log`

有一次全量在并发负载下报了已记录的 PDF flake（`tests/pdf.test.mjs:161` 期望 `resource-limit`、
实际 `worker-unavailable`，见 `work/implementation/evidence/17-pdf-text/`、`arch-49`/`arch-54` 的同名记录）。
`full-npm-test-flake-pdf.log` 是该次原文；随后隔离重跑 `node --test tests/pdf.test.mjs` 5/5 通过
（`pdf-rerun.log`），再跑全量 121/121 通过（`final-full-npm-test.log`）。未改 PDF 代码，未用 `--no-verify` 掩盖。

`tests/helpers/backend.mjs` 在本票合并的 `704a1a9`（#57）中没有改动（`git diff 4ee6b39..704a1a9 -- tests/ scripts/ backend/` 为空），
新测试仍用既有的 `runBackend` / `makeHome` / `removeHome` / `describeRun`，合并后全绿。

## 范围外发现（未修，按票面交回地图）

**`bundleDeclaresAgentModel` 比声称弱：前缀漂移仍判通过。**
`scripts/ourfairy-backend.mjs:314` 用 `patch.includes('model: ' + selection.model)` 做子串匹配，
所以 `model: deepseek-flash-drifted` 仍包含 `model: deepseek-flash`，检查通过。
复现（把 model 改成 `deepseek-flash-drifted` 后跑 doctor）：

```
$ node scripts/ourfairy-backend.mjs doctor --json --home <tmp>
bundle agent model -> True | deepseek-official/deepseek-flash declared in both combo.json and the bundle
doctor exit=0
```
`finding-doctor-accepts-prefix-drift.log`

这正是 #64 主题的第四次实例：`combo.json` 与 README 说「the two declarations cannot drift apart」，
而执行侧的检查在真实漂移（值被加后缀）下不失败。#46 的修复把死函数接进了 doctor，但没有把
「相等」写成相等判定。本票不扩大范围去改 launcher（那是 #46 的范围，且 #46 已关闭）；
新增测试的断言 1 在测试层独立做严格相等比较，因此该漂移在 `npm test` 下会失败——
但 **doctor 自身的声称仍未被真值化**，建议新票：把 `bundleDeclaresAgentModel` 改为解析 yml 的
`agent-default-model` 行做值相等比较，并把 `combo.json`/README 的措辞对齐到实际强度。

其余 grep 复核（`cannot drift` / `single source` / `only list` / `tests assert` 等）未发现票面三处之外的
「声称被检查但实际没有」实例：`backend/probe/README.md` 的「reports facts, not policy」与
`tests/baseline-boot.test.mjs:37` 的 `FORBIDDEN_ROW_IDS` 仍是正例，`backend/v1-bundle/README.md`
的两处声称现在分别由 `tests/bundle-readme.test.mjs` 与本票的新测试支撑。

## 未完成项与边界

- 没有把「可执行声称检查」做成机械扫描工具。判定「一句文档是否构成可执行声称、是否已有对应检查」
  依赖语义判断，字符串扫描只能抓到措辞、抓不到「断言的是同一事实」，属于票面提示要避免的脆弱实现。
  因此落在两处人工但可判定的位置：`CODING_STANDARDS.md` 的审查判定问句 + `CONVENTIONS.md` §8 的三步检查。
- 本票只在本 worktree 提交，未 push、未合入集成分支、未改 `combo.json`、未评论/关闭 issue。
- 不声称真实云服务、真机或性能验收；本票证据全部是 JVM/Node 测试与 doctor 输出。
