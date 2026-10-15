# #27 backend: owned sessions and a fixed primary — evidence

**Status: NOT ACCEPTED. The product tests are red at the time of writing.** This file
records what was actually executed, what passed, and the exact blocker found.

## What was built

`backend/sessions/` is a new product module (`@ourfairy/dsh-sessions`) mounted by
`backend/v1-bundle/cordis.patch.yml` and linked by `scripts/ourfairy-backend.mjs`.

Design decisions taken (and why):

- **No second ownership store.** The untracked draft `backend/sessions/src/store.mjs`
  (a second SQLite file with a `UNIQUE` index and a duplicated `user_short_id` +
  `owner` column) was deleted, not landed. `SessionHeader.owner` — written and
  replayed by dsh's own persistence — is the only ownership authority; a second
  index could disagree with the artifact it describes.
- **The fixed primary is derived, not stored.** One named function,
  `primarySessionIdOf(shortId)` in `backend/sessions/src/service.mjs`, returns
  `ourfairy-user-<shortId>-primary`. Short numbers are permanent and never
  recycled, so the binding is identical before and after a restart with no
  extra column and no second copy to drift. Ordinary sessions use
  `sessionIdOf(shortId)` → `ourfairy-user-<shortId>-<uuid>`; the store's
  process-local `session-<n>` counter is not used, because it restarts at 1 and
  would hand out an id that already belongs to a persisted session.
- **Owner is checked before content, and before any path that could write.**
  Read/select/primary/list go through `persistence.stat` / `persistence.list`,
  which read a stored header and nothing else. Nothing is opened for write, no
  recovery or repair path is entered, and an unknown id, an ownerless header,
  and a foreign header are all refused before any handle exists. An existing
  reserved primary with an absent or foreign owner is refused (409), never
  adopted or rebound.
- **Concurrency is a per-request promise map, cleared in `finally`.** Two
  concurrent first-creates for one owner cannot mint two handles or move the
  fixed id; nothing persists after the request.
- **HTTP duplication was removed, not copied.** `backend/identity/src/http.mjs`
  now exports `postHandler`, `sendJson`, and `readJsonBody`; the sessions module
  imports them instead of keeping the draft's second copy. Identity's own
  behavior is unchanged.
- **No dsh changes were made** and no guessed API was used; the seams used are
  `ctx.sessions` (`super(ctx, 'sessions')`, core/session/src/index.ts:1084) and
  `ctx.sessionPersistence` (`super(ctx, 'sessionPersistence')`,
  session-persistence/src/index.ts:142).

## Commands actually run

All from `.worktrees/04-owned-sessions` (ticket/04-owned-sessions).

1. `git merge integration/ourfairy-v1` — merged `de2ded1` (fast, no conflicts).
2. `node --test tests/owned-sessions.test.mjs` → `red-01-baseline.log`, **EXIT=1**.
   Both tests fail with `404 !== 200` / `404 !== 401`: the `/sessions/*` routes
   did not exist. This is the red evidence the pre-existing commit lacked.
3. After implementation: `node --test tests/owned-sessions.test.mjs` →
   `green-01.log`, **EXIT=1**. Routes now exist. Test 2
   ("an unowned or foreign session is refused…") **passes**: anonymous callers
   get 401 `sessions/unauthorized`, a stranger gets 404 `sessions/unknown-session`
   for a known id, unknown ids are refused, the administrator's list is empty.
   Test 1 fails at the *second* create:
   `409 sessions/unowned-primary` — the stored header for the primary id comes
   back from `stat` with **no `owner`**.
4. `node --test tests/owned-sessions.test.mjs` → `green-02.log`, **EXIT=1**, same
   failure, after removing `sessions.flush` to test whether the store's flush
   path was overwriting the header. It was not.

## The blocker (not yet resolved)

`SessionHeader.owner` does not survive the round trip through the persistence
that the **pinned combination actually runs**: after a successful first create,
`persistence.stat(primaryId)` returns a header with **no `owner`**, so the very
next request is refused with 409 `sessions/unowned-primary`.

What was actually verified, and what was not:

- Verified: the first create works end to end — the response carries
  `owner: user:<n>` from the live `session.header`, so `SessionStore.create(id,
  { meta: { owner } })` does put the owner on the in-memory header
  (core/session/src/index.ts:1187).
- Verified: removing `sessions.flush` does not change it (`green-02.log`), so the
  store's flush path is not overwriting the header.
- Verified: no production code in dsh calls `persistence.create()` when a
  session is created, so nothing else registers a pending tracked entry that
  could shadow the artifact `stat` returns.
- Verified: `combo.json` pins dsh at `d3fe98f969…` and that pin is unchanged by
  the newer `18e8227` ("pin the reviewed session export consumer").
- **Not verified, and my first draft of this file asserted it wrongly:** the
  built CLI artifacts are NOT the cause. `apps/cli/lib` is a bundle of the CLI
  app only — it contains no session packages — so finding no `owner` support
  there proves nothing about the runtime. The correct statement is: `owner` is
  supported in dsh source (session-format-v3-to-v4 `encodeHeader`/`decodeHeader`,
  session-persistence-jsonl `materializeCreateHeader`) but is dropped somewhere
  on the write-or-read-back path in the pinned runtime, and the exact seam has
  not yet been isolated.

The single next step that resolves it, in order of expected value:

1. In the dsh worktree, run a focused `vitest` against the pinned tree proving
   `persistHeader({...header, owner}, 0)` then `stat(id)` round-trips `owner`.
   That one run separates "the runtime drops owner" from "the product wires the
   wrong seam", and needs no product change to run.
2. If the round trip holds there, the remaining suspect is the *format catalog*
   the running composition resolves (a v3 row would drop the V4-only key), so
   compare `SESSION_FORMAT_VERSION` (4, core/session/src/types.ts:122) with the
   catalog row actually mounted by `session-persistence-jsonl`'s config.

Not done: no dsh source edit, no `combo.json` edit, no Android work, no
`/sessions/subscribe` or `/sessions/control` routes (they stay unregistered), and
the identity/admin/`/api` bypass and cold-ownerless-fixture checks that the plan
calls for were not reached because the primary create is not yet green.


## Remaining acceptance gates (unexecuted)

- create → flush → restart → list/read/select/primary with unchanged owner+primary
- concurrent primary requests
- genuinely ownerless / cold legacy persisted fixture refused before any repair/write
- unknown shared `/api` route probed at the current composition for a bypass

## Raw logs

- `red-01-baseline.log` — 404 on every `/sessions/*` path (red)
- `green-01.log` — routes mounted; authorization test passes; primary create fails 409
- `green-02.log` — same failure without `sessions.flush`
