> 发布权威：[#208](https://github.com/eafen405/OurFairy/issues/208)。本文件是工作副本。

## Parent

[#205 TypeScript 全量迁移：施工](https://github.com/eafen405/OurFairy/issues/205)

## Blocked by

- 02

## Scope

`backend/spaces` + `backend/attachments` 迁 `.ts`；`pdf-worker.py` 搬出 `src`。

## Steps

- 两包 `.mjs`→`.ts`；`main`/`types`/`exports`/`files` 切 `dist`；删 `.mjs`；根 solution 加两个 reference。
- `backend/attachments/src/pdf.mjs` 依赖 `pdf-worker.py`：把该文件搬到包根稳定目录（如 `assets/pdf-worker.py`），更新 `import.meta.url` 解析，`files` 加 `assets/**`；tsc 不复制非 TS 资产。
- 该包相关 tests（attachments、pdf、spaces、sandbox-network-profile 等实际集合）import 改 `dist`，断言不变。

## Acceptance

- `npm run build`；相关测试全绿；`doctor`/`probe` 通过；pdf 渲染与文件权限/沙箱行为不变。
- 不跑全量；不触发 CI。

