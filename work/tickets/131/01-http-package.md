# 138: 传输工具箱新包：@ourfairy/dsh-http 落地、identity 路由独立、bundle 挂行

**Status:** ready-for-agent

## Parent

[#131 后端传输层独立：把产品 HTTP 工具箱从 identity 拆成 @ourfairy/dsh-http](https://github.com/eafen405/OurFairy/issues/131)

## What to build

新增产品包 `@ourfairy/dsh-http`，让产品 HTTP 编解码只有一个家：JSON 请求/响应信封、bearer 解析、body 上限与 `post` 包装器都从 identity 包搬入。包的主入口是可挂载的插件行（`inject` 与 `apply` 都为空），`/http` 子路径导出这些传输函数。

identity 只保留身份领域：`IDENTITY_PATHS` 与 `identityHandlers` 留在 identity，路由模块改由 `./routes` 子路径导出；`./http` 暂时保留为指向新包的兼容出口，让五个消费方在本次合并后仍然工作（收口票删除它）。identity 改为从新包导入 `postHandler` 与 `bearerToken`。

bundle 把新包纳入产品包清单并挂载一行，使 doctor 的 `bundle packages`、`plugin compatibility` 与只声明 bundle 的 profile 启动都能证明它真实存在且 active。

传输函数不再默认使用 `IdentityError` 与 `identity` 前缀：`readJsonBody` 与 `postHandler` 的 `HttpError`、`codePrefix` 改为必传。现有五个调用点已经显式传参，删除默认值不改变行为，也是新包不依赖 identity 的唯一办法。

## Acceptance criteria

- [ ] `backend/http` 是 `private: true` 的产品包，具备非空 `description`、`exports` 的 `.`、`./http`、`./locale/*.json`，`files` 含 `src`、`README.md`、`locale/*.json`，`locale/en.json` 有非空 `meta.title` 与 `meta.description`
- [ ] 插件行声明 `name: 'ourfairy-http'`、空 `inject`、空 `apply`，不依赖 identity 或任何产品包
- [ ] 传输函数（body 上限、请求头读取、bearer 解析、body 读取、`sendJson`、`postHandler`）只在新包定义；identity 不再定义它们
- [ ] `readJsonBody` 与 `postHandler` 没有 `IdentityError`/`identity` 默认值；所有调用点显式传入自己的错误类与前缀
- [ ] identity 路由模块由 `./routes` 导出；identity 的 `./http` 暂时重导出新包的传输函数，五个现有消费方不改也能工作
- [ ] identity 的 `package.json` 声明 `@ourfairy/dsh-http` peer；新包不声明任何 `@ourfairy/*` peer
- [ ] bundle 的 `package.json` 增 `"@ourfairy/dsh-http": "file:../http"`，`cordis.patch.yml` 增一行挂载
- [ ] `doctor --json` 的 `bundle packages` 与探针 rows 报告新行已挂载且 `active`；`plugin compatibility` 覆盖新包
- [ ] `tests/identity-http.test.mjs`、`tests/gateway.test.mjs`、`tests/owned-sessions.test.mjs` 原样通过
- [ ] `npm test` 与 `npm run combo:verify` 通过
- [ ] 证据写入 `work/implementation/evidence/<票号>-http-package/README.md`；证据索引由收口票统一登记

## Blocked by

None (can start immediately).
