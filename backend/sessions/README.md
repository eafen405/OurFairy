# @ourfairy/dsh-sessions

The product's session kernel: which authenticated identity owns a dsh session,
and which of that identity's sessions is its fixed primary session. It stores
nothing of its own.

## Owns

In one sentence: the ownership decision and the primary-session binding, exposed
as `ctx.ourfairySessions` and the `/sessions/*` paths.

- `SessionHeader.owner` as the only ownership authority, written through the
  `user:<shortId>` codec from `@ourfairy/dsh-identity/owner`. There is no second
  ownership table to keep in step with the session logs.
- The deterministic primary id `ourfairy-user-<shortId>-primary`, created on
  first use; ordinary sessions get a UUID id under the same namespace so a
  restart of dsh's `session-<n>` counter cannot collide with them.
- The ownership check: an unknown or foreign session answers the same 404, an
  ownerless header answers 403 rather than being adopted, and the check runs
  before any handle is opened. `/primary` and `/create` are serialized per owner
  so a race cannot observe "no primary" twice.
- The one-shot event read exported as `./events`: `readSessionEvents` opens an
  observation, returns its events and cursor, and disposes it in `finally`.

## Does not own

- Session storage, headers, logs or events. `sessions` creates the header and
  `sessionPersistence` writes and reads it; this package adds no session rows.
- Users, short numbers or credentials. [`identity`](../identity/README.md)
  resolves the caller; this package only compares the resulting owner.
- Message content, transcripts or projections; [`chat`](../chat/README.md) owns
  those.

## dsh seams

| Seam | Used for |
| --- | --- |
| cordis `Service` | exposing the module as `ctx.ourfairySessions` |
| `webServer.register({ kind: 'exact', path, handler })` | mounting each `/sessions/*` path; each registration is released through `ctx.effect` |
| `connection.fence(request)` | rejecting an untrusted Host or Origin before a handler runs |
| `sessions.prepare(id, { meta: { owner } })` | creating the native header for a session that is being materialized |
| `sessionPersistence.stat(id)` | reading one header snapshot for the ownership check |
| `sessionPersistence.list()` | reading every stored header to filter by owner |
| `sessionPersistence.create(header)` | persisting a new owned header, followed by `flush` and `close` |
| `sessionQuery.observeSession(id, { projectionMode: 'none' })` | the exported one-shot read in `./events` |

It also reuses `postHandler` and `ownerOf` from `@ourfairy/dsh-identity` instead
of keeping a second copy of the fence/body/envelope or the owner format.

## Service

`ctx.ourfairySessions`, exposing `authenticate(request)`, `create(owner)`,
`primary(owner)`, `list(owner)`, `read(owner, sessionId)` and `expose(header,
shortId)`. It injects `webServer`, `connection`, `identity`, `sessions` and
`sessionPersistence`.
