> 发布权威：[#207](https://github.com/eafen405/OurFairy/issues/207)。本文件是工作副本。

## Parent

[#205 TypeScript 全量迁移：施工](https://github.com/eafen405/OurFairy/issues/205)

## Blocked by

- 01

## Scope

`backend/identity` + `backend/sessions` 迁 `.ts`，包内原子。

## Steps

- 两包 `.mjs`→`.ts`，补 strict 注解；相对 import 写 `.js`；`main`/`types`/`exports`/`files` 切 `dist`；删 `.mjs`；根 solution 加两个 reference。
- 该包相关 tests 的 import 改 `dist`（identity store/codes/interfaces、sessions 相关），断言不变。
- `backend/probe` 仍 `.mjs`，它依赖 identity 的 dist；确保 probe 安装/启动通过。

## Acceptance

- `npm run build`；相关测试（identity-*、owned-sessions、native-rows 等实际集合）全绿；`doctor`/`probe` 通过。
- 不跑全量；不触发 CI。

