# 140: 消费方迁移（二）：attachments、speech 改用 dsh-http

**Status:** ready-for-agent

## Parent

[#131 后端传输层独立：把产品 HTTP 工具箱从 identity 拆成 @ourfairy/dsh-http](https://github.com/eafen405/OurFairy/issues/131)

## What to build

把 `@ourfairy/dsh-attachments` 与 `@ourfairy/dsh-speech` 的传输函数 import 改到新包，peer 声明相应改向。

`attachments` 用 `postHandler` 与 `sendJson`，`speech` 只用 `sendJson`；两者都不需要身份领域语义，改动后对 identity 的模块依赖为零。两个包的 `inject` 里仍有 `identity`（speech 直接用它认证，attachments 经会话服务间接使用），本次不改 `inject` 语义。

本票与并行票「消费方迁移（一）」互不重叠：不碰 chat、gateway、sessions，也不碰 identity 与 bundle。

## Acceptance criteria

- [ ] `attachments`、`speech` 对传输函数的 import 指向 `@ourfairy/dsh-http/http`，不再指向 `@ourfairy/dsh-identity/http`
- [ ] 两个包的 `peerDependencies` 去掉 identity、增加 `@ourfairy/dsh-http`
- [ ] 两个包对 `@ourfairy/dsh-identity` 的 import 为零
- [ ] `tests/attachments.test.mjs`、`tests/speech.test.mjs` 原样通过
- [ ] `npm test` 与 `npm run combo:verify` 通过

## Blocked by

- #138
