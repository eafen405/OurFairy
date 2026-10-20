## Parent

[#124 文档收口：以「两个仓库」为准的事实纠偏与减法整理](https://github.com/eafen405/OurFairy/issues/124)

## What to build

收口 `docs/specs/` 与 `docs/architecture/`：这两处是**需求与边界的现行权威**，必须只陈述仍成立的事实。

### 1. 规格与边界文档的冲突（以边界文档为准）

`docs/specs/ourfairy-v1.md:189` 仍写「优先复用 dsh HTTP unary 与 WebSocket stream」，而 `docs/architecture/dsh-ecosystem-boundary.md:24,30-33` 记录的实际决定是：产品流用自建 SSE `/chat/observe`，`/api` Fetch bridge、Typert unary/WebSocket、`/api/remote.mux` 均未挂载、未使用（#97 的结论）。

规格是需求权威、边界文档是实现边界权威，两者冲突时以**更晚的、被代码验证过的那份**为准——这里是边界文档。改规格，把"优先复用 unary/WebSocket"改为对现行传输的准确描述，并指向边界文档。

### 2. 逐条声称核验

对 `docs/specs/ourfairy-v1.md`（314 行）与 `docs/architecture/dsh-ecosystem-boundary.md`（188 行）逐条过：

- 每条"必须/应当"若已被实现，要么保留（它仍是验收依据），要么改写为"已由 X 覆盖"并指向证据；
- 每条"A 由 B 派生""X 已被保证""清单由 Y 决定"若能指出失效时会红的具体测试，保留；**指不出的，删除，不为它补断言**；
- 已被后续票推翻的条款，删除或改写，不要保留成"看着像现行要求"的僵尸条款。

已知需要处理的：规格里对客户端拓扑的残留（`android/` 内联后哪些条款已不适用）、规格 §8 与 `CONVENTIONS.md` 的重复（只留一处，另一处放指针）。

### 3. 重复权威收敛

- 规格里若重复了 `backend/v1-bundle/`（行/包/模型）或 `combo.json`（组合与来源）的事实，改为指针；
- 边界文档已经做对的不要动：`tests/ecosystem-boundary.test.mjs` 会从 loader 派生并拒绝文档抄写行/包清单。

### 4. 不要破坏已建立的检查

`tests/story-coverage.test.mjs` 断言 75 条用户故事文本、顺序、票归属与证据链接；`tests/ecosystem-boundary.test.mjs` 断言边界文档必须点名接缝、指向行/包权威、引用的测试标题真实存在。改动这些文档时**不要删改故事矩阵与被引用的测试标题**。

## Acceptance criteria

- [ ] 规格与边界文档不再冲突；`unary/WebSocket` 的表述与现行 SSE 实现一致
- [ ] 两份文档中凡是"必须/应当"的条款，要么仍成立，要么已删/改写指向证据；不存在无法指出失效检查的断言式声称
- [ ] 规格不再重复 bundle 与 combo 的事实，改为指针
- [ ] `npm test` 全绿（`story-coverage`、`ecosystem-boundary`、`docs` 必须仍过）
- [ ] 交付"删除清单 + 保留理由"，逐条说明被删条款"为什么它已不再成立"
- [ ] 只改 Markdown

## Blocked by

无。
