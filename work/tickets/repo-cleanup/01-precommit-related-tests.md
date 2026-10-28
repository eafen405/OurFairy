## Parent

OurFairy 仓库环境清扫；本地 ID：CLEAN-01。

## What to build

修复 `scripts/precommit.ts` 的 related 测试选择，让经真实 launcher/HTTP 覆盖产品包、但正文没有直接 import 包路径的现有测试也能被选中。

## Current evidence

`relatedTests()` 目前只扫描测试正文中的包路径、发布包名和脚本名（`scripts/precommit.ts:150-189`）。因此：

- `backend/delivery/` 与 `backend/speech/` 的源码改动会退回 `typecheck`，尽管已有 delivery/speech 行为测试。
- `backend/memory/` 只稳定选中部分测试，CRUD、印象、策略和维护测试没有形成完整关联。
- `backend/groups/`、`backend/search/` 已有 `groups*.test.mjs` 与 `conversation-search.test.mjs`，当前选择结果不能代表这些直接行为面。

`tests/precommit.test.mjs:84-97` 还把 `backend/delivery/` 当作“无测试引用”的夹具，固定了错误前提。

## Scope

- `scripts/precommit.ts`
- `tests/precommit.test.mjs`
- 为建立显式关联而必须修改的现有测试文件，仅限 delivery、speech、memory、groups、search 相关测试。

优先让行为测试在自己文件中声明所覆盖的产品包，选择器读取该声明；直接源码引用仍可作为另一类关联信号。不得维护一份与测试分离、需要手工同步的第二份包→测试清单。

## Acceptance criteria

- [ ] 先新增选择器失败用例，并确认它们因缺少关联而失败，再改实现。
- [ ] `backend/delivery/src/tool.ts` 至少选中 `text-delivery`、`file-delivery`、`delivery-row` 三个现有测试。
- [ ] `backend/speech/src/service.ts` 选中 `speech.test.mjs`。
- [ ] `backend/memory/src/index.ts` 选中现有 `memory-crud`、`memory-impression`、`memory-policy`、`memory-maintenance`、`memory-maintenance-recovery` 测试。
- [ ] `backend/groups/` 的代表源码改动选中 `groups` 与 `groups-row`；`backend/search/` 选中 `conversation-search`。
- [ ] 无关联源码仍退回 `typecheck`；原有用例改用真正没有关联声明的包路径。
- [ ] 保持 docs/related/typecheck/full 四模式、45 文件上限、full authority 和每档 `combo:verify` 不变。
- [ ] 注释只声称“直接关联选择”，不把选中集合描述成完整覆盖率。

## Verification

```bash
npm run build
node --test tests/precommit.test.mjs
```

最终全量门禁由 CLEAN-08 执行。

## Blocked by

无。

## Out of scope

不调整产品代码、测试覆盖率目标、CI 触发规则或 Android 门禁；不给每个包机械补测试。
