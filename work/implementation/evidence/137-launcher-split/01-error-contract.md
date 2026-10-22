# 01-error-contract — 票 #155 证据

> 父票 [#137](https://github.com/eafen405/OurFairy/issues/137)；票面
> `work/tickets/137/01-error-contract.md`；分支 `ticket/155-error-contract`；基线
> `integration/spec-137` 的 `631d0f3`；实现提交 `39f0ca2`；证据提交即本文件所在提交。
> 本票只改启动器错误契约与 `tests/lifecycle.test.mjs`；模块拆分留给 #156。
>
> 复核修正（#137 两轴 review）：分支 `ticket/137-review-fixes`（基于 `integration/spec-137`
> @ `135e283`），提交 `a4e92e6`、`917e2fe`。下面「复核修正」一节记录新增的 committed
> 断言与 doctor 行为变化；原有历史结论保留，只有与新事实冲突处已就地更正。

## 改了什么

`scripts/ourfairy-backend.mjs`

- `fail(message)`（`:84`）不再写 stderr 并 `process.exit`，改为 `throw new Error(message)`。
  所有内部失败路径因此抛到调用方：argv 用法、`--patch` 准入、隔离 home 拒绝、dsh 检出缺失 /
  CLI build 缺失 / 提交漂移、bundle manifest 准入、profile 安装失败与安装后缺 bundle、
  探针 overlay 缺失、探针启动失败、已在运行、启动未就绪、未知命令。
- 新增唯一边界 `cliFailure(error)`（`:89`）：写 `ourfairy-backend: <message>` 到 stderr，
  `process.exit(1)`。命令派发整体包在 `try/catch`（`:897`–`:924`）里。模块加载期的
  `readCombination()`（`:62`）经同一个 `cliFailure` 退出，所以缺 combo.json / pin 为空时
  仍保留原有前缀与退出码。
- 消息文本未改；退出码未改：所有内部失败原本就用 `fail` 的默认码 1，用法路径保持
  `help` → 0、无命令 → 2、`--help` → 1（改动前后 `parseArgv` 都先把 `--help` 当未知 flag）。
- `doctor` 的逐检查 `try/catch` 现在真正生效：`dsh CLI build`、`profile project linked` 等
  失败被记入 `checks`，`doctor --json` 仍输出完整报告并返回 1。`commandBootProduct` 的
  「产品 profile 未能起服务」是命令结果（写报告文件 + stderr 诊断 + 返回 1），不是内部异常路径，未改。
- 复核修正（`917e2fe`）：`doctor` 不再在记录任何检查前调用 `assertIsolatedHome`。隔离是
  **第一条记录项**；它失败时输出只含这一条失败检查的正常报告（JSON 或文本）并返回 1，
  不再执行任何可能写盘的检查（corepack 缓存、profile 安装）。原先后面那条重复的
  「isolated home」检查已删除。`probe` / `start` / `boot-product` 的前置拒绝保持不变。

`tests/lifecycle.test.mjs`

- 新增 `doctor --json records a missing dsh checkout as a failed check instead of dying`（`:116`）：
  `OURFAIRY_DSH_DIR` 指向不存在的目录，断言退出非零、stdout 可解析为 JSON、`ok` 为 false、
  `dsh CLI build` 检查 `ok` 为 false 且 detail 点名该路径。
- 既有断言原样保留（`--patch applies to probe and start only`、`already running`、缺失 dsh 的
  probe 诊断文本）。

## 红 → 绿

先写测试，红（改动前的启动器）：

```
node --test --test-name-pattern='doctor --json records' tests/lifecycle.test.mjs
```

结果 `fail 1`：stdout 为空，stderr 为
`ourfairy-backend: dsh checkout missing at /tmp/ourfairy-lifecycle-…/no-such-dsh-doctor; …`，
`JSON.parse` 抛 `Unexpected end of JSON input`。

实现后同一命令：`pass 1`（3.6s）。

## 命令与结果

| 命令 | 结果 |
| --- | --- |
| `node --test --test-name-pattern='doctor --json records' tests/lifecycle.test.mjs` | 实现前 fail 1；实现后 pass 1 |
| `node --test tests/lifecycle.test.mjs tests/baseline-boot.test.mjs` | 10/10 pass，14.9s |
| `node --test tests/bundle-manifest.test.mjs tests/product-sources.test.mjs tests/bundle-packages.test.mjs tests/plugin-compatibility.test.mjs tests/native-capabilities.test.mjs` | 24/24 pass，78.1s |
| `npm test` | 235/235 pass（基线 234 + 本票新增 1），113.7s，exit 0 |
| `npm run combo:verify` | 三行 ok（ourfairy / dsh / android source），exit 0 |
| 提交 `39f0ca2` 的 pre-commit hook | 再次跑 `npm test` 235/235 与 `combo:verify`，均通过 |

消息逐字核对（#155 当时的一次性对比，未入库）：把 `scripts/`、`combo.json`、`package.json`
复制到临时仓库，另存基线 `631d0f3` 的启动器，对同一命令分别跑基线与本分支，比较 stdout /
stderr / 退出码。以下全部 identical：`OURFAIRY_DSH_DIR` 缺失的 `probe`、host home 的
`status` 与 `doctor --json`、`boot-product --patch`、未知命令、未知 flag、缺参数、无命令
（exit 2）、`help`（exit 0）；另核对 pin 为空（`backend.profileName`）与缺 `combo.json`
两种模块加载期失败，以及把 `<home>/pnpm-store` 做成普通文件触发的
`profile install failed in …`，均 identical。

## 复核修正（#137 两轴 review）

review 指出「错误文本逐字不变」只有一次性对比、没有 committed 断言，且 `doctor --json`
在隔离 home 不安全时仍会猝死。修正提交 `a4e92e6`（消息 pin）与 `917e2fe`（doctor 行为 +
安装失败契约）。

五条稳定消息现在的 committed 断言：

| 消息 | committed 断言 |
| --- | --- |
| `--patch applies to probe and start only; 'boot-product' does not mount profile overlays` | `tests/baseline-boot.test.mjs` 的 `boot-product refuses an overlay instead of silently ignoring it` 断言完整 stderr 行（含 `ourfairy-backend: ` 前缀与换行）。 |
| `backend already running with pid <pid> (started <startedAt>); run 'stop' first` | `tests/lifecycle.test.mjs` 的 `duplicate start is refused, stop is clean, and nothing leaks across cycles` 从 `<home>/run/backend.json` 读 `pid` / `startedAt`，断言完整 stderr 行。 |
| `dsh checkout missing at <dir>; set OURFAIRY_DSH_DIR or clone <remoteUrl>` | `tests/lifecycle.test.mjs` 的 `a missing dsh checkout fails loudly instead of booting something else` 从 `combo.json` 读 `remoteUrl`，断言完整 stderr 行。 |
| `refusing OURFAIRY_HOME=<home>: it is the host home (<host>) or an ancestor of it. Backend state must stay isolated; unset OURFAIRY_HOME to use <root>/.ourfairy.` | `tests/lifecycle.test.mjs` 的 `doctor --json records an unsafe isolated home as its first failed check` 断言 `checks[0].detail` 全文。 |
| `profile install failed in <profileDir> (exit <code>): …` | `tests/lifecycle.test.mjs` 的 `doctor --json records a profile install failure instead of dying` 断言 detail 前缀到 `(exit `；后缀是 pnpm 的 stdout/stderr，不稳定。 |

前四条整行固定；安装失败只固定前缀。一次性基线对比仍不可重放，本文件不再把它当作
「消息逐字不变」的唯一依据。

### 红 → 绿

隔离 home 用例先红（`917e2fe` 之前）：

```
node --test --test-name-pattern='unsafe isolated home' tests/lifecycle.test.mjs
```

结果 fail 1：stdout 为空，stderr 为完整的
`ourfairy-backend: refusing OURFAIRY_HOME=/home/eafen405: …`，`JSON.parse` 抛
`Unexpected end of JSON input`。实现后同一命令 pass 1。

安装失败用例在实现前后都输出 JSON（本票的 `try/catch` 已生效），新增的是契约断言：
`doctor --json` 可解析、`ok: false`、`profile project linked` 失败、detail 以
`profile install failed in <profileDir> (exit ` 开头、退出非零。

### 复核命令与结果

| 命令 | 结果 |
| --- | --- |
| `node --test --test-name-pattern='boot-product refuses' tests/baseline-boot.test.mjs` | 1/1 pass |
| `node --test --test-name-pattern='duplicate start|missing dsh checkout fails' tests/lifecycle.test.mjs` | 2/2 pass，11.3s |
| `node --test --test-name-pattern='unsafe isolated home|profile install failure' tests/lifecycle.test.mjs` | 红 1 fail（隔离）；实现后 2/2 pass，1.2s |
| 提交 `a4e92e6` 的 pre-commit hook | `npm test` 242/242 pass，111.9s；`combo:verify` 三行 ok |
| 提交 `917e2fe` 的 pre-commit hook | `npm test` 246/246 pass，105.5s；`combo:verify` 三行 ok |
| 合并后 `node --test tests/lifecycle.test.mjs tests/bundle-packages.test.mjs tests/product-sources.test.mjs tests/launcher-import.test.mjs tests/baseline-boot.test.mjs` | 29/29 pass，86.2s |

## 合并

合并前 `git merge integration/spec-137`：集成分支 tip 仍是 `631d0f3`，结果为
`Already up to date.`，无冲突。合并后重跑
`node --test tests/lifecycle.test.mjs`：4/4 pass（8.0s）。

复核修正分支合并时 `git merge integration/spec-137` 同样为 `Already up to date.`
（tip `135e283`），无冲突；合并后重跑上表 5 个测试文件 29/29 pass。

## 未执行 / 范围外

- 未拆模块（#156）、未改 `combo.mjs` 的 bundle 准入（#157）。
- 未改 `backend/`、`android/`、`scripts/combo.mjs`、`package.json` 或其他测试文件。
- 未做 Windows 平台验证；本仓库现有测试均在本机 Linux 上运行。
- 复核修正未重新做一次性基线逐字对比；五条稳定消息由 committed 断言固定，安装失败
  因含 pnpm 输出只固定前缀。
