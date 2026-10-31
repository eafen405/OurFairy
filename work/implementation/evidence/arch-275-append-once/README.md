# #275 `ourfairyChatRuntime.appendOnce`：会话写入协议收回 chat

日期：2026-10-31。票面：[#275](https://github.com/eafen405/OurFairy/issues/275)。
分支 `ticket/275-append-once`，worktree `.worktrees/275-append-once`，基线 `181943bafa`（main）。

`delivery.settle` 原先在 delivery 里重建了 chat 冷写协议的前半段：判断 live、开 write handle、
`read` 存储前缀、`sessions.prepare` 的四个参数、`session/end-seed` 的偏移、`flush`/`close` 顺序、
`structuredClone(header)` 和 live-preferred 查重都在 delivery 里。本票把它们收进
`ourfairyChatRuntime.appendOnce`，delivery 的 `settle` 变成一次调用。

## `appendOnce` 的 interface

```ts
appendOnce<E extends SessionEvent>(
  sessionId: SessionId,
  match: (events: readonly SessionEvent[]) => E | undefined,
  build: (session: Session) => E,
): Promise<E>
```

- `match`：在一条日志前缀上找到调用方自己的事件；命中即返回既有事件，不再 `build`。
- `build`：在一个 Session 上追加事件并返回它；只有 `match` 未命中时调用。
- 解析即 durable：resolve 时事件已过 `session.flush` / 冷 handle `flush`。

实现见 [`backend/chat/src/runtime.ts`](../../../../backend/chat/src/runtime.ts)（`SessionRuntime.appendOnce`），
delivery 的调用见 [`backend/delivery/src/index.ts`](../../../../backend/delivery/src/index.ts) 的 `settle`。

## 不变量

1. **整个操作在目标会话的 session queue 内**：live/cold 判定、`open('write')`、append、flush 都在
   `runSession(sessionId, …)` 里，所以不会与 `agents.resume` 抢 `claimWrite`，也不会和另一条写并发。
   调用方不能已经持有同一把 session queue（队列是 promise tail，非可重入）。
2. **live 查重读 live log**：走 `runtime.events`（`sessionQuery.observeSession`，live-preferred），
   不是持久化读。live append 后 flush 失败时事件已在本进程 live Session 里；重试必须命中它，
   否则会追加第二条。命中后仍然执行 `barrier`，因此重试负责把上次未落盘的事件变得 durable。
3. **cold 分支**：在 queue 内 `sessionPersistence.open(id, 'write')` → `handle.read()` →
   `match(read.events)`；未命中才 `sessions.prepare(id, { seed, meta: structuredClone(handle.header),
   inheritedEventCount, eventState })` → `build(session)` → `handle.append(session.snapshotEvents(read.events.length))`
   → `handle.flush()`，`finally` 里 `close()`。
4. **offset 是存储前缀长度**：`prepare` 的恢复构造器会追加 `session/end-seed`，所以落盘后缀是
   `[end-seed, 新事件]`，从 `read.events.length` 开始截取，而不是从新事件的 seq 开始。
5. **cold 的 Session 绝不 `enter`/`announce`**：它只是一次性的恢复对象；进入 store 会让下一次
   chat resume 命中 `already exists`，直到进程重启。
6. **`meta` 必须 clone**：`prepare` 会就地 `deepFreeze` header；直接把 handle 的 header 交出去会让
   persistence handle 的不可变元数据被冻结（原生 resume 也因此 clone）。
7. **至多一次**：`match` 命中直接返回既有事件；未命中才 `build`。同一次投递的重复调用、崩溃后
   重放、flush 失败后的重试都落在同一条事件身份上。
8. **delivery 仍然拥有业务事实**：`deliveries.complete` 在 `appendOnce` resolve 之后；
   `deliveries` 行仍是投递事实的权威，通知出口、boot 恢复、`runDelivery` 队列隔离留在 delivery。

## appendOnce 藏住什么 / 不藏什么

| 藏住 | 不藏（仍由调用方决定） |
| --- | --- |
| live/cold 分支、session queue、live 判定时机 | 写哪种事件、事件 payload（delivery 的 `delivery/message` 形状） |
| 冷 write handle 的 `open`/`read`/`append`/`flush`/`close` 生命周期 | 事件的查重身份（`match` 用 `deliveryId` 判断） |
| `sessions.prepare` 的 `seed`/`meta`/`inheritedEventCount`/`eventState` | 业务行 `deliveries.complete` 的时机与内容 |
| `session/end-seed` 与 `snapshotEvents` 的存储前缀偏移 | boot 重放（`deliveries.pending()`）、`ourfairy/delivery` 通知、`runDelivery` 隔离 |
| header clone、flush 顺序、resolve 即 durable | |

## delivery `settle` 前后对照

**之前**（`backend/delivery/src/index.ts`）：`settle` 36 行，delivery 直接依赖
`sessions`、`sessionPersistence` 两个服务，自己判断 live 并维护冷 handle：

```ts
const result = await runtime.runSession(row.sessionId as SessionId, async () => {
  let event: DeliveryEvent | undefined
  const state = runtime.live(row.sessionId as SessionId)
  if (state) {
    event = find((await runtime.events(row.sessionId as SessionId)).events, row.deliveryId) ?? append(state.session, row)
    await runtime.barrier(state)
  } else {
    const handle = await ctx.sessionPersistence.open(row.sessionId as SessionId, 'write')
    try {
      const read = await handle.read()
      event = find(read.events, row.deliveryId)
      if (!event) {
        const session = ctx.sessions.prepare(row.sessionId as SessionId, { seed: read.events as SessionEvent[],
          meta: structuredClone(handle.header), inheritedEventCount: handle.inheritedEventCount, eventState: read.eventState })
        event = append(session, row)
        await handle.append(session.snapshotEvents(read.events.length as SessionLogOffset))
      }
      await handle.flush()
    } finally { await handle.close() }
  }
  const result = { messageId: event.data.message.id, acceptedSeq: event.seq }
  deliveries.complete(row.deliveryId, result)
  return { ...receipt(row), ...result }
})
```

**之后**：一次 `appendOnce` 调用，delivery 只提供事件形状与查重；`deliveries.complete` 仍在其后：

```ts
const event = await runtime.appendOnce(row.sessionId as SessionId,
  events => find(events, row.deliveryId),
  session => append(session, row))
const result = { messageId: event.data.message.id, acceptedSeq: event.seq }
deliveries.complete(row.deliveryId, result)
const settled = { ...receipt(row), ...result }
try { await ctx.parallel('ourfairy/delivery', settled) }
catch (error) { ctx.logger('ourfairy-delivery').warn(...) }
return settled
```

| 项 | 之前 | 之后 |
| --- | --- | --- |
| `inject` | `['identity','ourfairySessions','ourfairyAttachments','ourfairyChatRuntime','sessions','sessionPersistence','tools','agents']` | `['identity','ourfairySessions','ourfairyAttachments','ourfairyChatRuntime','tools','agents']` |
| `settle` 内的写协议 | live/cold 分支 + handle 生命周期 + prepare 四参数 + offset + clone | `runtime.appendOnce` 一次调用 |
| `ourfairyChatRuntime` 方法 | 5（`live` / `events` / `barrier` / `runSession` / `runDelivery`） | 2（`appendOnce` / `runDelivery`） |

## facade 方法数：5 → 2

`appendOnce` 把 session queue 收进 runtime 后，delivery 不再需要 `runSession`；live/cold 分支收进
runtime 后，`live` / `events` / `barrier` 在 facade 上没有调用方。删除前用
`grep -rn "ctx.ourfairyChatRuntime\|ourfairyChatRuntime\." backend tests` 核实：唯一的消费者是
`backend/delivery/src/index.ts`，且只再调用 `runDelivery`。`SessionRuntime` 自己的 `runSession` /
`live` / `events` / `barrier` 仍有 chat 的 service、jobs 与 unit suites 直接调用，保留原样。

## fail-outlets 两条用例不是空转

`backend/chat/test-support/fail-outlets.ts` 只在 `session/event` 里看到 `delivery/message` 时才武装，
并在下一次 `session/flush` 上抛错。live append 仍然写 live Session（`build(state.session)` →
`Session.append`），所以故障仍会被触发。为了避免「测试绿但故障没发生」的静默失效：

1. 在 `tests/text-delivery.test.mjs:224` 和 `tests/file-delivery.test.mjs:263` 两条用例里加了
   `assert.match(failed, /injected durability checkpoint failure/)`。如果 live 写入不再产生
   `session/event`，fixture 不会武装，投递会成功，这条断言就会失败——同时
   `assert.doesNotMatch(failed, /deliveryId/)` 也会失败。
2. 实测：临时在 fixture 的武装分支与抛错分支各写一行标记到
   `/tmp/275-fail-outlets-proof.log`（只用于取证，随后 `git checkout --` 还原，未入库），
   跑 `node --test tests/text-delivery.test.mjs tests/file-delivery.test.mjs`，14/14 通过，标记为：

```
ourfairy-user-3-primary armed by delivery/message
ourfairy-user-3-primary threw injected durability checkpoint failure
ourfairy-user-3-primary armed by delivery/message
ourfairy-user-3-primary threw injected durability checkpoint failure
```

两条用例各真正走到一次「武装 + 抛错」，不是空转。

## 新增「live 与 cold 都只写一次」用例

[`tests/chat-append-once.test.mjs`](../../../../tests/chat-append-once.test.mjs) 直接驱动
`SessionRuntime.appendOnce`，使用 pinned dsh 的真实 `Session`/`Session.fromRestore`（不是手写
Session 替身），两个用例：

- **live**：第一次 flush 注入失败 → `appendOnce` reject；第二次重试命中 live-preferred 读到的
  已提交事件，`build` 只调用 1 次，live 日志只有 1 条 `delivery/message`；断言 cold handle 从未打开。
  这正好固定「查重读 live 而不是持久化」。
- **cold**：连续调用两次 → 一次 `prepare`、一次 append 批次
  `['session/end-seed','delivery/message']`、第二次只 read/flush/close；断言没有 `enter`/`announce`，
  且 `prepare` 收到的是 header 的 clone（fixture 在 `prepare` 里就地冻结传入 header，若不是 clone，
  handle.header 会被冻住，断言失败）。

既有黑盒网也覆盖了两条路径，本票未改它们：
`tests/text-delivery.test.mjs` 的 flush-failure retry（live）、
`tests/file-delivery.test.mjs` 的同名用例（live + 文件）、
`tests/delivery-cold-concurrency.test.mjs` 的 C/D（两个发送者冷写、冷写失败后同身份重试）。

## 实际命令与统计行

```
$ npm run build
（无输出）exit 0

$ node --test tests/chat-append-once.test.mjs
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ duration_ms 168.266038

$ node --test tests/delivery-cold-concurrency.test.mjs tests/text-delivery.test.mjs \
    tests/file-delivery.test.mjs tests/delivery-row.test.mjs
ℹ tests 19
ℹ pass 19
ℹ fail 0
ℹ duration_ms 16384.498276

$ node --test tests/remote-chat.test.mjs tests/chat-read-window.test.mjs tests/chat-page-cut.test.mjs \
    tests/chat-stream-backpressure.test.mjs tests/chat-multi-observer.test.mjs tests/chat-cold-boundary.test.mjs \
    tests/chat-runtime.test.mjs tests/chat-append-once.test.mjs tests/jobs.test.mjs
ℹ tests 37
ℹ pass 37
ℹ fail 0
ℹ duration_ms 27748.335317

$ node --test tests/row-addressability.test.mjs
ℹ tests 7
ℹ pass 7
ℹ fail 0
ℹ duration_ms 18757.621672

$ node --test tests/mount-routes.test.mjs
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ duration_ms 52.215816

# 取证用（临时标记 fixture，随后还原）：
$ node --test tests/text-delivery.test.mjs tests/file-delivery.test.mjs
ℹ tests 14
ℹ pass 14
ℹ fail 0
ℹ duration_ms 8987.561896
```

首次 boot 前用最终 `npm run build` 后的 product-source hash
`241a2f1e5e9d062a8c6062146d29374300522f01c0ab9f4665913c23a1183d4a` 预热了
`.ourfairy-template/241a2f1e…-11.28.5`；它是 gitignore 产物，不入库。

## 与 #277（mountRoutes）的关系

`backend/chat/src/index.ts` 未改：`SURFACE` 仍是挂载来源，`mountRoutes(ctx, { label: 'ourfairy-chat',
surface: SURFACE, handlers })` 不变，facade 仍在 `apply` 中 `mountRoutes` 之前构造。本票没有退回内联注册，
`tests/mount-routes.test.mjs` 5/5 通过。

## 没覆盖的 / 未执行

- **cold `handle.flush()` 失败仍没有用例**：现有 `delivery-cold-concurrency` 的 D 在
  `handle.append`（EACCES）处失败，目标会话已 materialize，`flush` 直接返回。要构造 append 成功后
  flush 失败需要未 materialize 的会话或可注入的 fault seam；本票没有为测试增加冷写 seam。
- **没有重跑 boot 恢复的独立用例**：pending 行重放、`ourfairy/delivery` 通知出口、`delivery-row`
  禁用行不恢复由既有套件覆盖（本票全绿），没有新增专门的恢复用例。
- **未跑全量 `npm test`、`npm run combo:verify`、Android 门禁**：按用户要求留给收口；未 push。
- **未做跨进程并发**：两个后端进程争同一 home 不是产品语义。
- 模型与网络均为替身；不涉及真机与真实云模型。
