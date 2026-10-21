# 02-bundle-groups — 票 #161 证据

> 父票 [#134](https://github.com/eafen405/OurFairy/issues/134)；票面
> [`work/tickets/134/02-bundle-groups.md`](../../../tickets/134/02-bundle-groups.md)；
> 任务图与 19/27 归属 [`work/tickets/134/README.md`](../../../tickets/134/README.md)；
> 分析记录 [`docs/research/dsh-bundle-group-composition.md`](../../../../docs/research/dsh-bundle-group-composition.md) §1、§2。
> 分支 `ticket/161-bundle-groups`，基线 `integration/spec-134` @ `e5e043d`。

本票只改组合文件的分组方式、bundle README 的「Row set and package set」段，并新增两个行为
用例。每行的 `id`/`name`/`config` 未变；probe 报告结构未动，没有新增行、字段或依赖。

## 改了什么

1. `backend/v1-bundle/cordis.patch.yml` — 顶层 `insert` 从 46 个平铺行改成两个 loader 原生
   group 行：
   - `kernel`（19 行）：`agent`、`session`、`llm`、`system-prompt`、`session-projection`、
     `tools`、`agent-loop`、`agent-default-model`、`llm-deepseek-api-key`、`llm-retry`、
     `spill-local`、`spill-policy`、`session-persistence-jsonl`、
     `session-checkpoint-policy`、`session-query-sqlite`、`credentials`、`llm-pi-ai`、
     `webserver`、`connection`。
   - `plugins`（27 行）：其余行，按票面清单。
   两个 group 行都是 `name: cordis:group`、`group: true`、`config` 为嵌套行数组；`package.json`
   未新增任何依赖。
   判据写在文件头：**停掉该段之后基本功能是否还成立**，不是包名前缀。`tool-todo`、
   `jobs-local`、`attachment-local`、`config-editor`、`settings` 与各工具行虽是原生包，
   停掉后内核仍能启动，所以归 `plugins`。文件头删掉了「分组只为读者」的旧说法，写明
   新增产品行必须决定归属段；顶层出现非 group 行会被新测试拦住。文件头对停用 `plugins`
   的结论是测试实际证明的那一条——**后端仍能启动且内核服务 live**——不再声称还能跑通
   一轮模型（`chat` 在 `plugins` 里，停用整组后没有产品的模型回合路径）。
   每行的注释与 `!!js` 表达式原样保留；行内顺序只影响可读性。
2. `backend/v1-bundle/README.md` — 「Row set and package set」段改为描述两个 group、判据，
   并指向文件；不再按旧 section 清单复述行集。「Absent rows」段未动（#160）。
3. `tests/bundle-groups.test.mjs`（新增，2 个用例，全部走 dsh 自己的加载器与真实 launcher）：
   - `the composition is two segments and every row belongs to one`：用
     `loadOverlayPatches` + `composeEntries` 读组合；顶层恰为 `kernel`、`plugins`，二者
     `name: cordis:group`、`group: true`、`Array.isArray(config)` 且 `config` 非空；顶层
     没有非 group 行；用 `scripts/combo.mjs` 的 `flattenEntries` 展开后叶子行 id 唯一。
     这里不写死行数：行集由组合文件本身提供，硬编码计数会成为第二份权威。
   - `disabling the plugins group leaves the kernel booting`：overlay
     `[{ id: 'plugins', disabled: true }]`，用 `runBackend` 跑
     `probe --patch <overlay> --report <path>`（keyless）；断言 exit 0、`report.ok === true`、
     `report.failures` 为空；内核服务 `sessions`、`tools`、`llm`、`agents`、
     `sessionPersistence`、`sessionQuery`、`sessionProjections` live；从组合里读出的
     `plugins.config` 每个子行 `disabled: true`，`kernel.config` 每个子行 `disabled: false`；
     `plugins` 与 `kernel` 两个 group 行自身 `disabled: false`（loader 语义：group 行永不
     报告 disabled，状态在子行上）；`report.rows` 含两个 group 行。
4. `tests/native-capabilities.test.mjs` — `composedRows()` 返回
   `flattenEntries(composeEntries(...))` 的叶子行，不再过滤 group 行。`flattenEntries`
   现在只返回叶子行、把祖先 group 的 `disabled` 物化到叶子，并且是幂等的；失败注入用例
   对展开行集 `filter`/`map` 后再次传入 `nativeCapabilityFailures` 不会重复展开子行。
   新增 `a required row inside a disabled group is reported as disabled`：把整份叶子行包进
   一个 `disabled: true` 的 group，断言四个必选原生行都被报为 disabled（每个消息点名行 id
   并含 disabled）。没有这条断言时，禁用整个 `plugins` 会让 `subprocess` 在运行时失效，
   但 doctor 的逐行 flag 检查仍会通过。

## 零语义变化对照

改动提交前（`HEAD` = `e5e043d`）把旧组合写到临时文件，再用 dsh 的加载器分别展开两份组合，
逐行比较 `id`/`name`/`config`：

```sh
git show e5e043d:backend/v1-bundle/cordis.patch.yml > /tmp/cordis.before.yml
node --input-type=module - <<'EOF'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
const combo = JSON.parse(readFileSync('combo.json', 'utf8'))
const dshRequire = createRequire(join(combo.repos.dsh.localPath, 'apps', 'cli', 'package.json'))
const boot = dshRequire('@deepseek-ai/dsh-app-boot')
const flatten = entries => entries.flatMap(entry => [
  entry,
  ...(entry.group && Array.isArray(entry.config) ? flatten(entry.config) : []),
])
const load = path => flatten(boot.composeEntries([boot.loadOverlayPatches('dsh', path)]))
const before = load('/tmp/cordis.before.yml')
const after = load(join(process.cwd(), combo.backend.bundlePathInRepo, 'cordis.patch.yml'))
const groups = after.filter(row => row.group === true)
const rows = after.filter(row => row.group !== true)
const mismatches = []
for (const row of before) {
  const match = rows.find(candidate => candidate.id === row.id)
  if (match === undefined) mismatches.push(`missing ${row.id}`)
  else if (!isDeepStrictEqual(
    { id: row.id, name: row.name, config: row.config },
    { id: match.id, name: match.name, config: match.config },
  )) mismatches.push(`changed ${row.id}`)
}
const extra = rows.filter(row => !before.some(candidate => candidate.id === row.id)).map(row => row.id)
console.log('before rows', before.length, 'after rows', rows.length,
  'groups', groups.map(group => `${group.id}:${group.config.length}`).join(', '))
console.log('mismatches', mismatches)
console.log('extra', extra)
EOF
```

实际输出：

```text
before rows 46 after rows 46 groups kernel:19, plugins:27
mismatches []
extra []
```

即除两个新 group 行外，46 行的 `id`/`name`/`config` 深度相等；没有增删、改名或重配任何行。

## 命令与结果（实际执行）

在 worktree 根目录：

| 命令 | 结果 |
| --- | --- |
| `node --test tests/bundle-groups.test.mjs` | **2 pass / 0 fail**（最终树 `duration_ms` 13620；kernel-only boot 用例 12850 ms） |
| `node --test tests/native-capabilities.test.mjs` | **8 pass / 0 fail**（评审修复新增 disabled-group 用例；#161 当时的树为 7 pass） |
| `node --test tests/row-addressability.test.mjs` | **7 pass / 0 fail**（最终树 `duration_ms` 99148；原样通过，overlay 仍能按 id 命中 group 内的 `delivery`、`groups`、`scoped-*`） |
| `npm run backend:doctor` | `doctor: all checks passed`，含 `native capabilities`（4 行 + history export）与 `bundle packages`（10 declared package(s) mounted by 15 row(s)） |
| `npm test` | **238 pass / 0 fail**，7 suites（评审修复新增 1 条 disabled-group 用例；#161 当时的树为 237） |
| `npm run combo:verify` | 三行 ok：ourfairy（based on the integration tip）、dsh、android source；`combo: combination verified` |

kernel-only boot 的实测事实（来自上述 `bundle-groups` 用例）：`probe --patch <plugins 整组
停用> --report <path>` exit 0、`report.ok === true`、`failures` 为空、7 个内核服务 live；
27 个 plugin 子行全部 `disabled: true`，19 个 kernel 子行全部 `disabled: false`，两个 group
行自身 `disabled: false`，`report.rows` 含 `kernel`/`plugins`。

红-绿：分组前先写 `tests/bundle-groups.test.mjs` 并运行，第一个用例失败（顶层是 46 个
平铺行，expected `['kernel','plugins']`）；改组合文件后转绿。

## 未完成 / 备注

- 无未完成项。`work/implementation/evidence/README.md` 未改，索引条目归收口票 #162。
- 备注：`tests/speech.test.mjs` 的 150 ms ASR 超时用例在本机是既有 flake。第一次 `npm test`
  出现 236/237（`speech/timeout`），把本票改动 `git stash` 掉后该用例仍失败，单独重跑通过；
  第二次 `npm test` 237/237（评审修复后为 237/238）。不是本票引入，未改该测试。
