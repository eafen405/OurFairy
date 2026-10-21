# 01-error-contract — 票 #155 证据

> 父票 [#137](https://github.com/eafen405/OurFairy/issues/137)；票面
> `work/tickets/137/01-error-contract.md`；分支 `ticket/155-error-contract`；基线
> `integration/spec-137` 的 `631d0f3`；实现提交 `39f0ca2`；证据提交即本文件所在提交。
> 本票只改启动器错误契约与 `tests/lifecycle.test.mjs`；模块拆分留给 #156。

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

消息逐字核对：把 `scripts/`、`combo.json`、`package.json` 复制到临时仓库，另存基线
`631d0f3` 的启动器，对同一命令分别跑基线与本分支，比较 stdout / stderr / 退出码。以下全部
identical：`OURFAIRY_DSH_DIR` 缺失的 `probe`、host home 的 `status` 与 `doctor --json`、
`boot-product --patch`、未知命令、未知 flag、缺参数、无命令（exit 2）、`help`（exit 0）；
另核对 pin 为空（`backend.profileName`）与缺 `combo.json` 两种模块加载期失败，以及把
`<home>/pnpm-store` 做成普通文件触发的 `profile install failed in …`，均 identical。

## 合并

合并前 `git merge integration/spec-137`：集成分支 tip 仍是 `631d0f3`，结果为
`Already up to date.`，无冲突。合并后重跑
`node --test tests/lifecycle.test.mjs`：4/4 pass（8.0s）。

## 未执行 / 范围外

- 未拆模块（#156）、未改 `combo.mjs` 的 bundle 准入（#157）。
- 未改 `backend/`、`android/`、`scripts/combo.mjs`、`package.json` 或其他测试文件。
- 未做 Windows 平台验证；本仓库现有测试均在本机 Linux 上运行。
