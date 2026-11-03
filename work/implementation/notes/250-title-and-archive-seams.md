# #250 title & archive seams — exploration note

Read-only exploration. dsh = `/home/eafen405/projects/deepseek-harness` @ `d80522d2` (== combo.json `productCommit`); product = `/home/eafen405/projects/OurFairy` (main). Paths are repo-relative to their own repo.

## A. TITLE READ PATH

### A1. Reading a stored title without opening a live session — `ctx.sessionQuery.readTitle*`

`packages/session-query/session-query/src/index.ts`:

```ts
// :220
async readTitle(sessionId: SessionId, signal?: AbortSignal): Promise<SessionTitleSnapshot | undefined>
// :233
async readTitleSnapshot(sessionId, signal?): Promise<SessionTitleObservation>          // { session: SessionHeader; title? }
// :251
async readTitleSnapshots(sessionIds: readonly SessionId[], signal?): Promise<SessionTitleObservationResult[]>
```

Implementation (:251-262) folds the log directly — **no projection registry involved**:

```ts
return this._corpus.projectMany(sessionIds, (source): SessionTitleObservation => {
  const title = foldSessionTitle(source.events)
  return { session: structuredClone(source.header), ...title === undefined ? {} : { title } }
}, signal)
```

Cold path `corpus.ts:139-177`: `ctx.sessions.get(id)` first; for the rest **one `persistence.list()`** (`:166-168`), then only the unresolved logs are read. So `readTitleSnapshots(ids)` is the right shape for `/sessions/list`; a single `readTitle` still costs a full `list()`.

Return shapes: `SessionTitleObservation` = `{ session, title? }` (`session-query/src/types.ts:164-169`); batch = per-id `{status:'fulfilled', value} | {status:'rejected', reason}` (`:172-188`), so one corrupt log does not fail the list.

Alternative (heavier, needs `sessionProjections`): `observeSession(id, { projectionMode: 'all' })` → `observation.projections.values.title: string | null`; prepared sessions hydrate at `observation.ts:318-325`. Key comes from `titleProjectionDefinition` (`session-title/src/index.ts:269-281`). Prefer `readTitle*`: it works even without `session-title` mounted and costs no projection.

`SessionTitleSnapshot` = `{ title, messageSeqs, source, eventSeq, updatedAt }`, `source` = `{kind:'fallback'} | {kind:'provider', provider, model?} | {kind:'user'}` (`session-title/src/types.ts:28-56`). **This is the "标题来源可区分" field #251/#252 need — no new column.**

### A2. Importing `foldSessionTitle` into `backend/sessions` — precedent exists, but use the service

Value imports of dsh internals in product code: `backend/sessions/src/events.ts:16` (`isAppendSurfaceEvent` from `@deepseek-ai/dsh-session/surface`), `backend/chat/src/units.ts` (`dsh-session/surface`, `dsh-llm/assistant-stream`), `backend/memory/src/maintenance.ts` (`dsh-llm`), `backend/delivery/src/index.ts` (`dsh-tools`, `dsh-llm`). The *service* precedent is in the module under change: `readSessionEvents` calls `ctx.sessionQuery.observeSession(...)` (`backend/sessions/src/events.ts:47-54`, type-only import at `:19`).

Recommendation: `ctx.sessionQuery.readTitleSnapshots()` (A1) — the seam this module already uses, no new peer, no event-type knowledge. `foldSessionTitle` is a pure function (`index.ts:288-298`) so importing it would match `isAppendSurfaceEvent`, but it forces a new `@deepseek-ai/dsh-session-title` peer, which `doctor` judges against the dsh runtime version (`scripts/combo.ts:565-601`) and which `tests/plugin-compatibility.test.mjs:118-137` requires to be an explicit caret range (`^0.2.1-alpha.2` satisfies the pinned `0.2.1-rc.2`).

**The fallback derivation does need that peer anyway**: `fallbackSessionTitle(text, maxWords, maxBytes)`, `normalizeSessionTitle`, `truncateTitleUtf8` (`index.ts:53`; impl `normalize.ts:39-74`). No dsh helper exports "first eligible human message", so the product selects it from the raw events itself (`hasMessages`/`readSessionEvents` is the local precedent).

### A3. `persistence.list()/stat()` carry no title — confirmed

`SessionPersistenceSnapshot` = `{ header, formatStatus?, revision, eventCount?, sizeBytes? }` (`packages/session/session-persistence/src/index.ts:50-62`). `SessionHeader` (`packages/core/session/src/types.ts:128-173`) verbatim:

```ts
export interface SessionHeader {
  readonly version: typeof SESSION_FORMAT_VERSION
  readonly id: SessionId
  readonly createdAt: number
  readonly cwd?: string
  readonly parentSession?: SessionId
  readonly isSeeded: boolean
  readonly origin?: 'subagent'
  readonly delegationDepth?: number
  readonly agentPreset?: string
  readonly owner?: SessionOwnerId
}
```

Product side: `_headerOf` uses `persistence.stat` (`backend/sessions/src/service.ts:106-108`); `list()` maps `snapshot.header` (`:135-140`).

## B. PROVIDER ROUTE RESOLUTION

### B4. `request.route === undefined` → config `provider`/`model` is the only fallback; otherwise it throws

`packages/session/session-title-llm/src/index.ts:178-189`:

```ts
function resolveRoute(config, request): SessionTitleModelIdentity {
  if (config.provider !== undefined && config.model !== undefined) {
    return { provider: config.provider, model: config.model }
  }
  if (request.route === undefined) {
    throw new Error('session-title-llm: no logged request route is available; configure provider and model together')
  }
  return request.route
}
```

Precedence: **config wins over the logged route** when both exist. `refresh()` derives the route from the last logged header, `session.requestHeader()?.config` (`session-title/src/index.ts:466-468`). A historical session that has a user message but no reply has no `request/header` → route `undefined` → the throw. **The provider row MUST set `provider` + `model`.** (They must be paired and non-empty: `resolveSessionTitleLlmConfig`, `:129-158`.)

### B5. Required config, and ready-to-paste rows

- `session-title` (`session-title/src/index.ts:56-86`, asserted `:303-330`): **all three required**, positive integers, no defaults; `fallbackMaxBytes ≤ maxTitleBytes` → `fallbackMaxWords`, `fallbackMaxBytes`, `maxTitleBytes`.
- `session-title-first-prompt-llm` (`session-title-first-prompt-llm/src/index.ts:28-44`): required `targetWords`, `targetCjkCharacters`, `maxInputBytes`, `maxOutputTokens`, `timeoutMs` (`≤ MAX_TIMER_DELAY_MS`); optional-but-paired `provider`, `model`.

```yaml
        # Native title service: log-backed title fold + deterministic fallback.
        # The three numbers are deployment decisions, not inherited defaults.
        - id: session-title
          name: '@deepseek-ai/dsh-session-title'
          config:
            fallbackMaxWords: 5
            fallbackMaxBytes: 40
            maxTitleBytes: 80
        # First-human-message model provider. provider/model are REQUIRED here:
        # a historical session opened cold may carry no request/header, and
        # without this pair the provider throws instead of naming a title.
        - id: session-title-llm
          name: '@deepseek-ai/dsh-session-title-first-prompt-llm'
          config:
            targetWords: 5
            targetCjkCharacters: 10
            maxInputBytes: 4096
            maxOutputTokens: 4096   # ceiling vs runaway output, not a length target
            timeoutMs: 60000
            provider: minimax-cn
            model: MiniMax-M3.1-Flash
```

Values mirror the reference mount `packages/bundle/base/cordis.patch.yml:60-77` (same row ids), plus `provider`/`model`. Put both in the `plugins` group of `backend/v1-bundle/cordis.patch.yml` — product capabilities, not kernel; the kernel still boots without them.

### B6. Dependencies already satisfied

- `session-title` injects `['sessions', 'sessionProjections']` (`index.ts:302`) → bundle:37 `dsh-session` and bundle:47 `dsh-session-projection`. ✓
- Provider injects `['sessionTitle', 'llm', 'sessions']` (`first-prompt index.ts:24`) → all mounted (bundle:39 `llm`). ✓
- `session-projection-cache` is **not** mounted and is not needed: `readTitle*` projects nothing, and prepared hydration falls back to `registry.hydrate` (`observation.ts:318-325`).
- No new bundle `dependencies` entry: native `@deepseek-ai/*` rows are outside the declared/mounted comparison, which is scoped to `@ourfairy` (`scripts/combo.ts:491-496`).

## C. COLD-OPEN TITLE GENERATION

### C7. Nothing fires on a cold replay — the product must call `refresh` explicitly, once

`SessionTitleService` reacts only to live appends: `ctx.on('session/event', ...)` → `onUserMessage` (only `user/message` with `source.kind === 'user'`, `index.ts:506-530`) and `onRequestHeader` (`:533-543`). A cold resume *seeds* the log (`agents.resume` → `sessions.prepare({ seed })`, `agent-loop/src/index.ts:887-891`); replay emits no `session/event`, so `ensureFallback` (`index.ts:809-843`; called from `onUserMessage`'s deferred task `:522-529` and from `runProvider` `:601`) never runs. A historical session has **no title event** until someone calls `refresh`.

For #251 ("首次打开时补生成一次模型标题并持久化；再次进入不重复生成"):

1. After `open()` resolves (C9), read `ctx.sessionTitle.get(session)`; **run `refresh` unless the title's `source.kind` is `'provider'` or `'user'`**. `undefined` = no title event yet; `'fallback'` must still refresh (see the trap below).
2. Then `void ctx.sessionTitle.refresh(session).catch(...)` — fire-and-forget: the reply path is not blocked and a failure is swallowed (不重试、不弹错、不阻塞).
3. Persistence is automatic: `runProvider` appends `session/title` to the live session (`index.ts:618-626`), so the checkpoint policy stores it durably. Every later open finds a provider title and costs zero model calls.
4. Also guard per session **in process** (a `Set<SessionId>` of attempted ids): every chat route calls `open()` (`/chat/read`, `/chat/page`, `/chat/stop`), so a log-only check re-attempts on every poll while the first call is in flight.
5. Guard `ctx.get('sessionTitle')` — the row may be absent.

**Trap — do not guard on "has any title".** The automatic path only schedules a model title for `count === 1` with no title yet (`index.ts:515`), so a historical session never gets one automatically; but the first *new* user message in it still runs `ensureFallback` (`:522-529`), which appends a **fallback** title because `get(session) === undefined`. A guard written as `get() === undefined` therefore loses the race to the user's first message and leaves the session pinned to a fallback forever. Guard on `source.kind`, not on presence.

List path (#251 read-only fallback) must not write and must not call the model: `readTitleSnapshots(ids)`, then for `title === undefined` derive `fallbackSessionTitle(firstHumanText, fallbackMaxWords, fallbackMaxBytes)` and expose it as source `fallback`, computed per request and never appended.

### C8. `refresh` with no `request/header` — works, if the provider row has `provider`/`model`

- Route becomes `undefined` (`index.ts:466-468`); the provider is still invoked with `{ session, messages, currentTitle?, signal }` and no `route` (`runProvider` `:609-615`).
- `executeSessionTitleLlm` then throws (`session-title-llm/src/index.ts:186-188`) **unless** the row configures `provider`+`model` (B4). With them it proceeds normally.
- Exception paths: `session "${id}" is not live in this store` when the Session was not published by the store (`index.ts:439-441`); `session-title service disposed` (`assertServiceActive`, `:770-772`); no eligible message → `input.lastSeq === null` → returns `undefined` (`:444-457`); a user-pinned title is deliberately re-derived over in the no-provider branch (`:450-454`).
- On the **explicit** path a provider rejection propagates to the caller (`startProvider`/`runProvider` have no catch; only the automatic `startPending` catches, `:574-579`). The product must `.catch()`.

### C9. How the product opens a cold session, and where the hook goes

`backend/chat/src/runtime.ts:169-187`:

```ts
async open(owner: SessionOwner, sessionId: unknown): Promise<LiveSession> {
  await this.ctx.ourfairySessions.read(owner, sessionId)   // authz first, always
  const key = sessionId as SessionId
  const live = this.#live.get(key)
  if (live !== undefined) return live
  let opening = this.#opening.get(key)                      // one resume per id
  if (opening === undefined) { opening = this.runSession(key, () => this.#resume(owner, key)); this.#opening.set(key, opening) }
  try { return await opening } finally { if (this.#opening.get(key) === opening) this.#opening.delete(key) }
}
```

`#resume` (`:192-`) calls `ctx.agents.resume({ resumeSessionId, agentOptions, setup })`, which opens persistence in `'write'`, replays the stored log, appends synthetic closers for an interrupted turn, and **publishes** the Session (`agent-loop/src/index.ts:843-921`; `setupAndPublish` `:790-816`). Returns a `LiveSession` (`runtime.ts:110-141`); `.session` is the live dsh `Session`.

Hook placement: inside `#resume`, **after** `await this.ctx.agents.resume(...)` resolves. Not in `setup` — `setup` runs before `publish` (`setupAndPublish:810-814`), so `ctx.sessions.get(id) !== session` and `refresh` throws C8(a). `open()` is the single choke point every chat route uses (`service.ts:79,104,112,119,137,142,155`; `jobs.ts:42,56`).

## D. ARCHIVE

### D10. dsh has no archive concept — confirmed

`grep -rni archive packages/session/ packages/core/session/ --include=*.ts` → 16 hits, all prose about *a directory of session files* (`session-format/src/filename.ts:23`) or projection-cache test fixtures. No archived state, no `SessionHeader` flag, no persistence filter, no service API. Archive must be product-owned state.

### D11. Product SQLite pattern to copy

Established (`backend/memory/src/store.ts`, `backend/identity/src/store.ts`): `node:sqlite` `DatabaseSync` (synchronous), one file per module, WAL + `foreign_keys = OFF`, `meta.schema_version` + idempotent `CREATE TABLE IF NOT EXISTS` re-exec on upgrade, `BEGIN IMMEDIATE` for multi-statement writes, `deleted_at INTEGER`, `created_at`/`updated_at` epoch ms, `close()` from the plugin's dispose.

```ts
// node:sqlite DatabaseSync, WAL, foreign_keys OFF, meta.schema_version, BEGIN IMMEDIATE.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS session_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,                 -- dsh SessionHeader.id, exactly as the store writes it
  owner_short_id INTEGER NOT NULL,          -- the caller the archive is scoped to (actor, NOT ownership)
  status INTEGER NOT NULL DEFAULT 0,        -- 0 active, 1 archived  (numeric enum rule)
  archived_at INTEGER,                      -- epoch ms when archived; NULL while active
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER                        -- logical delete (mandatory on every business table)
);
CREATE UNIQUE INDEX IF NOT EXISTS session_archive_by_session ON session_archive(session_id);
`

export class ArchiveStore {
  #db: DatabaseSync
  constructor({ path }: { path: string }) {           // copy memory/src/store.ts:141-163 verbatim
    if (typeof path !== 'string' || path === '') throw new Error('archive store needs a path')
    mkdirSync(dirname(path), { recursive: true })
    this.#db = new DatabaseSync(path)
    try { this.#db.exec('PRAGMA journal_mode = WAL'); this.#db.exec('PRAGMA foreign_keys = OFF'); this.#migrate() }
    catch (error) { this.#db.close(); throw error }
  }
  close(): void { this.#db.close() }                  // called from the plugin's dispose
  // #migrate/#storedVersion/#setVersion: identity/src/store.ts:401-438 verbatim
  // #transaction: memory/src/store.ts:419-425 (BEGIN IMMEDIATE / COMMIT / ROLLBACK)
}
```

`status`/`archived_at` is the product fact #253/#254 read and write (archived rows keep `deleted_at IS NULL` — log and messages are intact), while `deleted_at` satisfies the mandatory logical-delete column. One row per session, upserted on `session_id` (restore = `status = 0, archived_at = NULL`); reads `WHERE owner_short_id = ? AND status = ? AND deleted_at IS NULL`.

DB rules — `CODING_STANDARDS.md:3` defers to `AGENTS.md` §数据库:

> - 业务状态、分类、象限、来源等有限枚举，数据库与接口统一使用数字编码；中文含义通过注释、枚举类或前端常量维护。
> - 业务表必须包含逻辑删除字段，并记录必要的关联人员、创建及更新时间。失效记忆条目按 ADR-0002 物理删除且编号不复用，是该规则的例外。
> - 若改动涉及数据结构，需在设计阶段明确告知用户变动内容。

So: title source and archive status are numeric enums (`0 fallback / 1 provider / 2 user`, `0 active / 1 archived`), never strings; `created_by`/`updated_by` and both timestamps are required.

### D12. Existing per-session product state keyed by session id — yes

`maintenance_state.source_session TEXT PRIMARY KEY` (`backend/memory/src/store.ts:49`), `memories.source_session` (`:36`), `uploads.session_id` (`backend/identity/src/schema/uploads.ts:12`), `deliveries.sender_session_id` / `recipient_session_id` (`backend/identity/src/schema/deliveries.ts:12-14`). A session-keyed product table is an established shape. Ownership stays `SessionHeader.owner` (`service.ts:1-10`); an archive row must **not** become a second ownership authority — keep `owner_short_id` as the actor/scope and still authorize against the header (他人不能归档/恢复).

## E. ANDROID SURFACE

### E13. Where the list lives, what state it has, and the minimal seams

- `android/app/src/main/java/me/rerere/rikkahub/ui/identity/IdentitySessionList.kt:34-112` — the drawer. **The defect is here**, `:100`: `Text(if (session.primary) "主会话" else "会话 ${index + 1}")`, plus the raw id at `:101-102`.
- `data/remote/OwnedSessionState.kt:17-33` — `SessionsSnapshot(sessions, primarySessionId, selectedId, loading, failure)`; epoch/one-action guard `request{}` at `:151-173`; every mutation is `request { token, current -> current.copy(...) }`.
- `data/remote/SessionApi.kt:27-33` — `OwnedSession(id, owner, primary, createdAt)`; `SessionBackend:42-52` (`list/create/select/primary/read`); POST helper `call()` `:118-159`.
- Backend: `backend/sessions/src/http.ts:14-20` (`SESSION_PATHS`), `:50-70` (handlers), `service.ts:91-103` (`expose`).

Minimal seam, in dependency order:
1. `OwnedSession` += `title: String = ""`, `titleSource: Int = 0` (numeric enum per D11).
2. `SessionBackend` += `rename(token, sessionId, title)`, `archive(token, sessionId)`, `restore(token, sessionId)`; `SessionApi` mirrors `select`'s document-carrying shape (`:107-109`) so `content-type` is set (`:126-130`).
3. `SESSION_PATHS` += `/sessions/rename`, `/sessions/archive`, `/sessions/restore`; handlers reuse `oneSession()`/`post()` (`http.ts:37-48`).
4. `SessionsSnapshot` += `archived: Boolean = false`, `showArchived: Boolean = false`; `refresh()` (`OwnedSessionState.kt:89-100`) passes the flag, and `joined()` (`:129-137`) must not resurrect an archived row.
5. Row UI: keep the whole-row `clickable` (`:97`), render `session.title`, add a trailing `IconButton` + `DropdownMenu` (改名 / 删除) **absent when `session.primary`** (`:100` already branches on it). 删除 opens an `AlertDialog` naming 归档 + 可恢复 + 会先停止当前回复; only confirm calls `archive`.
6. Archived view: a toggle beside 刷新 flips `showArchived`; the same composable renders it with 恢复 replacing 删除 and no 新建会话.

### E14. Android UI test harness — Robolectric + Compose test rule

`app/build.gradle.kts:225-229`: `libs.robolectric`, `androidx.compose.bom`, `androidx.ui.test.junit4`. Tests are JVM unit tests: `@RunWith(RobolectricTestRunner::class)` + `@get:Rule createComposeRule()`, driving real composables with fake backends.

Representative files under `android/app/src/test/java/me/rerere/rikkahub/`:
- `ui/fairy/FairyPagesTest.kt` — whole pages, real state objects (`OwnedSessionState`, `RemoteChatState`), `onNodeWithText`/`performClick`/`performScrollTo`, `RuntimeEnvironment` for resources.
- `ui/identity/GatewayPageTest.kt` — a settings page with an editing state machine.
- `ui/fairy/FairyNumericFieldTest.kt` — one composable, focus/IME behaviour.

No existing test drives `IdentitySessionList`; a new `ui/identity/IdentitySessionListTest.kt` would be the first. Closest template: `FairyPagesTest.kt`'s "real state + fake backend + composeRule" shape; `data/remote/SessionApiTest.kt` shows the fake-`SessionBackend` style.

### E15. "Is this session replying?" and the stop operation

- Client: `RemoteChatApi.stop(token, sessionId)` → `POST /chat/stop` with `{"sessionId": …}` (`data/remote/RemoteChatApi.kt:157`, impl `:239-241`); `RemoteChatState.stop()` (`data/remote/RemoteChatState.kt:632-638`) plus `stopRequested` (`:53`).
- Backend: `ourfairyChat.stop` (`backend/chat/src/service.ts:141-143`) → `runtime.stop` (`backend/chat/src/runtime.ts:523-527`): `state.stopping = state.status === 'running'; state.agent.cancel({ kind: 'user' }, { keepInbox: true })`.
- Wire reply state is the projection's `replyStatus` (`runtime.ts:509`): `0` idle, `1` running, `2` stopping — available only for a session the client is observing/reading (`/chat/read`), not for an arbitrary drawer row.
- Seam for #253: call `stop` **unconditionally** before `archive` — it is a no-op when idle, and the confirm text is what tells the user a reply will be stopped. Do not build a per-row reply-status endpoint.

## F. TEST HARNESS (BACKEND)

### F16. Pattern for a new backend test file

`tests/helpers/`: `backend.mjs`, `dsh-peers.mjs`, `fake-corepack.mjs`, `profile-install.mjs`. Everything drives the real launcher (`scripts/ourfairy-backend.ts`); no plugin is hand-assembled.

```js
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import {
  describeRun, dshDir, httpJson, makeHome, removeHome, runBackend, startArgs, startedPort,
} from './helpers/backend.mjs'

// The model double is dsh's own loopback Messages server, from the pinned checkout.
const { startMockLlmServer } = await import(join(dshDir, 'packages/test-support/llm-mock-server/lib/index.js'))

const home = makeHome('ourfairy-title-')          // isolated OURFAIRY_HOME
const backend = { port: undefined }
let model
before(async () => {
  model = await startMockLlmServer({ apiKey: 'mock-key', sequence: ['success'], repeatLast: true, successText: 'OK' })
  const run = runBackend(startArgs(), {           // startArgs() adds --allow-drift when OURFAIRY_DSH_DIR is set
    OURFAIRY_HOME: home, OURFAIRY_PORT: '0', OURFAIRY_PHAETHON_PASSWORD: 'pw',
    MINIMAX_CN_API_KEY: 'mock-key', OURFAIRY_MINIMAX_BASE_URL: `${model.baseURL}`,  // point the deployment route at the double
  })
  backend.port = startedPort(run)                 // asserts exit 0, reads listeningPorts[0]
})
after(async () => { runBackend(['stop'], { OURFAIRY_HOME: home }); removeHome(home); await model?.close() })

const request = (path, options = {}) => httpJson(backend.port, path, { ...options, expect: false })
// then: /identity/sign-in (phaethon) → /identity/invite → /identity/register → /sessions/create → /chat/send
```

Mechanics: `httpJson` speaks `node:http` (never `fetch` — ambient proxy) and sets `Authorization: Bearer` + `content-type` (`helpers/backend.mjs:285-327`); a test that serves its own loopback double must use `runBackendAsync`, not `runBackend`'s `spawnSync` (`:229-259`); `writeOverlay(home, rows)` mounts a test-only row via `--patch` (`:210-217`). Worked example: `tests/owned-sessions.test.mjs:1-140`.

### F17. What must change when a row is added to `cordis.patch.yml`

- **`tests/baseline-boot.test.mjs:40-96` — `FORBIDDEN_ROW_IDS`.** Matched by **row id**, not package name (`:150-157`). Both `'session-title'` (`:46`) and `'session-title-llm'` (`:47`) are listed with the deferral reason at `:42-45`. Mounting the service requires deleting `'session-title'`; if the provider row reuses the reference id `session-title-llm` (as `packages/bundle/base/cordis.patch.yml:67` does), that entry must go too. A fresh id (e.g. `session-title-first-prompt-llm`) leaves the old entry harmless but stale — delete it anyway, since its stated reason is now false.
- **`tests/bundle-packages.test.mjs:86-121`** — nothing to edit: it asserts declared ⇄ mounted ⇄ installed agreement through `doctor`'s "bundle packages" check, and that check scopes product rows to `@ourfairy` (`scripts/combo.ts:491-496`). A native `@deepseek-ai/*` row needs no `backend/v1-bundle/package.json` change; a new `@ourfairy/*` row **would** (declaration + `file:` specifier + `files`).
- **`tests/bundle-groups.test.mjs:39-65`** — the row must sit inside `kernel` or `plugins` (a top-level row fails), and its id must be unique across all rows and groups.
- `tests/ecosystem-boundary.test.mjs:157-180` — the boundary doc must keep pointing at `FORBIDDEN_ROW_IDS` and must not quote the new row/package (checked against the mounted set).
- If a `ctx.sessionTitle` consumer lands, consider adding `sessionTitle` to `REQUIRED_SERVICES` (`baseline-boot.test.mjs:18-26`) so a missing row fails loudly.
