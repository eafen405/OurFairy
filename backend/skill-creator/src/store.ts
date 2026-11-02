/**
 * The skill store: one SQLite file for skill identities, versions and each
 * user's enable preference.
 *
 * One synchronous `node:sqlite` connection, WAL, a versioned
 * `meta.schema_version` and `BEGIN IMMEDIATE` transactions follow the
 * repository's business-store pattern. The file is separate from every other
 * product store so skill history never reshapes another schema.
 *
 * Schema v1 is deliberately the runtime subset: identity, versions (with every
 * review, growth and install column the later tickets write), and preferences.
 * The three background-learning tables arrive with their own ticket as a new
 * schema version; nothing here creates empty placeholders for them.
 *
 * The identity uniqueness rule `(scope, COALESCE(owner_short_id, 0), name)` for
 * active rows is a partial expression unique index, and
 * `tests/skill-package.test.mjs` pins that SQLite enforces it on the Node
 * version this repository supports. The import transaction additionally looks
 * the identity up before inserting, so a conflict is reported as a domain
 * decision rather than as a driver error.
 *
 * @module @ourfairy/dsh-skill-creator/src/store
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite'
import { PackageError } from './package.js'

/** The current schema version of this file; the ladder is asserted by the store test. */
export const SKILL_SCHEMA_VERSION = 1

/** Skill identity scope: a user's own skill, or a deployment-common skill. */
export const SKILL_SCOPE = Object.freeze({ personal: 1, common: 2 })

/** One version's review lifecycle. */
export const VERSION_STATUS = Object.freeze({
  pending: 0,
  changesRequested: 1,
  rejected: 2,
  approvedCurrent: 3,
  superseded: 4,
})

/** Where a version's content came from. */
export const SOURCE_TYPE = Object.freeze({
  explicit: 0,
  install: 1,
  background: 2,
  evolution: 3,
  rollback: 4,
  seed: 5,
})

/**
 * A skill store refusal. The class lives here rather than in the HTTP module so
 * the seed path can refuse with the same vocabulary without importing a route.
 */
export class SkillStoreError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'SkillStoreError'
    this.code = code
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS skill (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  scope INTEGER NOT NULL,                     -- 1 personal, 2 common
  owner_short_id INTEGER,                     -- NULL for a common skill
  current_version_id INTEGER,                 -- NULL until an approved version exists
  archived_at INTEGER,                        -- NULL while the identity is in the selection pool
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  proposed_by INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS skill_identity
  ON skill(scope, COALESCE(owner_short_id, 0), name) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS skill_version (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_id INTEGER NOT NULL,
  parent_version_id INTEGER,
  package_path TEXT NOT NULL,                 -- POSIX path relative to the skill data root
  manifest TEXT NOT NULL,                     -- canonical manifest JSON (see package.ts)
  manifest_hash TEXT NOT NULL,
  core_characters INTEGER NOT NULL,
  license TEXT,
  source_type INTEGER NOT NULL,               -- 0 explicit, 1 install, 2 background, 3 evolution, 4 rollback, 5 seed
  source_location TEXT,
  status INTEGER NOT NULL,                    -- 0 pending, 1 changes_requested, 2 rejected, 3 approved_current, 4 superseded
  verification TEXT,
  growth_exceeded INTEGER NOT NULL DEFAULT 0,
  growth_confirmed_by INTEGER,
  growth_confirmed_at INTEGER,
  growth_confirm_message TEXT,
  reviewer INTEGER,
  reviewed_at INTEGER,
  review_note TEXT,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS skill_version_by_skill
  ON skill_version(skill_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS skill_version_one_current
  ON skill_version(skill_id) WHERE status = 3 AND deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS skill_user_preference (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_id INTEGER NOT NULL,
  skill_id INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS skill_preference_unique
  ON skill_user_preference(short_id, skill_id) WHERE deleted_at IS NULL;
`

/** One row of the `skill` table, as every read site sees it. */
export type SkillRow = {
  id: number
  name: string
  /** 1 personal, 2 common. */
  scope: number
  owner_short_id: number | null
  current_version_id: number | null
  archived_at: number | null
  created_by: number
  updated_by: number
  proposed_by: number | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** One row of the `skill_version` table. */
export type SkillVersionRow = {
  id: number
  skill_id: number
  parent_version_id: number | null
  package_path: string
  manifest: string
  manifest_hash: string
  core_characters: number
  license: string | null
  source_type: number
  source_location: string | null
  status: number
  verification: string | null
  growth_exceeded: number
  growth_confirmed_by: number | null
  growth_confirmed_at: number | null
  growth_confirm_message: string | null
  reviewer: number | null
  reviewed_at: number | null
  review_note: string | null
  created_by: number
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** One row of the `skill_user_preference` table. */
export type PreferenceRow = {
  id: number
  short_id: number
  skill_id: number
  enabled: number
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** The identity key one active skill row occupies. */
export type SkillIdentity = {
  readonly scope: number
  readonly ownerShortId: number | undefined
  readonly name: string
}

/** One reviewed version the import path writes. */
export type ReviewedVersion = {
  readonly name: string
  readonly scope: number
  readonly ownerShortId?: number
  readonly createdBy: number
  readonly proposedBy?: number
  readonly manifest: string
  readonly manifestHash: string
  readonly coreCharacters: number
  readonly license?: string
  readonly sourceType: number
  readonly sourceLocation?: string
  readonly reviewer: number
  readonly reviewedAt: number
  readonly parentVersionId?: number
  readonly preference?: { readonly shortId: number; readonly enabled: boolean }
}

/** What one import created or reused. */
export type ImportedVersion = {
  readonly skillId: number
  readonly versionId: number
  readonly createdSkill: boolean
}

/** One pending draft the creation path inserts before verification runs. */
export type DraftVersion = {
  readonly name: string
  readonly scope: number
  readonly ownerShortId?: number
  readonly proposedBy?: number
  readonly createdBy: number
  /** POSIX path relative to the skill data root, under `candidates/`. */
  readonly packagePath: string
  readonly manifest: string
  readonly manifestHash: string
  readonly coreCharacters: number
  readonly license?: string
  readonly sourceType: number
  readonly sourceLocation?: string
  readonly parentVersionId?: number
  readonly growthExceeded?: boolean
}

/** One pending draft together with the identity fields a reviewer needs. */
export type PendingDraftRow = SkillVersionRow & {
  readonly skill_name: string
  readonly skill_scope: number
  readonly skill_owner_short_id: number | null
  readonly skill_proposed_by: number | null
  readonly skill_archived_at: number | null
}

/** One affected row count from a mutation. */
type ChangeResult = { readonly changes: number | bigint }

/**
 * The SQLite driver types every column as `SQLOutputValue`; the schema is the
 * authority on which columns are numbers, which are text and which may be
 * NULL. The assertion is confined to this one boundary so every read site keeps
 * a typed row.
 */
function rowOf<T extends Record<string, SQLOutputValue>>(row: Record<string, SQLOutputValue> | undefined): T | undefined {
  return row as T | undefined
}

/** Every row of one query, read as the row shape its table declares. */
function rowsOf<T extends Record<string, SQLOutputValue>>(rows: Record<string, SQLOutputValue>[]): T[] {
  return rows as T[]
}

/**
 * The facts one draft must carry before the store writes it.
 *
 * A draft package lives under `candidates/` in the immutable-path vocabulary;
 * the store refuses anything else so no caller can make a row point at an
 * approved `versions/` directory.
 */
function validateDraft(version: DraftVersion): void {
  if (version.scope !== SKILL_SCOPE.personal && version.scope !== SKILL_SCOPE.common) {
    throw new SkillStoreError('skills/invalid-scope', `unknown skill scope ${String(version.scope)}`)
  }
  if (version.scope === SKILL_SCOPE.personal && version.ownerShortId === undefined) {
    throw new SkillStoreError('skills/invalid-owner', 'a personal skill needs an owner short number')
  }
  if (version.scope === SKILL_SCOPE.common && version.ownerShortId !== undefined) {
    throw new SkillStoreError('skills/invalid-owner', 'a common skill has no owner short number')
  }
  const parts = version.packagePath.split('/')
  if (parts[0] !== 'candidates' || parts.length < 2 || parts.some(part => part === '' || part === '.' || part === '..')) {
    throw new SkillStoreError('skills/invalid-path', `a draft package path must be under candidates/: ${version.packagePath}`)
  }
  if (version.manifest === '' || version.manifestHash === '') {
    throw new SkillStoreError('skills/invalid-package', 'a draft needs a manifest and its hash')
  }
}

export class SkillStore {
  #db: DatabaseSync

  constructor({ path }: { path: string }) {
    if (typeof path !== 'string' || path === '') {
      throw new SkillStoreError('skills/misconfigured', 'the skill store needs a database path')
    }
    mkdirSync(dirname(path), { recursive: true })
    this.#db = new DatabaseSync(path)
    try {
      this.#db.exec('PRAGMA journal_mode = WAL')
      this.#db.exec('PRAGMA foreign_keys = OFF')
      this.#migrate()
    } catch (error) {
      this.#db.close()
      throw error
    }
  }

  close(): void {
    this.#db.close()
  }

  /** The schema version the file declares, or undefined for a fresh file. */
  schemaVersion(): number | undefined {
    return this.#storedVersion()
  }

  /** The one active identity with exactly this scope, owner and name. */
  activeIdentity({ scope, ownerShortId, name }: SkillIdentity): SkillRow | undefined {
    return rowOf<SkillRow>(this.#db.prepare(
      'SELECT * FROM skill WHERE scope = ? AND COALESCE(owner_short_id, 0) = ? AND name = ? AND deleted_at IS NULL',
    ).get(scope, ownerShortId ?? 0, name))
  }

  /** One identity that is not logically deleted, by number. */
  identity(id: number): SkillRow | undefined {
    return rowOf<SkillRow>(this.#db.prepare('SELECT * FROM skill WHERE id = ? AND deleted_at IS NULL').get(id))
  }

  /**
   * Every identity the owner may see: common identities plus their own personal
   * ones, archived identities included (the pool reports them as archived; the
   * catalog derivation excludes them separately).
   */
  visibleIdentities(shortId: number): SkillRow[] {
    return rowsOf<SkillRow>(this.#db.prepare(
      'SELECT * FROM skill WHERE deleted_at IS NULL AND (scope = ? OR (scope = ? AND owner_short_id = ?)) ORDER BY name, scope, id',
    ).all(SKILL_SCOPE.common, SKILL_SCOPE.personal, shortId))
  }

  /** One version row that is not logically deleted. */
  version(id: number): SkillVersionRow | undefined {
    return rowOf<SkillVersionRow>(this.#db.prepare('SELECT * FROM skill_version WHERE id = ? AND deleted_at IS NULL').get(id))
  }

  /** Every preference row this user has, active only. */
  preferences(shortId: number): PreferenceRow[] {
    return rowsOf<PreferenceRow>(this.#db.prepare(
      'SELECT * FROM skill_user_preference WHERE short_id = ? AND deleted_at IS NULL',
    ).all(shortId))
  }

  /** One user's preference for one skill, active only. */
  preference(shortId: number, skillId: number): PreferenceRow | undefined {
    return rowOf<PreferenceRow>(this.#db.prepare(
      'SELECT * FROM skill_user_preference WHERE short_id = ? AND skill_id = ? AND deleted_at IS NULL',
    ).get(shortId, skillId))
  }

  /**
   * Insert or replace one user's enable preference. Disabling keeps the row
   * (logical state), because an explicit off differs from "no preference yet"
   * and archive/restore must preserve it.
   */
  setPreference({ shortId, skillId, enabled }: { readonly shortId: number; readonly skillId: number; readonly enabled: boolean }): void {
    const now = Date.now()
    this.#transaction(() => {
      const existing = this.preference(shortId, skillId)
      if (existing === undefined) {
        this.#db.prepare(
          'INSERT INTO skill_user_preference (short_id, skill_id, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).run(shortId, skillId, enabled ? 1 : 0, now, now)
        return
      }
      this.#db.prepare('UPDATE skill_user_preference SET enabled = ?, updated_at = ? WHERE id = ?')
        .run(enabled ? 1 : 0, now, existing.id)
    })
  }

  /**
   * Import one validated, already-reviewed package.
   *
   * `place` runs inside the same immediate transaction, after the identity is
   * known but before the version row is inserted. It returns the package path
   * relative to the data root; the seed path uses it to move the staged package
   * into `versions/<skillId>/<uuid>/` and answer that relative path. A throw
   * rolls the transaction back and the caller removes whatever `place` moved.
   *
   * A new approved version supersedes the current one and moves the pointer in
   * the same transaction, so a reader never sees zero or two current versions.
   */
  importReviewed(version: ReviewedVersion, place: (skillId: number) => string): ImportedVersion {
    if (version.scope !== SKILL_SCOPE.personal && version.scope !== SKILL_SCOPE.common) {
      throw new SkillStoreError('skills/invalid-scope', `unknown skill scope ${String(version.scope)}`)
    }
    if (version.scope === SKILL_SCOPE.personal && version.ownerShortId === undefined) {
      throw new SkillStoreError('skills/invalid-owner', 'a personal skill needs an owner short number')
    }
    if (version.scope === SKILL_SCOPE.common && version.ownerShortId !== undefined) {
      throw new SkillStoreError('skills/invalid-owner', 'a common skill has no owner short number')
    }
    if (version.preference !== undefined && version.scope === SKILL_SCOPE.personal && version.preference.shortId !== version.ownerShortId) {
      throw new SkillStoreError('skills/invalid-owner', 'a personal skill preference belongs to its owner')
    }
    return this.#transaction(() => {
      const now = Date.now()
      const existing = this.activeIdentity({ scope: version.scope, ownerShortId: version.ownerShortId, name: version.name })
      let skillId: number
      let createdSkill = false
      if (existing === undefined) {
        const result = this.#db.prepare(
          'INSERT INTO skill (name, scope, owner_short_id, created_by, updated_by, proposed_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(version.name, version.scope, version.ownerShortId ?? null, version.createdBy,
          version.reviewer, version.proposedBy ?? null, now, now) as { readonly lastInsertRowid: number | bigint }
        skillId = Number(result.lastInsertRowid)
        createdSkill = true
      } else {
        skillId = existing.id
        if (existing.archived_at !== null) {
          throw new SkillStoreError('skills/archived', `skill "${existing.name}" is archived; restore it before importing a version`)
        }
      }
      const packagePath = place(skillId)
      this.#db.prepare('UPDATE skill_version SET status = ?, updated_at = ? WHERE skill_id = ? AND status = ? AND deleted_at IS NULL')
        .run(VERSION_STATUS.superseded, now, skillId, VERSION_STATUS.approvedCurrent)
      const inserted = this.#db.prepare(
        `INSERT INTO skill_version
          (skill_id, parent_version_id, package_path, manifest, manifest_hash, core_characters, license,
           source_type, source_location, status, reviewer, reviewed_at, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(skillId, version.parentVersionId ?? null, packagePath, version.manifest, version.manifestHash,
        version.coreCharacters, version.license ?? null, version.sourceType, version.sourceLocation ?? null,
        VERSION_STATUS.approvedCurrent, version.reviewer, version.reviewedAt, version.createdBy, now, now) as { readonly lastInsertRowid: number | bigint }
      const versionId = Number(inserted.lastInsertRowid)
      this.#db.prepare('UPDATE skill SET current_version_id = ?, updated_by = ?, updated_at = ? WHERE id = ?')
        .run(versionId, version.reviewer, now, skillId)
      if (version.preference !== undefined) {
        const preference = this.preference(version.preference.shortId, skillId)
        if (preference === undefined) {
          this.#db.prepare(
            'INSERT INTO skill_user_preference (short_id, skill_id, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
          ).run(version.preference.shortId, skillId, version.preference.enabled ? 1 : 0, now, now)
        } else {
          this.#db.prepare('UPDATE skill_user_preference SET enabled = ?, updated_at = ? WHERE id = ?')
            .run(version.preference.enabled ? 1 : 0, now, preference.id)
        }
      }
      return { skillId, versionId, createdSkill }
    })
  }

  /**
   * Insert one pending draft and, when the identity does not exist yet, the
   * identity itself in the same transaction.
   *
   * A second draft is allowed only while the identity has no approved current
   * version: that is the request-changes path (the reviewer asked for a new
   * draft). Once a version is approved, the name is established and a new
   * version there would be a revision, which the evolution ticket owns; this
   * method refuses with a message the caller reports as the conflict.
   */
  createDraft(version: DraftVersion): ImportedVersion {
    validateDraft(version)
    return this.#transaction(() => {
      const now = Date.now()
      const existing = this.activeIdentity({ scope: version.scope, ownerShortId: version.ownerShortId, name: version.name })
      let skillId: number
      let createdSkill = false
      if (existing === undefined) {
        const inserted = this.#db.prepare(
          'INSERT INTO skill (name, scope, owner_short_id, created_by, updated_by, proposed_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(version.name, version.scope, version.ownerShortId ?? null, version.createdBy,
          version.createdBy, version.proposedBy ?? null, now, now) as { readonly lastInsertRowid: number | bigint }
        skillId = Number(inserted.lastInsertRowid)
        createdSkill = true
      } else {
        if (existing.archived_at !== null) {
          throw new SkillStoreError('skills/archived', `skill "${existing.name}" is archived; restore it before creating a new draft`)
        }
        if (existing.current_version_id !== null) {
          // A draft may coexist with a current version only as a revision of
          // exactly that version; anything else would be a second identity or
          // a revision against a stale pointer.
          if (version.parentVersionId === undefined || version.parentVersionId !== existing.current_version_id) {
            throw new SkillStoreError('skills/name-conflict',
              `a skill named ${existing.name} already exists; use a revision of its current version`)
          }
        }
        skillId = existing.id
      }
      const inserted = this.#db.prepare(
        `INSERT INTO skill_version
          (skill_id, parent_version_id, package_path, manifest, manifest_hash, core_characters, license,
           source_type, source_location, status, growth_exceeded, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(skillId, version.parentVersionId ?? null, version.packagePath, version.manifest, version.manifestHash,
        version.coreCharacters, version.license ?? null, version.sourceType, version.sourceLocation ?? null,
        VERSION_STATUS.pending, version.growthExceeded === true ? 1 : 0, version.createdBy, now, now) as {
        readonly lastInsertRowid: number | bigint
      }
      return { skillId, versionId: Number(inserted.lastInsertRowid), createdSkill }
    })
  }

  /**
   * The identities whose current version has a revision in progress.
   *
   * A pending sibling always counts. A changes-requested sibling counts while
   * it is the newest version row: once a newer draft exists, that draft (or its
   * settled outcome) is the state the pool should present. Only identities the
   * caller can review are counted, so the pool never leaks another user's draft.
   */
  openDraftSkillIds(shortId: number): Set<number> {
    const rows = rowsOf<{ skill_id: number }>(this.#db.prepare(
      `SELECT DISTINCT v.skill_id
         FROM skill_version v JOIN skill s ON s.id = v.skill_id
        WHERE v.deleted_at IS NULL AND s.deleted_at IS NULL AND s.archived_at IS NULL
          AND ((s.scope = ? AND s.owner_short_id = ?) OR (s.scope = ? AND s.proposed_by = ?))
          AND (v.status = ? OR (v.status = ? AND NOT EXISTS (
                SELECT 1 FROM skill_version newer
                 WHERE newer.skill_id = v.skill_id AND newer.deleted_at IS NULL AND newer.id > v.id)))`,
    ).all(SKILL_SCOPE.personal, shortId, SKILL_SCOPE.common, shortId,
      VERSION_STATUS.pending, VERSION_STATUS.changesRequested))
    return new Set(rows.map(row => row.skill_id))
  }

  /**
   * The pending candidates one caller may review, newest first and bounded.
   *
   * A personal draft is visible to its owner; a common draft to its proposer
   * (the Phaethon branch is added by the sharing ticket at the one permission
   * function, not here). Archived identities keep their drafts out; a draft of
   * an archived identity is not reviewable.
   */
  pendingDrafts(shortId: number, limit = 50): PendingDraftRow[] {
    return rowsOf<PendingDraftRow>(this.#db.prepare(
      `SELECT v.*, s.name AS skill_name, s.scope AS skill_scope,
              s.owner_short_id AS skill_owner_short_id, s.proposed_by AS skill_proposed_by,
              s.archived_at AS skill_archived_at
         FROM skill_version v JOIN skill s ON s.id = v.skill_id
        WHERE v.status = ? AND v.deleted_at IS NULL AND s.deleted_at IS NULL AND s.archived_at IS NULL
          AND ((s.scope = ? AND s.owner_short_id = ?) OR (s.scope = ? AND s.proposed_by = ?))
        ORDER BY v.created_at DESC, v.id DESC LIMIT ?`,
    ).all(VERSION_STATUS.pending, SKILL_SCOPE.personal, shortId, SKILL_SCOPE.common, shortId, limit))
  }

  /** Store one version's verification report; only a pending row accepts a report. */
  updateVerification(versionId: number, verification: string): boolean {
    const result = this.#db.prepare(
      'UPDATE skill_version SET verification = ?, updated_at = ? WHERE id = ? AND status = ? AND deleted_at IS NULL',
    ).run(verification, Date.now(), versionId, VERSION_STATUS.pending) as ChangeResult
    return Number(result.changes) > 0
  }

  /**
   * Record one terminal review decision for a pending version.
   *
   * The predicate `status = pending` is part of the UPDATE, so a repeated or
   * concurrent decision changes exactly one row and the loser gets `false`.
   */
  recordReviewDecision({ versionId, status, reviewer, reviewedAt, note }: {
    readonly versionId: number
    readonly status: number
    readonly reviewer: number
    readonly reviewedAt: number
    readonly note?: string
  }): boolean {
    if (status !== VERSION_STATUS.changesRequested && status !== VERSION_STATUS.rejected) {
      throw new SkillStoreError('skills/invalid-decision', `review decision ${String(status)} is not a settled draft state`)
    }
    const result = this.#db.prepare(
      'UPDATE skill_version SET status = ?, reviewer = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE id = ? AND status = ? AND deleted_at IS NULL',
    ).run(status, reviewer, reviewedAt, note ?? null, Date.now(), versionId, VERSION_STATUS.pending) as ChangeResult
    return Number(result.changes) > 0
  }

  /**
   * Publish one pending draft as the identity's single current version.
   *
   * Everything that can invalidate an approval is re-read inside one
   * `BEGIN IMMEDIATE` transaction: the version is still pending, the identity
   * is not archived, and the caller's `recheck` (the on-disk manifest hash)
   * still holds. The previous current version is superseded in the same
   * transaction as the pointer move, so no reader sees zero or two current
   * versions. The first personal approval with no preference row enables the
   * owner; an explicit preference always survives.
   */
  publishDraft({ versionId, packagePath, reviewer, reviewedAt, ownerShortId, defaultEnable, confirmGrowth, recheck }: {
    readonly versionId: number
    readonly packagePath: string
    readonly reviewer: number
    readonly reviewedAt: number
    /** The personal owner whose default preference this approval may establish. */
    readonly ownerShortId?: number
    readonly defaultEnable: boolean
    /** The validated user confirmation an exceeded-growth candidate was approved with. */
    readonly confirmGrowth?: { readonly confirmedBy: number; readonly confirmedAt: number; readonly messageId: string }
    readonly recheck: (version: SkillVersionRow, skill: SkillRow) => boolean
  }): { readonly skillId: number; readonly previousVersionId: number | null } {
    return this.#transaction(() => {
      const now = Date.now()
      const version = this.version(versionId)
      if (version === undefined || version.status !== VERSION_STATUS.pending) {
        throw new SkillStoreError('skills/not-pending', `skill version ${versionId} is no longer pending`)
      }
      const skill = this.identity(version.skill_id)
      if (skill === undefined) throw new SkillStoreError('skills/not-found', `skill version ${versionId} has no identity`)
      if (skill.archived_at !== null) {
        throw new SkillStoreError('skills/archived', `skill "${skill.name}" is archived`)
      }
      if (!recheck(version, skill)) {
        throw new SkillStoreError('skills/changed', 'the candidate content or state changed after it was inspected; re-check it before approving')
      }
      // A revision may only publish against the parent it was written for: if
      // another version became current meanwhile, the candidate is stale.
      if (version.parent_version_id !== null && skill.current_version_id !== version.parent_version_id) {
        throw new SkillStoreError('skills/changed',
          `skill "${skill.name}" changed its current version; create a new revision of the latest current version`)
      }
      if (version.growth_exceeded === 1 && confirmGrowth === undefined) {
        throw new SkillStoreError('skills/growth-confirmation-required',
          'core body grew more than 10%; show the counts and collect the user confirmation first')
      }
      // Only an exceeded version records a confirmation; a supplied one for a
      // normal revision is ignored rather than becoming a misleading audit row.
      const recordedGrowth = version.growth_exceeded === 1 ? confirmGrowth : undefined
      const previous = rowOf<{ id: number }>(this.#db.prepare(
        'SELECT id FROM skill_version WHERE skill_id = ? AND status = ? AND deleted_at IS NULL',
      ).get(skill.id, VERSION_STATUS.approvedCurrent))
      // Supersede before approving: the one-current unique index forbids two
      // approved rows even for the instant between the two updates.
      if (previous !== undefined && previous.id !== versionId) {
        this.#db.prepare('UPDATE skill_version SET status = ?, updated_at = ? WHERE id = ?')
          .run(VERSION_STATUS.superseded, now, previous.id)
      }
      this.#db.prepare(
        `UPDATE skill_version
            SET status = ?, package_path = ?, reviewer = ?, reviewed_at = ?,
                growth_confirmed_by = ?, growth_confirmed_at = ?, growth_confirm_message = ?, updated_at = ?
          WHERE id = ?`,
      ).run(VERSION_STATUS.approvedCurrent, packagePath, reviewer, reviewedAt,
        recordedGrowth?.confirmedBy ?? null, recordedGrowth?.confirmedAt ?? null, recordedGrowth?.messageId ?? null,
        now, versionId)
      this.#db.prepare('UPDATE skill SET current_version_id = ?, updated_by = ?, updated_at = ? WHERE id = ?')
        .run(versionId, reviewer, now, skill.id)
      if (defaultEnable && skill.scope === SKILL_SCOPE.personal && ownerShortId !== undefined
        && skill.owner_short_id === ownerShortId && this.preference(ownerShortId, skill.id) === undefined) {
        this.#db.prepare(
          'INSERT INTO skill_user_preference (short_id, skill_id, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        ).run(ownerShortId, skill.id, 1, now, now)
      }
      return { skillId: skill.id, previousVersionId: previous?.id ?? null }
    })
  }

  /** Clear one identity's archive marker; used by the lifecycle ticket and its tests. */
  restoreIdentity(id: number, updatedBy: number): boolean {
    const result = this.#db.prepare('UPDATE skill SET archived_at = NULL, updated_by = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
      .run(updatedBy, Date.now(), id) as ChangeResult
    return Number(result.changes) > 0
  }

  /** Set one identity's archive marker; used by the lifecycle ticket and its tests. */
  archiveIdentity(id: number, updatedBy: number): boolean {
    const now = Date.now()
    const result = this.#db.prepare('UPDATE skill SET archived_at = ?, updated_by = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL AND archived_at IS NULL')
      .run(now, updatedBy, now, id) as ChangeResult
    return Number(result.changes) > 0
  }

  #migrate(): void {
    this.#transaction(() => {
      const version = this.#storedVersion()
      if (version === undefined) {
        this.#db.exec(SCHEMA)
        this.#setVersion()
        return
      }
      if (version > SKILL_SCHEMA_VERSION) {
        throw new SkillStoreError('skills/schema-too-new', `the database file was written by schema version ${version}`)
      }
      if (version === SKILL_SCHEMA_VERSION) return
      // No older schema has ever shipped from this module. The ladder is kept
      // explicit so a later ticket adds a real step instead of silently
      // stamping the new number on an old file.
      throw new SkillStoreError('skills/schema-unsupported', `unsupported skill schema version ${version}`)
    })
  }

  #storedVersion(): number | undefined {
    // A fresh file has no `meta` table at all; asking SQLite first keeps the
    // version read from turning that into a missing-table error.
    const hasMeta = this.#db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get() !== undefined
    if (!hasMeta) return undefined
    const row = rowOf<{ value: string }>(this.#db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get())
    if (row === undefined) return undefined
    const version = Number(row.value)
    if (!Number.isSafeInteger(version)) {
      throw new SkillStoreError('skills/schema-too-new', `the database file declares an unreadable schema version ${row.value}`)
    }
    return version
  }

  #setVersion(): void {
    this.#db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SKILL_SCHEMA_VERSION))
  }

  #transaction<T>(work: () => T): T {
    this.#db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.#db.exec('COMMIT')
      return result
    } catch (error) {
      this.#db.exec('ROLLBACK')
      throw error
    }
  }
}

/** Re-exported so the seed path and its tests name one package error type. */
export { PackageError }
export type { SQLInputValue }
