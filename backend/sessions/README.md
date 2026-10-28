# @ourfairy/dsh-sessions

The product's session kernel: which authenticated identity owns a dsh session,
and which of that identity's sessions is its fixed primary session. It stores
nothing of its own.

## Owns

In one sentence: the ownership decision and the primary-session binding, exposed
as `ctx.ourfairySessions` and the `/sessions/*` paths.

- `SessionHeader.owner` as the ownership record, written through the
  `user:<shortId>` codec from `@ourfairy/dsh-identity/owner`.
- The deterministic primary id `ourfairy-user-<shortId>-primary`, created on
  first use; ordinary sessions get a UUID id under the same namespace so a
  restart of dsh's `session-<n>` counter cannot collide with them.
- The ownership check: an unknown or foreign session answers the same 404; on
  `/sessions/read` and `/sessions/select` an ownerless header answers 403
  `sessions/unowned-session`, and on `/sessions/primary` and `/sessions/create`
  an ownerless reserved primary answers 409 `sessions/unowned-primary` — neither
  is adopted. The check runs before any handle is opened. `/primary` and
  `/create` are serialized per owner so a race cannot observe "no primary" twice.
- The one-shot event read exported as `./events`: `readSessionEvents` opens an
  observation, returns its events and cursor, and disposes it in `finally`.
- The empty-session rule on `/sessions/create`: a session whose log carries no
  message event is entered again instead of duplicated — the primary while it is
  still empty, otherwise the newest empty ordinary session; only a session that
  already has a message forces a new ordinary session.
- The address `/sessions/rename`. It belongs to this family, but this package
  does not serve it: a rename is accepted only on a live session, and opening one
  is [`chat`](../chat/README.md)'s job. The path constant
  (`SESSION_RENAME_PATH`) lives here so the family publishes each address once;
  chat registers the handler.

## Does not own

- Session storage, headers, logs or events. `sessions` creates the header and
  `sessionPersistence` writes and reads it; this package reaches session records
  through that seam.
- Users, short numbers or credentials. [`identity`](../identity/README.md)
  resolves the caller; this package only compares the resulting owner.
- Message content, transcripts or projections; [`chat`](../chat/README.md) owns
  those. Reading events here decides only whether a log already has a message;
  it never projects or interprets the content.

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
| `sessionQuery.observeSession(id, { projectionMode: 'none' })` | the exported one-shot read in `./events`, used by create to decide whether a session's log already has a message |

It also uses `postHandler` and `ownerOf` from `@ourfairy/dsh-identity` for the
fence/body/envelope and the owner format.

## Service

`ctx.ourfairySessions`, exposing `authenticate(request)`, `create(owner)`,
`primary(owner)`, `list(owner)`, `read(owner, sessionId)` and `expose(header,
shortId)`. `create` returns the caller's empty session when one exists (the
primary first, then the newest empty ordinary) and only materializes a new
ordinary session otherwise. It injects `webServer`, `connection`, `identity`,
`sessions`, `sessionPersistence` and `sessionQuery`.
