# #159 — 原生能力检查与行删除测试不再假设扁平行表

票面副本 `work/tickets/134/01-native-group-aware.md`；父票 #134；分析记录
`docs/research/dsh-bundle-group-composition.md` §2。分支 `ticket/159-native-group-aware`，
基线 `integration/spec-134` @ `cf81810`。

本票只改「必选原生行是否存在」的两处判断方式与测试的行删除方式。**组合文件
`backend/v1-bundle/cordis.patch.yml` 一字未改**（`git diff cf81810 -- backend/v1-bundle` 为空），
分组本身是 #161。

## 改了什么

1. `scripts/combo.mjs` — `nativeCapabilityFailures` 建 id 表前先 `flattenEntries(rows)`。
   展开只有这一处：`verifyInstalledNativeCapabilities` 与测试都把这个函数当作唯一入口，
   函数自己吃掉「行可能在 group 里」，调用点不必再展开一次（研究记录 §2：
   「一处改动即可覆盖」）。没有在调用点重复 `flattenEntries`，因为
   `flattenEntries` 不是幂等的——对已展开的行集再展开会把 group 子行重复一遍。
   报错措辞未变。
2. `tests/native-capabilities.test.mjs`
   - `composedRows()` 返回 `flattenEntries(composeEntries(...))`；其余用例的
     filter/map 仍在同一批行上断言同一批行为。
   - 新增用例 `a required row nested in a group is still found`：把整份行集塞进一个
     `cordis:group` 行后 `nativeCapabilityFailures` 返回 `[]`。这是「group 内的必选行
     仍被找到」的可执行断言。
   - doctor 用例不再按 4/6 空格缩进做字符串替换：用 `loadOverlayPatches` 读安装副本的
     补丁结构，先把插入行整体包进一个 group 并断言 doctor 仍 ok（证明安装态的检查是
     group-aware），再用递归的 `removeRow(entries, 'llm-retry')` 按 id 删除（跨进 group
     的 `config`），找不到该行时 `assert.ok` 失败。写回用 dsh 自己的方言
     `entryListSchema`（从 dsh 安装解析，`!!js` 表达式原样往返）。

## 命令与结果（实际执行）

| 命令 | 结果 |
| --- | --- |
| `node --test tests/native-capabilities.test.mjs` | 7 pass / 0 fail |
| `node --test tests/bundle-packages.test.mjs` | 9 pass / 0 fail |
| `npm run backend:doctor` | 全部 ok，含 `native capabilities: llm-retry:…, spill-local:…, spill-policy:…, subprocess:…, @deepseek-ai/dsh-agent/session-history` |
| `npm test` | 235 pass / 0 fail（`tests 235`，`duration_ms` 117001） |
| `npm run combo:verify` | 三行 ok（ourfairy / dsh / android source） |

红-绿对照：临时把 `nativeCapabilityFailures` 的 `flattenEntries` 去掉后重跑
`node --test tests/native-capabilities.test.mjs`，`a required row nested in a group is still
found` 与 doctor 用例（分组后 doctor 报 missing）两条失败，5 pass / 2 fail；恢复后 7 pass。
即新增/调整的断言确实会因「假设扁平行表」而失败。

## 未做 / 范围外

- 不分组：`backend/v1-bundle/cordis.patch.yml` 未改，分组归 #161。
- `work/implementation/evidence/README.md` 未改，索引条目归收口票 #162。
