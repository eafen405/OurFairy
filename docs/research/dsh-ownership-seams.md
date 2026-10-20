> 2026-10-20 状态：已被 #25、#27 取代。本文记录 2026-10-14 的判断，不描述当前实现。

# dsh 原生改动地图：会话归属与正式投递（#25 / #27）

基线：dsh fork 的上游提交见[研究基线](README.md)（分支 `product/ourfairy-v1`，工作区干净，逐条核实后未改动任何文件）。
产出票：#25（扩展会话归属与投递的正式记录格式）、#27（本人多会话与固定主会话）。
方法：只读源码实读 + 定向 vitest。每条结论附 `路径:行号`。
证据等级标记：**实读**＝本人在该检出上打开并引用了原文；**派查**＝只读子侦察实读后回报、未二次打开（本文均给出 `路径:行号`，实施前可就地复核）；**未验证**＝未确认。

> 与 `docs/research/v1-backend-readiness.md`（下称「既有研究」）的差异集中列在第 0 节。既有研究的方向结论仍然成立，但其 seam 清单的行号、一个关键类型描述、以及三处重大遗漏需要修正。

---

## 0. 与既有研究的差异（先读这一节）

| # | 既有研究的说法 | 实测结果 | 影响 |
| --- | --- | --- | --- |
| D1 | 「`create()` 的 meta 仅 `Pick<SessionHeader,'cwd'>`」 | **错**。`CreateSessionOptions.meta` 是内联 7 字段对象类型（`core/session/src/types.ts:151-159`：cwd/parentSession/createdAt/isSeeded/origin/delegationDepth/agentPreset）；`CreateAgentOptions.meta` 是另一个独立的 6 字段内联对象（`core/agent/src/index.ts:79-86`，有意排除 `createdAt`）。仓库内**不存在** `Pick<SessionHeader,'cwd'>`。 | 改 meta 时要同时改两处内联类型，不是一处 Pick。 |
| D2 | 「resume 在拿 write handle 后会补 interrupted-turn closers，再调用 setup」（[loop L687/L748/L844]） | 时序**正确**，行号漂移。实际：`open(id,'write')` `agent-loop/src/index.ts:878-883` → `handle.read` `:888` → `interruptedTurnClosers` `:891` → **`handle.append(closers)` `:892`** → `sessions.prepare` `:893-898` → `appendUnstoredSuffix` `:900` → `setupAndPublish` `:908-918`，其中 `setup?.()` 在 **`:811`**。`createAgent` 在 `:750`，`resume` 在 `:843`，`resumeWith` 在 `:852`。 | 归属核对点必须早于 **:892**；`setup`(:811) 不是守门位置。 |
| D3 | 「catalog 有静态当前与历史链」 | **重大遗漏**。历史链是 4 个独立包：`session-format-v0-to-v1` / `-v1-to-v2` / `-v2-to-v3` / `-v3-to-v4`，由 `session-format` 的引擎（`chain.ts`/`catalog.ts`）编译，装配在 `session-format-catalog/src/generated.ts`——**该文件是 `scripts/gen-session-format-catalog.ts` 生成的、已入库的生成代码**。 | 「只改类型」在这个仓库里必然失败；见 D4、D5。 |
| D4 | 「仅拓宽 TypeScript header 不会完成物理保存」 | **正确且更严重**。**当前 v4 物理 header 编解码器就是 released v2 编解码器把 `version` 改写回 4**：`session-format-v3-to-v4/src/codec.ts:13-16` `physicalV2()`、`:24-26` `decodeHeader`、`:41-44` `encodeHeader` 全部委托 `releasedV2SessionFormatCodec`。因此 v4 的 header 键准入实际由 `session-format-v1-to-v2` 的**冻结** v2 codec 决定。 | 新增 header 字段若去拓宽 v1-to-v2，会破坏「released v2 ＝ 精确 v2 schema」不变量；必须让 v4 自己拥有 header 编解码。 |
| D5 | 未提及 | **同版本短路**：`session-format/src/catalog.ts:131-138` 当 `storedVersion === chain.currentVersion` 直接返回 `CurrentSessionFormatRestore`，**不跑任何迁移边**（只有 `restoreCurrentHeader`：`assertReleasedV4Header` + `validateInstalledCurrentSessionHeader`）。仓库自述见 `core/session/src/types.ts:74-86`：「同版本 reader 保留早期表示；相邻迁移链在存储版本与当前版本相同时不运行」。 | 现有 v4 日志**永远无法被补写**成新必需字段。要「必需」只能升版本到 5；否则字段必须是可选＋在边界处显式拒绝。 |
| D6 | 未提及 | **重大遗漏**：仓库**已有投递概念**。`session-log-deepseek` 包（增量无损上传官方 DeepSeek API）已定义事件 `session-log-deepseek/delivery-accepted`＝`{ sessionId, sessionFormatVersion?, throughSeq }`（`session-log-deepseek/src/types.ts:78-89`），并在 v4 关系校验中被验证：`session-format-v3-to-v4/src/validation.ts:89-101`（要求 `throughSeq < event.seq`、非空 sessionId），`assertReleasedV4Relationships:116-120` 报错 `current-generation delivery marker names the wrong Session`。该包还有**第二套 header 线上表示**，键集不同：用 `seedLength` 代替 `isSeeded`（`session-log-deepseek/src/index.ts:67-79`、`src/types.ts:7-18`）。 | #25 的「正式投递记录」不是从零发明：已有 delivery 事件族与 `afterSeq/throughSeq` 增量窗口语义可复用，但必须决定是复用还是新开事件类型（见第 10 节）。 |
| D7 | 「既有日志 owner 缺失的处理要明确拒绝或有显式迁移证明」 | **需修正机制表述**。`validateSessionHeader`（`core/session/src/index.ts:92-134`）**只显式拒绝 `seedLength`（:98-100）**，未知键会被 `deepFreeze(record)`（:134）原样保留；而物理 JSONL 的键白名单（`format.ts:96-98` + `isHeaderLine:163`）会**拒绝**未知键。 | 「不猜用户 1」不能靠格式层自然获得：既要在写路径收紧校验，又要在产品边界显式拒绝缺归属的会话。 |
| D8 | `assertSessionHeadersCompatible` 不比较 owner | **正确**，且它也不比较 `agentPreset`/`version`/`origin`：`session-query/src/sources.ts:11-24` 只比 6 项（id/createdAt/cwd/parentSession/isSeeded/delegationDepth??0）。SQLite 侧 `sameHeader` 比 7 项（多 agentPreset）。 | 加 owner 时必须同时补 `sources.ts` 与 `sameHeader`，否则冷热/持久化一致性检查对归属视而不见。 |
| D9 | 「Loader import 因无安装依赖失败」 | **已过期**。依赖已装好；真实 Loader 组合测试有现成模板（`packages/session/session-stats/tests/loader-composition.spec.ts`，86 行），本条已可实测。 | 既有研究的「未验证」清单中这一项可以划掉。 |
| D10 | 研究索引行号 | 多数漂移 ±2~10 行，个别错位较大：`[D-session L767]` 实际 `commit` 在 `:876`（`flush` :1318 正确）；`[D-format L96/L142]` 精确（96/141-156）；`[D-storage L535]` 精确（live 路由）；`[persistence L322/L348]` 精确（create 320 / open 348）。 | 实施时以本文行号为准。 |

---

## 1. SessionHeader / CreateSessionOptions / CreateAgentOptions 与传递路径

| 位置 | 形状（实读） |
| --- | --- |
| `core/session/src/types.ts:89` | `export const SESSION_FORMAT_VERSION = 4` |
| `core/session/src/types.ts:94-131` | `interface SessionHeader { version: typeof SESSION_FORMAT_VERSION; id: SessionId; createdAt: number; cwd?: string; parentSession?: SessionId; isSeeded: boolean; origin?: 'subagent'; delegationDepth?: number; agentPreset?: string }`——**无 owner** |
| `core/session/src/types.ts:151-159` | `CreateSessionOptions.meta?: { cwd?; parentSession?; createdAt?; isSeeded?; origin?; delegationDepth?; agentPreset? }`（内联，非 Pick） |
| `core/session/src/types.ts:172-181` | `RestoredSessionOptions { seed; meta: SessionHeader; inheritedEventCount; eventState }` |
| `core/session/src/types.ts:184-186` | `PrepareSessionOptions = (CreateSessionOptions & {eventState?: undefined}) \| RestoredSessionOptions` |
| `core/agent/src/index.ts:63-119` | `CreateAgentOptions`，`meta?:` 在 `:79-86`（6 字段，注释明确镜像 CreateSessionOptions.meta 且排除 createdAt） |
| `core/agent/src/index.ts:125-144` | `ResumeAgentOptions { resumeSessionId; parentAgent?; agentOptions?; signal?; setup? }`——**无 meta**，resume 只能靠持久 header |
| `core/session/src/index.ts:92-134` | `validateSessionHeader`：拒绝 `seedLength`；逐字段校验；**未知键放行**；`:134` `return deepFreeze(record as unknown as SessionHeader)` |
| `core/session/src/index.ts:137-146` | `validateRestoredSessionHeader`（先查原型再委托） |
| `core/session/src/index.ts:148-156` | `snapshotSessionHeader`：无 store header 时默认 `{version,id,createdAt:Date.now(),isSeeded:false}` |
| `core/session/src/index.ts:1173-1183` | `prepare()` 显式逐字段构造 header（新字段不加进来就会被**静默丢弃**） |
| `core/session/src/index.ts:1379-1397` | `fork()` 的 meta 在 `:1391-1395` **只带 `cwd` + `parentSession` + `isSeeded`** → 归属不会传给 fork 子会话 |

传递路径（实读）：`CreateAgentOptions.meta` → `agentLoop.createAgent` `agent-loop/src/index.ts:751-755` → `sessions.prepare` → `prepare()` 的 header 字面量 → `Session.create` → `Session.fromRestore`/`validateSessionHeader`。resume 侧不走 meta，走 `persistence.open` 拿到的持久 header（`resumeWith:895` `meta: structuredClone(handle.header)`）。

**结论**：新增永久归属字段至少要同时改 6 处：`SessionHeader`、`CreateSessionOptions.meta`、`CreateAgentOptions.meta`、`prepare()` 的 header 字面量、`validateSessionHeader`（加显式校验）、`fork()`（决定是否继承）。只改接口不会生效。

---

## 2. create / prepare / resume 调用链与关键时序

`SessionStore`（`core/session/src/index.ts:1049`）：

- `create(id?, options?)` `:1110-1121` → `this.prepare(id, options)`，再在 `ctx.effect` 内 `yield this.enter(session); this.announce(session)`。
- `prepare(id?, options?)` `:1142-1185`：按 `options.eventState` 分派——`'detached'|'shared-frozen'` → `Session.fromRestore(...)`；`undefined` → 构造 header（`:1173-1183`）后 `Session.create(...)`。**两种路径都不经过任何归属校验**。
- `enter(session)` `:1209+`：重复 id 守门在 `:1214`（`session "${id}" already exists`）。
- `commit(event, entry)` `:876-897`：先 `this.surfaceManager.validateNext(event)`，再收集并调用 `session/event` 回调（observer 错误被包含，不撤销内存事件）。
- `flush(session)` `:1318-1335`：唯一持久化入口；`collectSessionCallbacks(ctx,[carrier,'session/flush',session])` + `Promise.allSettled`，抛首个失败，返回 `callbacks.length > 0`（**只证明有 listener 参与，不证明已落盘**）。

resume 关键时序（`agent-loop/src/index.ts:852-926`，实读原文顺序）：

1. `:878-883` `persistence.open(id, 'write', {signal})` —— 先拿写所有权（注释原文：「Taking write ownership FIRST excludes a concurrent resume of the same id」）。
2. `:888` `handle.read(0, undefined, {signal})` —— 冷读全量日志。
3. `:891` `const closers = interruptedTurnClosers(persisted)`。
4. **`:892` `if (closers.length > 0) await handle.append(closers)`** ← 第一处持久副作用。
5. `:893-898` `sessions.prepare(id, {seed:[...persisted,...closers], meta: structuredClone(handle.header), inheritedEventCount, eventState})`。
6. `:900` `appendUnstoredSuffix(...)` ← 第二处写入。
7. `:908-918` `setupAndPublish(...)` → `:811` 才 `setup?.()`。

另外 `persistence.open(id,'write')` 自身在 `:393` 会 `publishStoredMigration(...)`（发布迁移后的 generation），也是 setup 之前的持久副作用。

**结论（#27 硬要求）**：归属核对必须发生在 **`:892` 之前**（最迟在 `:888` 冷读后、`:891` 生成 closers 前后），不能依赖 `setup`。`list`/`read`/`subscribe`/`control` 各自入口同样要在返回内容前核对；`core/session/src/index.ts:1392` 的 `fork()` 也要单独决定归属继承，否则派生会话变成无归属。

---

## 3. 单 writer 租约与 live/cold 仲裁

| 概念 | 位置与语义（实读） |
| --- | --- |
| 进程内独占 | `session-persistence-jsonl/src/storage.ts:429-432` `claimWrite(id)`：已声明则抛 `SessionAlreadyOwnedError`；`:482-486` `adopt(handle)` 对写句柄执行 `writers.set(handle.id, handle)`（同时绑定 live 路由）；`:495-500` `release` 释放 |
| 内核租约 | `session-persistence-jsonl/src/lease.ts:70-116` `SessionWriteLease.acquire(dir,id)`：POSIX `open(path,'w')`+`tryLockExclusive(fd)`，`EAGAIN/EWOULDBLOCK` → `SessionAlreadyOwnedError`（:96）；加锁后校验 inode 仍指向该路径（:99-106）；win32 走命名信号量（:76-86）。`release()` `:124-134` 只关 fd，**不删 POSIX 锁文件**；无过期时间，进程死亡由内核释放 |
| write open | `session-persistence-jsonl/src/index.ts:348-424`：`claimWrite` `:383` → `findLog` `:386` → `acquireLease` `:388` → `requireStoredLog` `:389` → `publishStoredMigration` `:393` → 返回 `PrimedWriteHandle{cursor: stored.events.length, primed: stored, lease}` `:398-405`；失败路径 `:406-423` 释放租约与 claim |
| create | `:320-339`：`toHeaderLine` 前置校验 `:325`，`registerCreated` `:337`——**尚未加锁**；创建句柄在**首次物化写入前**才 `ensureLease()`（`storage.ts:352-354`）。未物化的会话无文件系统足迹 |
| append | `storage.ts:187-196`：先 `materializeAppendBatch(events)` 校验并深快照，再 `run('append')` → `persistContiguous`；`:319-343` 内含 `assertContiguous(id, batch, state.cursor)`、torn-tail 截断与 `recoveredTail` 重写、`persistBatch`、推进 cursor。**append 在 resolution 时即 durable** |
| flush | `storage.ts:203-212`：只读句柄抛 `SessionReadOnlyError`；已物化则直接返回（注释「appends are durable on resolution」）；否则 `ensureLease()` + `persistHeader` |
| close | `storage.ts:223-260`：幂等（`closing ??=`）；循环 `drainLive()` 直到 routed buffer 为空；等 `chain`；释放 lease；`releaseHandle`；多错聚合为 `AggregateError` |
| live 路由 | `storage.ts:534-566` `install(ctx)`：`:535` `ctx.on('session/event', (session,event) => writers.get(session.id)?.enqueueLive(event, ...))`；`:540` `ctx.on('session/flush', ...)` → `drainLive()`+`flush()`；`:548` `session/disposed` → `close()`；`:555` teardown 关闭所有句柄 |
| 批窗口 | `enqueueLive` `:274-281` 以 `LIVE_WRITE_BATCH_MAX_DELAY_MS` 定时；`drainLive` `:288-292` 单飞；`drainBuffered` `:294-316` splice 批次、失败按序回填 |
| 服务级 | `storage.ts:508-523` `flushAll()`：遍历 `writers`，跳过 `null`，`drainLive()`+`flush()`，忽略 `SessionHandleClosedError` |

**结论**：投递写入必须复用同一仲裁（live 走 `Session.append`+`sessions.flush`；cold 走同一会话的写仲裁），`sessions.flush` 返回 boolean 不能当「已保存」通知。单 writer 锁是底层拒绝保障，不能拿「冲突失败」当正常并发协议。

---

## 4. JSONL 格式、白名单、catalog 链与未知必读事件

### 4.1 物理 header 契约（实读，`session-persistence-jsonl/src/format.ts`）

```ts
:83-94   interface HeaderLine { type:'session'; version:number; id:SessionId; createdAt:number;
                               cwd?:string; parentSession?:SessionId; isSeeded:boolean;
                               origin?:'subagent'; delegationDepth:number; agentPreset?:string }
:96      const HEADER_REQUIRED_KEYS = ['type','version','id','createdAt','isSeeded','delegationDepth'] as const
:97      const HEADER_OPTIONAL_KEYS = ['cwd','parentSession','origin','agentPreset'] as const
:98      const HEADER_KEYS = new Set<string>([...HEADER_REQUIRED_KEYS, ...HEADER_OPTIONAL_KEYS])
:105-110 assertNoRetiredHeaderFields()  // 拒绝 sandboxMode / approvalPolicy
:119-134 toHeaderLine()  → sessionFormatCatalog.encodeCurrentHeader({...header, delegationDepth: ?? 0}, cut)
:141-156 fromHeaderLine()  // 显式逐字段映射（新字段不加进来就被丢弃）
:159-186 isHeaderLine()    // :163 `Object.keys(value).every(key => HEADER_KEYS.has(key))` ← 未知键判非法
:349-378 parseHeaderRecord()  // :364 `if (!isHeaderLine(parsed))`，:377 返回 fromHeaderLine(parsed).meta
```

**这是 (a) 的最高危点**：改类型却漏改 `HEADER_KEYS`/`isHeaderLine`/`fromHeaderLine`，本版本写出的日志会被**本版本自己的 reader 拒绝**——#25 的「往返 + 重启读取」验收必然失败。

同族还有另外三处键集拒绝（派查，`session-format-*` 包内）：`session-format-v3-to-v4/src/validation.ts:19-42` `assertReleasedV4Header`（`required = ['version','id','createdAt','isSeeded','delegationDepth']`，`allowed = Set([...required,'cwd','parentSession','origin','agentPreset'])`，`unexpected` 直接抛）；`session-format-v1-to-v2/src/validation.ts` `assertReleasedV2Keys`；`session-format-v0-to-v1/src/validation.ts:40-61`。

### 4.2 catalog：当前与历史链（实读 `generated.ts` + `current.ts` + `index.ts`）

- `session-format-catalog/src/generated.ts`（**已入库的生成代码**，头部注明 `GENERATED by scripts/gen-session-format-catalog.ts — do not edit by hand`）导出 `sessionFormatCatalogOptions`：`currentVersion: 4`、`codecs: [releasedV0…releasedV4]`、`currentEncoder: releasedV4SessionFormatCodec`、`migrations: [v0→v1, v1→v2, v2→v3, v3→v4]`、`restoreCurrent`（`restoreReleasedV4Artifact(..., KNOWN_SESSION_EVENT_TYPES)` + `validateInstalledCurrentSessionArtifact`）、`restoreTransformedCurrent`、`restoreCurrentHeader`（`assertReleasedV4Header` + `validateInstalledCurrentSessionHeader`）；随后 `export const sessionFormatCatalog = createSessionFormatCatalog(sessionFormatCatalogOptions)`。
- `session-format-catalog/src/current.ts:18-31 / :38-52`：以 `Session.fromRestore(...)` 反向校验「已安装的当前表示」。
- `session-format-catalog/src/historical.ts:10-19`：**第二个、封顶在 v3 的 catalog**，仅用于收集历史 child 事实（避免递归打开当前会话）。
- `session-format-catalog/src/children.ts:14-17`：用同一 options 把 v3→v4 边替换为 `createSessionFormatV3ToV4(children)` 再装配第三个 catalog。
- `session-format-catalog/src/message-projections.ts:7`：`currentSessionMessageProjections = [imageOffloadProjection]`。
- 引擎：`session-format/src/catalog.ts:131-138` 同版本短路；`session-format/src/chain.ts` 负责相邻链编译与 `plan(from)`。
- 当前格式的持有包是 `session-format-v3-to-v4`（`codec.ts` 经 `releasedV4SessionFormatCodec`，即 D4 所述的 v2 委托）。

### 4.3 未知必读事件（实读 `known-event-types.ts` + `types.ts`）

- `core/session/src/known-event-types.ts`：**生成文件**（`GENERATED by scripts/gen-persistence-catalog.ts`，`pnpm run gen-persistence-catalog` 重新生成，`pnpm run verify-persistence-catalog` 校验新鲜度，属 `doc-sync`）。`:22-83` `KNOWN_SESSION_EVENT_TYPES: ReadonlySet<string>`（含 `'assistant/message'` :29、`'session-log-deepseek/delivery-accepted'` :54）；`:86-88` `MESSAGE_PROJECTION_EVENT_TYPES = new Set(['image/offload'])`。
- `core/session/src/types.ts:501-511`（`ignorable` 语义原文）：缺 `ignorable` 即「必需」，reader 遇到不认识且无 `ignorable` 的类型**必须拒绝重建**；默认必需是「宁可过度拒绝，也不静默恢复残缺会话」。
- **header 键不享受 `ignorable`**：header 无该标志，准入是全有全无（`HEADER_KEYS` / `exactKeys` / `assertReleasedV4Header`）。

---

## 5. Surface 与消息

| 项 | 位置与形状（实读） |
| --- | --- |
| `SurfaceEventType` 联合 | `core/session/src/types.ts:439-444` = `'system/message' \| 'developer/message' \| 'user/message' \| 'assistant/message' \| 'tool/result'` |
| 运行时集合 | `core/session/src/surface.ts:50-56` `SURFACE_EVENT_TYPES = new Set<string>([...同样 5 项])`；`:63-65` `isSurfaceEligibleType`；`:72-76` `isSurfaceEvent`（须带 `surfaceOp`）；`:89-93` / `:102-106` append/replace 判定 |
| `SurfaceOp` / `SurfaceIntent` | `types.ts:462-464` / `:470-478`；`assistant/message` **禁止** `sourceEventSeqs`（因为它内嵌 provider stream），运行时同样拒绝：`surface.ts:335-337` `'assistant/message embeds its source stream and cannot carry sourceEventSeqs'` |
| 事件 data 校验 | `surface.ts:166-220` `validateSessionEventData(event, subject)`：developer role 与 `developer/message` 必须成对（:174-176）、tool-change 块需要 developer role（:177-181）、`request/header` 非规范字段（:200-211）、`tool/result.error` 需要 `message.isError === true`（:212-219）。**它不校验完整事件负载，也不校验内嵌 provider stream** |
| `Session.append` 校验入口 | `core/session/src/index.ts:876-897` `commit()` 首行 `this.surfaceManager.validateNext(event)` |
| `registerMessageProjection` | `core/session/src/index.ts:1066-1074`：同一事件类型重复注册抛错；经 `ctx.effect` 注册/卸载；`:1052/:1055-1057` `SessionMessageProjection[]`。**职责＝纯事件解释**（`surface.ts:35-47` `project(event, context): ReadonlyMap<SessionSeq, Message>`），不负责给未知事件造出合法 surface 与物理 codec |
| `Message` 族 | `llm/llm/src/message.ts`：`MessageSourceMap` `:110-115`（**合并可扩展**，注释 :104-109：各生产者在自己模块声明 `kind`，无共享 catch-all `plugin`；user 消息可携带任意生产者 kind，消费者对未知 kind 落空）；`MessageSource` `:136`；`MessageBase` `:139-148`（`source` 必填）；`SystemMessage` `:151-154`；`DeveloperMessage` `:157-159`；`UserMessage` `:162-164`；**`AssistantMessage` `:167-170` `readonly source: ModelMessageSource`（硬绑定）**；`ToolResultMessage` `:173-180`；**`MessageRoleMap` `:187-193` 封闭**（注释：每个模型可见 role 必须有持久事件与适配器投影）；`Message` `:196` |
| 构造函数 | `createAssistantMessage` `:260-271` 硬编码 `source: {kind:'model', ...}`；`NewAssistantMessage` `:203-205` 把 `kind` 置为 `never` |
| assistant 事件形状 | `core/session/src/types.ts:341-349` `'assistant/message': { turn:number; step:number; message:AssistantMessage; stream:AssistantStreamRecord[]; usage?:TokenUsage; interrupted?:true }`；`'assistant/attempt'` `:355`；`tool/call` `:361`；`tool/result` `:375-385` |

**结论**：正式投递若复用 `assistant/message`，就必须伪造 `turn`/`step`/`stream`（#25 明确禁止：「不伪造模型 turn/step/stream」）；而新开 surface 事件类型必须同时改联合类型、运行时集合、`deriveEventMessage` 分支，并重新生成 `known-event-types.ts`。投递来源在**格式层已被放行**（见第 6/10 节），真正的约束在 TS 类型与消息角色封闭集合。

---

## 6. 模型请求投影（llm-deepseek）

| 项 | 位置与行为（实读） |
| --- | --- |
| 不支持的 assistant 内容 | `llm-deepseek/src/serialize.ts:11-13` `unsupported(type): never { throw new LlmError(\`DeepSeek Messages cannot represent ${type}\`, 'UNSUPPORTED_CONTENT') }`；`:26-39` `assistant()` 只接受 `text`→`{type:'text'}`、`reasoning`→`{type:'thinking'}`（可带 replay signature）、`tool-call`→`{type:'tool_use'}`，其余 `default: return unsupported(...)`。**是抛错，不是丢弃** |
| user/tool-result 侧 | `:64-78` `input()`：`text` 保留；`reasoning`/`tool-call` **静默丢弃**（:66）；其余非 image 种类 → `unsupported('user/tool-result content ...')`（:67）；`image` → `requestImageHandleText(...)` 加 base64 或 `file_id` 段 |
| 唯一序列化入口 | `:56-61` `serialize(options: GenerateOptions, connection: Connection, history: readonly RequestMessage[], images: ReadonlyMap<ImageAttachmentRef['attachmentId'], RequestImageAttachment>, access: ImageAttachmentAccessResolver, onReplayDegrade?, fileIds?): WireRequest` |
| replay 规则 | `llm-deepseek/src/replay.ts:49` `if (message.source.kind !== 'model' \|\| message.source.replayState === undefined) return undefined`——**非 model source 直接返回无 replay**；`:54` 校验 `response.model === message.source.model`；`:63` 仅当目标 model 一致才回放 blocks。**全文没有 provider 校验** |
| 文件永不原生下行 | `llm/llm/src/content.ts:151-158` `fileHandleText(ref, readonlyPath)` 是文件唯一到达 provider 的表示；`llm/llm/src/index.ts:1075-1076` 在 `adapterStream` 内 `if (projectedMessages.some(m => contentHasFile(m.content))) projectedMessages = projectFilesToText(projectedMessages, ref => this.fileReadPath(ref))`；随后 `:1081` `projectImagesForTextModel`、`:1084` `projectToolUpdates` |
| `fileRequestText` | `llm/llm/src/index.ts:679-681` |

**结论**：投递消息若带 file/image 附件，现有投影链已能把文件降级为句柄文本、图片按路由转成语义文本或原生图片段；**不需要**为普通文件新增 assistant 分支。但若投递要成为「真正的 assistant 角色非模型来源」，当前 `AssistantMessage.source` 类型不允许；而 `readReplay` 对非 model source 返回 `undefined` 后 `assistant()` 仍会照常序列化其 text/tool_use——即运行时其实可行，**约束纯在类型层**。

---

## 7. session-query

| 项 | 位置与行为（派查 + 复核） |
| --- | --- |
| header 一致性断言 | `session-query/src/sources.ts:11-24`：比较 id/createdAt/cwd/parentSession/isSeeded/`(delegationDepth??0)`，冲突抛 `SessionQueryError(..., 'SESSION_QUERY_SOURCE_CONFLICT')`；调用点 `corpus.ts:78/119/196`。**不比 owner，也不比 agentPreset/version/origin** |
| SQLite 行/schema | `session-query-sqlite/src/schema.ts`：`SESSION_QUERY_SQLITE_SCHEMA_VERSION = 8`（:8）；`persisted_sessions` DDL `:113-125`（id/version/created_at/cwd/parent_session/seed_length/delegation_depth/agent_preset/revision/generation，**无 owner 列**）；`search_state` :106；`persisted_docs` FTS5 :126-137；`temp.live_sessions` :142-156；`temp.live_docs` :157-168 |
| **SQLite 是派生索引，不是权威** | `schema.ts:46-78` `openSearchDatabase`：`:56` 读 `PRAGMA user_version`，`:58-63` 拒绝他人应用或非空未识别库，`:64-67` 已识别库先 `assertDerivedUserTables`（:87-94，未知用户表直接抛错）再在版本不符时 `resetDerivedSchema`；`:96-101` `resetDerivedSchema` **DROP 全部用户表并 `PRAGMA user_version = 0`**（随后 `ensurePersistentSchema`/`ensureTemporarySchema` 重建，`:138` 写回版本号）。 | **加 owner 列 = 改 DDL + 全部 SQL 列表 + 递增 schema 版本 8→9，索引自动重建**，不需要数据迁移；这也正面支持 #27「缓存不成为归属或历史权威」 |
| SQLite 映射 | `index.ts:781-795` `headerBindings`（绑 8 个 header 值）；`:938-946` `sameHeader`（比 7 项，含 agentPreset）；`:948-959` `rowHeader`（`seed_length`→isSeeded 等）；`:876-891` `observeSession` 的 live 指纹＝`sha256(JSON.stringify({header, inheritedEventCount, events}))` |
| 正文提取 | `session-query/src/extraction.ts:15` `extractSessionEventText(event)`：`:19-20` `assistant/message` → `contentText(event.data.message.content)`；`:41-42` `default: return ''`（未知类型不产出正文）；`:70-83` `blockText` 只认识 text/tool-call |
| 区间读取 | `session-query/src/index.ts:355` `readEvent` → `:363-394` `_readEvent`（`:379` startSeq、`:380` endSeq、`:382` slice）；持久层 `session-persistence/src/handle.ts:83` `read(offset?, length?, options?)`；冷读 `cold-read.ts:40`；SQL 侧 `session-query-sqlite/src/query.ts:193-216` `buildEventWhere` 的 `seq` 分支 → `addRange` `:417-433` |
| 排序/限额与授权位置 | `session-query-sqlite/src/index.ts:797-852` `selectedDocumentsSql`（候选并集，`persistenceVisible` 门在 :820/:833）；`:647-682` `_querySessions`（`ROW_NUMBER()` :670-676、最终 `ORDER BY match_count DESC, document_length ASC, time DESC, session_id, seq` :679）；`:684-708` `_queryEvents`（ORDER BY :705） |
| 扩展点 | **无过滤器/hook 注册机制**：唯一接缝是继承 `SessionQueryEngine`（抽象 `searchSessions` `session-query/src/index.ts:153`、`searchEvents` `:164`；SQLite 侧已是子类 `session-query-sqlite/src/index.ts:203`）。`SessionSearchExecContext` 只有 `signal`（`session-query/src/types.ts:247-250`）；`filterSessions`/`filterEvents` 是具体方法不可覆写 |

**结论**：#27 要求在返回内容前核对归属，而 query 层没有授权扩展点——授权必须在 OurFairy 自己的 engine 子类或调用方完成；同时 `sources.ts`、`sameHeader`、`headerBindings`、SQLite 行都必须带上 owner，否则「冷热一致」与「越权拒绝」都缺少归属依据。投递正文若要可检索，`extraction.ts` 必须新增分支（`:41-42` 的 default 会令新事件类型完全不可搜）。

---

## 8. 受影响的消费者清单（改类型/格式后必须同步）

### 8.1 会**静默丢弃**新 header 字段（i 类）

| 位置 | 说明 |
| --- | --- |
| `session-persistence-jsonl/src/format.ts:141-156` `fromHeaderLine` | 物理行 → 逻辑 header 的显式映射 |
| `session-persistence-jsonl/src/index.ts:1153-1181` `currentHeader` | catalog 字符串身份 → 带品牌 `SessionHeader`；参数类型本身就是显式键列表（:1153-1163） |
| `core/session/src/index.ts:1173-1183` `prepare()` | meta → header 字面量 |
| `session-log-export/src/archive.ts:110-136` `serializeSessionLog`（构造 :121-132） | 重复实现了一套 header 编码 |
| `session-log-deepseek/src/index.ts:67-79` `wireHeader` | **离机 DeepSeek 请求线上的第二套 header 表示**：用 `seedLength` 取代 `isSeeded`（:74）；仅编码、仓库内无解码器；`src/types.ts:7-18` 是线上类型 |
| `session-query-sqlite/src/index.ts` 行类型 :175-178 + INSERT :591/:621 + SELECT :717/:727/:805-808/:828-831 + `rowHeader` :948-959 | 第二个持久存储，完全按列重建 header |
| `session-format-v3-to-v4/src/codec.ts:13-16/24-26/41-44` | v4 header 编解码即 v2 委托（D4） |
| `session-projection-cache/src/index.ts:404-412` `lifecycleIdentityOf` | 缓存身份投影（子集） |

### 8.2 会**拒绝**新 header 字段（ii 类，fail-closed）

| 位置 | 说明 |
| --- | --- |
| `session-persistence-jsonl/src/format.ts:96-98` + `:163` `isHeaderLine` | **最高危**：写出的日志被自己拒绝 |
| `session-format-v3-to-v4/src/validation.ts:19-42` `assertReleasedV4Header`（`allowed` :22、`unexpected` :25-26） | 当前格式的 header 准入；每次当前 header 读取都会跑到（D5 的空计划仍以 `restoreCurrentHeader` 收尾） |
| `session-format-v1-to-v2/src/validation.ts:17-18/33-52/128-139` `assertReleasedV2Header`/`assertReleasedV2Keys`（:137） | **冻结的已发布 v2 契约，不得拓宽** |
| `session-format-v0-to-v1/src/validation.ts:19-20/40-61` | v0/v1 历史契约 |
| `session-format-v0-to-v1/src/codec.ts:21-22/142-187` | 历史物理 header 用 `seedLength`（:22、:180），与 D6 的离机表示同源 |

### 8.3 只**读取/投影子集**，不会崩但会漏（ii-b / iii 类）

`session-query/src/sources.ts:11-24`（少 owner/agentPreset/version/origin）、`session-persistence-jsonl/src/catalog-migration.ts:65-68`（子集比较 :67）、`session-projection-cache/src/index.ts:462-469` `lifecycleIdentityMatches`、`api/session-controller/src/list.ts:353-363` `listFields`（响应投影）、`acp/acp/src/index.ts:321`（ACP 响应项）、`core/agent/src/index.ts:79-86`、`subagent/subagent/src/child-agent.ts:143-153`、`api/session-controller/src/types.ts:439-451` `SessionWireHeader`、`api/session-controller/src/agent.ts:489-492`。

### 8.4 无需改动（前向兼容）

四个 `migrateHeader` 实现全是 spread 式，天然保留未知字段：`v0-to-v1/src/migration.ts:31-34`、`v1-to-v2/src/migration.ts:47-50`、`v2-to-v3/src/migration.ts:16-19`、`v3-to-v4/src/migration.ts:19-22`；`session-format/src/json.ts:85-93` `snapshotSessionFormatHeader`；各历史 `validateTargetHeader`（旧代日志不可能携带新字段）；`chain.ts` 规划器本身。

### 8.5 生成物与校验门（**漏改 = CI 失败**）

| 生成物/门 | 位置与命令（实读根 `package.json`） |
| --- | --- |
| 事件词表 + 持久化目录 + schema | `scripts/gen-persistence-catalog.ts` → `docs/persistence-catalog.md`(+`.zh.md`+`.i18n.yaml`)、`docs/experimental-persistence-catalog.*`、`packages/core/session/src/known-event-types.ts`、`docs/persistence-schema.json`。再生成 `corepack pnpm@11.28.5 run gen-persistence-catalog`；校验 `run verify-persistence-catalog`（`:181`，属 `doc-sync`） |
| **变更确认记录** | `run verify-persistence-changes`（`:184`，属 `doc-sync`）：header 根的任何新增属性（**含可选**）都要求兼容性复核；需 `persistence-changes --record <id> --decision same-version` 生成 `<id>.md/.zh.md/.i18n.yaml/.schema.json`，否则 `check:all`/CI 失败。（派查） |
| catalog 装配 | `scripts/gen-session-format-catalog.ts` → `session-format-catalog/src/generated.ts`；`run gen-session-format-catalog` / `run verify-session-format-catalog`（`:187-189`） |
| 历史格式事实 | `run verify-persistence-formats`（`:186`，`--write` 重写）、`run verify-persistence-releases`（`:185`） |
| CORDIS API 目录（内嵌 `SessionHeader`/`SessionEventMap`/`SurfaceEventType` 全文） | `packages/extensions/tool-cordis/src/api-catalog.ts`（:6913-6915 `SessionHeader`、:6797-6798 `SessionEventMap`、:7689-7691 `SurfaceEventType`、:6001-6002 `MessageSourceMap`）；`run verify-cordis-catalog`（`:160`）与字节级测试 `packages/typert/generator/tests/cordis-catalog.spec.ts:66-92`（派查） |
| 文档类型等价块 | `docs/subsystems/persistence.md`（`SessionHeader`）、`session.md`（`SessionEventMap`/`SurfaceEventType`）、`llm-streaming.md`（`MessageSourceMap`）＋各自 `.zh.md`；`scripts/type-equiv.manifest.json`；`run verify-type-equiv`（`:123`）（派查） |
| 双语文档配对 | 每个 `X.md` 需 `X.zh.md` + `X.i18n.yaml`；`run verify-translation-pairing`（派查） |
| 类型检查 | `corepack pnpm@11.28.5 run typecheck`（`package.json:51` = `build:lib:host` + `tsc -b tsconfig.client.json`） |

**判据**：想证明「没漏消费者」，最便宜的是 `corepack pnpm@11.28.5 run verify-persistence-changes`（会把持久化 schema 与已提交产物对账并列出所有未确认差异）；完整覆盖用 `run doc-sync`（`run-gates.ts` 的 `docSyncLeafGates()` 汇总了上述全部门）。

---

## 9. 既有测试接缝（红测试落点与命令）

**先记住两条环境事实（实测）**：
1. vitest 4 **不存在 `--reporter=basic`**（会 `ERR_LOAD_URL` 加载自定义 reporter 失败）；用默认 reporter。
2. 管道会吞掉退出码：跑门禁请用 `set -o pipefail` 或直接看 vitest 输出。单元 lane 通过 `vite-tsconfig-paths` 走 `tsconfig.base.json` 的 `paths` 解析到 `src`，**不需要** `build:lib:host`；`*.e2e.ts` 不在 `testIncludes` 内，属于独立 e2e 配置（`jsonl.spec.ts` 属 `process-bound`（forks）工程）。

| 目标行为 | 落点（文件:it 名） |
| --- | --- |
| header 字段往返（**首选红测试**） | `session-persistence-jsonl/tests/jsonl.spec.ts:413` `it('round-trips every optional header field through the header line')`——构造完整 `SessionHeader` → `toHeaderLine(full, SessionLogOffset(3))` → `scanLog` → `expect(scan.meta).toEqual(full)`。该文件共 **185 个测试**（实测） |
| 物理 header 键拒绝 | **存在断言「精确键集」的测试，加字段必改**：`session-format-v3-to-v4/tests/codec.spec.ts:50` `[{ ...header, extra: true }, 'unexpected field extra']`（当前 v4）；`session-format-v1-to-v2/tests/codec.spec.ts:127`（`seedLength` 被拒）与 `:262`；`session-format-v1-to-v2/tests/validation.spec.ts:134`。另有 `session-format/tests/chain.spec.ts:182` `it('rejects newer inputs and wrong header versions')`；`jsonl.spec.ts:2656` 一带的 retired-policy-header 探针 |
| 契约层（后端无关） | `session-persistence/tests/contract.ts:139` `runPersistenceContract`：:251「single-holder per instance」、:316「service-level flush materializes every active write handle」、:503「vocabulary fail-closed: unknown stored event type refuses reads and write opens」、:539 torn-tail；`live-write-contract.ts:49` `runLiveWritePathContract`：:55 live 路由、:117 flush 屏障、:147 服务级 flush 聚合、:295 close 后新句柄接管 |
| 写租约 | `session-persistence-jsonl/tests/lease.spec.ts:157` `describe('cross-process write lock')`（10 个 it） |
| 格式迁移/历史链 | `session-format/tests/catalog.spec.ts:111+`（:112 链路分类、:208/:219 编码器声明校验）；`chain.spec.ts:86/101/115/137/192/261`；各 `session-format-v*-to-v*/tests/migration.spec.ts` |
| live 事件路由 | 上面的 `live-write-contract.ts:55`；`core/session/tests/scoped.spec.ts:82` `describe('sessions.flush()')`，:101 `it('dispatches session/flush with the owning carrier and awaits all listeners')` |
| surface / 消息投影 | `core/session/tests/surface.spec.ts:813` `describe('surface type guards')`（:814 eligible 类型集合、:822 isSurfaceEvent 收窄、:848 append/replace 拆分、:862 拒绝 log-only 与无 marker）；`message-projections.spec.ts:35`（:36 缺解释器时拒绝必需事件、:62 按 fiber 注册） |
| `SurfaceEventType` 生成契约 | `core/session/tests/gen-persistence-catalog.spec.ts:238` `describe('gen-persistence-catalog collectSurfaceEventTypes')`（:239 解析字面量联合、:246/:252/:259 硬错误分支） |
| assistant 流 / 基线-终态对账 | `api/session-controller/tests/assistant-stream.client.spec.ts:107`（:108 重建 baseline 前缀、:139 成功消息与 chunk 退役、:169 失败/中断退役、:183/:194/:207/:215/:227 rebaseline）；`assistant-stream.host.spec.ts:6`；`session-history-journal.host.spec.ts` 的 baseline 相关 it：105/124/179/308/388/429/486/536 |
| 崩溃修复 | `core/session/tests/repair.spec.ts:53`（:116 关空 turn、:125 先关 step、:441 `interruptedTurnClosers` 是公开中断入口） |
| **真实 Loader 组合（现成模板）** | `packages/session/session-stats/tests/loader-composition.spec.ts`（86 行）：`mkdtemp` 临时根 + 写 `cordis.yml` + `context.plugin(Loader)` + 把 `context.loader.internal` 换成受控 `import` 映射 + `await context.loader.await()`，再断言 `loaded.sessions` / `loaded.sessionProjections` 活性；`afterEach` dispose + `rm -rf`。全仓 34 个同类文件，另有 `packages/session-query/session-log-export/tests/loader-composition.host.spec.ts` |

**实测命令与输出（本次实际执行）**：

```
$ corepack pnpm@11.28.5 exec vitest run \
    packages/session/session-format/tests/chain.spec.ts \
    packages/session/session-format/tests/catalog.spec.ts \
    packages/core/session/tests/surface.spec.ts \
    packages/core/session/tests/message-projections.spec.ts
 ✓ packages/session/session-format/tests/chain.spec.ts (8 tests)
 ✓ packages/session/session-format/tests/catalog.spec.ts (11 tests)
 ✓ packages/core/session/tests/message-projections.spec.ts (5 tests)
 ✓ packages/core/session/tests/surface.spec.ts (68 tests)
 Test Files  4 passed (4)    Tests  92 passed (92)    EXIT=0

$ corepack pnpm@11.28.5 exec vitest run \
    packages/session/session-persistence-jsonl/tests/jsonl.spec.ts \
    -t "round-trips every optional header field"
 ✓ |process-bound| packages/session/session-persistence-jsonl/tests/jsonl.spec.ts (185 tests | 184 skipped)
 Test Files  1 passed (1)    Tests  1 passed | 184 skipped (185)    EXIT=0
```

---

## 10. 最小连贯改动集与顺序

### (a) 会话 header 永久归属

**推荐路线：兼容扩展 + v4 自持 header codec，不升版本。**
理由：#25 的验收原文是「采用**相容扩展**」「历史缺归属**不猜为用户 1**」——所以格式层把 owner 做成**可选字段**（不写就不存在），把「缺归属即拒绝」放在**产品/授权边界**（OurFairy 的会话与身份 Module），而不是靠 dsh 格式升版。若产品坚持「必需」，则只能升到 `SESSION_FORMAT_VERSION = 5` 并新增 `session-format-v4-to-v5` 包（见风险 R3）。

顺序（每步都可在当前检出上写出红测试）：

| 步骤 | 文件 | 动作 |
| --- | --- | --- |
| A1 | `core/session/src/types.ts:94-131`、`:151-159` | `SessionHeader` 与 `CreateSessionOptions.meta` 增加 `owner`（建议 `readonly owner?: SessionOwnerId` 之类品牌字符串，不要用裸 `string`） |
| A2 | `core/session/src/index.ts:92-134`、`:1173-1183` | `validateSessionHeader` 增加 owner 显式校验（非空字符串/品牌），`prepare()` 增加映射 |
| A3 | `core/agent/src/index.ts:79-86` | `CreateAgentOptions.meta` 同步 |
| A4 | `core/session/src/index.ts:1391-1395` | 决定 `fork()` 是否继承 owner（#27 下派生会话若无归属将被拒绝，**建议继承**） |
| A5 | `session-format/src/types.ts:16-26` | `SessionFormatHeader` 增加同名字段 |
| A6 | `session-format-v3-to-v4/src/validation.ts:19-42` | `allowed` 集合放行 owner |
| A7 | `session-format-v3-to-v4/src/codec.ts:13-16/24-26/41-44` | **让 v4 自持 header 编解码**（就地实现或围绕 v2 委托做剥离/回填），**不得**拓宽 `session-format-v1-to-v2`（released v2 必须冻结） |
| A8 | `session-persistence-jsonl/src/format.ts:83-94`、`:96-98`、`:141-156`、`:159-186` | `HeaderLine`、`HEADER_OPTIONAL_KEYS`/`HEADER_KEYS`、`fromHeaderLine`、`isHeaderLine` 四处同步——**最高危，漏则自拒日志** |
| A9 | `session-persistence-jsonl/src/index.ts:1153-1181` | `currentHeader` 映射 |
| A10 | `session-query-sqlite/src/index.ts`（:175-178、:591、:621、:717、:727、:805-831、:781-795、:938-946、:948-959）+ `schema.ts` | 加列 + 加映射 + schema 版本递增（**DDL 具体位置未验证**） |
| A11 | `session-query/src/sources.ts:11-24` | 一致性断言加入 owner |
| A12 | `session-log-export/src/archive.ts:121-132`、`session-log-deepseek/src/index.ts:67-79` + `src/types.ts:7-18`、`session-projection-cache/src/index.ts:404-412`、`session-persistence-jsonl/src/catalog-migration.ts:65-68` | 其余投影/子集比较 |
| A13 | 生成与文档 | `run gen-persistence-catalog` → `run gen-session-format-catalog`（通常无 diff）→ `run gen-cordis-catalog`；补 `docs/subsystems/persistence.md`(+`.zh.md`) 的 type-equiv 块；`run persistence-changes --record <id> --decision same-version`；`run verify-translation-pairing --write` 如需 |
| A14 | 测试 | 先扩 `jsonl.spec.ts:413` 的红测试（新增 owner 往返），再加重启读取、无归属拒绝、fork 继承；同步更新**精确键集**用例：`session-format-v3-to-v4/tests/codec.spec.ts:50`、`session-format-v1-to-v2/tests/codec.spec.ts:127/:262`、`session-format-v1-to-v2/tests/validation.spec.ts:134` |

### (b) 正式非模型投递 assistant 事件

**格式层几乎无需改动**：`session-format-v3-to-v4/src/message-sources.ts:9` 只要求「非空字符串 kind 且不等于 `'plugin'`」，任何生产者自有 kind 都被 v4 接纳（派查已复核原文）。

**推荐：新开 surface 事件类型，不复用 `assistant/message`。** 因为复用就必须编造 `turn`/`step`/`stream`（#25 禁止），且 `assistant/message` 被显式禁止携带 `sourceEventSeqs`（`types.ts:470-478`、`surface.ts:335-337`）。

| 步骤 | 文件 | 动作 |
| --- | --- | --- |
| B1 | 归属插件内（OurFairy 或 dsh 扩展包） | 用 `declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { <kind>: {...} } }` 声明投递来源（先例：`guard/repeat-tool-reminder/src/index.ts:14-18`、`extensions/cordis-host-runner/src/index.ts:12-17`，两者都用 `createUserMessage`） |
| B2 | `core/session/src/types.ts:281-428`、`:439-444` | `SessionEventMap` 加 `'<ns>/delivery'` 事件（建议字段：`message`、`deliveryId`、发送者标识、可选附件引用；**不要** turn/step/stream）；`SurfaceEventType` 联合加入该类型 |
| B3 | `core/session/src/surface.ts:50-56`、`:129+` | `SURFACE_EVENT_TYPES` 加入；`deriveEventMessage` 增加该分支并返回合法 role 的 `Message` |
| B4 | 生成 | `run gen-persistence-catalog`（重生成 `known-event-types.ts` 与目录） |
| B5 | `session-query/src/extraction.ts:15`（`:41-42` default 会漏） | 增加正文提取分支，使投递正文可被检索（#25 要求） |
| B6 | `session-query-sqlite` documents/`classifySurface` | 让投递进入 FTS 文档 |
| B7 | 消费者/协议镜像 | wire 类型、ACP/客户端投影（若首版不部署，至少保证编译） |

**可选路线 B′（仅当投递必须是 assistant 角色）**：把 `llm/llm/src/message.ts:167-170` 的 `AssistantMessage.source` 放宽为 `ModelMessageSource | <DeliverySource>`，并同步 `:203-205` `NewAssistantMessage`、`:260-271` `createAssistantMessage`。实测**下游几乎无痛**：全仓只有 `packages/client/ui-trajectory/src/client/trajectory-assistant-definition.ts:268-269` 读取 `.source.provider/.model`；`readReplay` 对非 model source 已返回 `undefined`（`replay.ts:49`），`serialize.ts:26-39` 仍会正常序列化其 text/tool_use。代价是改动公共 `Message` 类型（`MessageRoleMap` 封闭、`AssistantMessage` 是导出契约）。

**并行边界**：`(a)` 与 `(b)` 触及的文件基本不相交（header/format/catalog/store/query 对 surface/message/llm），**唯一冲突点是 `core/session/src/types.ts`**（(a) 改 :94-131/:151-159，(b) 改 :281-428/:439-444）与生成物（两者都要重跑 `gen-persistence-catalog`）。因此：**同一写入者顺序完成 types.ts 的两段改动，生成步骤串行**；其余可并行。`(a)` 必须先落，因为 #27 的归属核对依赖 header 字段，而 #26 尚未解封（#27 被 #25、#26 双重阻塞）。

---

## 11. 会让 #25/#27 无法按票面验收的风险

| # | 风险 | 证据 | 后果 |
| --- | --- | --- | --- |
| R1 | **JSONL header 白名单是 fail-closed**：只改类型不改 `HEADER_KEYS`/`isHeaderLine`/`fromHeaderLine`/`currentHeader`，本版本写出的日志会被自己拒绝 | `format.ts:96-98`、`:163`、`:141-156`；`index.ts:1153-1181` | #25「往返＋重启读取保留全部必要字段」直接失败 |
| R2 | **v4 header codec 委托 released v2**，若去拓宽 v1-to-v2 以放行新字段，会破坏已发布 v2 契约 | `session-format-v3-to-v4/src/codec.ts:13-16/24-26/41-44`；`v1-to-v2/src/validation.ts:128-139`；历史事实 `docs/persistence-changes/historical-formats/v2.*` | 旧代 reader 语义被改写，#25「已发布旧代不被覆写」失败；`verify-persistence-formats` 失败 |
| R3 | **同版本短路**：现有 v4 日志永不跑迁移边，**新「必需」字段无法补写** | `session-format/src/catalog.ts:131-138`；`core/session/src/types.ts:74-86` | 若产品要求 owner 必填，只能升 `SESSION_FORMAT_VERSION = 5` 并新增 `session-format-v4-to-v5` 包 + 重生成 `generated.ts` + 更新 `scripts/migrate-sessions-to-v4.ts:202-203` 的硬门 + 新 finalized 记录；工作量与风险显著放大 |
| R4 | **持久化变更未确认会导致门禁失败** | `run verify-persistence-changes`（`package.json:184`，属 `doc-sync`）；header 根新增属性即使是可选也要求复核并 `--decision` | 功能正确但 `check:all`/CI 红，票面「独立保持构建与相关兼容检查通过」失败 |
| R5 | 复用 `assistant/message` 承载投递 ⇒ 必须伪造 turn/step/stream | `core/session/src/types.ts:341-349` | 直接违反 #25「不伪造模型 turn/step/stream」，且投递身份/附件语义被模型流字段污染 |
| R6 | `fork()` 不继承归属 | `core/session/src/index.ts:1391-1395` | 派生会话无归属；在「不默认用户 1」下会被拒绝，子代理/派生路径连带不可用 |
| R7 | query 层无授权扩展点，且归属未进一致性断言/SQLite/headerBindings | `session-query/src/index.ts:153/164`；`types.ts:247-250`；`sources.ts:11-24`；`session-query-sqlite/src/index.ts:781-795/938-946` | #27「列表/读取/订阅/控制在返回内容前核对归属」「两用户上下文独立」只能靠调用方自律；冷热一致性检查对归属视而不见 |
| R8 | 投递正文不可检索 | `extraction.ts:41-42` default 返回 `''` | #25 要求「投递正文需纳入 extraction」，漏改则搜索不可见 |
| R9 | 离机 DeepSeek 线协议有**第二套 header 表示**且用 `seedLength` | `session-log-deepseek/src/index.ts:67-79`、`src/types.ts:7-18`；`docs/deepseek-llm-api-wire-extensions.md:117`（派查：「Changing the Session header projection requires an extension-schema bump」） | 若首版启用该上传扩展，新增 header 字段还需线协议 schema 升版，否则线上表示静默丢字段 |
| R10 | **既有「精确键集」测试会立刻变红** | `session-format-v3-to-v4/tests/codec.spec.ts:50`、`session-format-v1-to-v2/tests/codec.spec.ts:127/:262`、`validation.spec.ts:134` 均断言 `unexpected field` | 加字段后必须同步这些用例；若不理解其意图而直接放宽断言，会静默放弃 released v2/v4 的键集契约（与 R2 同源），#25「相容扩展」验收证据随之失真 |

---

## 12. 未验证（勿当结论使用）

1. ~~`session-query-sqlite` 的 DDL / schema 版本机制~~ → **已核实（见第 7 节新增行）**：`schema.ts:106/:113` 的 `CREATE TABLE IF NOT EXISTS`、版本号 `:8`、`PRAGMA user_version` `:56/:100/:138`、版本不符即 `resetDerivedSchema` 重建 `:64-67/:96-101`。仍未读的是 `ensurePersistentSchema`/`ensureTemporarySchema` 的完整 DDL 细节（:103-169 已知大体形状）。
2. ~~是否存在**断言 v4 物理 header 精确键集**的测试~~ → **已核实：存在**。`session-format-v3-to-v4/tests/codec.spec.ts:50`、`session-format-v1-to-v2/tests/codec.spec.ts:127/:262`、`session-format-v1-to-v2/tests/validation.spec.ts:134`；新增 header 字段必须同步这些「unexpected field」用例。未做的是运行 `jsonl.spec.ts` 全量以确认无额外隐含断言。
3. `session-persistence-jsonl/src/generation.ts`（`readDecodedJsonlSource`、`JsonlPhysicalIdentity`）仅经调用点见到，未读。
4. `session-format-v3-to-v4/src/relationships.ts`(385) 与 `v0-to-v1/src/relationships.ts`(497) 未读；后者经 grep 只见以**值**方式读取 `header.version/parentSession/id`，无键枚举（据此判断无需改动，但未逐行确认）。
5. `packages/client/**` 的客户端投影：只 grep 到 `ui-agent-preset` 类投影键，未检查是否还有其它 header 键枚举。
6. `bundle/headless/src/index.ts:172-200`（读到 `header.agentPreset`）未完整打开。
7. `scripts/migrate-sessions-to-v4.ts:202-203` 的硬 v4 门已确认，但**未运行**该脚本；「现网 v4 日志只读、永不重写」是据 `:233`（`open(id, source.version === 4 ? 'read' : 'write')`）的推断。
8. 第 8.5 节门禁的**实际 CI 工作流映射**未核对（只核对了根 `package.json` 与 `run-gates.ts` 的 `doc-sync` 组成）。
9. `assertReleasedV2Keys` 的精确行号（`v1-to-v2/src/validation.ts:128-139` 为派查值）未二次打开。

---

## 13. 证据与环境（本次实际执行）

- 检出：`/home/eafen405/projects/deepseek-harness`，`git log -1` 见[研究基线](README.md)，`git status --porcelain` 为空，分支 `product/ourfairy-v1`。**除本文件外未改动任何文件**（本文写在 OurFairy 仓库，不触碰 dsh）。
- 工具链：`corepack pnpm@11.28.5`（未使用 PATH 上的 pnpm 12）。
- 测试：见第 9 节两条实测命令与原始输出（92 passed / 185 collected、1 passed）。
- 反例记录：`--reporter=basic` 在 vitest 4 不存在；`| tail` 会掩盖退出码——两者都会伪造「通过」假象，实施者勿重蹈。
