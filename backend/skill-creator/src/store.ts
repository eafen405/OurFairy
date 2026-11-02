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
