## Parent

[#124 文档收口：以「两个仓库」为准的事实纠偏与减法整理](https://github.com/eafen405/OurFairy/issues/124)

## What to build

`docs/decisions/` 与 `docs/research/` 是**日期化记录**：正文保留原貌，但必须让人一眼看出"这是当时的判断，不是现在的状态"。同时把被复制了四份的研究基线收敛到一处。

### 1. 每篇加状态头

`docs/decisions/`（4 篇）与 `docs/research/`（24 篇）每篇首行加一行：

```
> 2026-10-20 状态：<现行 | 已被 <票> 取代>。本文记录 <日期> 的判断，不描述当前实现。
```

已知需要标"已被取代"或至少标出过期段落的：

- `docs/decisions/v1-implementation-route.md:15`——「首版共用模型显式配置为 `deepseek-official/deepseek-flash`」；实际是 `minimax-cn` / `MiniMax-M3.1-Flash`（#103，bundle 的 `agent-default-model` 行是唯一声明）。
- 同文件 `:34`——「当前两个本地源码 checkout … OurFairy 尚无产品 package/lockfile」；现在客户端已内联、根 `package.json` 已存在。
- 同文件 `:58`——「优先复用 dsh HTTP unary 与 WebSocket stream」；已被 #97 的 SSE 决定取代。
- `docs/decisions/frontend-v1-boundary.md:32`——「首版共用官方 DeepSeek 配置」，同上。
- `docs/decisions/upstream-compatibility-calibration.md:45`——「当前产品在 resum 时取得共用默认值，尚未实现每轮跟随共用选择」；实际每轮重读（`tests/gateway.test.mjs` 有此断言）。

**正文不改**（它们是当时的记录），但状态头必须让读者知道上面这些段落已过期。若某文件的过期段落占正文主体、状态头不足以防止误读，可在该段落后加一行"（已被 X 取代）"，仍不改原文措辞。

### 2. 研究基线只留一处

dsh `d743267…`、rikkahub `0966502…`、Fairybot `095efdd…` 这组研究基线目前写在至少四处：`docs/specs/ourfairy-v1.md:307`、`work/implementation/CONVENTIONS.md:32-34`、`work/implementation/notes/client-access-seams.md:3`、`work/implementation/notes/dsh-ownership-seams.md:3`。

收敛方案：新建 `docs/research/README.md` 作为**研究目录索引 + 研究基线的唯一位置**，其余现行文档（规格、CONVENTIONS）删除副本改为指针。`work/implementation/notes/` 是冻结历史，不改。

### 3. 研究目录索引

`docs/research/README.md` 同时兼作索引：列出 24 篇的一句话主题与日期，声明"本目录是日期化调查，不描述当前状态"。这让 `docs/README.md`（#125）可以只写一行指向它，不重复列表。

## Acceptance criteria

- [ ] `docs/decisions/` 与 `docs/research/` 每篇都有状态头，且 `v1-implementation-route`、`frontend-v1-boundary`、`upstream-compatibility-calibration` 的过期段落已被标注
- [ ] 研究基线只出现在 `docs/research/README.md` 一处；规格与 `CONVENTIONS.md` 改为指针
- [ ] `docs/research/README.md` 列出全部 24 篇并有一句话主题
- [ ] 冻结区的 `work/implementation/notes/*` 不动
- [ ] `npm test` 全绿
- [ ] 交付"标注清单 + 保留理由"

## Blocked by

无。若 #126 先落地，`docs/README.md` 的 research 行直接指向本票新建的索引。
