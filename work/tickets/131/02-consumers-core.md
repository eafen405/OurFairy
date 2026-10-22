# 139: 消费方迁移（一）：chat、gateway、sessions 改用 dsh-http

**Status:** ready-for-agent

## Parent

[#131 后端传输层独立：把产品 HTTP 工具箱从 identity 拆成 @ourfairy/dsh-http](https://github.com/eafen405/OurFairy/issues/131)

## What to build

把三个只用到传输信封的包改成直接依赖新包：`@ourfairy/dsh-chat`、`@ourfairy/dsh-gateway` 与 `@ourfairy/dsh-sessions` 的 `postHandler` 改从 `@ourfairy/dsh-http/http` 导入，peer 声明相应改向。

`sessions` 同时保留 `@ourfairy/dsh-identity` peer：它的服务层仍用 `/owner` 的 `ownerOf`，而且 `inject` 里的 `identity` 是凭据解析的真实依赖。`chat` 与 `gateway` 的 `inject` 里仍有 `identity`（网关用它认证调用者，chat 经 sessions 服务间接使用），本次不改 `inject` 语义，只改模块 import 与 peer。

本票不改 identity 包、不改 bundle、不改 attachments/speech；这些分别由前置票与并行票负责。

## Acceptance criteria

- [ ] `chat`、`gateway`、`sessions` 对传输函数的 import 指向 `@ourfairy/dsh-http/http`，不再指向 `@ourfairy/dsh-identity/http`
- [ ] `chat`、`gateway` 的 `peerDependencies` 去掉 identity、增加 `@ourfairy/dsh-http`；`sessions` 增加 `@ourfairy/dsh-http` 并保留 identity
- [ ] 这三个包对 `@ourfairy/dsh-identity` 的剩余 import 为零（sessions 只剩 `@ourfairy/dsh-identity/owner`）
- [ ] `tests/gateway.test.mjs`、`tests/owned-sessions.test.mjs`、`tests/remote-chat.test.mjs` 原样通过
- [ ] `npm test` 与 `npm run combo:verify` 通过

## Blocked by

- #138
