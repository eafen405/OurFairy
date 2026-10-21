# 134-bundle-groups — 收口（票 #162）

> 父票 [#134 组合层显式化内核与插件](https://github.com/eafen405/OurFairy/issues/134)；票面
> [`work/tickets/134/04-closeout.md`](../../../tickets/134/04-closeout.md)；
> 任务图 [`work/tickets/134/README.md`](../../../tickets/134/README.md)；
> 分析记录 [`docs/research/dsh-bundle-group-composition.md`](../../../../docs/research/dsh-bundle-group-composition.md)。
> 收口分支 `ticket/162-closeout`，基于 `integration/spec-134` @ `be37140`；
> 评审修复分支 `ticket/134-review-fixes`，基于 `integration/spec-134` @ `7bf1b0e`。
> 三票证据：[#159](01-native-group-aware.md) · [#161](02-bundle-groups.md) · [#160](03-absence-attribution.md)。

本目录记录 #159–#162 的交付与收口。收口票 #162 本身只写证据与索引，并把
`work/tickets/134/` 下的四份副本刷新到当时的 GitHub 票面；产品代码、测试、
`backend/v1-bundle/cordis.patch.yml` 与 bundle README 当时未改。

评审修复分支在此之上修了六类问题：bundle README 的不可证声称、票面工作副本里的第二份
行清单、bundle 文件头的过度声称、`flattenEntries` 的重复实现与行数断言，以及「禁用
group 对原生能力检查不可见」的行为缺口。**下文数字与结论均为修复后的最终树**；涉及
历史提交的段落保留原提交信息。

## 规格改了什么（指针）

| 票 | 交付 | 证据 |
| --- | --- | --- |
| #159 | `scripts/combo.mjs` 的 `flattenEntries` 改为只返回叶子行、把祖先 group 的 `disabled` 物化到叶子且幂等；`nativeCapabilityFailures` 仍展开输入；`verifyInstalledNativeCapabilities` 显式传入展开行。`tests/native-capabilities.test.mjs` 的 `composedRows()` 返回叶子行，新增「必选行在 disabled group 里被报为 disabled」用例，doctor 删行用例按 id 递归删除并用 `entryListSchema` 写回。组合文件行内容未改。 | [01-native-group-aware](01-native-group-aware.md) |
| #161 | `backend/v1-bundle/cordis.patch.yml` 的顶层 `insert` 拆成 `kernel`（19 行）与 `plugins`（27 行）两个 loader 原生 group；新增 `tests/bundle-groups.test.mjs`（不写死行数，用 `flattenEntries` 检查叶子 id 唯一）；bundle README 的「Row set and package set」段改写；文件头对停用 `plugins` 的结论改为「后端启动且内核服务 live」。 | [02-bundle-groups](02-bundle-groups.md) |
| #160 | `tests/baseline-boot.test.mjs` 的 `FORBIDDEN_ROW_IDS` 按四段组织并各写一行理由，34 → 37 个 id；bundle README 的「Absent rows」改为指向名单的指针。 | [03-absence-attribution](03-absence-attribution.md) |
| #162 | 本收口：零语义变化对照、探针行集与行数断言审计、kernel-only 实测、最终门禁、票面副本核对。 | 本文 |

合计仍是 46 个挂载行，每行的 `id`/`name`/`config` 未变；两个 group 行是新增的顶层行。

## 零语义变化对照

基线是 #161 合并提交 `9133f43` 的第一父 `e5e043d`（`git rev-parse 9133f43^1` 输出
`e5e043d32bbbb2a495376be1204229608236dbbd`），即分组前的集成分支树。用 dsh 自己的加载器读两份
组合、展开、逐行比较 `id`/`name`/`config`：

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

即 46 行的 `id`/`name`/`config` 深度相等；除两个新 group 行外没有新增、删除或改配任何行。原始输出
未入库；上面的命令可原样重放。评审修复分支复跑了同一对照（组合文件只改了头部注释），输出与上面
完全一致：`before rows 46 after rows 46 groups kernel:19, plugins:27`、`mismatches []`、`extra []`。

## 探针行集与行数断言

`probe` 报告 50 行 = 46 个挂载行 + 2 个 group 行（`kernel`、`plugins`）+ `include` +
`ourfairy-baseline-probe`。实测命令（keyless，临时 home）：

```sh
HOME_DIR=$(mktemp -d /tmp/ourfairy-closeout-XXXXXX)
env -u MINIMAX_CN_API_KEY -u OURFAIRY_MINIMAX_BASE_URL \
  OURFAIRY_HOME="$HOME_DIR" OURFAIRY_PORT=0 \
  node scripts/ourfairy-backend.mjs probe --report "$HOME_DIR/report.json"
node -e "const r=JSON.parse(require('node:fs').readFileSync(process.argv[1],'utf8')); console.log('rows', r.rows.length); console.log('groups', r.rows.filter(x => x.id === 'kernel' || x.id === 'plugins').map(x => x.id + ':disabled=' + x.disabled))" "$HOME_DIR/report.json"
```

实际输出：

```text
ourfairy-baseline-probe: ok (24 services live, 50 rows composed, mode boot)
probe exit: 0
rows 50
groups [ 'kernel:disabled=false', 'plugins:disabled=false' ]
```

摘要里的 `24 services live` 是 `report.services` 的**条目数**，不是 24 个 live 服务：这次
kernel-only boot 中 24 个服务项里 10 个 live、其余 14 个 disabled。行数是 50（46 个挂载行
+ 2 个 group 行 + `include` + `ourfairy-baseline-probe`），没有被任何测试写死。

### 行数断言审计

检查命令：

```sh
grep -rni "rows.*\.length\|rowcount\|rows count" tests/ --include='*.mjs'
grep -rn "\b46\b\|\b48\b\|\b50\b" tests/ --include='*.mjs'
grep -rn "report\.rows\.length" tests/ --include='*.mjs'
```

命中的行数相关断言与判读：

| 位置 | 断言 | 判读 |
| --- | --- | --- |
| `tests/bundle-packages.test.mjs:259` | `productRows.length > 0` | 下界，不约束 probe 总行数。 |
| `tests/ecosystem-boundary.test.mjs:64` | `rows.length > 5` | 下界，不约束 probe 总行数。 |
| `tests/bundle-only-profile.test.mjs:218`、`:359` | `productRows.length > 0` | 下界，不约束 probe 总行数。 |

`report.rows.length` 的断言为 0 条；现有断言按 id 建集合或按 id 查找，例如
`tests/baseline-boot.test.mjs:146` 的 `new Set(report.rows.map(row => row.id))` 与
`tests/bundle-groups.test.mjs` 的 `rowById`。因此多出的两个 group 行不会让任何测试因行数失败。

`tests/bundle-groups.test.mjs` 原先的 `flattened.length === 48` 已在评审修复中删除：现在它
只断言顶层恰为两个 group、每个 group 的 `config` 非空、顶层没有非 group 行、以及
`flattenEntries` 展开后的叶子行 id 唯一，不比较行数。因此票面「没有任何按行数比较的断言」
在修复后成立；上表的三个命中都是下界，不是行数比较。

## Kernel-only 启动

`tests/bundle-groups.test.mjs` 的 `disabling the plugins group leaves the kernel booting`
（第 52–88 行）用真实 launcher 跑 `probe --patch <plugins 整组停用> --report <path>`，断言：

- exit 0、`report.ok === true`、`report.failures` 为空；
- 7 个内核服务 live：`sessions`、`tools`、`llm`、`agents`、`sessionPersistence`、`sessionQuery`、
  `sessionProjections`；
- `plugins.config` 的 27 个子行全部 `disabled: true`，`kernel.config` 的 19 个子行全部
  `disabled: false`；
- `plugins` 与 `kernel` 两个 group 行自身都 `disabled: false`。loader 的 group 行从不报告 disabled，
  状态在子行上，所以「整组停用」的断言依据是子行状态，不能拿 group 行判断。

这条用例证明的是**后端启动且内核服务 live**；停用 `plugins` 后没有产品的模型回合路径
（`chat` 在 `plugins` 里），所以文件头不再声称「一轮模型仍可运行」。

实际结果：

```text
$ node --test tests/bundle-groups.test.mjs
✔ the composition is two segments and every row belongs to one (5.578779ms)
✔ disabling the plugins group leaves the kernel booting (4212.879981ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ duration_ms 4321.950665
```

## 最终门禁

在评审修复后的最终树（`ticket/134-review-fixes`，基于 `integration/spec-134` @ `7bf1b0e`）上执行；
修复分支之后只追加 Markdown。`combo:verify` 的 ourfairy 行显示该树基于 `7bf1b0e`。

| 命令 | 结果 |
| --- | --- |
| `npm test` | **238 pass / 0 fail**，7 suites，`duration_ms` 116374；未出现 150 ms ASR 超时 flake。 |
| `npm run combo:verify` | 三行 ok：ourfairy `7bf1b0e19496`（based on the integration tip）、dsh `5b8ec0f175d3`、android source `460109d1b89b`；末行 `combo: combination verified`，exit 0。 |
| `npm run backend:doctor` | `doctor: all checks passed`，exit 0。含 `bundle packages: 10 declared package(s) mounted by 15 row(s)`、`plugin compatibility: 12 installed product package(s)`、`native capabilities` 5 项（`llm-retry`、`spill-local`、`spill-policy`、`subprocess`、`@deepseek-ai/dsh-agent/session-history`）；`model double: not configured (keyless startup only)`。 |
| `node --test tests/docs.test.mjs` | **1 pass / 0 fail**。 |

`npm test` 的 238 条包含 `tests/bundle-groups.test.mjs` 的 2 条与
`tests/native-capabilities.test.mjs` 的 8 条（评审修复新增 disabled-group 用例）。收口票 #162
的原门禁（237）跑在 `be37140`；评审修复新增 1 条测试后为 238。

## 票面副本核对

用 `gh issue view <n> --repo eafen405/OurFairy --json body -q .body` 取四张票的当前正文，
与 `work/tickets/134/` 下的本地副本对照；本地副本保留 `# NN: title` 头行，正文从第 3 行起逐字
对应 GitHub body。编号对应见 [`published.json`](../../../tickets/134/published.json)。对照命令：

```sh
for pair in "159 01-native-group-aware" "161 02-bundle-groups" "160 03-absence-attribution" "162 04-closeout"; do
  set -- $pair
  gh issue view "$1" --repo eafen405/OurFairy --json body -q .body > "/tmp/body-$1.md"
  diff -B -u "/tmp/body-$1.md" <(tail -n +3 "work/tickets/134/$2.md")
done
```

第一次核对发现漂移：01/02/03 缺 GitHub 的「分析记录」指针，02 的 27 行只写「其余 27 行」而没有
逐行枚举，03 仍保留旧版「不增删任何 id」的句子（与自身验收第 2/4 条及当前票面冲突），04 缺
`## Parent` 段。GitHub #160 在 `2026-10-21T12:02:18Z` 被编辑过一次，本地副本混了编辑前后两版。

已按当前票面重写四份副本：保留本地头行，正文的 `## Parent`/`## What to build`/`## Acceptance criteria`/
`## Blocked by` 与 GitHub 一致（`04` 的头行仍是 `# 04: 收口：…`，与 issue 标题的 `spec 134` 前缀不同，
这是本地头行的既有写法）。重写后上面的对照命令（`diff -B` 忽略末尾空行）四份全部无 diff（`MATCH`）。
GitHub 票面本身未改。

| 本地副本 | GitHub | 处理 |
| --- | --- | --- |
| [`01-native-group-aware.md`](../../../tickets/134/01-native-group-aware.md) | #159 | 补 `## Parent` 与「分析记录 … 第 2 节」；恢复 GitHub 的段落切分。 |
| [`02-bundle-groups.md`](../../../tickets/134/02-bundle-groups.md) | #161 | 补 `## Parent` 与「分析记录 … 第 1、2 节；分组清单与受影响检查见 `work/tickets/134/README.md`」；验收第 2 条恢复 27 个 id 的逐行枚举。 |
| [`03-absence-attribution.md`](../../../tickets/134/03-absence-attribution.md) | #160 | 补 `## Parent` 与「分析记录 … 第 3、4 节」；删掉旧版「不增删任何 id」，改为当前票面的「不改变任何行的挂载状态」。 |
| [`04-closeout.md`](../../../tickets/134/04-closeout.md) | #162 | 补 `## Parent`；其余正文原本已一致。 |

## 未执行与残余风险

- **未跑 Android 构建/真机**：本票只动 Markdown，门禁是 Node 测试、组合校验与 doctor；Android 侧不在
  本次改动范围内。
- **未用真实云服务**：全量测试按 keyless 方式跑，模型侧使用测试替身；`backend:doctor` 明确报告
  `model double: not configured (keyless startup only)`。真实 DeepSeek/MiniMax/ASR 服务未在本次收口中
  重新验收。
- **评审修复后的门禁已在最终树重跑**：`npm test` 238 pass、`backend:doctor` 全绿、`combo:verify`
  三行 ok、`docs.test.mjs` 1 pass，均记录在上面的「最终门禁」。
- **探针行数不被测试锁定**：50 行是本次实测事实；没有测试断言 probe 的精确行数，所以未来增删行不会
  因这个数字失败，也不会被这个数字提醒。这是刻意的（避免把诊断输出变成第二份行清单）。
