# 03-manifest-rules — 票 #157 证据

> 父票 [#137](https://github.com/eafen405/OurFairy/issues/137)；票面
> `work/tickets/137/03-manifest-rules.md`；分支 `ticket/157-manifest-rules`；
> 基线 `integration/spec-137` 的 `06b5198`；实现提交 `988a961`、`02f6174`；
> 证据提交即本文件所在提交。
>
> 复核修正（#137 两轴 review）：分支 `ticket/137-review-fixes`（基于 `integration/spec-137`
> @ `135e283`），提交 `ccdde9f`。已安装副本的端到端覆盖从 `file:` 一条扩展到三条规则；
> 见「复核修正」。

## 改了什么

### `scripts/ourfairy-composition.mjs`

新增导出 `admitBundleDependencies({ dependencies, bundleDir, containmentRoot, entries })`，
三条依赖准入规则只在这里实现一次，返回：

- `admitted: {name, dir}[]`：通过准入的依赖，保持声明顺序，`dir` 相对 `containmentRoot`；
- `refused: {name, specifier, target?, rule}[]`：`rule` 为 `file` / `containment` / `duplicate`。

规则函数不抛错：抛还是记 failure 由调用方决定。检查顺序与语义未改
（非字符串或非 `file:` → `file`；`relative()` 为空、以 `..` 开头或为绝对路径 →
`containment`；名字与 bundle/probe 条目重名 → `duplicate`）。

`productPackages(root)` 改为调用该函数，`containmentRoot = root`、`entries = [bundlePackage, probePackage]`；
对第一条 `refused` 抛出既有消息。三处消息的模板字面量原样保留（`file:` 规则、仓库外、
重名），`tests/composition-module.test.mjs` 继续断言其点名与规则文本。

### `scripts/combo.mjs`

- 从组合层 import `admitBundleDependencies`（依赖方向仍为 `combo.mjs` → 组合层；
  组合层不 import `combo.mjs`，无循环）。
- `verifyBundlePackages` 读已安装 manifest（`boot.readProfileManifest(binName, layer.packageDir)`）后，
  用同一函数：`bundleDir = layer.packageDir`，`containmentRoot = join(profileDir, 'node_modules')`，
  `entries = [bundlePackage, probePackage]`。已安装包的 `file:../identity` 解析到
  `<profile>/node_modules/@ourfairy/identity`，落在该根内。
- 每条违规经 `installedAdmissionFailure` 转成 `failures` 的一条，不抛穿 doctor；
  消息点名已安装 manifest 的绝对路径、包名与规则，`file:` 违规的消息含 `file:<path>`。
- `declared` 仍取已安装 manifest 的依赖名（`Object.keys(manifest.dependencies)`），
  因此违规不会额外产生 "does not declare"/ghost package 失败。

### 测试

- `tests/composition-module.test.mjs`：新增
  「the shared rule gives the worktree and installed shapes the same verdict」。
  同一份依赖内容分别以 worktree 形状（bundle 在 `backend/v1-bundle`，根为仓库）和
  installed 形状（bundle 在 profile 的 `node_modules/@ourfairy/dsh-v1-bundle`，根为
  `node_modules`）调用共享函数：一条合法依赖 + 三条违规（非 `file:`、根外、重名 bundle、
  重名 probe）在两个根下给出相同的 `admitted` 名字或相同的 `refused` 名字与 `rule`。
- `tests/bundle-packages.test.mjs`：新增端到端
  「an installed bundle dependency outside the file: rule fails the check and names it」。
  先跑 `doctor --json` 安装 profile；把 **已安装** bundle manifest 的
  `@ourfairy/dsh-search` 改成 `^1.0.0`；再跑 `doctor --json`。源哈希未变，doctor 复用
  已安装副本（断言 mutation 仍在）。断言 "bundle packages" 失败，detail 含包名、
  `file:`、已安装 manifest 路径，且不含 `does not declare @ourfairy/dsh-search`。
  复核修正（`ccdde9f`）把该用例改为
  「installed bundle admission violations fail the check and name the package and rule」：
  安装一次后依次变异**已安装** manifest 的非 `file:` specifier、containment 根外目标、
  与 bundle 条目重名三种违规，每次跑 `doctor --json` 断言 "bundle packages" 失败并点名
  包名、已安装 manifest 路径与对应规则；每个 case 后恢复 manifest，最后再断言恢复后
  检查变绿。源哈希不变，所有 doctor 都复用已安装副本（每个 case 断言 mutation 仍在）。

## 红 → 绿

实现前：

- `node --test tests/composition-module.test.mjs` → `SyntaxError: The requested module
  '../scripts/ourfairy-composition.mjs' does not provide an export named 'admitBundleDependencies'`。
- `node --test --test-name-pattern="installed bundle dependency" tests/bundle-packages.test.mjs`
  → 1 fail；第二次 doctor 的 check 仍为 `ok: true`，detail 为
  `10 declared package(s) mounted by 15 row(s): ...`。

实现后同一命令：

- `node --test tests/composition-module.test.mjs` → 4/4 pass，约 0.11s。
- `node --test --test-name-pattern="installed bundle dependency" tests/bundle-packages.test.mjs`
  → 1/1 pass，10.8s。

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| 基线（改动前）`node --test tests/composition-module.test.mjs tests/bundle-packages.test.mjs` | 12/12 pass，69.1s |
| `node --test tests/composition-module.test.mjs`（红） | 1 fail：缺 `admitBundleDependencies` 导出 |
| `node --test tests/composition-module.test.mjs`（绿） | 4/4 pass，0.11s |
| `node --test --test-name-pattern="installed bundle dependency" tests/bundle-packages.test.mjs`（红） | 1 fail：check `ok: true` |
| 同一命令（绿） | 1/1 pass，10.8s |
| `node --test tests/composition-module.test.mjs tests/bundle-packages.test.mjs tests/bundle-manifest.test.mjs tests/plugin-compatibility.test.mjs tests/product-sources.test.mjs` | 23/23 pass，86.6s |
| `node scripts/combo.mjs verify` | ourfairy / dsh / android source 三行 ok，exit 0 |
| 提交 `988a961` 的 pre-commit hook：`npm test` | 241/241 pass，113.7s |
| 提交 `02f6174` 的 pre-commit hook：`npm test` | 241/241 pass，112.4s |
| 合并后重跑上述 5 个测试文件 | 23/23 pass，106.2s |

`npm test` 从基线 239 增至 241，新增的两个用例即本票的直接判定测试与端到端测试。
Node 24.18.0，Linux。

## 复核修正（#137 两轴 review）

review 指出已安装副本的准入规则只有 `file:` 一条做了端到端验证，另两条只有组合层直接
测试。`ccdde9f` 把 `tests/bundle-packages.test.mjs` 的已安装用例扩展为三种违规的端到端
变异（非 `file:`、containment 根外、与 bundle 条目重名），并恢复 `(installed)` /
`(cached)` 的 doctor 安装模式断言：

- 安装 profile 一次，之后每个 case 只改**已安装** bundle manifest；源哈希不变，doctor
  复用已安装副本，不重装覆盖变异。
- 每个 case 断言 `bundle packages` 失败、detail 含包名、已安装 manifest 路径与规则文本
  （`an installed product package is linked, not fetched` /
  `an installed bundle may only link packages inside the profile's node_modules` /
  `twice: once as a bundle/probe entry and once in dependencies`），且不额外报
  `does not declare <name>`。
- 每个 case 后恢复 manifest；最后一个 doctor 断言恢复后检查变绿。

| 命令 | 结果 |
| --- | --- |
| `node --test --test-name-pattern='installed bundle admission|bundle rows, its declared|installed copy boots' tests/bundle-packages.test.mjs` | 3/3 pass，26.9s |
| `node --test tests/bundle-packages.test.mjs tests/lifecycle.test.mjs` | 16/16 pass，121.3s |
| 合并后 `node --test tests/lifecycle.test.mjs tests/bundle-packages.test.mjs tests/product-sources.test.mjs tests/launcher-import.test.mjs tests/baseline-boot.test.mjs` | 29/29 pass，86.2s |
| 提交 `ccdde9f` 的 pre-commit hook | `npm test` 246/246 pass，105.9s；`combo:verify` 三行 ok |

## 合并

`git merge integration/spec-137` → `Already up to date.`：集成分支 tip 仍是 `06b5198`
（本票基线），无冲突需要解决。合并后重跑 5 个测试文件 23/23 pass。

复核修正分支合并时 `git merge integration/spec-137` 同样为 `Already up to date.`
（tip `135e283`），无冲突；合并后重跑 5 个受影响测试文件 29/29 pass。

## 未执行 / 范围外

- 未改 `scripts/ourfairy-backend.mjs`：doctor 的 `bundle packages` 检查仍只把
  `verifyBundlePackages` 的 `failures` join 成 detail，消息不需要移动。
- 未做 Windows 验证；本仓库测试均在本机 Linux 上运行。
- 未新增源码扫描式「只有一份实现」测试：`CODING_STANDARDS.md` 禁止用正则扫源码
  充当检查。单份实现由两调用点共用同一导出、且组合层不 import `combo.mjs` 体现。
- 复核修正未做 judgement calls 未列出的项：不重命名 `readCombination`、不收窄导出、
  不合并 worktree/installed 两套规则消息渲染器。
