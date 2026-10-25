# @ourfairy/dsh-identity

The product's identity kernel: users, short numbers, invites and login
credentials in a business SQLite file this package opens, the `/identity/*`
request paths, and the second credential that admits one of its session tokens
to dsh's `/api`.

## Owns

In one sentence: the product's users, short numbers, invites and login
credentials, the business SQLite file that holds their rows and the group,
upload and delivery coordination rows, and the request paths plus dsh
credential that speak for them.

- Users, short numbers, invites, the administrator flag, and hashed session
  tokens, including seeding Phaethon and keeping a removed identity's short
  number reserved.
- The business SQLite file itself, and the narrow faces other product rows read
  it through: `users`, `groups`, `uploads` and `deliveries`. Group membership,
  upload lifetime and delivery coordination rows are stored here; the behaviour
  over those rows belongs to the packages that call the faces.
- The `user:<shortId>` owner codec exported as `./owner`, which writes and reads
  `SessionHeader.owner`.
- The `/identity/*` paths, their POST body/error envelope, and the
  `ourfairy-identity` authenticator Connection consults for a session token.
- The `/identity/agents` roster: every live agent's short number and name, and
  nothing else about them.

## Does not own

- dsh's session records: it writes no session log, header or event, and decides
  no session ownership — that is [`@ourfairy/dsh-sessions`](../sessions/README.md).
- Group tools and group file roots ([groups](../groups/README.md)), the upload
  protocol and attachment store ([attachments](../attachments/README.md)), and
  delivery behaviour ([delivery](../delivery/README.md)); it owns only the rows
  and faces those packages coordinate through.
- Admission to `/api` itself: Connection applies the principal this package
  resolves and keeps the Host/Origin fence.
- The HTTP carrier, the listener and the Host/Origin policy.

## dsh seams

| Seam | Used for |
| --- | --- |
| cordis `Service` | exposing the module as `ctx.identity` |
| `webServer.register({ kind: 'exact', path, handler })` | mounting each `/identity/*` path; each registration is released through `ctx.effect` |
| `connection.fence(request)` | rejecting an untrusted Host or Origin before a handler runs |
| `connection.authenticators.register({ name, identify })` | admitting an identity session token to `/api` as the `user:<shortId>` principal |
| `connection.revokePrincipal(principal)` | revoking that admitted scope on sign-out |
| `@deepseek-ai/schemastery` `Config` | declaring the row's validated fields to the loader |

It injects `webServer` and `connection`.

## Service

`ctx.identity`, exposing `authenticateRequest(request)` and the `users`,
`groups`, `uploads` and `deliveries` faces. The store behind the faces is the
SQLite file this package opens.
