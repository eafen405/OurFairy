# 209-ts-chat — 票 #209（T4 chat 迁 .ts）证据

分支 `ticket/209-ts-chat`，基线 `integration/spec-205` @ `fc782e5104`。dsh 检出
`/home/eafen405/projects/deepseek-harness` @ `d1b6099ae716`（与 `combo.json` 锁定一致，已构建，本票未重建）。
Node v24.18.0，编译用 dsh 自带的 TypeScript 6.0.3，`zod` 4.4.3（链接农场里的那一份）。

`tdd` skill 在本会话不可用（子会话没有 `Skill` 工具），按同样的 red→green 纪律手工执行：先让
「测试已改指 `dist`、产物尚未生成」的状态红，再让它绿，红绿都记在下面。

## 改了什么

### 包的源码（`.mjs` → `.ts`，包内原子）

| 文件 | 行数（迁移前） | 说明 |
| --- | --- | --- |
| `backend/chat/src/index.ts` | 55 | 9 条产品路由 + SSE 观察路由；`register` 的 `respond` 改条件展开 |
| `backend/chat/src/jobs.ts` | 51 | `/chat/jobs/output` 与 `/chat/jobs/stop` |
| `backend/chat/src/persona.ts` | 2 | 部署角色常量，一字未改 |
| `backend/chat/src/queues.ts` | 33 | 会话/投递两条有序队列 |
| `backend/chat/src/runtime-facade.ts` | 29 | 投递行能看到的窄运行时面 |
| `backend/chat/src/runtime.ts` | 404 | live session、事件窗口、投影发布 |
| `backend/chat/src/service.ts` | 119 | 9 个远程 chat 操作 |
| `backend/chat/src/spill-read.ts` | 51 | 本会话 spill 目录的只读授权 |
| `backend/chat/src/units.ts` | 574 | 两个投影单元（transcript / work） |
| `backend/chat/test-support/fail-outlets.ts` | 18 | 测试专用行（见下「test-support 决定」） |
| `backend/chat/test-support/frame-gap.ts` | 33 | 测试专用行 |
| `backend/chat/test-support/lost-event.ts` | 31 | 测试专用行 |

12 个 `.mjs` 源文件**已删**，不留 shim、不留兼容层。相对 import 一律写 `.js` 说明符
（`./units.js`、`./runtime.js`、`./queues.js`、`./jobs.js`）：Node 的类型剥离只删类型、不改写说明符，
编译产物的路径才对得上。

### 清单与工程文件

- `backend/chat/package.json`：`main` → `./dist/index.js`，`types` → `./dist/index.d.ts`；
  `exports` 的 `"."` 写成 `{ "types": …, "default": … }`（条件按声明顺序匹配，`types` 在前）；
  `"./locale/*.json"` 保持纯字符串目标；`files` → `["dist/**/*.js", "dist/**/*.d.ts", "README.md", "locale/*.json"]`。
  `dependencies`（`zod`）与 `peerDependencies` **一字未改**。
- `backend/chat/tsconfig.json`：`rootDir: src`、`outDir: dist`、`tsBuildInfoFile: dist/.tsbuildinfo`、
  `include: ["src/**/*.ts"]`；`references` → `../http` + `../sessions` + `../attachments`。
- `backend/chat/tsconfig.test-support.json`：T2/T3 的 noEmit 叶子工程（见下「test-support 决定」）。
- 根 `tsconfig.json`：solution 增加 `./backend/chat`、`./backend/chat/tsconfig.test-support.json` 两个 reference。
- `backend/chat/README.md`：正文里指向自己的 7 处 `src/*.mjs` 改成 `src/*.ts`（指向
  `backend/sessions/src/events.mjs` 的那处一并改成 `.ts`）。测试与脚本的 `.mjs` 路径保持原样。

### 测试 import 与断言（同一提交内）

| 测试文件 | 改动 |
| --- | --- |
| `tests/chat-page-cut.test.mjs:19` | `../backend/chat/src/runtime.mjs` → `../backend/chat/dist/runtime.js` |
| `tests/chat-read-window.test.mjs:20,21` | → `../backend/chat/dist/units.js`、`../backend/chat/dist/runtime.js` |
| `tests/chat-runtime.test.mjs:11` | → `../backend/chat/dist/queues.js` |
| `tests/native-job-status.test.mjs:27,56` | → `../backend/chat/dist/units.js`、`../backend/chat/dist/jobs.js` |
| `tests/native-job-stop-outcome.test.mjs:28` | → `../backend/chat/dist/jobs.js` |
| `tests/projection-units.test.mjs:26` | → `../backend/chat/dist/units.js` |
| `tests/projection-units-real.test.mjs:28` | → `../backend/chat/dist/units.js` |
| `tests/projection-fold.test.mjs:21` | → `../backend/chat/dist/units.js`（票面清单漏了这一处，它是 chat 源码的 import） |
| `tests/precommit.test.mjs:52,132` | 夹具路径 `'backend/chat/src/units.mjs'` → `'backend/chat/dist/units.js'` |
| `tests/reconnect.test.mjs:347,401` | 夹具路径 `frame-gap.mjs` / `lost-event.mjs` → `.ts` |
| `tests/file-delivery.test.mjs:252` | 夹具路径 `fail-outlets.mjs` → `fail-outlets.ts` |
| `tests/text-delivery.test.mjs:217,237` | 夹具路径 `fail-outlets.mjs` → `fail-outlets.ts` |

`tests/precommit.test.mjs` 的那两处是**选择器的夹具路径**，不是 import：选择器按
`^backend/([^/]+)/` 取包名（`backend/chat/`）加包名（`@ourfairy/dsh-chat`）做子串匹配，
`backend/chat/dist/units.js` 命中的是同一条 needle，选出的测试集与迁移前一致（见下「实际命令与结果」
里 `precommit.mjs --print` 的 13 个文件）。

**没有改任何一条行为断言。**

### 文档链接

`tests/docs.test.mjs` 断言仓库里每个 Markdown 相对链接都可达。源码改名后有 8 条链接指向不存在的文件：
`docs/decisions/native-capability-dependencies.md` 5 条（`spill-read` / `runtime` / `jobs` / `index` / `units`）、
`docs/decisions/upstream-compatibility-calibration.md` 3 条（`runtime` / `index` / `units`）。这 8 条改成
新的 `.ts` 路径，正文未改。指向 delivery / gateway / groups / search / speech 的 `.mjs` 链接（T5 的包）保持原样。

## 类型口径

档位照 `tsconfig.base.json`：`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` +
`noImplicitOverride` + `noUnusedLocals` + `noUnusedParameters`（#201 的决议）。

- 没有 `@ts-nocheck`，没有 `@ts-ignore`，没有 `@ts-expect-error`，导出的签名里没有 `any`。
- **投影单元的类型**：`SessionProjectionStateMap` 里新增 `ourfairyTranscript` 与 `ourfairyWork`
  两个 host-only 键（`declare module '@deepseek-ai/dsh-session-projection/types'`），状态类型由
  zod schema 推导（`z.infer<typeof …Schema>`），因此 `stateSchema` 与 `apply` 的状态类型**同源**。
- **产品的消息源扩展**：原生 `MessageSource` 只有 `kind`；产品自己往同一个 JSON source 对象里写
  `rpcId` 与 `attachments`。本包用**本地视图类型** `ProductMessage` 读它们（`productMessage(message)`
  返回的就是同一个消息对象），**没有**去 `declare module '@deepseek-ai/dsh-llm'` 改 `MessageSourceMap`——
  那会与 T5 的投递行抢同一个权威。
- **附件类型**：`AttachmentInput` 由 `Context['ourfairyAttachments']['inputs']` 推导，附件行仍是唯一权威。
- dsh 的上下文接缝用 `import type {} from '@deepseek-ai/dsh-…'` 加载其 `Context` 增强：
  `dsh-agent`（`ctx.agents` 与 `agent/inbox/spliced` 事件）、`dsh-agent-default-model`（`ctx.agentDefaultModel`）、
  `dsh-llm`（`ctx.llm`）、`dsh-session-persistence`（`ctx.sessionPersistence`）、`dsh-session-projection`
  （`ctx.sessionProjections`）、`dsh-tool-jobs`（`jobs/lifecycle` / `jobs/report` 事件与 `tool-jobs` 消息源）、
  `dsh-host-webserver`（`ctx.webServer`）、`dsh-client-connection`（`ctx.connection`）、
  `dsh-spill`（`ctx.spillStore`）、`@ourfairy/dsh-sessions`（`ctx.ourfairySessions`）、
  `@ourfairy/dsh-spaces`（`ctx.ourfairySpaces`）、`@ourfairy/dsh-attachments`（`ctx.ourfairyAttachments`）。
  这些 import 是纯类型的，编译产物里没有新的运行期依赖。
- 产品自己的服务在包里声明上下文增强：`service.ts` 声明 `ctx.ourfairyChat`（`RemoteChat`），
  `runtime-facade.ts` 声明 `ctx.ourfairyChatRuntime`（`ChatRuntimeFacade`）。两个增强都从包根
  `export type` 出去（`index.ts`），别的行 `import type {} from '@ourfairy/dsh-chat'` 就能拿到。
- 动态形状一律用真守卫或真收窄收窄，不用断言加检查：
  - `Number.isSafeInteger` 写成类型守卫 `isSafeInteger`（检查本身没变，只是让通过检查的值能被当数字用），
    出现在 `service.ts` 的 `maxEventsOf` / `page` 与 `jobs.ts` 的 `from`。
  - `Number.isSafeInteger` 之外没有新增任何运行期检查。

### 保留的 `as`（全部是「品牌 / 边界」上的断言，每处都写了理由，运行期不多一道检查）

- `backend/chat/src/runtime.ts`
  - `sessionId as SessionId`（`requestedSessionId`，两处调用点）：请求体里的 session id 是未受信的
    `unknown`；owned-session 服务是那个「它必须是字符串」的权威，运行时随后用**同一个字符串**做键。
  - `this.agent as Agent`（`LiveSession` 的三个 getter 与 `followup` / `stop`）：`agent` 字段迁移前就是
    `null` 起步，getter 在 agent 缺席时读 `null.session` 抛的仍是同一个 `TypeError`。
  - `selection.current as ModelSelection`：共用选择由运行时在 agent 起来之前设好，之后也只赋另一个选择。
  - `error as { message?: string } | null | undefined`（`agent/error`）与 `error as { message?: string }`
    （`agent/status` 的 reject）：被抛值的形状未知。运行期与迁移前**逐字相同**——被抛值是 `null` /
    `undefined` 时 `agent/error` 走 `String(error)`，`agent/status` 读 `.message` 得 `undefined`。
  - `error as Error`（`publish()` 的 catch）：观察者拿到的就是被捕获的那个值。
  - `state.route as { provider: string; model: string }`：过滤器已经去掉了 `null` 的 route。
  - `window as SeededWindow`（`#windowOf` 的两处返回）：种子解析完成时日志前缀已在位。
- `backend/chat/src/service.ts`
  - `(found as ReceiptMatch).receipt`：follow-up 的 splice 已提交，receipt 必在单元状态里。
- `backend/chat/src/jobs.ts`
  - `result as keyof typeof STOP_OUTCOME`：`Object.hasOwn` 是「这张表认得这个结果」的权威。
  - `event.job.owner as SessionId`：无主的 job 没有 owner，live 表里也没有它的条目。
  - `(taskId as string)`（两处）：任务是按 id 找到的，所以请求里的 `taskId` 就是那个字符串。
- `backend/chat/src/units.ts`
  - `status as keyof typeof TASK_STATUS`：`Object.hasOwn` 是「这张表认得这个状态」的权威。
  - `view.source.rpcId as string`：上面的过滤器只留 `rpcId` 为真的消息，所以它是非空字符串。
  - `rows[existing] as TranscriptRow` / `rows[index] as TranscriptRow` / `state.rows[move.index] as TranscriptRow`
    / `state.rows[index] as TranscriptRow`：下标来自 `state.index` / `attemptsByTurn` / `moves`，
    只记着确实存在的行。
  - `row.transitions[offset] as …` / `state.moves[offset] as …`：循环在自己的长度内走，条目必在。
  - `state.consumed[report.messageId as string]`：没有 message id 的 report 读的是 `undefined` 键，
    而 consumed 表里没有这样的行。
  - `state.rows[taskId] as JobRow`：展开一个缺席的行仍是 `{}`，与迁移前一致。
  - `(event.data as { interrupted?: true }).interrupted`：`interrupted` 是 assistant 事件自己的字段，
    投递来的消息没有这个字段，读出来就是「没被打断」。
- `backend/chat/src/spill-read.ts`
  - `ctx.get('spillStore') as { readonly root?: unknown } | undefined`：抽象的 `SpillStore` 上没有
    `root`，那是挂载的本地 store 才有的字段。
- `backend/chat/src/index.ts`
  - `result as ChatObserver`：传输信封把路由结果标成 `unknown`，这里收窄回观察者。
- `backend/chat/test-support/lost-event.ts`
  - `events.at(-2) as SessionEvent` / `events.at(-1) as SessionEvent`：上面的守卫保证这份表至少三个事件，
    两端都在。

## 行为面：迁移中没有引入新的运行期检查

逐条核对过的地方（迁移前 → 迁移后 → 判定）：

| 位置 | 迁移前 | 迁移后 | 判定 |
| --- | --- | --- | --- |
| `index.ts` `postHandler({...})` | `respond`（可能是 `undefined`）直接传 | `...respond !== undefined ? { respond } : {}` | 等价：`postHandler` 的默认形参对 `undefined` 与「属性缺席」同样生效 |
| `index.ts` 观察路由的 responder | `(response, subscribe) => {...}` | `(response, result) => { const subscribe = result; ... }` | 等价：`result` 就是 `handle` 返回的观察者 |
| `service.ts` / `jobs.ts` 整数守卫 | `!Number.isSafeInteger(x)` | `!isSafeInteger(x)` | 等价：守卫就是 `Number.isSafeInteger(value)`，同一个调用、同一个判定 |
| `runtime.ts` `open()` | `this.#live.get(sessionId)` | `const key = sessionId` 后 `this.#live.get(key)` | 等价：同一个值 |
| `runtime.ts` `agent/error` | `error?.message ?? String(error)` | `(error as { message?: string } \| null \| undefined)?.message ?? String(error)` | 等价：断言被擦除；被抛值是 `null`/`undefined` 仍走 `String(error)`，被抛值是字符串仍没有 `.message` |
| `runtime.ts` `agent/status` 的 reject | `error.message` | `(error as { message?: string }).message` | 等价：断言被擦除；非 Error 的 reject 仍得 `undefined` |
| `runtime.ts` `publish()` 的 catch | `observer.listener(undefined, error)` | `observer.listener(undefined, error as Error)` | 等价：断言被擦除；观察者拿到的就是被捕获的值 |
| `runtime.ts` `LiveSession` getter | `this.agent.session` | `(this.agent as Agent).session` | 等价：断言被擦除；agent 缺席时抛的仍是同一个 `TypeError` |
| `runtime.ts` `session/event` 监听 | `(session, event) =>` | `(_session, event) =>` | 等价：`session` 从未被读过；下划线是仓库 `noUnusedParameters` 的既有写法 |
| `runtime.ts` `selection.current` | `selection.current.provider` | `selection.current as ModelSelection` | 等价：共用选择在 agent 起来之前设好，之后只赋另一个选择 |
| `runtime.ts` `#windowOf` | 种子后的窗口 | `window as SeededWindow` | 等价：种子解析完成时日志前缀已在位 |
| `runtime.ts` `activeReplies()` | `...state.route` | `...state.route as { provider: string; model: string }` | 等价：断言被擦除；`null` 的 route 已被过滤器去掉 |
| `service.ts` requestId | `requestIdOf(requestId)`（裸语句）后用 `requestId` | `const request = requestIdOf(requestId)` 后用 `request` | 等价：`requestIdOf` 返回的就是它验过的那个字符串；校验的**时机与顺序**不变 |
| `service.ts` 上传 id | `uploadIds = uploadIdsOf(uploadIds)` | `const admitted = uploadIdsOf(uploadIds)` | 等价：同一个数组 |
| `service.ts` 消息内容 | `createUserMessage({ content: [...], source: {...} })` 内联 | 两个 `const` 局部量，`createUserMessage({ content, source })` | 等价：同样的两个值，同样的构造顺序 |
| `service.ts` `found.receipt` | `found.receipt` | `(found as ReceiptMatch).receipt` | 等价：follow-up 的 splice 已提交，receipt 必在单元状态里 |
| `jobs.ts` `taskId.slice(...)` | `taskId.slice(...)` | `(taskId as string).slice(...)` | 等价：任务按 id 找到，请求里的 `taskId` 就是那个字符串 |
| `jobs.ts` `runtime.live(...)` | `runtime.live(event.job.owner)` | `runtime.live(event.job.owner as SessionId)` | 等价：无主 job 的 owner 是 `undefined`，live 表里也没有它的条目 |
| `jobs.ts` `stopOutcomeOf` | `STOP_OUTCOME[result]` | `STOP_OUTCOME[result as keyof typeof STOP_OUTCOME]` | 等价：`Object.hasOwn` 是权威 |
| `units.ts` 消息源 | `message.source.rpcId` / `message.source.attachments` | `view.source.rpcId` / `view.source.attachments`（`view = productMessage(message)`） | 等价：`productMessage` 返回的就是同一个消息对象；视图类型只把产品自己的两个字段声明出来 |
| `units.ts` inbox 过滤器 | `message.source?.kind === 'user' && message.source.rpcId` | `view.source?.kind === 'user' && view.source.rpcId` | 等价：同一个对象上的同一次属性读 |
| `units.ts` `row.transitions[offset]` | 读两次 | `const candidate = row.transitions[offset]` | 等价：两次读之间数组没有被改 |
| `units.ts` `begin()` | `begin(event.seq); activity.episode.episodeId` | `const episode = begin(event.seq); episode.episodeId` | 等价：`begin` 在 episode 为空时设好它并返回它 |
| `units.ts` `const data = event.data` | 顶上取一次别名 | 每处直接读 `event.data` | 等价：事件对象没有被改，属性每次读到同一个值。**这处是必需的**：TS 的别名收窄只认 `const` 变量上的**字面量**判别式，`event` 是形参，`data` 不会随 `event.type` 收窄 |
| `units.ts` `event.data.interrupted` | `event.data.interrupted` | `(event.data as { interrupted?: true }).interrupted` | 等价：断言被擦除；投递来的消息没有这个字段，读出来就是「没被打断」 |
| `units.ts` `state.rows[taskId]` | `...state.rows[taskId]` | `...state.rows[taskId] as JobRow` | 等价：断言被擦除；展开一个缺席的行仍是 `{}` |
| `units.ts` `state.consumed[report.messageId]` | 同左 | `state.consumed[report.messageId as string]` | 等价：没有 message id 的 report 读的是 `undefined` 键，consumed 表里没有这样的行 |
| `units.ts` `TASK_STATUS[status]` | 同左 | `TASK_STATUS[status as keyof typeof TASK_STATUS]` | 等价：`Object.hasOwn` 是权威 |
| `spill-read.ts` spill 根 | `ctx.get('spillStore')?.root` | `const store = ctx.get('spillStore')` 后 `store?.root` | 等价：store 只取一次，可选链不变 |

### 机械复查：运算符与字面量逐文件比对

可复跑脚本：[`parity-scan.mjs`](parity-scan.mjs)。

```
$ node work/implementation/evidence/209-ts-chat/parity-scan.mjs
```

脚本把迁移前的 `.mjs`（`git show fc782e5104:…`）与迁移后的 `.ts`、以及**运行期产物**
`backend/chat/dist/*.js` 都用钉住的 TypeScript 去掉注释与类型标注，然后：

1. 逐文件统计每个运算符（`?.`、`??`、`??=`、`||`、`&&`、`===`、`!==`、`==`、`!=`、`!`、
   `=>`、算术与位运算…）——字符串内容先遮住，所以字面量里的运算符不计入；
2. 逐文件统计每一个字符串与数字字面量（从 AST 读，不把长串里的短串数两次）；
3. 打印只有一侧有的行（`lines:` 是源码对源码，`runtime lines:` 是迁移前对 `dist/*.js`），
   好逐条判定。

逐行差异全部落在上面那张「行为面」的表里：除 import 说明符、`respond` 的条件展开、
`isSafeInteger` 守卫、几个 `const` 局部量、`productMessage` 视图、`const data` 别名的去留、
`begin()` 的返回值之外，**没有别的行差异**。

结果（`source` = 迁前 `.mjs` 对迁后 `.ts`；`runtime` = 迁前 `.mjs` 对 `dist/*.js`）：

| 文件 | 运算符差异 | 字面量差异 | 判定 |
| --- | --- | --- | --- |
| `src/index.ts` | `!== 0→1`、`? 0→1`、`: 24→25`、`= 8→9` | 只有 import 说明符 | `respond` 的条件展开（`exactOptionalPropertyTypes` 不接受把 `undefined` 传给可选属性），见上面那张表 |
| `src/jobs.ts` | `=> 5→6`、`= 12→13` | 只有 import 说明符 | `isSafeInteger` 类型守卫（一个箭头、一个绑定） |
| `src/persona.ts` | 无 | 无 | 一字未改 |
| `src/queues.ts` | 无 | 无 | 一字未改 |
| `src/runtime-facade.ts` | 无 | 无 | 一字未改 |
| `src/runtime.ts` | `= 92→93` | 只有 import 说明符 | `open()` 里 `const key = sessionId`（同一个值取成局部量） |
| `src/service.ts` | `=> 5→6`、`= 21→28` | 只有 import 说明符 | `isSafeInteger` 守卫（+1/+1）加 6 个 `const` 局部量，每个都装着迁移前那个内联表达式的同一个值 |
| `src/spill-read.ts` | `= 2→3` | 无 | `const store = ctx.get('spillStore')`（store 仍只取一次） |
| `src/units.ts` | `= 144→148` | 无 | 4 个 `const view = productMessage(message)`（+4）、1 个 `const candidate`（+1）、1 个 `const episode`（+1）、减去 2 个删掉的 `const data = event.data` 别名（−2） |
| `test-support/fail-outlets.ts` | 无 | 无 | 一字未改 |
| `test-support/frame-gap.ts` | 无 | 无 | 一字未改 |
| `test-support/lost-event.ts` | 无 | 无 | 一字未改 |

**字面量差异只有 import 说明符**（`./units.mjs` → `./units.js` 等）：没有任何一条错误码、错误文案、
路径或阈值改过。

**运算符差异里没有任何一处「迁移前有、迁移后没有」的 `?.` / `??` / `||` / `&&`**：
逐条数下来，迁后每一类都不少于迁前（`index.ts` 的 `!==`/`?` 是新增，`units.ts` 与 `service.ts`
的 `=` 是新增局部量，其余都是持平）。

### 表面变化（非行为）

- `LiveSession` 类从「模块私有」变成 `export`（`runtime.ts`）：它的类型要出现在 `SessionRuntime`
  的公开方法签名里，而 `declaration: true` 不允许公开签名引用未导出的名字。类本身的行为一字未改。
- `index.ts` 新增两条 `export type { RemoteChat }` / `export type { ChatRuntimeFacade }`：
  **纯类型**再导出，编译产物里没有新的运行期导出；它们的用处是让别的行
  `import type {} from '@ourfairy/dsh-chat'` 就能拿到 `ctx.ourfairyChat` 与 `ctx.ourfairyChatRuntime`
  这两个上下文增强。

## test-support 决定

`backend/chat/test-support/*.ts` 是**测试专用**的 dsh 插件行：它们由测试用绝对路径交给 loader，
不在包的 `files` 里，因此从不随包发布，也不进 profile。做法照 T2/T3：

- **类型检查**：单独的 noEmit 工程 `backend/chat/tsconfig.test-support.json`（`noEmit: true`、
  `allowImportingTsExtensions`、`erasableSyntaxOnly`），作为根 solution 的叶子 reference 参与 `tsc -b`；
  它的 buildinfo 落在 `backend/chat/dist/.tsbuildinfo.test-support`（已被 `/backend/*/dist/` 忽略，
  `npm run clean` 也会清掉）。noEmit 工程只做类型检查、不产出 JS，所以夹具不会进包的 `dist`。
- **测试怎么到达**：`tests/reconnect.test.mjs`、`tests/file-delivery.test.mjs`、
  `tests/text-delivery.test.mjs` 把夹具路径指向 `backend/chat/test-support/*.ts`，由 Node 的类型剥离
  直接执行。这条路线与 T6 计划里 `scripts/` 走 `.ts` 的做法一致；本票的三个夹具在真实 dsh loader
  下都跑通了（见「实际命令与结果」里 reconnect / file-delivery / text-delivery 的用例）。
- `lost-event.ts` 需要 `ctx.ourfairyChat`，所以它 `import type {} from '@ourfairy/dsh-chat'`——
  这也验证了包根的类型再导出够用。

## Red / green

**Red 1（包内原子）**——源码已迁成 `.ts`、`.mjs` 已删，测试已改指 `dist/*.js`，而 `dist` 尚未生成：

```
$ node --test tests/chat-read-window.test.mjs
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
  '.../backend/chat/dist/units.js' imported from .../tests/chat-read-window.test.mjs
✖ tests/chat-read-window.test.mjs
ℹ tests 1  ℹ pass 0  ℹ fail 1
```

（复现方式：`mv backend/chat/dist /tmp/chat-dist-backup` 后跑同一条命令，再把目录移回。）

**Green**——`npm run build` 之后同一条命令与整个相关测试集全绿（见下表）。

**Red 2（test-support 确实被检查）**——往夹具里塞一个类型错误，`tsc -b` 当场报出来：

```
$ node node_modules/typescript/bin/tsc -b tsconfig.json
backend/chat/test-support/lost-event.ts(44,11): error TS2322: Type 'SessionSeq' is not assignable to type 'string'.
backend/chat/test-support/lost-event.ts(44,11): error TS6133: 'wrong' is declared but its value is never read.
```

（该行随后还原；noEmit 工程确实在检查这个文件，不是空转。）

## 实际命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run clean` | `removed 6 build output directories` |
| `npm run build` | 干净树编译通过，无输出。产物：`backend/chat/dist/{index,jobs,persona,queues,runtime-facade,runtime,service,spill-read,units}.{js,d.ts}` |
| `node scripts/precommit.mjs --print` | 门禁的相关测试选择：**13 个文件**（chat-page-cut、chat-read-window、chat-runtime、file-delivery、native-job-status、native-job-stop-outcome、plugin-compatibility、precommit、projection-fold、projection-units-real、projection-units、reconnect、text-delivery） |
| `node --test`（那 13 个文件 + product-sources + bundle-packages + docs，共 16 个） | **94 tests / 94 pass / 0 fail** |
| `npm run backend:doctor` | `doctor: all checks passed`。`product packages` 里 chat 是 `dist/*.js` + `dist/*.d.ts` + `README.md` + `locale/en.json` + `package.json`，**没有** `backend/chat/src/*`，**没有** `backend/chat/test-support/*` |
| `OURFAIRY_PORT=0 npm run backend:probe` | `ourfairy-baseline-probe: ok (24 services live, 51 rows composed, mode boot)` |
| `npm run combo:verify` | `combo: combination verified`（ourfairy / dsh / android source 三行 ok） |
| `node work/implementation/evidence/209-ts-chat/parity-scan.mjs` | 12 个文件，运算符与字面量差异如上表；字面量差异只有 import 说明符 |
| `git check-ignore -v backend/chat/dist/.tsbuildinfo.test-support` | `.gitignore:11:/backend/*/dist/` |

逐文件的用例数：

| 测试文件 | 用例 | 通过 | 失败 |
| --- | --- | --- | --- |
| `tests/chat-page-cut.test.mjs` | 4 | 4 | 0 |
| `tests/chat-read-window.test.mjs` | 5 | 5 | 0 |
| `tests/chat-runtime.test.mjs` | 3 | 3 | 0 |
| `tests/file-delivery.test.mjs` | 8 | 8 | 0 |
| `tests/native-job-status.test.mjs` | 2 | 2 | 0 |
| `tests/native-job-stop-outcome.test.mjs` | 3 | 3 | 0 |
| `tests/plugin-compatibility.test.mjs` | 4 | 4 | 0 |
| `tests/precommit.test.mjs` | 11 | 11 | 0 |
| `tests/projection-fold.test.mjs` | 3 | 3 | 0 |
| `tests/projection-units-real.test.mjs` | 1 | 1 | 0 |
| `tests/projection-units.test.mjs` | 15 | 15 | 0 |
| `tests/reconnect.test.mjs` | 8 | 8 | 0 |
| `tests/text-delivery.test.mjs` | 6 | 6 | 0 |
| `tests/product-sources.test.mjs` | 9 | 9 | 0 |
| `tests/bundle-packages.test.mjs` | 11 | 11 | 0 |
| `tests/docs.test.mjs` | 1 | 1 | 0 |
| **合计** | **94** | **94** | **0** |

`backend:probe` 用了 `OURFAIRY_PORT=0`：本机 3080 端口被一个与本票无关的 `dsh web` 占着（与 T1–T3
记录的情况相同）。

## 没有跑的

- **没有主动跑全量 `npm test`**：票面「不跑全量」把全量留给 T6。本票主动跑的是上表列出的 16 个文件。
  提交时仓库自带的 pre-commit 钩子若因为包 manifest 属于权威路径而判成 `full` 模式替本票跑一次全量，
  那是**钩子**的行为，不构成本票的门禁。
- **没有触发 CI**：没有 push。
- **没有合入 `integration/spec-205`**：由 Lead 合。
- 没有改 `combo.json`、Android 客户端、dsh 检出；没有加根 `devDependencies`、lockfile 或第二份
  TypeScript。
- 没有迁 `delivery` / `gateway` / `groups` / `search` / `speech` / `probe`，也没有迁 `scripts/`。

## 未完成项与留给 T5 的提醒

- **本票没有留下同类差异**：T2/T3 评审拦下过的那几类（丢可选链、catch 换成 `instanceof`、
  真值判断换成 `!== undefined`），本票逐条比对过：迁前有 `?.` / `??` / `||` / `&&` 的地方，
  迁后一处没少；`catch` 里的读法与迁移前**逐字相同**（`error?.message ?? String(error)`、
  `error.message`），没有换成 `instanceof` 分支；`.filter(page => page.image)` 这类真值判断
  本票没有对应的改写（chat 没有这样的过滤）。

- **`ourfairy/delivery` 事件的声明**：`backend/chat/test-support/fail-outlets.ts` 在**测试工程**里
  声明了 `Events['ourfairy/delivery']`（载荷 `{ messageId: string; acceptedSeq: number }`），因为
  投递行现在是 `.mjs`，还没有自己的类型声明。T5 迁投递行时，**投递行自己声明这个事件**，
  形状必须与上面一致；两处不在同一个 TS program 里（test-support 是独立的 noEmit 工程），
  所以不会互相合并，但形状要一样。

- **`ctx.ourfairyChat` 与 `ctx.ourfairyChatRuntime`**：这两个上下文增强由 chat 声明、从包根
  `export type` 出去。T5 的投递行要读 `ctx.ourfairyChatRuntime` 时，
  `import type {} from '@ourfairy/dsh-chat'` 即可，不必再声明一遍。

- **产品的消息源扩展（`source.rpcId` / `source.attachments`）目前只在 chat 的本地视图类型
  `ProductMessage` 里**。投递行写投递来的消息时也要往 source 上挂 `attachments`；**那处扩展应当
  只有一个权威**——要么把 `MessageSourceMap` 的扩展声明收敛到一处，要么两边都用同一个视图类型。
  本票没有替 T5 做这个决定。

- **`AttachmentInput` 的形状由附件行说了算**：chat 用
  `Awaited<ReturnType<Context['ourfairyAttachments']['inputs']>>[number]` 推导它，没有另写一份。

- **`ctx.get('spillStore')` 只能动态读**：抽象的 `SpillStore` 上没有 `root` 字段，
  `root` 是挂载的本地 store 才有的。chat 在读取处收窄一次；别的行若也要 spill 根，同样处理。

- **`exactOptionalPropertyTypes` 下可选的 `respond` 不能直接传 `undefined`**：本包用
  `...(respond !== undefined ? { respond } : {})` 展开（与 T3 的 attachments 同一形状）；
  `postHandler` 的默认形参对两种写法同样生效。

- **`const data = event.data` 这个别名在 TS 里不会随 `event.type` 收窄**：别名收窄只认 `const` 变量上的
  **字面量**判别式，`event` 是形参。所以本包的折叠里每一处都直接读 `event.data`。
  T5 迁投递行（也要读会话事件）时照这个写法。

- **`isAppendSurfaceEvent(event)` 会把事件收窄到 surface 事件并集**：
  `assistant/message` 有 `interrupted` 字段，`delivery/message` 没有——读它要过一次窄断言。

- **`Number.isSafeInteger` 对 `unknown` 不收窄**：请求体里的值是 `unknown`，
  需要类型守卫 `isSafeInteger`（T3 的既有形状）才能在比较前把它当数字用。

- **探针若给 chat 加，落在 `dist/`**：`tests/product-sources.test.mjs` 的「新增一个已发布文件必须进哈希」
  那条断言按发布集算哈希，chat 的发布集现在是 `dist/`。
