# #27 backend: owned sessions and a fixed primary — evidence

**Status: the product tests are green.** `node --test tests/owned-sessions.test.mjs`
passes 3/3 and the identity regression is unchanged. What is *not* claimed is marked
under "Remaining gates".

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
- **No dsh changes**, no `combo.json` change, and no guessed API: only
  `ctx.sessions` and `ctx.sessionPersistence` are used.

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

### Merge state

`git merge-base --is-ancestor 18e8227 HEAD` → **true**. `18e8227`
("pin the reviewed session export consumer") is already an ancestor of this
branch; the merge bringing it in is `ffff103`. The earlier note that the branch
merged only `de2ded1` described the merge at the time it was written, not the
current ancestry.

## Remaining gates (honest status)

- **Done:** create → restart → list/read/select/primary with unchanged owner and
  main; two users cannot read or select a known other's id before content;
  administrator gets the same own-only rule; anonymous refused on create/list/
  primary; concurrent primary-vs-create and concurrent creates; unknown shared
  `/api` route probed at the current composition (admission is covered by the
  identity suite: anonymous `/api` is refused at the door with 401, and an
  authenticated `/api` request reaches a 404 because no session endpoint is
  mounted there — so no product session content is reachable through `/api`).
- **NOT executed:** the genuinely ownerless **cold** legacy fixture — a persisted
  session with no owner, created while the backend is stopped, proving refusal
  before any repair or write. The code path (`persistence.stat` → 409
  `sessions/unowned-primary`, no write) is implemented and the *hot* ownerless
  and foreign cases are green, but the cold fixture was not built and this gate
  is therefore unproven.
- **Not done by design:** no `/sessions/subscribe` or `/sessions/control` routes
  (they stay unregistered), no Android work, no issue closure, and no push.

## Raw logs

- `red-01-baseline.log` — 404 on every `/sessions/*` path (red, routes absent)
- `green-01.log` — routes mounted; authorization passes; repeat create 409
- `green-02.log` — same, without `sessions.flush` (wrong-hypothesis probe)
- `green-03.log` — 3/3 pass after the snapshot/header and serialization fixes
- `regression-identity.log` — identity suite 8/8 after shared HTTP helpers
