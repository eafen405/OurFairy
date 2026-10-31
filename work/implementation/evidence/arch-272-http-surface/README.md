# #272 产品 HTTP 面清单与表驱动栅栏测试

日期：2026-10-31。票面：[#272](https://github.com/eafen405/OurFairy/issues/272)。
分支 `ticket/272-http-surface`，worktree `.worktrees/272-http-surface`，基线 `9730d94aee`，
合并 main 的提交 `8c98255012`，合入 main 的提交 `3cf1874757`。

本票只做第一步：给 38 个产品 HTTP 地址一份可执行的清单，并把栅栏测试改成表驱动。
运行时零改动——handler、挂载方式、admission 顺序与 wire 形状都不变。

## 改动

| 文件 | 职责 |
| --- | --- |
| [`backend/http/src/http.ts`](../../../../backend/http/src/http.ts) | 新增 `SurfaceEntry` / `SurfaceAuth` / `SurfaceBody` / `SurfaceResponse` 与 `freezeSurface`（数组与逐条 entry 都冻结） |
| [`backend/identity/src/routes.ts`](../../../../backend/identity/src/routes.ts) | 6 条 `SURFACE`；`IDENTITY_PATHS` 改由它派生 |
| [`backend/sessions/src/http.ts`](../../../../backend/sessions/src/http.ts) | 7 条 `SURFACE`；`SESSION_PATHS` 派生，`SESSION_RENAME_PATH` 不变 |
| [`backend/chat/src/index.ts`](../../../../backend/chat/src/index.ts) | 10 条 `SURFACE`（9 条 `chat/*` + rename，前缀 `sessions`） |
| [`backend/gateway/src/http.ts`](../../../../backend/gateway/src/http.ts) | 7 条 `SURFACE`，全部 `auth: 'role'` |
| [`backend/memory/src/impression.ts`](../../../../backend/memory/src/impression.ts) | 2 条 `/impression/*`；`IMPRESSION_PATHS` 派生 |
| [`backend/attachments/src/index.ts`](../../../../backend/attachments/src/index.ts) | 4 条（chunk 是 binary body，download 是 binary response） |
| [`backend/speech/src/index.ts`](../../../../backend/speech/src/index.ts) | 2 条，作为文件末尾独立块追加，未改 import 与注册循环；`/speech` 是 GET，`/speech/transcriptions` 是 binary body |
| 四个包根 `index.ts` | `SURFACE` 的 re-export |
| [`tests/route-inventory.test.mjs`](../../../../tests/route-inventory.test.mjs) | 新增：38 条唯一、row/前缀分组、method/body/response 矩阵、handler 表对账 |
| [`tests/identity-http.test.mjs`](../../../../tests/identity-http.test.mjs) | 6 条代表路径换成 38 条表驱动；`/speech` 改成精确 `speech/forbidden-authority` |
| [`docs/architecture/dsh-ecosystem-boundary.md`](../../../../docs/architecture/dsh-ecosystem-boundary.md) | 路径行不再手抄，指向该测试 |

矩阵：**37 POST / 1 GET**；**35 JSON body / 2 binary / 1 none**；**36 JSON / 1 SSE / 1 binary**。

## 实际命令与结果

```
$ npm run build
> node scripts/tsc.ts --fresh                      exit 0

$ node --test tests/route-inventory.test.mjs
ℹ tests 5   ℹ pass 5   ℹ fail 0

$ node --test tests/identity-http.test.mjs
✔ every product module entry point rejects an untrusted Host before parsing the body or reading the credential (106ms)
ℹ tests 12  ℹ pass 12  ℹ fail 0

$ node --test tests/speech.test.mjs
ℹ tests 2   ℹ pass 2   ℹ fail 0

$ node --test tests/ecosystem-boundary.test.mjs tests/docs.test.mjs
ℹ tests 7   ℹ pass 7   ℹ fail 0
```

合并 main（含 #273 的 speech policy）后在本分支重跑：

```
$ npm run build                                     exit 0
$ node --test tests/route-inventory.test.mjs tests/speech.test.mjs tests/speech-policy.test.mjs
ℹ tests 11  ℹ pass 11  ℹ fail 0
$ node --test tests/identity-http.test.mjs
ℹ tests 12  ℹ pass 12  ℹ fail 0   (2355ms)
```

## 一致的证明方式

- **直接读 handler 表（22 条）**：`route-inventory` 构造 `identityHandlers` / `sessionHandlers` /
  `gatewayHandlers` / `impressionHandlers` 的真实 Map，断言 key 的**顺序**与 `SURFACE` 逐条相等。
- **对照注册循环（chat 10、attachments 4、speech 2）**：逐条比对注册顺序。
- **运行期挂载证明（38 条全部）**：boot 后对每条地址发两次请求（不受信 Host；无凭据/坏 body），
  全部得到该 row 精确的 `<prefix>/forbidden-authority`。未挂载会是 404；凭据、方法或解析先跑
  会是 401/405/400。

## 没有覆盖的

**`SURFACE` 之外多注册一条路径，本票发现不了。** 清单与挂载仍是两处：运行期栅栏能证明
「表里的每条都真的挂载了」，不能反向证明「挂载的都在表里」。这要等第二步
[#277](https://github.com/eafen405/OurFairy/issues/277) 的 `mountRoutes` 让 `SURFACE` 成为挂载来源。

## 环境说明

冷 worktree 第一次 `start` 会因隔离 home 的 profile 安装超过 helper 的 300s 超时（stdout/stderr
为空，没跑到断言）。用 launcher 生成一次 `.ourfairy-template` 预热后全部通过；不是断言失败。
