# Skill runtime and creation

The skill row owns the product's skill surface: one SQLite file, the immutable
version directories outside every writable root, one skill provider per live
user session, the read-only contribution that lets an activated package's files
be read, the authenticated endpoints the Skills page uses, and the one
`skill_manage` model tool that creates, inspects and reviews candidates. The
native dsh rows (`skill`, `skill-filesystem`, `tool-skill`) supply catalog
merging, the `skill` tool, `/name` suppression and the trusted bundled root;
this package never re-implements them.

Installation from an address, shared proposals, evolution and background
learning are later tickets in the same spec. They extend this row's store,
service and tool; they do not add a second creation path.

## What the row owns

| Concern | Authority |
| --- | --- |
| Skill identity | `skill` table: name, scope (1 personal, 2 common), owner, current version pointer, archive marker, actors and timestamps |
| Reviewed content | `skill_version` rows plus immutable `versions/<skillId>/<uuid>/` directories |
| Candidates | Pending `skill_version` rows plus isolated `candidates/<uuid>/` directories, never served by a provider |
| Verification | The system-recorded report on the version: command, exit code, timeout, environment and bounded output for each scenario |
| Selection | `skill_user_preference` per user and skill; missing personal row = enabled, missing common row = disabled |
| Catalog | The per-agent provider `ourfairy-skills`, registered on `agent.ctx` for user sessions only |
| Integrity | The provider's `get` and an approval both re-read the package and compare its canonical manifest hash with the stored version |
| Resources | `contributeReadonlyFiles`: the trusted bundled root for every session, plus the current version directories of the caller's catalog winners |
| Model tool | `skill_manage` on user sessions only: `list`, `inspect`, `create`, `review` |
| Client surface | `/skills/list` (pool + pending + count), `/skills/detail`, `/skills/preference`, `/skills/review-open` (POST + JSON, caller from the bearer credential) |

The data root is `dshHomePath('skill')` by default:

```
skill/
  skill.sqlite
  versions/<skillId>/<uuid>/    approved, immutable packages
  candidates/<uuid>/            drafts under review
  tmp/<uuid>/                   staging for candidate writes and imports
  verify/<uuid>/                disposable verification environments (deleted after the run)
```

A version's `package_path` is stored relative to that root, so the root can move.
The row creates the single connection with WAL, versioned migrations and
`BEGIN IMMEDIATE` transactions, following `backend/memory/src/store.ts`.

## Winner and pool rules

For one owner the visible identities are every common identity plus their own
personal ones. A name has at most one personal and one common identity. A
personal identity wins when it is enabled and not archived; otherwise a common
identity wins when it is enabled and not archived. Archived identities never
enter a catalog but stay in the pool so their state is visible. A candidate has
no current version and is not a pool item at all; it appears only in the
separate pending area.

The backend returns every derived fact; the client only renders it:

- `state` numeric: 1 in catalog, 2 shadowed, 3 disabled, 4 archived.
- `scope` numeric: 1 personal, 2 common.
- `actions` numeric scope per action: 1 this user, 2 every user. Toggle is
  always this user's own preference; archive/restore scope depends on the
  identity's scope. This ticket only acts on toggle.
- `shadowedBy` carries the personal identity that shadows a common item.
- `pendingRevision` is always false in this ticket; revisions arrive with the
  version-review ticket.

`/skills/preference` re-derives the pool after writing and invalidates that
owner's live provider registration, so the next catalog reflects the change
without a restart. An approval does the same for the owner (or every agent when
a later ticket publishes a common version).

## Package and manifest

The one algorithm lives in `src/package.ts` and runs on import, on candidate
creation, on approval and again on activation:

- `SKILL.md` must start with a `---` frontmatter line closed by another `---`.
  The reader accepts a flat map of single-line `key: value` entries, quoted
  scalars and `true`/`false`. It refuses nested YAML, block scalars, anchors and
  tags instead of silently misreading them; the native filesystem provider
  reads the same file with a full YAML parser, so accepted product packages are
  accepted by both.
- Required `name` (kebab-case) and `description` (non-empty, at most 500
  Unicode code points). Optional `user-invocable` boolean, `license` string,
  `whenToUse` and `not-applicable` strings; the last two feed the review
  display's applicability block.
- The body after the frontmatter is at most 8000 Unicode code points.
- The manifest walks the package recursively, rejects symlinks and non-regular
  files, sorts entries by POSIX relative path, and records
  `{path, type: 'file', sha256, executable}`. The manifest hash is the SHA-256
  of the canonical JSON of that array. File times, owners and the rest of the
  mode bits are excluded.
- Package paths must be relative, use `/`, and contain no empty, `.`, `..`,
  drive-letter or control-character segment. `writeSkillPackage` additionally
  refuses duplicate paths and a path that is also another entry's directory.
  Text files must not embed an author-machine absolute home path
  (`/home/<name>/…` or `/Users/<name>/…`); use a relative package path or a
  neutral example. Binary resources are skipped by that scan.
- Candidate creation writes model-supplied files into `tmp/<uuid>/`, re-reads
  them with this algorithm, moves the directory into `candidates/<uuid>/` and
  only then inserts the pending version. Import copies a reviewed package the
  same way before the store transaction moves it into `versions/`; a source that
  changed between validation and copy is refused, so the recorded hash always
  describes the stored bytes.

Activation (`provider.get`) re-checks the version is still current, approved
and visible, the caller still wins the name, and the on-disk package still
hashes to the approved value. A mismatch throws
`skill package integrity check failed for <name>`; the native tool reports a
failed call and the chat projection shows no activation row.

## Creation, verification and review

`skill_manage create` is explicit creation from the caller's own exchange:

- `focus` resolves against the durable log: the current/latest turn by default,
  a numbered turn, or the latest turn plus the user's task statement. The
  resolved range (`turn`, `startSeq`, `endSeq`, the tool names it requested and
  the session id) is the version's provenance in `source_location`.
- The caller's owner and session are derived, never submitted. Only personal
  scope is accepted in this ticket; a common candidate needs the sharing
  ticket's explicit-turn rule.
- `files` must contain `SKILL.md` and the complete package. The backend stages,
  validates and hashes it; the model cannot choose a landing path, a manifest
  hash or a verification result.
- A name that already has an approved current version is refused; that path
  needs a revision (evolution ticket). While an identity has no approved
  version, a new draft may join it — that is how a change request becomes a
  re-verified draft with a new hash.
- At least one representative scenario is required. `src/verify.ts` copies the
  candidate into a fresh `verify/<uuid>/work/`, runs each `/bin/bash -lc`
  command under bwrap with a disposable HOME/TMPDIR/cache and network shared,
  and records the real exit code, duration, environment and bounded output.
  The shared environment root, spaces roots and session roots are not mounted.
  A missing bwrap marks the report incomplete; approval refuses it. `reused`
  stays empty in this ticket (the evolution ticket fills it).
- The candidate never enters a provider. Only an approved `versions/` package
  becomes a catalog winner.

`skill_manage inspect` returns the read-only review package and a
deterministic `display` composed by the backend, never by the model. The four
blocks are candidate identity/manifest hash and core-body change, applicability
and benefit, package changes plus the real executed/unexecuted/failed records,
and how to expand the full text (`expand: "skill"` or `expand: "files"` with a
package-relative `path`). The display is bounded; the full text is opt-in.

`skill_manage review` records the owner's decision for a pending version.
Approval re-reads the version status, the on-disk manifest hash, a complete
verification report and the archive state, then renames the candidate into
`versions/<skillId>/<uuid>/` and moves the current pointer in one
`BEGIN IMMEDIATE` transaction (the previous current becomes superseded). A
failure renames the directory back. The first personal approval with no
preference row enables the owner; an explicit preference always survives.
`request_changes` and `reject` settle the row; an old approval or verification
never carries over to a new hash, and repeated approvals lose the
`status = pending` predicate, so exactly one decision wins.

## Review entry

`POST /skills/review-open {versionId}` checks the caller may review that
candidate, resolves the caller's fixed primary session and appends one
`user/message` whose source is `{kind:'skill-review', form:'instructions',
versionId, manifestHash}`. `appendOnce` dedupes by candidate, so opening the
same pending item twice adds no second reference. The chat transcript fold
ignores every non-`user` source, so the reference is model context without a
user bubble. The client then opens the returned session id.

## Deployment seed and bundled Skill Creator

- `OURFAIRY_BUNDLED_SKILLS_DIR` points at `backend/skill-creator/bundled`, the
  only root the native filesystem provider scans (`includeDefaultRoots: false`,
  `watch: false`). The bundled `skill-creator` package is a native `bundled`
  skill: every agent sees it in its catalog and it is never written to the
  database. Its body is the creation contract and the quality rules; later
  background creation reads the same file instead of a second prompt copy.
- `OURFAIRY_SEED_SKILLS_DIR` (optional, empty means none) points at a directory
  of top-level packages. At apply, each package is imported as a **common**
  approved skill (`source_type: 5`, `created_by/reviewer: 0`). An existing
  active common identity with the same name is skipped and logged; the seed
  never overwrites. No preference rows are written, so the common default
  (disabled) applies.
- `./seed` exports `importReviewedPackage(...)` with no Cordis context: the
  boot seed uses it, and tests use it to create reviewed personal or common
  skills before a boot. Tests must not rebuild the manifest hash themselves;
  the import is the only writer of reviewed versions outside `skill_manage`.

## Seams left for later tickets

- No install-from-address, common candidate, archive/restore endpoint,
  evolution or background-learning engine.
- `skill_version` carries the growth and confirmation columns, and the review
  path keeps the growth/confirmation hook: a version with a parent computes the
  110% rule and refuses approval without the user's confirmation, which the
  evolution ticket completes with the message-reference validation. A #297
  candidate has no parent, so the rule never fires yet.
- `pendingRevision` in the pool stays false until the evolution ticket derives
  it from a pending revision of an approved identity.
- `SkillService` takes the store and data root, not a Cordis context;
  `SkillProviders` owns registration and invalidation; `SkillCreation` owns the
  candidate/review rules; `skillHandlers` owns the HTTP envelope; the row's
  `index.ts` composes them.
