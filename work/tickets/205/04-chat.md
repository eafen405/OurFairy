> 发布权威：[#209](https://github.com/eafen405/OurFairy/issues/209)。本文件是工作副本。

## Parent

[#205 TypeScript 全量迁移：施工](https://github.com/eafen405/OurFairy/issues/205)

## Blocked by

- 03

## Scope

`backend/chat` 迁 `.ts`。

## Steps

- 12 个 `.mjs`→`.ts`（含 test-support）；补 strict 注解；相对 import 写 `.js`；`main`/`types`/`exports`/`files` 切 `dist`；删 `.mjs`；根 solution 加 reference。
- 该包相关 tests（chat-*、remote-chat、spill-read、conversation-search 等实际集合）import 改 `dist`，断言不变。
- `test-support/*.mjs` 不在 `files`，按 #202 的测试路径处理，不随包发布。

## Acceptance

- `npm run build`；chat 相关测试全绿；`doctor`/`probe` 通过；SSE/分页/幂等行为不变。
- 不跑全量；不触发 CI。

