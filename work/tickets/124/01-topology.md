## Parent

[#124 文档收口：以「两个仓库」为准的事实纠偏与减法整理](https://github.com/eafen405/OurFairy/issues/124)

## What to build

把**根文档与客户端文档**里的拓扑改对，并删掉只会误导人的内容。

本票的前提：只有两个仓库——OurFairy（含 `android/`）与 dsh fork。任何"第三个仓库""跨仓集成""配套 fork"的说法都是错的。

### 1. `android/AGENTS.md`

第 3 行写「产品规则、术语与版本组合参见相邻 `../OurFairy/` 的 …；跨仓集成时再读取 …」。从 `android/` 看，`../OurFairy/` 是**仓库根**，不是隔壁仓库；"跨仓集成"也不再存在。

改为指向仓库根的 `AGENTS.md`、`CODING_STANDARDS.md`、`GLOSSARY.md` 与 `README.md`，并说明"客户端在本仓库，与后端同一提交版本"。

### 2. `android/README.md`

- 第 34 行「产品规格、术语和版本组合由 `OurFairy` 管理」读起来像另一个仓；改为"由本仓库根文档管理"，链接指向仓库根 `README.md`。
- 第 38 行把 `0966502c…` 称为"研究基线提交"，与来源声明 `460109d1` 并存易被读成来源。改为：**来源**是 `android/ourfairy-source.json` 与 `combo.json` 的 `androidSource`（`460109d1`）；`0966502c…` 只是更早的调研基线，不描述来源。

### 3. `android/docs/references/fairy-client-runtime.md`

第 3 行"本轮结果位于当前工作区"、第 62 行"`npm test` 133 项通过"（现 234）都已过期，而它被 `android/README.md` 当作现行客户端说明引用。

先通读：若主体是"某一轮工作区"的一次性报告，**删除该文件并从 `android/README.md` 移除链接**；若主体仍是有效的运行时组成说明，则保留结构描述、删掉"本轮"框架语与所有过期数字。

（注意：`:43` 的 86/10 文件数与 `:59` 的 275 经核仍准确，不要误删。）

### 4. 根 `GLOSSARY.md` 与 `GLOSSARY-MAP.md`

`GLOSSARY.md` 最后更新是 2026-10-14，之后实现增加了投递、活动投影、任务卡等概念。按"只留仍在使用且与实现一致的词"处理：

- 删除已不再使用的词条；
- 补上现在实际在用、但词表里没有的核心词（以代码与 README 的用词为准，不 invent）；
- 检查 `GLOSSARY-MAP.md` 指向的两个词汇文件都真实存在且分类正确。

### 5. 根 `README.md` 与 `AGENTS.md`

核对（大概率已正确，只需确认）：拓扑只写在这两处之一并成为唯一权威，另一处与 `CONVENTIONS.md`、父规格只放指针；许可证、两个入口、取上游修复的方式无过期内容。

## Acceptance criteria

- [ ] 现行文档全文搜索 `三个仓库`、`三仓`、`跨仓`、`配套 fork`、`客户端不在本仓库`、`../OurFairy` 零命中（`docs/decisions/` 与 `docs/research/` 的状态头之后、以及 `work/` 下的冻结记录除外）
- [ ] `android/AGENTS.md` 不再指向 `../OurFairy/`，不再出现"跨仓"
- [ ] `android/README.md` 的来源提交与 `android/ourfairy-source.json` 一致（`460109d1`），且不再用外链语气描述本仓库
- [ ] `android/docs/references/fairy-client-runtime.md` 已删除，或不再含"本轮"与任何过期测试数
- [ ] `GLOSSARY.md` 里没有已不存在的概念，`GLOSSARY-MAP.md` 的链接全部可解析
- [ ] `android/` 的业务代码零改动（`git diff --stat` 只出现 Markdown）
- [ ] `npm test` 全绿（`tests/android-source.test.mjs`、`tests/docs.test.mjs` 必须仍过）
- [ ] 交付"删除清单 + 保留理由"

## Blocked by

无。
