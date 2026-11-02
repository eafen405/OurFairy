# Skill runtime and creation

The skill row owns the product's skill surface: one SQLite file, the immutable
version directories outside every writable root, one skill provider per live
user session, the read-only contribution that lets an activated package's files
be read, the authenticated endpoints the Skills page uses, and the one
`skill_manage` model tool that installs, creates, inspects, reviews and
archives skills. The native dsh rows (`skill`, `skill-filesystem`,
`tool-skill`) supply catalog merging, the `skill` tool, `/name` suppression and
the trusted bundled root; this package never re-implements them.

Installation from an address, shared proposals, evolution and rollback are part
of this row: they reuse the same create/review path, store, package algorithm
and verification runner rather than adding a second one. Background learning is
the one engine still to arrive; it extends this row, not a second creation path.

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
| Install source | Fixed on the version: `address`, `resolvedVersion` (commit SHA or archive digest), archive digest, fetch time, optional ETag/Last-Modified and license |
| Lifecycle | `skill.archived_at`: archive removes the identity from every catalog and read-only resource but keeps content, history and preferences |
| Evolution | Parent version, core-body growth, an optional post-display growth confirmation and rollback candidates, all through the same candidate/review path |
| Model tool | `skill_manage` on user sessions only: `list`, `inspect`, `create` (files or `address`, new skill or revision), `review`, `rollback`, `archive`, `restore` |
| Client surface | `/skills/list` (pool + pending + count + bounded `reviewResults`), `/skills/detail`, `/skills/preference`, `/skills/review-open`, `/skills/archive`, `/skills/restore` (POST + JSON, caller from the bearer credential) |

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
enter a catalog but stay in the pool so their state is visible. A candidate is
not a pool item; it appears only in the separate pending area. A pending or
newest changes-requested version of a skill with a current version marks that
pool item `pendingRevision`.

The backend returns every derived fact; the client only renders it:

- `state` numeric: 1 in catalog, 2 shadowed, 3 disabled, 4 archived.
- `scope` numeric: 1 personal, 2 common.
- `actions` numeric scope per action: 0 not offered, 1 this user, 2 every user.
  Toggle is always this user's own preference. A personal archive/restore is
  offered to its owner (1); a common one only to Phaethon (2), and is 0 for
  every other caller. The server enforces the permission; the 0 lets the client
  hide a control it must not render.
- A common candidate is visible to its proposer and Phaethon; only Phaethon
  may decide it. A person's own name never widens either rule.
- `shadowedBy` carries the personal identity that shadows a common item.
- `pendingRevision` is true while the current version has a pending revision or
  a changes-requested draft that no newer draft has replaced; the client only
  renders it.

`/skills/preference` re-derives the pool after writing and invalidates that
owner's live provider registration, so the next catalog reflects the change
without a restart. A personal archive/restore invalidates its owner; a common
one invalidates every live agent. An approval does the same for the owner, or
for every agent when it publishes a common version.

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
- The caller's owner and session are derived, never submitted. `scope` is 1
  (personal) or 2 (common); a common proposal is accepted only when the user
  turn that opened the current turn contains one of `共有`, `共享`, `所有人` or
  `大家`, and its message id and text are recorded as the sharing consent.
- `files` must contain `SKILL.md` and the complete package. The backend stages,
  validates and hashes it; the model cannot choose a landing path, a manifest
  hash or a verification result.
- A name that already has an approved current version is refused for a plain
  create; that path needs a revision. While an identity has no approved
  version, a new draft may join it — that is how a change request becomes a
  re-verified draft with a new hash.
- A revision passes `parentVersionId` (the skill's current approved version)
  and a non-empty `targetBenefit` (at most 500 characters). The files are a
  complete rewrite of the package on the same identity, the row records
  `source_type: 3`, the parent and the growth flag. An unknown, stale or
  other-owner parent and a renamed package are refused; no benefit means no
  candidate.
- At least one representative scenario is required. `src/verify.ts` copies the
  candidate into a fresh `verify/<uuid>/work/`, runs each `/bin/bash -lc`
  command under bwrap with a disposable HOME/TMPDIR/cache and network shared,
  and records the real exit code, duration, environment and bounded output.
  The shared environment root, spaces roots and session roots are not mounted.
  A missing bwrap marks the report incomplete; approval refuses it. A revision
  may pass recorded parent runs as `reused`; those are listed separately from
  executed scenarios and never count as a fresh execution.
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
verification report, the archive state, the current pointer a revision was
written against, and — above 110% core-body growth — the user's growth
confirmation. It then renames the candidate into `versions/<skillId>/<uuid>/`
and moves the current pointer in one `BEGIN IMMEDIATE` transaction (the
previous current becomes superseded). A failure renames the directory back. The
first personal approval with no preference row enables the owner; an explicit
preference always survives, including across a version switch.
`request_changes` and `reject` settle the row; an old approval or verification
never carries over to a new hash, and repeated approvals lose the
`status = pending` predicate, so exactly one decision wins. Two revisions of the
same parent can both be pending; only the one whose parent is still current
publishes, and the other keeps its draft for a rebase.

### Evolution, growth and rollback

- Core-body length is the Unicode character count of `SKILL.md` after the
  frontmatter. A revision is abnormal when `new > floor(old * 1.1)`: 109% and
  exactly 110% need nothing extra, 111% does.
- The stored `growth_exceeded` flag is computed once at creation; approval
  recomputes the rule from the immutable parent and refuses an inconsistent
  row.
- An abnormal revision can only be approved with `growthConfirmMessageId`: the
  id of the user's own chat message whose exact text is `确认增长`, in the
  reviewing session, sent after the latest successful `skill_manage inspect`
  call that displayed that version. The model cannot read durable message ids
  from its context, so `skill_manage list` reports the same id after the user
  replied; approval re-reads the message from the log by id and never trusts the
  list value alone. The confirmer, time and message id are stored on the
  version, and a newer draft is a new hash with a fresh inspect and
  confirmation.
- Verification reuse compares the candidate scenario with the parent's
  recorded run: same name, same command and every `uses` path resolving to the
  same file hashes. Reused records keep the parent's facts and name the source
  version; everything else reruns in a fresh disposable environment.
- `rollback {versionId}` copies an approved **superseded** version's clean
  package into a new pending candidate (`source_type: 4`, parent = current),
  runs its recorded scenarios again with the same reuse rule, and requires
  normal review. It never moves the pointer; rolling back content that is
  already current is refused as a no-op.
- The review display's first block carries `核心正文 <old> → <new> 字符（±N%）`
  and, above 110%, the fourth block carries the exact `确认增长` instruction.
  Reused scenarios print as `↺ … → 复用自版本 N`.

## Installing from an address

`skill_manage create` accepts `address` instead of `files`; the scenarios are
still required. `src/install.ts` supports:

- `https://github.com/<owner>/<repo>/tree/<ref>/<path...>` — resolve `<ref>` to a
  commit through the GitHub API, then download
  `<codeload>/<owner>/<repo>/tar.gz/<sha>` and extract only `<path>`;
- the same URL with `/blob/.../SKILL.md` (the package directory is its parent);
- `github:<owner>/<repo>/<path>@<ref>`;
- a direct `http(s)` URL ending in `.tar.gz` or `.tgz`. A `.zip` is refused with
  `skills/unsupported-archive` rather than read by an untested extractor.

`OURFAIRY_GITHUB_API_BASE` and `OURFAIRY_GITHUB_CODELOAD_BASE` override the two
GitHub hosts (tests point them at a loopback stub); `OURFAIRY_SKILL_INSTALL_MAX_BYTES`
bounds the download, the inflated archive and the package. The fetch is bounded
by redirect count, timeout and response size.

The extractor accepts only regular files and directories. It refuses absolute
paths, `..`, backslashes, NUL, symlinks, hardlinks, devices and FIFOs, and
applies a byte and entry-count bound. Extraction happens under
`tmp/install-<uuid>/` in the skill data root, which is not a native scan root;
only the skill subtree is kept and the fetched package is then copied through
the ordinary candidate path. This module never executes package code, never
registers a plugin and never bypasses review. The version records the address,
the resolved commit or archive digest, the archive SHA-256, the fetch time, the
optional ETag/Last-Modified and the package's license (frontmatter or a root
`LICENSE*` file, which stays in the package). A later branch change cannot alter
an already fetched or approved candidate.

## Common proposals and lifecycle

A common identity has no personal owner (`owner_short_id = NULL`), records
`proposed_by`, and shares its name namespace with personal identities but not
with another common identity. A second common proposal for a pending name by a
different user is refused; the preparer may add a new draft after a change
request. The proposer can inspect the cleaned review material (package, fixed
source summary and verification report; no raw session or other personal
skills), open its review conversation and see the decision result. Phaethon
alone can approve, request changes, reject, archive or restore it. Approval
writes no preference rows for anyone, so the common default (disabled) applies
per user and the reviewer does not choose for other users.

`skill_manage archive|restore` and `POST /skills/archive|restore {skillId}` set
or clear `archived_at`. The store keeps the package, version history, source and
every preference row. Archived identities stay in `/skills/list` with state 4
so the client can restore them, but they are not pool winners, catalog entries
or read-only resources. Restore re-derives the previous preference; a missing
row again takes the scope default (personal enabled, common disabled). The
background creation child has no `skill_manage` tool, so it can never archive
or restore.

## Review results and reminders

`/skills/list` also returns a bounded, newest-first `reviewResults` view:
`{versionId, skillId, name, scope, status, decidedAt, proposer}` for settled
candidates visible to the caller (the owner's personal decisions; a common
proposal's decision to its proposer; every common decision to Phaethon). There
is no backend push and no notification table. The Android client keeps a
per-account durable set of pending and decided version ids, and publishes at
most one merged local notification per newly observed set, with an action that
opens `Screen.Skills`; a suppressed (foreground or switched-off) reminder is
recorded and never replayed.

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

- No background-learning engine yet. It is the one part of the spec this row
  still does not serve; the Skill Creator content and the store are ready for
  it.
- `SkillService` takes the store and data root, not a Cordis context;
  `SkillProviders` owns registration and invalidation; `SkillCreation` owns the
  candidate/review rules; `SkillInstall` owns the network fetch and extraction;
  `SkillLifecycle` owns archive/restore; `SkillNotifications` owns the bounded
  decision view; `skillHandlers` owns the HTTP envelope; the row's `index.ts`
  composes them.
