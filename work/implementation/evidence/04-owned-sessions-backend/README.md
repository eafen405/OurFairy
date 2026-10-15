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
that the **pinned combination actually runs**:

- dsh source at the pin (`d3fe98f969c3963c6d193e74c776692e33c1eb64`) supports it:
  `session-format-v3-to-v4/src/codec.ts` encodes and decodes the V4 `owner`
  header key, and `session-persistence-jsonl/src/index.ts:1181` keeps it.
- The launched backend does not: the built CLI the launcher runs
  (`apps/cli/lib`, built 2026-10-15 00:08) contains no `owner` header support —
  `grep` for the V4 owner key and for `expected format v4 physical Session header`
  finds nothing in the built artifacts.

So the header we persist is written without the owner, and the very next request
sees an ownerless artifact. The product code is written against the documented,
real public API; this is a stale/partial build-artifact problem in the pinned dsh
combination, not a product-logic decision. Two candidate fixes, for the Lead:

- refresh `apps/cli/lib` in the dsh product branch from the current source
  (`pnpm run build:lib:host`) and re-pin `combo.json`, or
- if the build cannot be refreshed under this ticket, prove with a dsh-side
  `vitest` run that `persistence.persistHeader(header-with-owner, 0)` +
  `stat(id)` round-trips `owner`, which would separate "product wiring wrong"
  from "running build stale".

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
