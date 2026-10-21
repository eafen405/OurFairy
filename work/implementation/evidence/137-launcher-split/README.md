# 137-launcher-split — spec #137 收口证据

> 父规格 [#137 启动器拆分：组合层独立成零 spawn 模块，并修正 doctor 的错误契约](https://github.com/eafen405/OurFairy/issues/137)；
> 收口票 [#158](https://github.com/eafen405/OurFairy/issues/158)。分支 `ticket/158-closeout`，
> 合并 tip `6269486`（`integration/spec-137`；门禁执行时本分支 HEAD 与之一致）；基线 `main` @ `f331c38`。
> 本目录是 spec #137 的证据入口；票面工作副本见 [work/tickets/137](../../../tickets/137/README.md)。
>
> 两轴 review 后的修正分支 `ticket/137-review-fixes`（基于 `integration/spec-137` @ `135e283`）
> 提交 `a4e92e6`、`917e2fe`、`ccdde9f`；逐项修正与门禁见「复核修正」。本文件的声称表已按
> 修正后的 committed 检查更新；历史门禁数字保留为当时结果。

## spec 改了什么

三张票在 `integration/spec-137` 上线性合并，最终形状是两个模块、一条错误契约：

| 事实 | 改动 |
| --- | --- |
| 组合层 | 新增 [`scripts/ourfairy-composition.mjs`](../../../../scripts/ourfairy-composition.mjs)（373 行）：读 `combo.json` 与 7 个 pin、隔离布局/环境、产品包清单与源文件集合/哈希、profile 生成、安装判定、overlay 列表。导入面只有 `node:crypto` / `node:fs` / `node:os` / `node:path`。 |
| 进程层 | [`scripts/ourfairy-backend.mjs`](../../../../scripts/ourfairy-backend.mjs) 只留 argv、git、`resolveDsh`、子进程环境、pnpm 执行与命令派发；新增 `main(argv)` 返回退出码，底部 `import.meta.main` 守卫。 |
| 错误契约 | `fail()` 从 `process.exit` 改为抛错；唯一 CLI 边界 `cliFailure` 保留 `ourfairy-backend: ` 前缀与退出码；`doctor` 的逐检查 `try/catch` 因此能把失败写进 `checks`。 |
| 准入规则 | 三条 bundle manifest 依赖准入规则收敛到 `admitBundleDependencies`：启动器读 worktree 副本（containment 根 = 仓库），[`scripts/combo.mjs`](../../../../scripts/combo.mjs) 的 `verifyBundlePackages` 读已安装副本（根 = profile 的 `node_modules`），违规转成 `failures`。 |
| `readCombo` | 实现迁入组合层，`combo.mjs` import 并 re-export，依赖方向单向；既有 `from '../scripts/combo.mjs'` 的导入点不变。 |
| 安装 | `installDecision` 返回 `{ mode, hash }`（`cached` / `install` 加判定哈希）；`spawnSync(pnpm …)` 与 `writeSourceStamp` 留在进程层，stamp 用判定返回的 hash，不再二次哈希。 |

## 三张票

| 票 | 提交（实现 / 证据 / 合并） | 逐票证据 | 结果 |
| --- | --- | --- | --- |
| [#155 错误契约](https://github.com/eafen405/OurFairy/issues/155) | `39f0ca2` / `7c2daa3` / `1a12d7a` | [01-error-contract](01-error-contract.md) | `fail` 改抛错、单一 CLI 边界；doctor 失败检查进入报告。当时 `npm test` 235/235。 |
| [#156 组合层独立](https://github.com/eafen405/OurFairy/issues/156) | `ef49e0f` / `7fcd7e8` / `06b5198` | [02-composition-module](02-composition-module.md) | 组合层抽出、启动器只留进程层、import 守卫；组合事实改为直接 import 断言。当时 `npm test` 239/239。 |
| [#157 准入规则单份](https://github.com/eafen405/OurFairy/issues/157) | `988a961`、`02f6174` / `30fbab1` / `6269486` | [03-manifest-rules](03-manifest-rules.md) | 共享 `admitBundleDependencies`；已安装副本的三条违规经 doctor 端到端失败（复核修正后）。当时 `npm test` 241/241。 |

逐票证据里的门禁数字是各自分支当时的结果；下面的全量门禁才是合并 tip 的最终结果。

## 复核修正（`ticket/137-review-fixes`）

两轴 review 的逐项修正在一个分支上完成，提交按逻辑分组：

| 提交 | 关闭的 review 项 | 落点 |
| --- | --- | --- |
| `a4e92e6` | A1 零 spawn 不可能性措辞；A2 五条消息无 committed 断言（前三条）；A3 组合层 layout 注释；A4 import 只证明不退出 | [01](01-error-contract.md)「复核修正」、[02](02-composition-module.md)「复核修正」 |
| `917e2fe` | B5 doctor 隔离 home 猝死；B6 安装失败无 JSON 契约；C9 `installDecision` 双重哈希 | [01](01-error-contract.md)「复核修正」、[02](02-composition-module.md)「复核修正」 |
| `ccdde9f` | B7 已安装副本只测 `file:` 规则；B8 手写环境；C10 安装模式断言；C11 combo.mjs「reported once」措辞 | [03](03-manifest-rules.md)「复核修正」、[02](02-composition-module.md)「复核修正」 |

修正后受影响测试文件 29/29 pass（`node --test tests/lifecycle.test.mjs
tests/bundle-packages.test.mjs tests/product-sources.test.mjs tests/launcher-import.test.mjs
tests/baseline-boot.test.mjs`，86.2s），`row-addressability` 的直连用例单独 1/1 pass；
三个提交的 pre-commit hook 分别跑 `npm test` 242/242、246/246、246/246 与
`combo:verify` 三行 ok。合并前 `git merge integration/spec-137` 为 `Already up to date.`
（tip `135e283`）。

## 最终门禁（合并 tip `6269486`）

在本 worktree、代码未改的状态执行；Node 24.18.0，Linux。同机另有 worktree 在跑测试
（观察到 `168-input-modalities` 的 `tests/gateway.test.mjs`）。

### `npm test`

第一次全量：

```
$ npm test
ℹ tests 241
ℹ suites 7
ℹ pass 240
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 121111.20909
```

唯一失败是 `tests/gateway.test.mjs` 的
`the gateway reads the shared configuration, refuses an ordinary agent, and survives a restart`：
profile 安装阶段 corepack 下载 `pnpm-11.28.5.tgz` 网络超时（`UND_ERR_CONNECT_TIMEOUT`，
`104.16.7.34:443`，10000ms），不是断言失败，也与本 spec 改动的文件无关。按约定只重跑该文件一次：

```
$ node --test tests/gateway.test.mjs
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ duration_ms 78219.129507
```

随后在同一 tip、代码未改的状态重跑全量：

```
$ npm test
ℹ tests 241
ℹ suites 7
ℹ pass 241
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 111787.329388
```

### `npm run combo:verify`

```
$ npm run combo:verify
row             branch                   expected          actual            result
--------------  -----------------------  ----------------  ----------------  ---------------------------------------------
ourfairy        integration/ourfairy-v1  based on integra  626948684bc7c008  ok (worktree is based on the integration tip)
dsh             product/ourfairy-v1      5b8ec0f175d3d7ba  5b8ec0f175d3d7ba  ok
android source  -                        460109d1b89b824a  460109d1b89b824a  ok (declaration matches)
combo: combination verified
```

三行 ok，exit 0。提交前 `git merge integration/spec-137` 为 `Already up to date.`（HEAD 仍是
`6269486`），无需重跑不受合并影响的门禁。本文件写入后另跑
`node --test tests/docs.test.mjs`（链接检查）：1/1 pass；提交 hook 会再跑全量 `npm test`。

## 改动范围

`git diff --stat main...HEAD`（在 `6269486` 上、写本文件前）：**18 files changed,
1467 insertions(+), 404 deletions(-)**。

| 类别 | 文件 |
| --- | --- |
| 脚本（3） | `scripts/ourfairy-composition.mjs`（新）、`scripts/ourfairy-backend.mjs`、`scripts/combo.mjs` |
| 测试（6） | `tests/composition-module.test.mjs`（新）、`tests/launcher-import.test.mjs`（新）、`tests/bundle-only-profile.test.mjs`、`tests/bundle-packages.test.mjs`、`tests/lifecycle.test.mjs`、`tests/product-sources.test.mjs` |
| 证据（3） | `work/implementation/evidence/137-launcher-split/01-error-contract.md`、`02-composition-module.md`、`03-manifest-rules.md` |
| 票面（6） | `work/tickets/137/README.md`、`01-error-contract.md`、`02-composition-module.md`、`03-manifest-rules.md`、`04-closeout.md`、`published.json` |

本收口提交新增本文件并更新 [`work/implementation/evidence/README.md`](../README.md)，最终为
20 个文件。`git diff --name-only main...HEAD -- backend android` 输出为空：`backend/` 与
`android/` 均未改。

## 可执行声称复核

按 [`work/implementation/CONVENTIONS.md`](../../CONVENTIONS.md) §8 与
[`CODING_STANDARDS.md`](../../../../CODING_STANDARDS.md)「声称须可执行」逐条复核本次增量。
「检查」列是声称失效时会失败的**具体命令或用例**；只能靠源码扫描或答不出检查的声称，
在「处理」列删除或收窄，不补断言。

| 增量中的声称 | 失效时失败的检查 | 是否断言同一事实 / 处理 |
| --- | --- | --- |
| bundle manifest 三条准入规则只有一处实现，worktree 与 installed 两份副本得到同一判定（#157） | `node --test tests/composition-module.test.mjs` 的 `a dependency that is not a file: specifier is refused by name and rule`、`a dependency resolving outside the repository is refused by name and rule`、`a dependency duplicating the bundle or probe entry is refused by name and rule`、`the shared rule gives the worktree and installed shapes the same verdict`；`node --test tests/bundle-packages.test.mjs` 的 `installed bundle admission violations fail the check and name the package and rule` | 同一事实：前三个用例让 worktree 调用路径（`productPackages`）对三条规则分别抛错并点名规则；`the shared rule …` 对两种形状直接调用共享函数并比较 `admitted` / `refused`；installed 用例让已安装 manifest 的非 `file:`、containment 根外、与 bundle 条目重名三种违规分别使 doctor 的 `bundle packages` 失败，并点名包名与规则。**仍不覆盖**：「结构上只有一份实现」没有测试（禁止源码扫描）。保留的声称是「两条调用路径应用同一规则函数所给的判定」，不是「不可能出现第二份」。 |
| doctor --json 在检查失败时仍输出完整报告并记失败检查（#155 / #156） | `node --test tests/lifecycle.test.mjs` 的 `doctor --json records a missing dsh checkout as a failed check instead of dying`、`doctor --json records an unsafe isolated home as its first failed check`、`doctor --json records a profile install failure instead of dying`；`node --test tests/bundle-packages.test.mjs` 的 `installed bundle admission violations fail the check and name the package and rule` | 同一事实：四条失败路径都断言 stdout 可解析为 JSON、`ok: false`、对应 check 的 `ok: false`、退出非零。隔离 home 用例还断言只记录这一条检查（后续可能写盘的检查不执行），detail 是完整拒绝消息。**收窄**：测试只覆盖这四条路径；本文件不保留「总是」。 |
| importing the launcher is inert（import 启动器无副作用，#156） | `node --test tests/launcher-import.test.mjs` 的 `importing the launcher has no side effects and exposes main`、`importing a launcher copy with no combo.json resolves and exposes main` | 同一事实：第一条证明进程内 `await import` 成功并导出 `main` / `repoRoot`，若加载期执行 CLI，`node --test <file>` 的 argv 会走 help 分支并以 2 退出；第二条删除复制仓库的 `combo.json` 后仍能 import，若加载期读 `combo.json` 会 reject。**范围**：固定的是「import 不执行 CLI、不退出、不读 `combo.json`，并导出 main」；「不打印」没有独立断言。 |
| 安装判定是组合层事实，执行是进程层事实（#156） | 判定：`node --test tests/product-sources.test.mjs` 的 `unchanged product sources decide cached`、`reinstall decides install even when the installed profile is current`、`a missing linked bundle manifest decides install`、`a new product source file changes the hash and decides install`；执行：`node --test tests/bundle-packages.test.mjs` 的 `the bundle rows, its declared packages, and the installed profile agree`（第一次 `(installed)`、第二次 `(cached)`）、`installed bundle admission violations…`（每次 doctor 复用已安装副本，不覆盖 mutation） | 同一事实：前四条直接 import `installDecision`，断言 `decision.mode` 的 `cached` / `install` 分支，不经子进程；后两条要求真实 pnpm 安装出的 profile 存在、可复用且安装模式被报告。**未检查**：「执行不在组合层」是导入面结构事实，无行为测试；见零 spawn 行。 |
| doctor checks are projections of composition facts（#156） | 没有测试在 doctor 内联第二份计算但输出相同时失败 | **删除原句**。保留的事实：doctor 的四个检查（`node version`、`product packages`、`isolated home`、`profile project linked`）调用组合层函数，`bundle packages` 经 `combo.mjs` 间接使用准入规则；`doctor reports its checks on a clean isolated home` 只断言这些检查存在且本机通过，不断言「投影」。 |
| readCombo has one implementation（#156） | 没有测试区分 re-export 与另一份实现；四个测试文件从 `scripts/combo.mjs` 导入 `readCombo` 并成功使用（`tests/bundle-only-profile.test.mjs`、`tests/bundle-packages.test.mjs`、`tests/ecosystem-boundary.test.mjs`、`tests/plugin-compatibility.test.mjs`） | **删除「只有一份实现」**。保留的声称是「`combo.mjs` re-export 组合层的 `readCombo`，既有导入点不变」：re-export 被删时上述四个测试文件在 import 期失败。 |
| 组合层零 spawn（#156） | 无行为测试 | **不作为已检查声称**。接缝是模块导入面：[`scripts/ourfairy-composition.mjs`](../../../../scripts/ourfairy-composition.mjs) 只 import `node:crypto` / `node:fs` / `node:os` / `node:path`，没有 `node:child_process`；`CODING_STANDARDS.md` 禁止用正则扫源码充当检查，因此只记录导入面事实。 |
| 内部失败经单一 CLI 边界，消息与退出码不变（#155） | `node --test tests/lifecycle.test.mjs` 的 `duplicate start is refused, stop is clean, and nothing leaks across cycles`（从 `run/backend.json` 读 pid/startedAt 后断言完整 `already running` 行）、`a missing dsh checkout fails loudly instead of booting something else`（从 `combo.json` 读 remoteUrl 后断言完整行）、`doctor --json records an unsafe isolated home as its first failed check`（完整拒绝 detail）、`doctor --json records a profile install failure instead of dying`（`profile install failed in <profileDir> (exit ` 前缀）、`doctor --json records a missing dsh checkout as a failed check instead of dying`；`node --test tests/baseline-boot.test.mjs` 的 `boot-product refuses an overlay instead of silently ignoring it`（完整 `--patch applies…` 行） | 同一事实：这些用例断言失败文本与退出码；动态 pid / 时间戳 / remoteUrl 从磁盘或 combo.json 读取后再拼完整行。**范围**：五条稳定消息有 committed 断言；与基线的完整逐字比较仍是 #155 的一次性临时仓库对比（未入库），不作为可重放检查。安装失败因后缀含 pnpm 输出只固定前缀。 |

## 未完成 / 范围外

- **零 spawn 没有行为测试。** 接缝是模块导入面；按 `CODING_STANDARDS.md` 不用正则扫源码充当
  检查。这里只记录导入面事实，不声称「已被检查」。复核修正只把措辞从「不可能」改为
  「导入面边界」，没有新增强制机制。
- **Windows 未验证。** 所有命令与测试都在本机 Linux（Node 24.18.0）执行。
- **`combo.mjs` 的 git 调用未动。** `repoPath` 与 `verify*` 留在原处；本 spec 只把 `readCombo`
  与准入规则函数接入。
- **`nodeSatisfies` 与 doctor 的检查编排留在进程层。** 组合层只提供 `nodeRange`；检查顺序、
  `check()` 包装与退出码仍是进程层事实。复核修正只把隔离检查移到第一位。
- **`readCombo` 的「只有一份实现」没有测试。** 只固定 `combo.mjs` re-export 可用。
- **未做 review 未列出的 judgement calls。** 不重命名 `readCombination`、不收窄导出、
  不合并 worktree/installed 两套规则消息渲染器。
- **观察到的偶发失败。** 第一次全量 `npm test` 有 1 个与本 spec 无关的失败（corepack 下载
  pnpm 11.28.5 网络超时）；`tests/gateway.test.mjs` 单独重跑 9/9 通过，第二次全量 241/241
  通过。同机有其它 worktree 并行跑测试，这是网络/负载型偶发，不是本 spec 改动引起。
- **收口票本身未新增测试。** 复核修正新增了上述 committed 断言（A2/A4/B5/B6/B7/B8/C9/C10），
  其余检查仍指向既有用例。

## 收口对照（04-closeout 验收项）

| 验收项 | 落点 |
| --- | --- |
| 合并后的集成分支上跑 `npm test` 与 `npm run combo:verify`，命令与结果入库 | 「最终门禁（合并 tip `6269486`）」 |
| 本 README 作为 spec 证据入口，登记 01–03 的逐票证据 | 「三张票」及三份链接 |
| 更新 `work/implementation/evidence/README.md` 索引 | 新增「启动器拆分（规格 #137）」节与 `137-launcher-split` 行 |
| 逐条复核可执行声称，答不出的删除 | 「可执行声称复核」 |
| 记录改动范围与未完成项 | 「改动范围」「未完成 / 范围外」 |
| 记录「启动器 import 无副作用」由哪条断言固定 | 复核表第 3 行；`tests/launcher-import.test.mjs` 的 `importing the launcher has no side effects and exposes main` 与 `importing a launcher copy with no combo.json resolves and exposes main` |
| 未完成项如实记录 | 「未完成 / 范围外」 |
