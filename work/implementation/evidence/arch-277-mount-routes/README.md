# #277 SURFACE 成为挂载来源：dsh-http 的 mountRoutes

日期：2026-10-31。票面：[#277](https://github.com/eafen405/OurFairy/issues/277)。
分支 `ticket/277-mount-routes`，worktree `.worktrees/277-mount-routes`，基线 `fc77d5310b`（main）。

#272 让 7 个 row 各导出 `SURFACE`，但 chat / attachments / speech 的注册仍是内联字面量，
`SURFACE` 与实际挂载是两处：运行期栅栏能证明「清单里的每条都挂载了」，不能反向证明
「挂载的都在清单里」。本票在 `@ourfairy/dsh-http/http` 加一个薄的 `mountRoutes`，把 7 个 row 的
注册都改成「SURFACE + handler 表」一次调用；不新建包，wire、错误码、错误文案与 admission 顺序未动。

## 改动

| 文件 | 职责 |
| --- | --- |
| [`backend/http/src/http.ts`](../../../../backend/http/src/http.ts) | 新增 `RouteHandler`、`MountRoutesOptions` 与 `mountRoutes`：注册前双向对账（重复 path / 缺 handler / SURFACE 之外的 handler），每条在 `ctx.effect` 里注册 `kind: 'exact'`；`label` 省略时按 entry 的 error prefix 生成 effect 标签 |
| [`backend/identity/src/index.ts`](../../../../backend/identity/src/index.ts) | `for (IDENTITY_PATHS)` 循环换成 `mountRoutes`；handler 表不变 |
| [`backend/sessions/src/index.ts`](../../../../backend/sessions/src/index.ts) | `for (SESSION_PATHS)` 循环换成 `mountRoutes`；handler 表不变 |
| [`backend/gateway/src/index.ts`](../../../../backend/gateway/src/index.ts) | `for (GATEWAY_PATHS)` 循环换成 `mountRoutes`；handler 表不变 |
| [`backend/memory/src/index.ts`](../../../../backend/memory/src/index.ts) | `for (IMPRESSION_PATHS)` 循环换成 `mountRoutes`；handler 表不变 |
| [`backend/chat/src/index.ts`](../../../../backend/chat/src/index.ts) | 10 次 `register(path, handle, respond?, family)` 改为一张 `Map<path, handler>` + `mountRoutes`；SSE 仍走 `respondToChatObserver`，rename 仍用 `sessions` 前缀 |
| [`backend/attachments/src/index.ts`](../../../../backend/attachments/src/index.ts) | 4 次 `register` 改为 handler 表：propose / complete / download 仍由 `postHandler` 包住，chunk 保留自己的 fence、凭据、content-type、offset 与错误映射 |
| [`backend/speech/src/index.ts`](../../../../backend/speech/src/index.ts) | 内联 `[path, transcribe]` 循环改为 handler 表 + `mountRoutes`；`SURFACE` 从文件末尾移到 `apply` 前并用 `freezeSurface` 冻结 |
| [`backend/http/README.md`](../../../../backend/http/README.md) | 「Mounting a row's surface」一节：seam 藏住什么、不藏什么 |
| [`tests/mount-routes.test.mjs`](../../../../tests/mount-routes.test.mjs) | 新增 5 个用例：从 SURFACE 注册、effect disposer、重复 path、缺 handler、SURFACE 之外的 handler |

## interface

```ts
mountRoutes(ctx: Context, {
  label?: string,
  surface: readonly SurfaceEntry[],
  handlers: ReadonlyMap<string, RouteHandler>,
}): void

type RouteHandler = WebRoute['handler']
```

- **藏住**：注册生命周期（每条一个 `ctx.effect`，随 row 的 fiber 释放）、路由形状（`kind: 'exact'`）、
  effect 标签（`<label ?? entry.prefix>: <path>`），以及 SURFACE 与 handler 表的双向对账。
- **不藏**：admission。JSON 路由仍由 `postHandler` 做 fence → method → body → 错误信封；SSE 路由仍把
  `respondToChatObserver` 交给 `postHandler` 的 `respond`；二进制下载仍交给 `createDownloadResponder`；
  `/attachments/chunk`、`/speech`、`/speech/transcriptions` 仍自己读原始 body、认证并映射错误。
  对账只在**注册前**做一次，失败的 row 不会留下半套路由。

## 每个 row 改造前后

| row | 改前 | 改后 |
| --- | --- | --- |
| identity | `for (IDENTITY_PATHS)` 取 Map 后逐条 `ctx.effect(register)`，缺 handler 抛 `IdentityError(500, 'identity/missing-handler')` | `mountRoutes(ctx, { label: 'ourfairy-identity', surface, handlers })`，effect 标签不变 |
| sessions | 同上，缺 handler 抛普通 `Error` | `mountRoutes(..., label: 'ourfairy-sessions')` |
| gateway | `for (GATEWAY_PATHS)`，`handlers.get(path)!` | `mountRoutes(..., label: 'ourfairy-gateway')` |
| memory | `for (IMPRESSION_PATHS)`，缺 handler 抛普通 `Error` | `mountRoutes(..., label: 'ourfairy-memory')` |
| chat | 局部 `register()` 立即 `postHandler` + `ctx.effect`，10 条内联调用 | 一张 `Map<path, handler>` + `mountRoutes`；`respond`/`prefix` 由 `post(family, handle, respond?)` 生成 |
| attachments | 局部 `register()` 4 条：3 条 `json()` + chunk 内联 raw handler | 一张 `Map<path, handler>` + `mountRoutes`；chunk 的 raw admission 原样保留 |
| speech | `for ([path, transcribe] of [['/speech', false], ['/speech/transcriptions', true]])` 内联 | `SURFACE.map(entry => [entry.path, carrier(entry.method === 'POST')])` + `mountRoutes` |

7 个 row 的 effect 标签与挂载顺序都与改前一致；改名/停用 row 的可见行为由既有套件复验。

## 实际命令与结果

```
$ npm run build
> node scripts/tsc.ts --fresh                        exit 0

$ node --test tests/mount-routes.test.mjs tests/route-inventory.test.mjs
ℹ tests 10  ℹ pass 10  ℹ fail 0

$ node --test tests/identity-http.test.mjs
ℹ tests 12  ℹ pass 12  ℹ fail 0

$ node --test tests/row-addressability.test.mjs
ℹ tests 7   ℹ pass 7   ℹ fail 0

$ node --test tests/speech.test.mjs
ℹ tests 2   ℹ pass 2   ℹ fail 0

$ node --test tests/attachments.test.mjs tests/speech.test.mjs
ℹ tests 8   ℹ pass 8   ℹ fail 0

$ node --test tests/remote-chat.test.mjs tests/chat-read-window.test.mjs tests/chat-page-cut.test.mjs \
    tests/chat-stream-backpressure.test.mjs tests/chat-multi-observer.test.mjs \
    tests/chat-cold-boundary.test.mjs tests/chat-runtime.test.mjs tests/jobs.test.mjs
ℹ tests 35  ℹ pass 35  ℹ fail 0

$ node --test tests/owned-sessions.test.mjs tests/session-title.test.mjs tests/session-rename.test.mjs \
    tests/session-rename-backfill.test.mjs tests/session-archive.test.mjs \
    tests/session-archive-store.test.mjs tests/memory-impression.test.mjs
ℹ tests 48  ℹ pass 48  ℹ fail 0

$ node --test tests/gateway.test.mjs tests/gateway-service.test.mjs \
    tests/gateway-compaction-settings.test.mjs tests/gateway-maintenance-settings.test.mjs
ℹ tests 24  ℹ pass 24  ℹ fail 0

# 源码定稿（最后一次只改注释）后的复跑：
$ node --test tests/identity-http.test.mjs tests/row-addressability.test.mjs tests/speech.test.mjs
ℹ tests 21  ℹ pass 21  ℹ fail 0
```

## 与 #272 验收的关系

- `tests/route-inventory.test.mjs` 仍是 38 条、只读、矩阵与四张可导出的 handler 表对账；`SURFACE` 的字段没有变。
- `tests/identity-http.test.mjs` 的 38 条表驱动栅栏全绿：38 条地址都从各自 row 的 `SURFACE` 派生，
  任一地址没挂载会是 404 而不是该 row 的 `<prefix>/forbidden-authority`。
- `tests/mount-routes.test.mjs` 用 fake carrier 直接调用 `mountRoutes`：断言 `webServer.register`
  被逐条调用、每条一个 effect、disposer 只注销自己那条；重复 path、缺 handler、表外 handler 都在
  任何注册发生前抛错。该文件只测 seam 本身，真实 row 的接入由 boot 套件证明：apply 里
  `mountRoutes` 的预检会让任何一张漂移的 handler 表在 boot 期失败，identity-http /
  row-addressability 的启动即覆盖 7 个 row 的挂载调用。
- `tests/row-addressability.test.mjs` 全绿：禁用 row 后地址仍是载体裸 404，没有 placeholder/fallback。

## 没有覆盖的

- **运行时仍不能禁止一条手写的 `ctx.webServer.register`。** `mountRoutes` 是 7 个 row 的唯一注册调用，
  它让「表」与「挂载」在 row 内双向对账（多一条、少一条都在 load 期失败），但载体服务本身对任何
  row 开放。若以后有人绕过 `mountRoutes` 直接注册，测试发现不了；这属于评审事项，#277 没有把
  `webServer` 收窄成只能经 seam 访问（那会改 dsh 载体或引入 central mounter，票面禁止）。
- **未执行**：全量 `npm test`、`npm run combo:verify`、Android 门禁、真实 ASR 与真机。speech 的行为
  证据来自替身 ASR provider；真实云服务与设备验收留给集成收口。
- 未改任何 wire 形状、错误码、错误文案、admission 顺序与 auth/ownership；`backend/*/README.md`
  中除 http 外的行为文档未动。

## 与 #275 的合并风险

#275（facade appendOnce）改 chat runtime 的发送入口（`runtime-facade.ts` / runtime 侧），本票只改
chat 的**注册形状**（`index.ts` 的 `register` 列表 → handler 表）。两票在 `backend/chat/src/index.ts`
上相邻，但本票不碰 facade 的发送语义；合并时预期只有 index.ts 的 import 与 apply 尾部冲突，
按「保留 #275 的 runtime 调用 + 本票的 `mountRoutes`」重排即可。
