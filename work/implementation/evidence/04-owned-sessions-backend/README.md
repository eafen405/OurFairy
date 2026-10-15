# #27 backend: owned sessions and a fixed primary — evidence

**Status: backend acceptance is green.**
`node --test tests/owned-sessions.test.mjs tests/identity-http.test.mjs`
passes **13/13** (5 session + 8 identity tests). Android and future message,
subscription and control behavior are outside this backend result.

## The actual cause of the earlier 409 (corrected)

An earlier revision of this file asserted a **persistence blocker**: that
`SessionHeader.owner` is dropped on the way through the pinned runtime's
persistence, so `persistence.stat(primaryId)` returns a header with no owner.

**That claim was unsupported and was wrong.** The persisted header was never
observed losing `owner`. The real defect was a property lookup in our own
`backend/sessions/src/service.mjs`:

- `#headerOf(id)` returns `await this.persistence.stat(id)`, which is a
  **snapshot** `{header, revision, ...}`, not a bare `SessionHeader`.
- `#ownedHeader` read it correctly as `snapshot.header.owner`.
- `create` and `primary` read `existing.owner` against that same snapshot. That
  property is **always `undefined`**, so every repeat create/primary took the
  `sessions/unowned-primary` branch and answered 409.

One property lookup. No dsh change, no new format catalog, and no runtime
artifact rebuild was needed or made. The failed logs from the wrong hypothesis
are kept below on purpose: they are what actually ran at the time.

The snapshot/header distinction is now documented at `#headerOf` so the next
reader does not repeat it.

## Second defect found and fixed: coalescing vs. serialization

`#exclusively` **coalesced every operation for an owner** — a second request
returned the first request's in-flight promise. So a `/primary` racing a
`/create` could be handed the create's ordinary session, violating the fixed
main contract.

It now **serializes**: each operation chains onto the owner's tail promise and
runs after the one before it, returning *its own* result. The queue is still
per-request state cleared in `finally` (no lock framework, nothing left behind
after a failure). `/primary` therefore always resolves the deterministic main;
separate `/create` requests each mint their own ordinary session.

## Concurrent create+primary test (public, over real HTTP)

`tests/owned-sessions.test.mjs` → *"a primary request racing a create still
resolves the fixed primary session"* fires `/sessions/create` and
`/sessions/primary` together for an identity that owns nothing, asserts the
primary response is `primary: true` and stable across a repeat call, asserts
exactly one primary is listed, then fires two concurrent creates and asserts
they get distinct non-primary sessions and do not move the binding.

**Red proof.** With `#exclusively` reverted to the coalescing version, the same
test fails (`AssertionError: two concurrent creates must each get their own
ordinary session`) — the coalescing behavior returns one session to both
callers. With serialization it passes.

## What was built

`backend/sessions/` is a product module (`@ourfairy/dsh-sessions`) mounted by
`backend/v1-bundle/cordis.patch.yml` and linked by `scripts/ourfairy-backend.mjs`.

- **No second ownership store.** The untracked draft
  `backend/sessions/src/store.mjs` (a second SQLite file with a duplicated
  `user_short_id` + `owner` column) was deleted, not landed. `SessionHeader.owner`
  is the only ownership authority.
- **The fixed primary is derived, not stored.** `primarySessionIdOf(shortId)` →
  `ourfairy-user-<shortId>-primary`. Short numbers are permanent and never
  recycled, so the binding is identical across restarts with no extra column.
  Ordinary sessions use `sessionIdOf(shortId)` → `ourfairy-user-<shortId>-<uuid>`;
  the store's process-local `session-<n>` counter is not used, because it
  restarts at 1 and would collide with a persisted id.
- **Owner is checked before content and before any write path.** read/select/
  primary/list go through `persistence.stat` / `persistence.list`, reading a
  stored header and nothing else. An unknown id, an ownerless header, and a
  foreign header are all refused before any handle exists. A reserved primary
  with an absent or foreign owner is refused (409), never adopted or rebound.
- **HTTP duplication was removed.** `backend/identity/src/http.mjs` exports
  `postHandler`, `sendJson`, `readJsonBody`; the sessions module imports them.
  Identity's own behavior is unchanged (regression green).
- **No dsh changes**, no `combo.json` change. The earlier implementation called
  JSONL's `persistHeader` implementation method; the finish below replaces it
  with the declared persistence interface.

## Formal persistence and failed-create recovery

At pinned dsh `d3fe98f`, `packages/session/session-persistence/src/index.ts`
declares `create(header, options?): Promise<SessionHandle>`, `open`, `flush`,
`stat` and `list`. `SessionHandle.flush()` explicitly materializes empty
sessions. `persistHeader` is not declared by the service; it belongs to the
JSONL implementation's storage collaborator. Its direct use also skipped
registering a writer for subsequent live events.

The product now uses `SessionStore.prepare` → `persistence.create` →
`handle.flush` → an owned effect containing `enter`/`announce`. A persistence
failure closes the handle while the session is still unpublished, so a retry
does not collide with an abandoned live session. The successful handle stays
open: JSONL routes `session/event` and `SessionStore.flush(session)` to that
writer, and closes it on session disposal or persistence teardown
(`session-persistence-jsonl/src/storage.ts`, `JsonlBackendTracker.install`).
Future #28 code must reuse that live session/writer, not create a second writer.
Cold message resume is still #28 work; these read/select endpoints return only
the authorized header.

`OwnedSessionService` follows the existing identity module's Cordis `Service`
pattern and publishes the one instance as `ctx.ourfairySessions`. The next
consumer can inject that service to reuse the same ownership checks and
per-owner operation queue. Its package already declares the Cordis peer and
exports this service; no additional registry or ownership state was added.

The HTTP regression places a regular file at JSONL's `_no-cwd` directory,
causing a real filesystem materialization error. After removing it, another
create in the **same backend process** must succeed. Before the fix, the retry
returned 500 because the first call left a duplicate live session
(`red-06-durable-retry.log`); after the fix it passes. No persistence mock or
product fixture endpoint was added.

## Cold ownerless and foreign refusal without writes

`backend/sessions/test-support/persist-fixtures.mjs` is a test-only profile row.
It uses public `sessions.prepare`, `sessionPersistence.create`, handle `flush`
and `close` to persist three empty current-format sessions: an ownerless
reserved primary, a known foreign session, and a reserved primary with a
foreign owner. It never enters them into the live store. The test stops that
process, removes the fixture profile row, then restarts the product.

Both an ordinary user and the administrator receive 403 on ownerless
read/select and 404 on a known foreign id. Reserved ownerless primary
create/primary return 409 `sessions/unowned-primary`; foreign primary collision
returns 409 `sessions/primary-taken`. The fixture's real owner can read/select
their own header; anonymous read/select are 401. None of these operations
changes any durable log: SHA-256 and nanosecond mtime for every artifact are
compared before restart and after all requests. `green-05-cold-and-retry.log`
records the fixture ids, hashes and mtimes after that equality assertion.

Authenticated requests naming the foreign id under `/api/sessions/read`,
`select`, `subscribe`, `control` return 404, as do the unregistered product
subscribe/control routes. The actual composition has only the connection
`/api` prefix carrier, identity paths and the five owned-session paths; no
shared session RPC/query route is mounted. No claim is made about future
handlers. This is current-format data with optional owner absent, not a
hand-written historical JSONL or malformed artifact.

## Commands actually run

All from `.worktrees/04-owned-sessions` (ticket/04-owned-sessions).

1. `git merge integration/ourfairy-v1` — merged `de2ded1` at the time (fast).
2. `node --test tests/owned-sessions.test.mjs` → `red-01-baseline.log`, **EXIT=1**.
   Both tests fail with `404 !== 200` / `404 !== 401`: the `/sessions/*` routes did
   not exist. This is the red evidence the pre-existing commit lacked.
3. After implementation: → `green-01.log`, **EXIT=1**. Routes mounted;
   authorization test passes; first create works (the response carries
   `owner: user:<n>` from the live header — the very evidence that disproved the
   persistence hypothesis). Repeat create fails `409 sessions/unowned-primary`.
4. → `green-02.log`, **EXIT=1**, same failure, after removing `sessions.flush` to
   test whether the store's flush path overwrote the header. It did not.
5. After fixing the snapshot/header lookup and serializing per-owner
   operations: → `green-03.log`, **EXIT=0**, 3/3 pass.
6. `node --test tests/identity-http.test.mjs` → `regression-identity.log`, 8/8 pass,
   after the shared HTTP helper extraction.
7. Initial sandbox attempt for the new retry test timed out before test output
   (`red-05-durable-retry.log`). Retrying with authorized host loopback execution
   exposed a fixture setup ENOENT (`red-05-durable-retry-host.log`); after creating
   the parent directory, the real failed-retry red was captured in
   `red-06-durable-retry.log` (**3 pass, 1 fail**).
8. After the formal handle lifecycle fix and cold fixture extension:
   `node --test tests/owned-sessions.test.mjs tests/identity-http.test.mjs`
   → `green-05-cold-and-retry.log`, **13 pass, 0 fail**. Host execution was used
   for the real loopback backend, without a model/cloud request.
9. The same command after publishing `ctx.ourfairySessions`
   → `green-06-published-service.log`, **13 pass, 0 fail**.

### Merge state

`doctor` is what caught the real merge state: it failed with *"worktree HEAD is
not based on integration/ourfairy-v1 (f8bb706…)"*, i.e. integration had moved
past `18e8227`. After `git merge integration/ourfairy-v1` (clean, no conflicts,
merge commit `296def5`):

- `git merge-base --is-ancestor f8bb706 HEAD` → **true**
- `node --test tests/lifecycle.test.mjs tests/owned-sessions.test.mjs tests/identity-http.test.mjs`
  → **14/14 pass, 0 fail**, including `doctor` → `green-04-postmerge.log`

The earlier note that the branch merged only `de2ded1` described the merge at
the time it was written, not the current ancestry.

## Remaining gates (honest status)

- **Done:** create → restart → list/read/select/primary with unchanged owner and
  main; two users cannot read or select a known other's id before content;
  administrator gets the same own-only rule; anonymous refused on all five
  paths; concurrent primary-vs-create and concurrent creates; genuinely
  persisted cold ownerless/foreign fixtures and reserved-primary collisions
  refused with unchanged artifact hashes/mtimes; failed-write retry succeeds;
  no mounted `/api` bypass for a known foreign id in the current composition.
- **Earlier evidence corrected:** the original second test used nonexistent ids
  `session-1` and `not-a-session`, not persisted ownerless sessions. There was no
  proved "hot ownerless" gate. The cold test above supplies actual ownerless
  persisted data. It does not test migration of incompatible historical data.
- **Not done by design:** no `/sessions/subscribe` or `/sessions/control` routes
  (they stay unregistered), no Android work, no issue closure, and no push.

## Raw logs

- `red-01-baseline.log` — 404 on every `/sessions/*` path (red, routes absent)
- `green-01.log` — routes mounted; authorization passes; repeat create 409
- `green-02.log` — same, without `sessions.flush` (wrong-hypothesis probe)
- `green-03.log` — 3/3 pass after the snapshot/header and serialization fixes
- `regression-identity.log` — identity suite 8/8 after shared HTTP helpers
- `red-05-durable-retry.log` — restricted sandbox run timed out
- `red-05-durable-retry-host.log` — initial failure-test setup ENOENT
- `red-06-durable-retry.log` — actual failed-write retry exposes live duplicate
- `green-05-cold-and-retry.log` — 13/13, with cold fixture durable hash/mtime evidence
- `green-06-published-service.log` — 13/13 after the service publication
