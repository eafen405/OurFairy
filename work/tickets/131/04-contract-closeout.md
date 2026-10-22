# 141: 契约收口：删除 identity 的 http 兼容出口并跑全量门禁

**Status:** ready-for-agent

## Parent

[#131 后端传输层独立：把产品 HTTP 工具箱从 identity 拆成 @ourfairy/dsh-http](https://github.com/eafen405/OurFairy/issues/131)

## What to build

收口这次拆包：删除 identity 的 `./http` 兼容出口与它指向新包的重导出，让 `@ourfairy/dsh-identity/http` 在导出映射层面不存在——任何遗留 import 都会在加载时失败，而不是继续悄悄工作。此时 identity 的依赖面只剩身份领域，产品传输层只有一个家。

同时补齐新包的 README 与证据索引，并跑全量门禁。`docs/architecture/dsh-ecosystem-boundary.md` 不写新包名：`tests/ecosystem-boundary.test.mjs` 会因文档出现 bundle 声明的包名而失败。

## Acceptance criteria

- [ ] identity 的 `exports` 不再声明 `./http`，兼容重导出文件删除；`@ourfairy/dsh-identity/http` 无法解析
- [ ] `backend` 与 `tests` 中零 `@ourfairy/dsh-identity/http` import；`owner` 子路径保持不变
- [ ] identity 的包描述与 locale 只描述身份领域，不再声称承担产品传输层
- [ ] `backend/http/README.md` 说明包是什么、导出哪些函数、为什么它不依赖 identity
- [ ] `work/implementation/evidence/README.md` 登记本次四张票的证据目录
- [ ] `npm test` 全绿（基线 234 条）与 `npm run combo:verify` 三行 ok
- [ ] `doctor --json` 的 `bundle packages`、`plugin compatibility`、`native capabilities` 全绿，新行报告为 `active`
- [ ] 行为测试 `tests/identity-http.test.mjs`、`tests/gateway.test.mjs`、`tests/owned-sessions.test.mjs`、`tests/attachments.test.mjs`、`tests/speech.test.mjs` 原样通过

## Blocked by

- #139
- #140
