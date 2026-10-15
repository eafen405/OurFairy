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

- duplicate name: `SELECT 1 FROM users WHERE name = ? AND deleted_at IS NULL` before insert in `register`
- short-number allocation: `SELECT COALESCE(MAX(short_id), 0) + 1 FROM users` inside the same transaction
- association existence: the admin row is loaded and checked in `createInvite`

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
- every write sets `updated_at`: user insert, Phaethon password update, invite
  insert, invite redemption, session insert, sign-out revocation, removals
- `revoked_at` is untouched and still means credential revocation only; it is not
  used as a substitute for business deletion

Number allocation reads `MAX(short_id)` over **all** rows including deleted ones,
so a removed identity's short number is never reissued. Verified: after removing
short numbers 3 and 4, the next registration got 4.

Two store-level soft-delete methods were added — `removeUser(shortId)` and
`removeInvite(code)` — because a logical-deletion field that can never be written
is not a deletion field. They are plain store methods with no HTTP surface.

## Schema migration (v1 → v2)

One local migration, reusing the existing `meta.schema_version`. The migration runs
in a single `BEGIN IMMEDIATE` transaction, so it either lands whole or not at all.

- a file with no recorded version is new and already carries the v2 shape
- `schema_version = 1` is migrated by rebuilding each table through a temporary
  `<table>_v1` table (`ALTER TABLE ... RENAME` → create current DDL → copy columns
  → drop), which is the only way SQLite drops a UNIQUE constraint or a REFERENCES
  clause. This is the temporary table use the task allows; no other new table exists
- the copy carries every v1 value across, ids included: `updated_at` is seeded from
  `created_at` and `deleted_at` from `NULL`
- a version **newer** than 2 (or a non-integer one) is refused with
  `IdentityError(500, 'identity/schema-too-new')` rather than downgraded

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
✔ migrating a genuine v1 database (132.02723ms)
✔ the stored schema obeys AGENTS.md (27.238134ms)
green exit: 0
```

RED was captured on the same test file with the two source files reverted
(`git stash push -- backend/identity/src/store.mjs backend/probe/src/index.mjs`),
so it shows the findings rather than a broken fixture — `red-store.log`, exit 1,
6 failing tests.

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
