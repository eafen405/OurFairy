# Skill runtime

The skill row owns the product's runtime skill surface: one SQLite file, the
immutable version directories outside every writable root, one skill provider
per live user session, the read-only contribution that lets an activated
package's files be read, and the authenticated endpoints the Skills page uses.
The native dsh rows (`skill`, `skill-filesystem`, `tool-skill`) supply catalog
merging, the `skill` tool, `/name` suppression and the trusted bundled root; this
package never re-implements them.

The row is deliberately not a creation UI. Creating, verifying, reviewing,
installing, evolving and background learning are later tickets in the same
spec; they write through the store and service this package exposes, and the
`skill_manage` tool arrives with them.

## What the row owns

| Concern | Authority |
| --- | --- |
| Skill identity | `skill` table: name, scope (1 personal, 2 common), owner, current version pointer, archive marker, actors and timestamps |
| Reviewed content | `skill_version` rows plus immutable `versions/<skillId>/<uuid>/` directories |
| Selection | `skill_user_preference` per user and skill; missing personal row = enabled, missing common row = disabled |
| Catalog | The per-agent provider `ourfairy-skills`, registered on `agent.ctx` for user sessions only |
| Integrity | The provider's `get` re-reads the package and compares its canonical manifest hash with the approved version row |
| Resources | `contributeReadonlyFiles`: the trusted bundled root for every session, plus the current version directories of the caller's catalog winners |
| Client surface | `/skills/list`, `/skills/detail`, `/skills/preference` (POST + JSON, caller from the bearer credential) |

The data root is `dshHomePath('skill')` by default:

```
skill/
  skill.sqlite
  versions/<skillId>/<uuid>/    approved, immutable packages
  tmp/<uuid>/                   staging for the copy-then-move import
```

A version's `package_path` is stored relative to that root, so the root can move.
The row creates the single connection with WAL, versioned migrations and
`BEGIN IMMEDIATE` transactions, following `backend/memory/src/store.ts`.

## Winner and pool rules

For one owner the visible identities are every common identity plus their own
personal ones. A name has at most one personal and one common identity. A
personal identity wins when it is enabled and not archived; otherwise a common
identity wins when it is enabled and not archived. Archived identities never
enter a catalog but stay in the pool so their state is visible.

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
without a restart. Seed import at boot happens before any provider exists.

## Package and manifest

The one algorithm lives in `src/package.ts` and runs on import (seed today) and
again on activation:

- `SKILL.md` must start with a `---` frontmatter line closed by another `---`.
  The reader accepts a flat map of single-line `key: value` entries, quoted
  scalars and `true`/`false`. It refuses nested YAML, block scalars, anchors and
  tags instead of silently misreading them; the native filesystem provider
  reads the same file with a full YAML parser, so accepted product packages are
  accepted by both.
- Required `name` (kebab-case) and `description` (non-empty, at most 500
  Unicode code points). Optional `user-invocable` boolean and `license` string.
- The body after the frontmatter is at most 8000 Unicode code points.
- The manifest walks the package recursively, rejects symlinks and non-regular
  files, sorts entries by POSIX relative path, and records
  `{path, type: 'file', sha256, executable}`. The manifest hash is the SHA-256
  of the canonical JSON of that array. File times, owners and the rest of the
  mode bits are excluded.
- Package paths must be relative, use `/`, and contain no empty, `.`, `..`,
  drive-letter or control-character segment. Text files must not embed an author-machine absolute
  home path (`/home/<name>/…` or `/Users/<name>/…`); use a relative package path or a neutral
  example. Binary resources are skipped by that scan.
- Import copies the package through `tmp/<uuid>/`, re-reads the staged copy and
  compares its hash with the validated source before the store transaction
  moves it to `versions/<skillId>/<uuid>/`. A source that changed between
  validation and copy is refused, so the recorded hash always describes the
  stored bytes.

Activation (`provider.get`) re-checks the version is still current, approved
and visible, the caller still wins the name, and the on-disk package still
hashes to the approved value. A mismatch throws
`skill package integrity check failed for <name>`; the native tool reports a
failed call and the chat projection shows no activation row.

## Deployment seed and bundled Skill Creator

- `OURFAIRY_BUNDLED_SKILLS_DIR` points at `backend/skill-creator/bundled`, the
  only root the native filesystem provider scans (`includeDefaultRoots: false`,
  `watch: false`). The bundled `skill-creator` package is a native `bundled`
  skill: every agent sees it in its catalog and it is never written to the
  database.
- `OURFAIRY_SEED_SKILLS_DIR` (optional, empty means none) points at a directory
  of top-level packages. At apply, each package is imported as a **common**
  approved skill (`source_type: 5`, `created_by/reviewer: 0`). An existing
  active common identity with the same name is skipped and logged; the seed
  never overwrites. No preference rows are written, so the common default
  (disabled) applies.
- `./seed` exports `importReviewedPackage(...)` with no Cordis context: the
  boot seed uses it, and tests use it to create reviewed personal or common
  skills before a boot. Tests must not rebuild the manifest hash themselves;
  the import is the only writer of reviewed versions in this ticket.

## Seams left for later tickets

- No `skill_manage` tool, no candidate area, no verification, no review, no
  archive endpoint, no install and no learning engine.
- `skill_version` already carries the review, growth and install columns, and
  `/skills/list` already carries `pending: []` and `pendingCount`, so those
  tickets add behaviour rather than a second schema or wire shape.
- `SkillService` takes the store and data root, not a Cordis context;
  `SkillProviders` owns registration and invalidation; `skillHandlers` owns the
  HTTP envelope. The row's `index.ts` composes them.
