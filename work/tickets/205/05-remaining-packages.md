> 发布权威：[#210](https://github.com/eafen405/OurFairy/issues/210)。本文件是工作副本。

## Parent

[#205 TypeScript 全量迁移：施工](https://github.com/eafen405/OurFairy/issues/205)

## Blocked by

- 04

## Scope

`backend/delivery`、`backend/gateway`、`backend/search`、`backend/speech`、`backend/groups`、`backend/probe` 迁 `.ts`。

## Steps

- 六包 `.mjs`→`.ts`；补 strict 注解；`main`/`types`/`exports`/`files` 切 `dist`；删 `.mjs`；根 solution 加六个 reference。
- `probe` 的 `main`/`exports` 切 `dist`；`overlay.patch.yml` 行不变。
- 该包相关 tests（delivery-row、gateway、gateway-service、conversation-search、speech、groups、native-job-* 等实际集合）import 改 `dist`，断言不变。

## Acceptance

- `npm run build`；相关测试全绿；`doctor`/`probe` 通过；gateway/speech 的替身证据不变。
- 不跑全量；不触发 CI。

