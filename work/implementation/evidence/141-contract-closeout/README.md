# 141-contract-closeout — 票 #141 证据

> 父规格 [#131](https://github.com/eafen405/OurFairy/issues/131)；票面本地副本
> [`04-contract-closeout.md`](../../../tickets/131/04-contract-closeout.md)；分支
> `ticket/141-closeout`；开工基线 `integration/spec-131` `544d082`（含 #138、#139、#140）。

## 收口改了什么

- `backend/identity/src/http.mjs` 删除（`git rm`）。它只剩一行重导出：
  `export { bearerToken, postHandler, sendJson } from '@ourfairy/dsh-http/http'`。
- `backend/identity/package.json`：`exports` 删除 `"./http": "./src/http.mjs"`；保留
  `./routes`（identity 自己的请求路径）与 `./owner`（`user:<shortId>` codec）。peer 未动——
  identity 的 `src/index.mjs` / `src/routes.mjs` 仍从 `@ourfairy/dsh-http/http` 取
  `bearerToken` / `postHandler`。
- identity 的 `description` 与 `locale/en.json`：改掉「with the product's own request paths /
  HTTP paths」这类让 identity 读成产品传输层的措辞，改为只描述身份领域、它自己的
  `/identity/*` 路由，以及会话令牌对 dsh `/api` 的 admission（后者仍是 identity 的能力）。
  （评审修复，见文末。）
- `backend/http/README.md`：评审修复把两处无接缝的措辞改成文件事实（manifest 无
  `peerDependencies`、`src/http.mjs` 无 import 声明；参数是调用方契约而非构造期强制），
  包是什么、`./http` 导出什么、行为何为空、为何不依赖 identity 未变。
- `work/implementation/evidence/README.md`：新增「传输层拆包（规格 #131）」一节，登记
  138/139/140/141 四个证据目录。
- 本目录 `README.md`（本文件）。

未改：`docs/architecture/dsh-ecosystem-boundary.md`、`combo.json`、`tests/`、五个消费包
（chat、gateway、sessions、attachments、speech）。bundle 只改了 sessions 行注释（评审修复，
见文末）。最终导出面即规格目标：identity 只剩自己的路由（`./routes`）、`/owner` codec
（`./owner`）与领域服务（`.`）。

## Red / green 说明

本票是契约收口，接缝是既有验收套件，未新增测试文件或断言。

- 改动前：在 `backend/identity` 内 `import.meta.resolve('@ourfairy/dsh-identity/http')`
  返回 `.../src/http.mjs`（Node 自引用经 `exports` 解析）。
- 删除后：同一解析与动态 import 以 `ERR_PACKAGE_PATH_NOT_EXPORTED` 失败。检查用 scratch
  文件（未提交，运行后删除），这就是「遗留 import 在加载期失败」的结构性证明。
- `grep -rn "@ourfairy/dsh-identity/http" backend tests`：删除后无输出（exit 1）。
  删除前该模式只在待删 shim 自己的注释里出现，没有任何 import。
- 行为未变由既有断言承担：`tests/identity-http.test.mjs`、`tests/gateway.test.mjs`、
  `tests/owned-sessions.test.mjs`、`tests/attachments.test.mjs`、`tests/speech.test.mjs`
  原样通过。

## 实际命令与结果

所有会派生 corepack/pnpm 的命令都带环境专用 shim（见文末环境说明）。

| 命令 | 时点 | 结果 |
| --- | --- | --- |
| `git merge integration/spec-131`（开工与交付前各一次） | 基线 `e57827e` | 开工时 fast-forward 到 `544d082`（#139 合入）；交付前 `Already up to date`，tip 仍 `544d082`（含 #138、#139、#140） |
| `node --test tests/identity-http.test.mjs tests/gateway.test.mjs tests/owned-sessions.test.mjs tests/attachments.test.mjs tests/speech.test.mjs` | 改动前基线 | 34 tests / 34 pass / 0 fail |
| `git rm backend/identity/src/http.mjs`；删除 `exports` 的 `./http` | 改动 | — |
| scratch `import.meta.resolve` + 动态 import `@ourfairy/dsh-identity/http` | 删除后 | **red**：`ERR_PACKAGE_PATH_NOT_EXPORTED`（`Package subpath './http' is not defined by "exports"`） |
| `grep -rn "@ourfairy/dsh-identity/http" backend tests` | 删除后 | 无输出，exit 1 |
| 五个验收文件（同第一行命令） | 删除后 | 34 tests / 34 pass / 0 fail |
| `node --test tests/plugin-compatibility.test.mjs tests/bundle-packages.test.mjs tests/bundle-only-profile.test.mjs tests/docs.test.mjs tests/ecosystem-boundary.test.mjs` | 删除后 | 24 tests / 24 pass / 0 fail |
| `npm test`（pre-commit hook 内，提交 `3cad61f` 与 `8f9d672`） | 两次提交树 | 各 234 tests / 234 pass / 0 fail（125 s / 109 s） |
| `npm test`（最终树 `8f9d672`，直接运行） | 最终树 | 234 tests / 234 pass / 0 fail（106 s） |
| `npm run combo:verify`（hook 内与最终树直接运行） | 最终树 | 4 行全 ok，`combo: combination verified`；ourfairy 行 `ok (worktree is based on the integration tip)`，actual `8f9d672` |
| `OURFAIRY_HOME=$(mktemp -d) node scripts/ourfairy-backend.mjs doctor --json` | 最终树，全新 home | exit 0；11 项 check 全 ok |
| `OURFAIRY_HOME=<同一临时 home> OURFAIRY_PORT=0 OURFAIRY_PHAETHON_PASSWORD=probe-password node scripts/ourfairy-backend.mjs probe --report ...` | 同一临时 home | exit 0，`ok: true`，0 failures，24 services live，49 rows 组合 |

doctor 中与本票相关的四项（节选）：

```
bundle packages         ok | 11 declared package(s) mounted by 16 row(s): conversation-search:@ourfairy/dsh-search,
                             http:@ourfairy/dsh-http, identity:@ourfairy/dsh-identity, sessions:@ourfairy/dsh-sessions, ...
plugin compatibility    ok | 13 installed product package(s) compatible with dsh 0.2.1-alpha.2: ...,
                             @ourfairy/dsh-http@0.1.0, @ourfairy/dsh-identity@0.1.0, ...
native capabilities     ok | llm-retry:@deepseek-ai/dsh-llm-retry, spill-local:@deepseek-ai/dsh-spill-local,
                             spill-policy:@deepseek-ai/dsh-spill-policy, subprocess:@deepseek-ai/dsh-subprocess-local,
                             @deepseek-ai/dsh-agent/session-history
product packages        ok | 逐包 files 清单（含 backend/http 与 backend/identity 的 src、README、locale）
```

`probe --report` 中 `http` 行的报告（这是「空插件入口真实启动且 active」的证据）：

```json
{"id":"http","name":"@ourfairy/dsh-http","disabled":false,"fiberState":"active"}
```

报告里 17 个 `@ourfairy/*` 行（bundle 挂的 16 行加测试探针行，含 `http`）全部
`disabled=false fiber=active`，24 个服务 live，`failures` 为空。

## 未执行项与说明

- 未 push、未合入集成分支、未评论或关闭 issue；由 Lead 指定的 merger 处理。
- 未做真机/客户端验收：本票只涉及后端包的导出面、文档与门禁。
- 未新增测试/断言。票面明确不新增「`@ourfairy/dsh-identity/http` 零 import」的正则测试；
  可执行保障是导出映射删除本身——任何遗留 import 在加载期以
  `ERR_PACKAGE_PATH_NOT_EXPORTED` 失败，而不是继续悄悄工作。
- `inject` 与 peer 是两个权威，不是同一份清单：`inject` 是运行期服务依赖（`ctx.identity` 的调用），
  peer 是模块 import 的声明。据此回答 Spec 评审的 user story 3：chat 的 `inject` 仍列 `identity`
  但已无 `ctx.identity` 调用，是残留，移除归 #133；gateway（`src/index.mjs:22`）、speech
  （`src/index.mjs:49`）、attachments（`src/service.mjs:41,143`）保留 `inject: ['identity']` 是因为
  它们真的调用 `ctx.identity`，而 peer 不再列 identity 是因为不再 import 它——这是两条正确的记录，
  不是待清理的缺陷；sessions 同时保留 identity peer 与 `inject`，且仍用 `/owner`。
- 环境说明：corepack 取 pnpm 的网络访问间歇性挂起，所有会派生 corepack/pnpm 的命令
  （测试、`combo:verify`、doctor、probe、提交）都在 `PATH` 前加了环境专用 shim：把
  `COREPACK_HOME` 指向共享缓存并关闭 corepack 的网络检查。它只改进程环境，仓库内容、
  测试、启动器与 pnpm 版本（11.28.5）均未因此改动。

## 评审修复

以下修正在 `ticket/131-review-fixes`（基线 `integration/spec-131` `4bade96`）上完成，均为文档/注释，
无行为代码改动；每行一条，附被修正的文件：

- #139 证据：peer 改向不再声称由既有测试覆盖，改为写明测试实际断言（已声明 peer 的 caret 形状、description/locale、声明 = 挂载 = 已安装），并明说改向本身没有专门断言——`work/implementation/evidence/139-consumers-core/README.md`。
- #140 证据：doctor 的 `plugin compatibility` 只证明两包已安装且其 dsh peer 相容，不再声称 identity → http 的 peer 改向被该检查判过——`work/implementation/evidence/140-consumers-attachments-speech/README.md`。
- #138 证据：`tests/` 从未 import `@ourfairy/dsh-identity/http`（它们经启动器走 HTTP），改为如实说明；「新包无 identity 默认值」改由 `src/http.mjs` 无 import 声明、无 `IdentityError`/`identity` 字样的文件事实与 grep 命令承担，不再推迟到 #141——`work/implementation/evidence/138-http-package/README.md`。
- `backend/http/README.md`：把「无 peer、只依赖 Node runtime」与「必传参数、无默认」改成可验证的文件事实与调用方契约，不再声称构造期强制——`backend/http/README.md`。
- identity 元数据：description 与 locale 只描述身份领域及其 `/identity/*` 路由与会话令牌对 `/api` 的 admission——`backend/identity/package.json`、`backend/identity/locale/en.json`。
- sessions 行注释：改为复用 `ctx.connection.fence` 与 `@ourfairy/dsh-http/http` 的 `postHandler`——`backend/v1-bundle/cordis.patch.yml`。

评审中判定不采纳的两项 judgement call：

- 共享错误值对象（共同错误基类 / 统一错误码前缀）：规格 Out of Scope，各路由继续保留自己的错误类与前缀。
- 去重 `backend/http/package.json` description、README 与 locale 的函数清单：三者读者不同（manifest fallback / README / dsh 插件元数据），不合并。

本分支的门禁（`PATH` 前加同一 corepack shim；`git merge integration/spec-131` 为 `Already up to date.`）：

| 命令 | 结果 |
| --- | --- |
| `node --test tests/docs.test.mjs tests/ecosystem-boundary.test.mjs tests/plugin-compatibility.test.mjs` | 13 tests / 13 pass / 0 fail |
| `npm test` | 234 tests / 234 pass / 0 fail |
| `npm run combo:verify` | 4 行全 ok，`combo: combination verified`（ourfairy 行 actual `4bade96`） |
| `OURFAIRY_HOME=$(mktemp -d) node scripts/ourfairy-backend.mjs doctor --json` | exit 0；11 项 check 全 ok |
