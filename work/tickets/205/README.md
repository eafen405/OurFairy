# #205 TypeScript 全量迁移：施工

父票：[#205 TypeScript 全量迁移：施工](https://github.com/eafen405/OurFairy/issues/205)。
GitHub issue 是发布权威，原生 blocked-by 是实时状态权威；本目录是实施时读取的工作副本。

基线：`main` @ `c39c83d8c1`，集成分支 `integration/spec-205`。
dsh 检出 `product/ourfairy-v1` @ `d1b6099ae7`（与 [`combo.json`](../../../combo.json) 锁定一致），
构建工具链取 dsh 自带的 TypeScript 6.0.3。

## 目标

`backend/` 与 `scripts/` 的源码全部是 `.ts`：backend 各包由 `tsc -b` 构建出 `dist/*.js` + `*.d.ts`，
以构建产物装进 installed profile 并正常启动；`scripts/` 由 Node 直接执行 `.ts`。
类型检查覆盖这两处源码，HTTP/SSE 契约与业务行为零变化。`tests/` 保持 `.mjs` 作为独立裁判，
只把 import 改到 `dist`；Android 不动。

## 已核实的事实

| 项 | 实测 |
| --- | --- |
| 产品源码规模 | `backend/` + `scripts/` 共 63 个 `.mjs`（backend 53 + scripts 10） |
| 产品包 | `backend/` 下 13 个目录，12 个带源码（`v1-bundle` 无源码），加 `probe` 共 12 个可编译包 |
| 包依赖图（静态 import） | `http` → `identity` → `sessions` → `spaces` → `attachments` → `chat` → `delivery`/`gateway`/`groups`/`search`/`speech` → `probe` |
| 试点底稿 | `ticket/203-ts-http-trial` @ `00e158ed7a`：两个 `.ts` 文件 + tsconfig + manifest + `scripts/link-types.mjs` + `scripts/tsc.mjs` + `tsconfig.base.json` + 根 solution |
| 研究 | #199 构建路线、#200 安装链、#202 测试与门禁三份已落 `docs/research/`（2026-10-23） |

三份研究文档已在 `integration/spec-205` 落地（`docs/research/2026-10-23-typescript-*.md`），
本票只补索引与收口清理。

## 任务图

| 文件 | 票号 | 内容 | 阻塞 |
| --- | --- | --- | --- |
| `01-infra-and-guards.md` | [#206](https://github.com/eafen405/OurFairy/issues/206) | 构建链、hash 守卫、测试门禁与 http 试点 | 无 |
| `02-identity-and-sessions.md` | [#207](https://github.com/eafen405/OurFairy/issues/207) | `identity` + `sessions` 迁 `.ts` | 01 |
| `03-spaces-and-attachments.md` | [#208](https://github.com/eafen405/OurFairy/issues/208) | `spaces` + `attachments` 迁 `.ts`，`pdf-worker.py` 搬家 | 02 |
| `04-chat.md` | [#209](https://github.com/eafen405/OurFairy/issues/209) | `chat` 迁 `.ts` | 03 |
| `05-remaining-packages.md` | [#210](https://github.com/eafen405/OurFairy/issues/210) | `delivery`/`gateway`/`search`/`speech`/`groups` + `probe` 迁 `.ts` | 04 |
| `06-closeout.md` | [#211](https://github.com/eafen405/OurFairy/issues/211) | `scripts` 迁 `.ts`、文档索引、全量门禁与清理 | 05 |

前沿是**一条链**：206 → 207 → 208 → 209 → 210 → 211。

这条链没有并行度，不是切分不够细，而是「包内原子」这条约定本身要求顺序落地：
一个包的 `.ts` 源码、`main`/`types`/`exports`/`files` 指向 `dist`、删 `.mjs`、
该包相关 tests 的 import 改 `dist` 必须同一步落地，否则中间态会让 profile 装出缺模块的树，
测试会红而不是给出可读信号。上一包迁完，下一包的依赖才有可用的 `dist` 产物。

## 约定

- 按 [`work/implementation/CONVENTIONS.md`](../../implementation/CONVENTIONS.md)：每票在自己的 worktree 里工作，
  分支 `ticket/<NN>-<slug>`，证据在 `work/implementation/evidence/<NN>-<slug>/`，由 merger 合入集成分支。
- **包内原子**：不做 `.mjs` 兼容层，不留 `.mjs` shim。
- **验证节奏**：迁移期按 `AGENTS.md`「验证节奏」只跑相关测试 + `npm run build` + 相关 `doctor`/`probe`；
  全量只在 T6。CI 只在合并/收口触发。
- **类型口径**：`strict` + dsh base 的 `noUncheckedIndexedAccess`/`exactOptionalPropertyTypes`/`noImplicitOverride`/`noUnused*`；
  `@ts-nocheck` 禁止；`any`/`as`/`@ts-expect-error` 按 #201 的边界。
- **不改行为**：不借迁移改 HTTP/SSE 契约、业务语义或架构；`tests/` 断言零改动，只改 import 路径。

## 范围外

- 不改 Android 客户端
- 不改 `combo.json` 的 dsh 锁或客户端来源
- 不升级 TypeScript 版本（用 dsh 自带的 6.0.3）
- 不引入根 `devDependencies` 与 lockfile（TypeScript 版本权威在 dsh 检出）

## 证据

`work/implementation/evidence/` 下每票一份记录加一份收口 README：
[`206-ts-infra/`](../../implementation/evidence/206-ts-infra/)、
[`207-ts-identity-sessions/`](../../implementation/evidence/207-ts-identity-sessions/)、
[`208-ts-spaces-attachments/`](../../implementation/evidence/208-ts-spaces-attachments/)、
[`209-ts-chat/`](../../implementation/evidence/209-ts-chat/)、
[`210-ts-remaining/`](../../implementation/evidence/210-ts-remaining/)、
[`211-ts-scripts/`](../../implementation/evidence/211-ts-scripts/)（目录索引见[证据索引](../../implementation/evidence/README.md)）。
