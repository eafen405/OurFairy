# Stage review #24–26 — backend standards fixes

Branch `fix/review-24-26-backend`, based on `integration/ourfairy-v1` at `de2ded1`.
Scope: findings 1, 2, 3 of `/tmp/ourfairy-stage-review/standards.md`.

## Finding 1 — forbidden UNIQUE and REFERENCES constraints

`backend/identity/src/store.mjs` no longer declares any UNIQUE constraint or
`REFERENCES` clause in `users`, `invites`, or `sessions`. Ordinary primary keys
(`users.id`, `invites.code`, `sessions.digest`, `meta.key`) are kept; they are
primary keys, not secondary unique indexes.

Every duplicate refusal is now an explicit check inside the existing
`BEGIN IMMEDIATE` transaction, so concurrency and atomicity protection is
unchanged — no transaction was weakened and no generic storage framework was
introduced:

- duplicate name: `SELECT 1 FROM users WHERE name = ?` before insert in `register`
  and in `seedPhaethon`
- short-number allocation: `SELECT COALESCE(MAX(short_id), 0) + 1 FROM users` inside the same transaction
- association existence: the admin row is loaded and checked in `createInvite`

Both name checks read **all** rows, deleted ones included, so a login name is
reserved for good once issued. That is the original invariant, kept deliberately:
the store does not promise that a removed identity's name can be taken again.

`PRAGMA foreign_keys = ON` is gone; the connection now sets `PRAGMA foreign_keys = OFF`
because a legacy v1 file may still carry those clauses and the rebuild must not enforce them.

Lookup indexes added, ordinary and non-unique: `users_by_short_id`, `users_by_name`
(alongside the pre-existing `sessions_by_user`).

## Finding 2 — logical deletion and update timestamps

`users`, `invites`, and `sessions` each gained `deleted_at` (logical deletion) and
`updated_at`. The existing person association columns are kept and are the
associations the tables already had: `invites.created_by`, `invites.redeemed_by`,
`sessions.user_id`. No new table, no admin API, no HTTP route was added.

- every read filters `deleted_at IS NULL`, including the `authenticate` join, so a
  removed user or session cannot authenticate
- every write sets `updated_at` from a single `now` value: user insert, Phaethon
  password update, invite insert, invite redemption, session insert, sign-out
- `revoked_at` is untouched and still means credential revocation only; it is not
  used as a substitute for business deletion. `signOut` skips a session that is
  already logically deleted or already revoked instead of re-stamping it

Deletion is a **stored state, not a store operation**. No removal API exists on
`IdentityStore`: nothing in the product or in #24/#26 asks for one, and a
speculative management surface is not part of this fix. The tests plant the
tombstone by writing `deleted_at` through a real `node:sqlite` connection against
the durable file, then verify behaviour only through the public API (sign-in,
authentication, listing, invite state, seeding). Short numbers and login names
stay reserved afterwards.

Number allocation reads `MAX(short_id)` over **all** rows including deleted ones,
so a removed identity's short number is never reissued. Verified: after tombstoning
short numbers 3 and 4, the next registration got 4.

## Seeding over a removed Phaethon

`seedPhaethon` looks up short number 1 across **all** rows. A live Phaethon is
returned as before; a row that exists but is logically deleted is refused with
`IdentityError(409, 'identity/phaethon-removed')` instead of being silently
recreated beside itself, which would have produced a second `short_id = 1`. An
initial seed whose name is already owned by another row is refused with
`identity/name-taken`, reusing the same in-transaction check `register` already
performs. No validator framework was added.

## Schema migration (v1 → v2)

One local migration, reusing the existing `meta.schema_version`. The version is
**read and every schema change happens inside one `BEGIN IMMEDIATE` transaction**,
so a second opener cannot decide on a stale version and then rebuild the file a
second time, discarding columns a newer writer added.

- a file with no recorded version is new and already carries the v2 shape
- `schema_version = 1` is migrated by rebuilding each table through a temporary
  `<table>_v1` table (`ALTER TABLE... RENAME` → create current DDL → copy columns
  → drop), which is the only way SQLite drops a UNIQUE constraint or a REFERENCES
  clause. This is the temporary table use the task allows; no other new table exists
- the copy carries every v1 value across, ids included: `updated_at` is seeded from
  `created_at` and `deleted_at` from `NULL`
- a version **newer** than 2 (or a non-integer one) is refused with
  `IdentityError(500, 'identity/schema-too-new')`, and the check runs **before any
  DDL**, so a refused file is left untouched. Only `1` and `2` are known: an
  integer below 2 that is not 1 is refused too, rather than treated as v1
- a constructor whose initialization fails closes its database handle before
  rethrowing

Preserved across the migration, verified by the test: row ids, password hashes,
unredeemed invites, redeemed invites, and unrevoked session digests.

## Finding 3 — speculative ToolRuntime probing

The seven-name guessing loop in `backend/probe/src/index.mjs`
(`['names', 'list', 'specs', 'describe', 'snapshot', 'all', 'entries']`) is deleted.
`collectTools` now reports `{ available: true, discovery: 'not-enumerable', names: null, count: null }`
directly, with a comment naming why: the pinned dsh `ToolRuntime` exposes no
enumeration API and this probe does not invent one. The `service-absent` report is
kept, and the real tool catalog evidence from the external model double is
untouched. No introspection interface was added to dsh.

## Checks run

Store migration and schema tests (`tests/identity-store.test.mjs`, new — it seeds a
genuine v1 database with the verbatim shipped v1 DDL including its UNIQUE and
`REFERENCES` clauses, then reopens it through the public `IdentityStore`):

```
$ node --test tests/identity-store.test.mjs
✔ migrating a genuine v1 database
✔ seeding against a deleted Phaethon
✔ the stored schema obeys AGENTS.md
ℹ tests 16  ℹ pass 16  ℹ fail 0
green exit: 0
```

RED for this follow-up round was captured on the new tests with only
`backend/identity/src/store.mjs` reverted (`git stash push -- backend/identity/src/store.mjs`),
so it shows the four corrections rather than a broken fixture —
exit 1, 4 failing tests: the reserved deleted name, the
deleted Phaethon, the duplicate initial seed name, and sign-out of a deleted
session. The earlier  (exit 1, 6 failures) covers the original
findings.

Identity HTTP acceptance against the **real launcher** was rerun after the store
change — see the suite output above in, 8 passing, exit 0.

Manual schema inspection (raw `node:sqlite` against a migrated file, not a
compilation pass) confirmed for every business table:

```
-- users index_list --
{"name":"users_by_name","unique":0,"origin":"c"}
{"name":"users_by_short_id","unique":0,"origin":"c"}
-- users foreign_key_list -- []
-- users columns -- id, short_id, name, is_admin, password, created_at, updated_at, deleted_at
```

with `users`, `invites`, `sessions` and `meta` all reporting an empty
`foreign_key_list`, no `unique` in any stored `sqlite_master.sql` for the business
tables, and only `sqlite_autoindex_*` primary-key indexes left.

Identity HTTP acceptance against the **real launcher** (no mocks; it boots
`scripts/ourfairy-backend.mjs start` and speaks HTTP to the listener it bound):

```
$ node --test tests/identity-http.test.mjs
✔ the provisioned Phaethon signs in as short number 1
✔ invited agents take the next short numbers in registration order
✔ refused registrations leave no identity and consume no short number
✔ an ordinary agent is refused the administrator invite operation
✔ the credential names its own holder with no user field in the request
✔ signing out ends the credential it was presented with
✔ a session credential admits dsh /api while an anonymous request is refused at the door
✔ concurrent registrations never share a short number and never half-succeed
ℹ pass 8  ℹ fail 0   exit: 0
```

The concurrency case is the one that matters most for finding 1: with the UNIQUE
constraints gone, racing registrations still never share a short number and never
half-succeed, because the `BEGIN IMMEDIATE` transaction is what prevents it.

## Limitations

- `tests/baseline-boot.test.mjs`, `tests/lifecycle.test.mjs`, and
  `tests/model-double.test.mjs` were not run in this session; only the two identity
  suites above were. They must be rerun unchanged on the host before integration.
- `tests/identity-store.test.mjs` asserts schema facts by opening the same durable
  SQLite file with `node:sqlite`. That is intentional and outside the product
  boundary on purpose: it inspects the file, while every behavioural assertion goes
  through the public `IdentityStore` API only.
- Loopback was available in this environment, so the real-launcher HTTP run
  completed here rather than being deferred to the host.

## Lead final verification

The complete existing product suite was rerun against this worktree on the host: `node --test 'tests/**/*.test.mjs'` → 34 passed / 0 failed.. The final inspection also made the durable schema branch explicitly accept current v2 or migrate v1, and reject other unsupported versions rather than silently continuing. No real cloud service or device check is implied.
