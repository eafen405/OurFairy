# 134-bundle-groups — 收口（票 #162）

> 父票 [#134 组合层显式化内核与插件](https://github.com/eafen405/OurFairy/issues/134)；票面
> [`work/tickets/134/04-closeout.md`](../../../tickets/134/04-closeout.md)；
> 任务图与 19/27 归属 [`work/tickets/134/README.md`](../../../tickets/134/README.md)；
> 分析记录 [`docs/research/dsh-bundle-group-composition.md`](../../../../docs/research/dsh-bundle-group-composition.md)。
> 分支 `ticket/162-closeout`，基于 `integration/spec-134` @ `be37140`。
> 三票证据：[#159](01-native-group-aware.md) · [#161](02-bundle-groups.md) · [#160](03-absence-attribution.md)。

本票只写证据与索引，并把 `work/tickets/134/` 下的四份副本刷新到当前 GitHub 票面。产品代码、测试、
`backend/v1-bundle/cordis.patch.yml` 与 bundle README 均未改；收口分支相对 `be37140` 的差异只有
`work/implementation/evidence/` 与 `work/tickets/134/` 下的 Markdown。

## 规格改了什么（指针）

| 票 | 交付 | 证据 |
| --- | --- | --- |
| #159 | `scripts/combo.mjs` 的 `nativeCapabilityFailures` 建 id 表前先 `flattenEntries`；`tests/native-capabilities.test.mjs` 的 `composedRows()` 返回展开行，doctor 删行用例改为按 id 递归删除并用 `entryListSchema` 写回。组合文件未改。 | [01-native-group-aware](01-native-group-aware.md) |
| #161 | `backend/v1-bundle/cordis.patch.yml` 的顶层 `insert` 拆成 `kernel`（19 行）与 `plugins`（27 行）两个 loader 原生 group；新增 `tests/bundle-groups.test.mjs`；bundle README 的「Row set and package set」段改写；`composedRows()` 过滤 group 行以保持二次展开稳定。 | [02-bundle-groups](02-bundle-groups.md) |
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
未入库；上面的命令可原样重放。

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
| `tests/bundle-groups.test.mjs:46` | `flattened.length === 48` | #161 新增的组合行计数（46 个挂载行 + 2 个 group 行），不是 probe 行数。 |
| `tests/bundle-packages.test.mjs:259` | `productRows.length > 0` | 下界，不约束 probe 总行数。 |
| `tests/ecosystem-boundary.test.mjs:64` | `rows.length > 5` | 下界，不约束 probe 总行数。 |
| `tests/bundle-only-profile.test.mjs:218`、`:359` | `productRows.length > 0` | 下界，不约束 probe 总行数。 |

`report.rows.length` 的断言为 0 条；现有断言按 id 建集合或按 id 查找，例如
`tests/baseline-boot.test.mjs:146` 的 `new Set(report.rows.map(row => row.id))` 与
`tests/bundle-groups.test.mjs:27` 的 `rowById`。因此多出的两个 group 行不会让任何测试因行数失败。

需要说清楚的一层：票面「没有任何按行数比较的断言」若按字面读并不成立——`tests/bundle-groups.test.mjs:46`
确实断言了组合行数 48。但它断言的是组合树（46 + 2 group），不是 probe 行集，且是 #161 为「顶层只允许
两个 group 行」刻意加的结构断言。探针行数（50）没有被任何测试写死或比较。

## Kernel-only 启动

`tests/bundle-groups.test.mjs` 的 `disabling the plugins group leaves the kernel booting`
（第 51–87 行）用真实 launcher 跑 `probe --patch <plugins 整组停用> --report <path>`，断言：

- exit 0、`report.ok === true`、`report.failures` 为空；
- 7 个内核服务 live：`sessions`、`tools`、`llm`、`agents`、`sessionPersistence`、`sessionQuery`、
  `sessionProjections`；
- `plugins.config` 的 27 个子行全部 `disabled: true`，`kernel.config` 的 19 个子行全部
  `disabled: false`；
- `plugins` 与 `kernel` 两个 group 行自身都 `disabled: false`。loader 的 group 行从不报告 disabled，
  状态在子行上，所以「整组停用」的断言依据是子行状态，不能拿 group 行判断。

实际结果：

```text
$ node --test tests/bundle-groups.test.mjs
✔ the composition is two segments and every row belongs to one (4.419109ms)
✔ disabling the plugins group leaves the kernel booting (3669.994368ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ duration_ms 3762.961243
```

## 最终门禁

在 `integration/spec-134` tip `be37140` 的代码/测试/组合树上执行（worktree 由 `combo:verify` 确认
基于该 tip）；收口分支随后只追加/刷新 Markdown（evidence 与 `work/tickets/134/` 副本）。写完本文与索引后，单独复跑
`node --test tests/docs.test.mjs` 校验相对链接，结果 **1 pass / 0 fail**。

| 命令 | 结果 |
| --- | --- |
| `npm test` | **237 pass / 0 fail**，7 suites，`duration_ms` 117546.532977；未出现 150 ms ASR 超时 flake，无需重跑。 |
| `npm run combo:verify` | 三行 ok：ourfairy `be3714061f6c`（based on the integration tip）、dsh `5b8ec0f175d3`、android source `460109d1b89b`；末行 `combo: combination verified`，exit 0。 |
| `npm run backend:doctor` | `doctor: all checks passed`，exit 0。含 `bundle packages: 10 declared package(s) mounted by 15 row(s)`、`plugin compatibility: 12 installed product package(s)`、`native capabilities` 5 项（`llm-retry`、`spill-local`、`spill-policy`、`subprocess`、`@deepseek-ai/dsh-agent/session-history`）；`model double: not configured (keyless startup only)`。 |

`npm test` 的 237 条包含 `tests/bundle-groups.test.mjs` 的 2 条；全量运行没有触发
`tests/speech.test.mjs` 的既有 150 ms ASR 超时 flake（#161 证据记录过它曾出现过一次）。

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
- **未在独立干净 worktree 重跑**：门禁在 `be37140` 的代码树上执行，收口分支只追加/刷新 Markdown
  （evidence 与票面副本）；`npm test` 在写本文前完成，`node --test tests/docs.test.mjs` 在最终 Markdown
  上单独复跑。若要求「最终提交的完整 `npm test`」，需要再跑一次全量（预计 2–3 分钟）。
- **探针行数不被测试锁定**：50 行是本次实测事实；没有测试断言 probe 的精确行数，所以未来增删行不会
  因这个数字失败，也不会被这个数字提醒。这是刻意的（避免把诊断输出变成第二份行清单）。
