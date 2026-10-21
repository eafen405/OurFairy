# #159 — 原生能力检查与行删除测试不再假设扁平行表

票面副本 `work/tickets/134/01-native-group-aware.md`；父票 #134；分析记录
`docs/research/dsh-bundle-group-composition.md` §2。分支 `ticket/159-native-group-aware`，
基线 `integration/spec-134` @ `cf81810`。评审修复分支 `ticket/134-review-fixes`（基于
`7bf1b0e`）把本票的展开语义改为「只返回叶子行 + 继承禁用」，并让安装态检查显式传入展开行；
下面是修复后的最终设计。

本票只改「必选原生行是否存在」的判断方式与测试的行删除方式。**组合文件
`backend/v1-bundle/cordis.patch.yml` 的行内容未改**（分组本身是 #161）。

## 最终设计

1. `scripts/combo.mjs` — `flattenEntries` 只返回**叶子行**：
   - group 行是容器，不是待检查的行，直接丢弃；其子行在容器位置返回。
   - 祖先 group 的 `disabled` 物化到每个叶子（`disabled: true`）。loader 的有效禁用状态
     会沿祖先链计算（`Entry.disabled`），而 `composeEntries` 返回的行只保留自己的 flag；
     不物化就会让「禁用整个 `plugins` group」对逐行检查不可见——`subprocess` 是
     `plugins` 里的必选原生行，运行时已停用，逐行 flag 检查却仍会通过。
   - 幂等：结果不含 group 行，再次展开返回同一批叶子行。`nativeCapabilityFailures`
     仍先 `flattenEntries(rows)`，所以对已展开行集再展开是安全的。
2. `scripts/combo.mjs` — `verifyInstalledNativeCapabilities` 显式传入
   `flattenEntries(boot.composeEntries(...))`，满足 #159 验收里「安装态检查交展开后的行」。
   `nativeCapabilityFailures` 内部的展开保留，作为该函数对任意调用点的兜底。
3. `tests/native-capabilities.test.mjs`
   - `composedRows()` 返回 `flattenEntries(composeEntries(...))`，不再过滤 group 行；
     helper 已只返回叶子行。
   - 新增用例 `a required row inside a disabled group is reported as disabled`：把整份
     叶子行包进 `disabled: true` 的 group，断言四个必选原生行都被报为 disabled，且每条
     消息点名行 id 并含 `disabled`。这是「禁用 group 不能骗过原生能力检查」的可执行断言。
   - 保留 `a required row nested in a group is still found`：group 内的必选行仍被找到。
   - doctor 用例不再按 4/6 空格缩进做字符串替换：用 `loadOverlayPatches` 读安装副本的
     补丁结构，先把插入行整体包进一个 group 并断言 doctor 仍 ok（证明安装态检查是
     group-aware），再用递归的 `removeRow(entries, 'llm-retry')` 按 id 删除（跨进 group
     的 `config`），找不到该行时 `assert.ok` 失败。写回用 dsh 自己的方言
     `entryListSchema`（从 dsh 安装解析，`!!js` 表达式原样往返）。

## 命令与结果（实际执行）

提交 `c0459d3`（实现 + 证据），之后 `git merge integration/spec-134` 合入集成分支 tip
`1d34620`（含 #160 的 `03-absence-attribution` 提交），合并提交 `4f695c7`，无冲突。
评审修复分支在 `7bf1b0e` 之上重跑下列命令；括号内为修复前 `4f695c7` 的结果。

| 命令 | 结果 |
| --- | --- |
| `node --test tests/native-capabilities.test.mjs` | 8 pass / 0 fail（修复前 7 pass；新增 disabled-group 用例） |
| `node --test tests/bundle-packages.test.mjs` | 9 pass / 0 fail（修复前同） |
| `node --test tests/bundle-groups.test.mjs` | 2 pass / 0 fail（修复前同；行数断言已删） |
| `npm run backend:doctor` | 全部 ok，含 `native capabilities: llm-retry:…, spill-local:…, spill-policy:…, subprocess:…, @deepseek-ai/dsh-agent/session-history` |
| `npm test` | 238 pass / 0 fail（修复前 237 pass；新增 1 个 disabled-group 用例） |
| `npm run combo:verify` | 三行 ok（ourfairy based on the integration tip / dsh / android source） |

红-绿对照一：临时把 `flattenEntries` 的祖先 `disabled` 继承去掉后重跑
`node --test tests/native-capabilities.test.mjs`，新增的
`a required row inside a disabled group is reported as disabled` 失败（0 !== 4，未报告任何
disabled）；恢复后 8 pass。

红-绿对照二：临时把 `nativeCapabilityFailures` 的 `flattenEntries` 去掉后重跑同一文件，
`a required row nested in a group is still found` 与 doctor 用例（分组后 doctor 报 missing）
两条失败，6 pass / 2 fail；恢复后 8 pass。即新增/调整的断言确实会因「假设扁平行表」或
「只看行自身 flag」而失败。

## 未做 / 范围外

- 不分组：`backend/v1-bundle/cordis.patch.yml` 的行内容未改，分组归 #161。
- `work/implementation/evidence/README.md` 未改，索引条目归收口票 #162。
