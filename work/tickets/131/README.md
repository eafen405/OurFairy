# #131 后端传输层独立：实施票与任务图

父票：[#131 后端传输层独立：把产品 HTTP 工具箱从 identity 拆成 @ourfairy/dsh-http](https://github.com/eafen405/OurFairy/issues/131)。
票面本体的 Web 权威在上面这个链接；本目录是工作副本，编号对应见 `published.json`。

子票（按依赖排序）：

| 文件 | 票号 | 内容 | 阻塞于 |
| --- | --- | --- | --- |
| `01-http-package.md` | #138 | 新包落地、identity 路由独立、bundle 挂行 | 无 |
| `02-consumers-core.md` | #139 | chat、gateway、sessions 改依赖 | #138 |
| `03-consumers-attachments-speech.md` | #140 | attachments、speech 改依赖 | #138 |
| `04-contract-closeout.md` | #141 | 删除兼容出口、证据索引与全量门禁 | #139、#140 |

实施采用 expand–contract：`#138` 先让新包与 identity 的 `./routes` 并存，并保留 identity 的 `./http`
作为指向新包的临时兼容出口；`#139`、`#140` 并行迁移消费方；`#141` 删除兼容出口。中间每张票合并后
`npm test` 都应保持绿，最终树的导出面与票面设计一致。

---

## Problem Statement

`@ourfairy/dsh-identity` 现在同时承担两件互不相干的事：产品领域（用户、短编号、邀请、会话凭据、角色）和产品传输层（JSON 请求/响应信封、bearer 解析、body 上限）。chat、gateway、attachments、speech、sessions 五个包为了拿到 `postHandler` / `sendJson` 而声明 identity 依赖，但它们没有任何一个需要身份语义。

结果是内核的接口比它实际提供的领域能力宽得多：读 `backend/identity/package.json` 会以为 identity 是几乎所有产品包的前置，而真正被用到的只是三个函数。想理解「卸载一个产品包会带走什么」时，依赖图给不出答案。

## Solution

新增 `@ourfairy/dsh-http` 产品包，主入口是可挂载的插件行，`/http` 子路径导出产品共享的请求/响应信封。identity 只保留自己的路由表与处理函数，领域接口不变。

## User Stories

1. 作为维护者，我想让 identity 包的依赖面只反映身份领域，这样我读依赖图时能判断「谁真的需要身份」。
2. 作为维护者，我想让产品 HTTP 编解码只有一个家，这样改错误信封时不需要在五个包里确认行为一致。
3. 作为维护者，我想在卸载 identity 时知道哪些包会真正失效，这样「插件可单独停用」不是一句空话。
4. 作为维护者，我想让新包的空插件入口被真实启动链路验证，这样「挂了行但什么都没做」不会成为被忽略的失败。
5. 作为升级者，我想在 dsh 升级后只检查一个地方的 Web 载体接缝，这样传输层的复核范围是可数的。
6. 作为维护者，我想让各个领域包的 peer 声明与它们的 import 一致，这样清单是可读的事实而不是历史残留。
7. 作为审查者，我想让「产品路由不经 `/api`」这条边界保持不动，这样这次拆包不会顺手改变协议。
8. 作为审查者，我想让错误类的 `instanceof` 捕获面不变宽，这样跨模块抛出的错误不会被误当成路由错误返回。
9. 作为打包者，我想让新包出现在 bundle 的包清单与行清单里，这样 `doctor` 会检查它而不是忽略它。
10. 作为测试作者，我想让既有的身份、网关、附件行为断言原样通过，这样「接口没变」有可执行的证据。
11. 作为维护者，我想让 `ownerOf` / `shortIdOf` 留在无环的位置，这样消费方不需要为了编解码而挂载身份插件。
12. 作为维护者，我想让这次拆分不引入共同错误基类，这样每个路由仍只捕获自己那一种错误。

## Implementation Decisions

- 新包 `@ourfairy/dsh-http`：`private: true`，非空 `description`，`exports` 含 `.`、`./http`、`./locale/*.json`，`files` 含 `src`、`README.md`、`locale/*.json`。`tests/plugin-compatibility.test.mjs` 要求产品包具备 description、导出的 `locale/en.json`（含 `meta.title` 与 `meta.description`），并在 `files` 中发布 locale。
- 插件入口声明 `name: 'ourfairy-http'`、空 `inject`、空 `apply`。行的存在理由是让包进入被挂载清单：bundle 权威规则要求每个声明的包至少被一行挂载，任何装进 profile 的 `@ourfairy/*` 包必须被声明，且 `autoInstallPeers: false` 堵死了仅靠 peer 安装的路径。空 `inject` 插件行的 fiber 是否稳定为 active 需要在实施时用一次 `doctor --json` 确认。
- 从 identity 搬入：body 上限常量、请求头读取、bearer 解析、body 读取、JSON 响应写出、`post` 包装器。
- 删除 `readJsonBody` 与 `postHandler` 上的 `HttpError = IdentityError` 与 `codePrefix = 'identity'` 默认值。五个现有调用点全部显式传参，删除零行为变化，并且这是切断新包对 `IdentityError` 唯一依赖的方式。
- identity 保留 `IDENTITY_PATHS` 与 `identityHandlers`；其路由模块的导出子路径从 `./http` 改名为 `./routes`，避免与新包的 `./http` 在同名位置产生歧义。`identityHandlers` 改从新包导入 `postHandler`。
- `ownerOf` / `shortIdOf` 留在 `@ourfairy/dsh-identity/owner`。它是当前唯一无环的选择：identity 不依赖任何产品包，其余包可以依赖它；移到新包会撞上与工具箱相同的挂载约束，而 codec 是纯函数模块。
- 不抽共同错误基类。各产品路由继续传入自己的具体错误类，`postHandler` 的 `instanceof` 捕获面因此不放大。
- bundle 侧：`dependencies` 增 `"@ourfairy/dsh-http": "file:../http"`，`cordis.patch.yml` 增一行挂载。
- peer 改向：chat、gateway、attachments、speech 的 identity peer 换成 dsh-http（它们对 identity 的唯一模块 import 就是 http）；sessions 增加 dsh-http 且保留 identity（它还要用 `/owner`）；delivery、search、spaces、probe 不动。
- `docs/architecture/dsh-ecosystem-boundary.md` 不写新包名。`tests/ecosystem-boundary.test.mjs` 会因文档出现 bundle 声明的包名而失败。

## Testing Decisions

好测试只断言外部行为：请求进、响应出，或启动链路报告的事实。不 import 私有模块、不断言实现结构。

- 接缝：真实启动器（`tests/helpers/backend.mjs`）加 `doctor --json`，本仓库既有的唯一验收入口，不新增接缝。
- 新行的存活证明：`doctor --json` 的 `bundle packages` 与探针 rows 必须把新行报告为已挂载且 active；`tests/plugin-compatibility.test.mjs` 的 metadata 断言必须覆盖新包。
- 行为未变由既有断言承担：`tests/identity-http.test.mjs`（凭据、栅栏、错误码）、`tests/gateway.test.mjs`（`gateway/unauthorized` / `gateway/forbidden`）、`tests/owned-sessions.test.mjs`。这些不需要新增，原样通过即是证据。
- 先前艺术：`tests/bundle-packages.test.mjs` 对「装了什么、声明了什么」的对账，以及 `tests/plugin-compatibility.test.mjs` 对 manifest 元数据的检查。
- 全量门槛仍是 `npm test` 与 `npm run combo:verify`。

## Out of Scope

- 迁移产品路由到 `/api`。
- 抽象共同错误基类或统一错误码前缀。
- 移动 `ownerOf` / `shortIdOf`。
- 修改启动器的包清单派生逻辑（它从 bundle manifest 派生，无需改）。
- 修改 `backend/v1-bundle/README.md` 的行清单散文。

## Further Notes

- 关联 #73（dsh 插件生态兼容）。本次是把 #73 定下的「产品包以行形式挂载」规则用到传输层。
- 实施顺序建议：先建包与搬符号、再改五个 import、再改 manifest 与 bundle、最后跑全量。中间任一步完成后 `combo:verify` 都应能指出缺的是哪一处。

