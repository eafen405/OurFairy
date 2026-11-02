/**
 * The skill store: one SQLite file for skill identities, versions, each user's
 * enable preference and the background-learning bookkeeping.
 *
 * One synchronous `node:sqlite` connection, WAL, a versioned
 * `meta.schema_version` and `BEGIN IMMEDIATE` transactions follow the
 * repository's business-store pattern. The file is separate from every other
 * product store so skill history never reshapes another schema.
 *
 * Schema v1 is the runtime subset: identity, versions (with every review,
 * growth and install column the later tickets write), and preferences. Schema
 * v2 adds the three background-learning tables and nothing else, so the v1
 * tables keep their exact shape. The ladder is a real step: a v1 file is read,
 * the v2 tables are created, and the version is stamped; a file newer than this
 * build is refused instead of being written.
 *
 * The learning tables hold one detection state per source session, immutable
 * reuse-signal evidence rows (a revocation is a new row naming the row it
 * revokes), and the cross-session creation claims. The creation claim is
 * selected and inserted inside one immediate transaction; a partial unique
 * index over the active/failed states is the database's second guarantee.
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
import { isValidTaskKey } from './learning-policy.js'
import { PackageError } from './package.js'

/** The current schema version of this file; the ladder is asserted by the store test. */
export const SKILL_SCHEMA_VERSION = 2

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

/** One source session's detection state: idle, running an interval, or failed and awaiting a resume. */
export const LEARNING_STATUS = Object.freeze({ idle: 0, running: 1, failed: 2 })

/** One reuse signal's judgement. Only a success without a later revocation counts. */
export const SIGNAL_STATUS = Object.freeze({ success: 0, failure: 1, uncertain: 2, revoked: 3 })

/** How far one signal has been taken by the cross-session creation path. */
export const SIGNAL_PROCESSING = Object.freeze({ new: 0, claimed: 1, used: 2, ignored: 3 })

/** One cross-session creation claim's state. */
export const CREATION_JOB_STATE = Object.freeze({
  pending: 0,
  running: 1,
  candidate: 2,
  noImprovement: 3,
  failed: 4,
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

/**
 * Schema v2: the three background-learning tables (#300).
 *
 * `skill_learning_state` is one row per source session: the completed
 * watermark, the frozen cut and child of the interval now running, the newest
 * closed-turn time, a retry time and the recovery status. A completed interval
 * advances the watermark even when it produced no signal.
 *
 * `skill_reuse_signal` is immutable evidence. A later correction inserts a new
 * `status = 3 revoked` row whose `revokes_signal_id` names the original; the
 * original's status and evidence range are never updated. `processing` and
 * `creation_job_id` are bookkeeping for the cross-session claim.
 *
 * `skill_creation_job` is one cross-session creation claim per owner and task
 * key. `signals` freezes the contributing ids, `through_signal_id` is the
 * newest id the job consumed (so a completed job gates the next claim), and a
 * failed job keeps its child for a resume. The partial unique index refuses a
 * second active/failed claim even if two engines ever race.
 */
const SCHEMA_V2 = `
CREATE TABLE IF NOT EXISTS skill_learning_state (
  source_session TEXT PRIMARY KEY,
  watermark_seq INTEGER NOT NULL DEFAULT -1,   -- last event position a completed interval covered
  cut_seq INTEGER,                             -- frozen cut of the active interval / latest observed turn
  last_closed_at INTEGER,                      -- the newest closed user turn's time
  child_session TEXT,                          -- the detection child of the active or last interval
  status INTEGER NOT NULL DEFAULT 0,           -- 0 idle, 1 running, 2 failed
  retry_at INTEGER,                            -- earliest retry for a failed interval
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS skill_reuse_signal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_short_id INTEGER NOT NULL,
  task_key TEXT NOT NULL,                      -- <task-type>:<artifact>, kebab-case, <= 64 chars
  source_session TEXT NOT NULL,
  evidence_start_seq INTEGER NOT NULL,         -- exclusive lower bound of the evidence range
  evidence_end_seq INTEGER NOT NULL,           -- inclusive upper bound of the evidence range
  status INTEGER NOT NULL,                     -- 0 success, 1 failure, 2 uncertain, 3 revoked
  revokes_signal_id INTEGER,                   -- the earlier row a status-3 row revokes
  judged_at INTEGER NOT NULL,
  processing INTEGER NOT NULL DEFAULT 0,       -- 0 new, 1 claimed, 2 used, 3 ignored
  creation_job_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS skill_reuse_signal_by_owner_key
  ON skill_reuse_signal(owner_short_id, task_key, id);
CREATE INDEX IF NOT EXISTS skill_reuse_signal_by_source
  ON skill_reuse_signal(source_session, id);
CREATE TABLE IF NOT EXISTS skill_creation_job (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_short_id INTEGER NOT NULL,
  task_key TEXT NOT NULL,
  state INTEGER NOT NULL DEFAULT 0,            -- 0 pending, 1 running, 2 candidate, 3 no_improvement, 4 failed
  child_session TEXT,
  signals TEXT NOT NULL,                       -- JSON array of the contributing signal ids
  candidate_version_id INTEGER,
  through_signal_id INTEGER NOT NULL DEFAULT 0,-- newest signal id this claim consumed
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS skill_creation_job_one_claim
  ON skill_creation_job(owner_short_id, task_key)
  WHERE state IN (0, 1, 4) AND deleted_at IS NULL;
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

/** One row of the `skill_learning_state` table. */
export type LearningRow = {
  source_session: string
  watermark_seq: number
  cut_seq: number | null
  last_closed_at: number | null
  child_session: string | null
  /** 0 idle, 1 running, 2 failed. */
  status: number
  retry_at: number | null
  updated_at: number
  deleted_at: number | null
}

/** One row of the `skill_reuse_signal` table. */
export type SignalRow = {
  id: number
  owner_short_id: number
  task_key: string
  source_session: string
  evidence_start_seq: number
  evidence_end_seq: number
  /** 0 success, 1 failure, 2 uncertain, 3 revoked. */
  status: number
  revokes_signal_id: number | null
  judged_at: number
  /** 0 new, 1 claimed, 2 used, 3 ignored. */
  processing: number
  creation_job_id: number | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** One row of the `skill_creation_job` table. */
export type CreationJobRow = {
  id: number
  owner_short_id: number
  task_key: string
  /** 0 pending, 1 running, 2 candidate, 3 no_improvement, 4 failed. */
  state: number
  child_session: string | null
  /** The contributing signal ids, as a JSON array. */
  signals: string
  candidate_version_id: number | null
  through_signal_id: number
  attempts: number
  next_retry_at: number | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** One signal the detection engine writes after a completed interval. */
export type NewSignal = {
  readonly ownerShortId: number
  readonly taskKey: string
  readonly sourceSession: string
  readonly evidenceStartSeq: number
  readonly evidenceEndSeq: number
  /** 0 success, 1 failure, 2 uncertain or 3 revoked. */
  readonly status: number
  /** Required when {@link status} is `3`: the earlier signal this row revokes. */
  readonly revokesSignalId?: number
}

/** One owner/task-key group that already meets the two-session threshold. */
export type CreationCandidate = {
  readonly ownerShortId: number
  readonly taskKey: string
  /** Distinct source sessions with at least one valid success. */
  readonly sessions: number
  /** The newest contributing signal id, used to bound the claim. */
  readonly latestSignalId: number
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

/** One settled version together with the identity facts a result view needs. */
export type DecidedVersionRow = {
  readonly id: number
  readonly skill_id: number
  readonly status: number
  readonly reviewed_at: number | null
  readonly updated_at: number
  readonly skill_name: string
  readonly skill_scope: number
  readonly skill_proposed_by: number | null
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

  // ── Background learning: detection state ────────────────────────────────

  /** One source session's detection state, or undefined before its first observation. */
  learning(sourceSession: string): LearningRow | undefined {
    return rowOf<LearningRow>(this.#db.prepare(
      'SELECT * FROM skill_learning_state WHERE source_session = ? AND deleted_at IS NULL',
    ).get(sourceSession))
  }

  /** Every source session the learning engine has observed, for the restart scan. */
  learningRows(): LearningRow[] {
    return rowsOf<LearningRow>(this.#db.prepare(
      'SELECT * FROM skill_learning_state WHERE deleted_at IS NULL ORDER BY source_session',
    ).all())
  }

  /**
   * Record the newest closed user turn an idle source has shown.
   *
   * The frozen cut doubles as the latest observed position while no interval is
   * active: a newer closed turn moves it and its time, while an older or equal
   * position leaves the stored time alone (an operator-visible shift must not be
   * overwritten by the next observation).
   */
  observeLearning({ sourceSession, lastClosedSeq, lastClosedAt }: {
    readonly sourceSession: string
    readonly lastClosedSeq: number
    readonly lastClosedAt: number
  }): void {
    const now = Date.now()
    const row = this.learning(sourceSession)
    if (row === undefined) {
      this.#db.prepare(`INSERT INTO skill_learning_state
        (source_session, watermark_seq, cut_seq, last_closed_at, child_session, status, updated_at)
        VALUES (?, -1, ?, ?, NULL, 0, ?)`).run(sourceSession, lastClosedSeq, lastClosedAt, now)
      return
    }
    if (row.status !== 0) return
    if (row.cut_seq !== null && lastClosedSeq <= row.cut_seq && row.last_closed_at !== null) return
    this.#db.prepare('UPDATE skill_learning_state SET cut_seq = ?, last_closed_at = ?, updated_at = ? WHERE source_session = ?')
      .run(lastClosedSeq, lastClosedAt, now, sourceSession)
  }

  /**
   * Freeze one interval and take it for one detection child, in one immediate
   * transaction.
   *
   * A running or failed interval is never claimed again: the same child owns it
   * until it completes, and a failed child is resumed rather than replaced.
   * @returns whether this call froze the interval.
   */
  claimLearning({ sourceSession, cutSeq, lastClosedAt, childSession }: {
    readonly sourceSession: string
    readonly cutSeq: number
    readonly lastClosedAt: number
    readonly childSession: string
  }): boolean {
    return this.#transaction(() => {
      const row = this.learning(sourceSession)
      if (row !== undefined && row.status !== 0) return false
      const now = Date.now()
      if (row === undefined) {
        this.#db.prepare(`INSERT INTO skill_learning_state
          (source_session, watermark_seq, cut_seq, last_closed_at, child_session, status, updated_at)
          VALUES (?, -1, ?, ?, ?, 1, ?)`).run(sourceSession, cutSeq, lastClosedAt, childSession, now)
        return true
      }
      this.#db.prepare(`UPDATE skill_learning_state
        SET cut_seq = ?, last_closed_at = ?, child_session = ?, status = 1, retry_at = NULL, updated_at = ?
        WHERE source_session = ?`).run(cutSeq, lastClosedAt, childSession, now, sourceSession)
      return true
    })
  }

  /** Keep the failed interval and its child for a resume; the watermark stays put. */
  failLearning({ sourceSession, childSession, retryDelayMs }: {
    readonly sourceSession: string
    readonly childSession: string
    readonly retryDelayMs: number
  }): void {
    const now = Date.now()
    this.#db.prepare(`UPDATE skill_learning_state
      SET child_session = ?, status = 2, retry_at = ?, updated_at = ?
      WHERE source_session = ?`).run(childSession, now + Math.max(0, retryDelayMs), now, sourceSession)
  }

  /**
   * Mark the frozen interval complete. Zero signals complete just like any
   * other run: the watermark is the frozen cut, so the next interval begins
   * after it.
   */
  completeLearning({ sourceSession, cutSeq, childSession }: {
    readonly sourceSession: string
    readonly cutSeq: number
    readonly childSession: string
  }): void {
    this.#db.prepare(`UPDATE skill_learning_state
      SET watermark_seq = ?, cut_seq = ?, child_session = ?, status = 0, retry_at = NULL, updated_at = ?
      WHERE source_session = ?`).run(cutSeq, cutSeq, childSession, Date.now(), sourceSession)
  }

  /**
   * Drop the frozen cut and child without advancing the watermark, so an
   * interval that can never finish (its child never came into existence, or the
   * configured turn budget is spent) is claimed again by a later tick.
   */
  resetLearning(sourceSession: string): void {
    this.#db.prepare(`UPDATE skill_learning_state
      SET cut_seq = NULL, child_session = NULL, status = 0, retry_at = NULL, updated_at = ?
      WHERE source_session = ?`).run(Date.now(), sourceSession)
  }

  // ── Background learning: immutable reuse signals ────────────────────────

  /**
   * Insert one interval's signals in one transaction.
   *
   * Every row is new evidence: the method never updates an existing row. A
   * `status = 3 revoked` row must name an active signal of the same owner; the
   * named row keeps its status and evidence range, which is what "valid success
   * = status 0 and no later revocation" reads.
   *
   * @returns the inserted ids, in submission order.
   * @throws {SkillStoreError} for an invalid task key, status, range or
   *   revocation target.
   */
  insertSignals(signals: readonly NewSignal[]): number[] {
    if (signals.length === 0) return []
    return this.#transaction(() => {
      const now = Date.now()
      const ids: number[] = []
      for (const signal of signals) {
        if (!isValidTaskKey(signal.taskKey)) {
          throw new SkillStoreError('skills/invalid-task-key', `a task key must be <task-type>:<artifact> kebab-case, at most 64 characters; got ${JSON.stringify(signal.taskKey)}`)
        }
        // The watermark starts at -1 ("before the first event"), so the first
        // interval's exclusive lower bound is -1 as well.
        if (!Number.isSafeInteger(signal.evidenceStartSeq) || !Number.isSafeInteger(signal.evidenceEndSeq)
          || signal.evidenceStartSeq < -1 || signal.evidenceEndSeq <= signal.evidenceStartSeq) {
          throw new SkillStoreError('skills/invalid-evidence-range', 'a signal needs an evidence range with -1 <= start < end')
        }
        const status = signal.status
        if (status !== SIGNAL_STATUS.success && status !== SIGNAL_STATUS.failure
          && status !== SIGNAL_STATUS.uncertain && status !== SIGNAL_STATUS.revoked) {
          throw new SkillStoreError('skills/invalid-signal', `unknown signal status ${String(status)}`)
        }
        if (status === SIGNAL_STATUS.revoked) {
          if (signal.revokesSignalId === undefined) {
            throw new SkillStoreError('skills/invalid-revocation', 'a revocation needs revokesSignalId')
          }
          const revoked = this.signal(signal.revokesSignalId)
          if (revoked === undefined || revoked.owner_short_id !== signal.ownerShortId || revoked.status !== SIGNAL_STATUS.success) {
            throw new SkillStoreError('skills/invalid-revocation',
              `signal ${signal.revokesSignalId} is not a success signal of owner ${signal.ownerShortId}`)
          }
        } else if (signal.revokesSignalId !== undefined) {
          throw new SkillStoreError('skills/invalid-revocation', 'only a status-3 revocation names revokesSignalId')
        }
        const inserted = this.#db.prepare(
          `INSERT INTO skill_reuse_signal
            (owner_short_id, task_key, source_session, evidence_start_seq, evidence_end_seq, status,
             revokes_signal_id, judged_at, processing, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(signal.ownerShortId, signal.taskKey, signal.sourceSession, signal.evidenceStartSeq,
          signal.evidenceEndSeq, status, signal.revokesSignalId ?? null, now,
          status === SIGNAL_STATUS.success ? SIGNAL_PROCESSING.new : SIGNAL_PROCESSING.ignored, now, now) as {
          readonly lastInsertRowid: number | bigint
        }
        ids.push(Number(inserted.lastInsertRowid))
      }
      return ids
    })
  }

  /** One signal row that is not logically deleted. */
  signal(id: number): SignalRow | undefined {
    return rowOf<SignalRow>(this.#db.prepare('SELECT * FROM skill_reuse_signal WHERE id = ? AND deleted_at IS NULL').get(id))
  }

  /**
   * The valid success signals for one owner and task key: status 0 and no later
   * revocation row. This is the only "success" the creation threshold reads.
   */
  validSuccessSignals(ownerShortId: number, taskKey: string): SignalRow[] {
    return rowsOf<SignalRow>(this.#db.prepare(
      `SELECT s.* FROM skill_reuse_signal s
        WHERE s.owner_short_id = ? AND s.task_key = ? AND s.status = ? AND s.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM skill_reuse_signal r
             WHERE r.revokes_signal_id = s.id AND r.status = ? AND r.deleted_at IS NULL)
        ORDER BY s.id`,
    ).all(ownerShortId, taskKey, SIGNAL_STATUS.success, SIGNAL_STATUS.revoked))
  }

  /**
   * The earlier successes of one source session a later interval may revoke,
   * newest first and bounded: the detection prompt names these rows explicitly.
   */
  revocableSignals(ownerShortId: number, sourceSession: string, limit: number): SignalRow[] {
    return rowsOf<SignalRow>(this.#db.prepare(
      `SELECT s.* FROM skill_reuse_signal s
        WHERE s.owner_short_id = ? AND s.source_session = ? AND s.status = ? AND s.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM skill_reuse_signal r
             WHERE r.revokes_signal_id = s.id AND r.status = ? AND r.deleted_at IS NULL)
        ORDER BY s.id DESC LIMIT ?`,
    ).all(ownerShortId, sourceSession, SIGNAL_STATUS.success, SIGNAL_STATUS.revoked, limit))
  }

  /** The owner's existing canonical task keys, newest first and bounded. */
  taskKeys(ownerShortId: number, limit: number): string[] {
    return rowsOf<{ task_key: string }>(this.#db.prepare(
      `SELECT task_key, MAX(id) AS latest FROM skill_reuse_signal
        WHERE owner_short_id = ? AND deleted_at IS NULL GROUP BY task_key
        ORDER BY latest DESC LIMIT ?`,
    ).all(ownerShortId, limit)).map(row => row.task_key)
  }

  /**
   * Every owner/task-key group that already has two independent sessions of
   * valid success and at least one signal newer than that key's last completed
   * job. The claim re-checks the same facts inside its transaction.
   */
  creationCandidates(): CreationCandidate[] {
    return rowsOf<{ owner_short_id: number; task_key: string; sessions: number; latest: number }>(this.#db.prepare(
      `SELECT s.owner_short_id AS owner_short_id, s.task_key AS task_key,
              COUNT(DISTINCT s.source_session) AS sessions, MAX(s.id) AS latest
         FROM skill_reuse_signal s
        WHERE s.status = ? AND s.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM skill_reuse_signal r
             WHERE r.revokes_signal_id = s.id AND r.status = ? AND r.deleted_at IS NULL)
          AND s.id > COALESCE((
            SELECT MAX(j.through_signal_id) FROM skill_creation_job j
             WHERE j.owner_short_id = s.owner_short_id AND j.task_key = s.task_key
               AND j.state IN (?, ?) AND j.deleted_at IS NULL), 0)
        GROUP BY s.owner_short_id, s.task_key
       HAVING COUNT(DISTINCT s.source_session) >= 2
        ORDER BY latest`,
    ).all(SIGNAL_STATUS.success, SIGNAL_STATUS.revoked, CREATION_JOB_STATE.candidate,
      CREATION_JOB_STATE.noImprovement)).map(row => ({
      ownerShortId: row.owner_short_id,
      taskKey: row.task_key,
      sessions: row.sessions,
      latestSignalId: row.latest,
    }))
  }

  // ── Background learning: cross-session creation claims ──────────────────

  /** One creation claim row that is not logically deleted. */
  creationJob(id: number): CreationJobRow | undefined {
    return rowOf<CreationJobRow>(this.#db.prepare('SELECT * FROM skill_creation_job WHERE id = ? AND deleted_at IS NULL').get(id))
  }

  /** Every claim row, for the restart scan. */
  creationJobs(): CreationJobRow[] {
    return rowsOf<CreationJobRow>(this.#db.prepare(
      'SELECT * FROM skill_creation_job WHERE deleted_at IS NULL ORDER BY id',
    ).all())
  }

  /** The claim that currently owns one owner/task key: active or awaiting a retry. */
  activeCreationJob(ownerShortId: number, taskKey: string): CreationJobRow | undefined {
    return rowOf<CreationJobRow>(this.#db.prepare(
      `SELECT * FROM skill_creation_job
        WHERE owner_short_id = ? AND task_key = ? AND state IN (?, ?, ?) AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 1`,
    ).get(ownerShortId, taskKey, CREATION_JOB_STATE.pending, CREATION_JOB_STATE.running, CREATION_JOB_STATE.failed))
  }

  /** The last settled claim that consumed evidence, if any. */
  lastCompletedCreationJob(ownerShortId: number, taskKey: string): CreationJobRow | undefined {
    return rowOf<CreationJobRow>(this.#db.prepare(
      `SELECT * FROM skill_creation_job
        WHERE owner_short_id = ? AND task_key = ? AND state IN (?, ?) AND deleted_at IS NULL
        ORDER BY id DESC LIMIT 1`,
    ).get(ownerShortId, taskKey, CREATION_JOB_STATE.candidate, CREATION_JOB_STATE.noImprovement))
  }

  /**
   * Take one owner/task-key creation claim atomically.
   *
   * Inside one `BEGIN IMMEDIATE`: an existing active or retrying claim refuses
   * the new one; the contributing signals are re-read (valid success, newer
   * than the last completed claim's `through_signal_id`); fewer than two
   * distinct source sessions is a no-op; then the job row is inserted and the
   * contributing signals are marked used with this job's id.
   */
  claimCreationJob({ ownerShortId, taskKey, childSession }: {
    readonly ownerShortId: number
    readonly taskKey: string
    readonly childSession: string
  }): { readonly claimed: true; readonly job: CreationJobRow; readonly signalIds: number[] }
    | { readonly claimed: false; readonly reason: 'busy' | 'below-threshold' } {
    return this.#transaction(() => {
      if (this.activeCreationJob(ownerShortId, taskKey) !== undefined) return { claimed: false as const, reason: 'busy' as const }
      const through = this.lastCompletedCreationJob(ownerShortId, taskKey)?.through_signal_id ?? 0
      const signals = this.validSuccessSignals(ownerShortId, taskKey).filter(row => row.id > through)
      const sessions = new Set(signals.map(row => row.source_session))
      if (sessions.size < 2) return { claimed: false as const, reason: 'below-threshold' as const }
      const now = Date.now()
      const signalIds = signals.map(row => row.id)
      const newest = Math.max(...signalIds)
      const inserted = this.#db.prepare(
        `INSERT INTO skill_creation_job
          (owner_short_id, task_key, state, child_session, signals, candidate_version_id,
           through_signal_id, attempts, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, 1, ?, ?)`,
      ).run(ownerShortId, taskKey, CREATION_JOB_STATE.running, childSession,
        JSON.stringify(signalIds), newest, now, now) as { readonly lastInsertRowid: number | bigint }
      const jobId = Number(inserted.lastInsertRowid)
      const mark = this.#db.prepare(
        'UPDATE skill_reuse_signal SET processing = ?, creation_job_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
      )
      for (const id of signalIds) mark.run(SIGNAL_PROCESSING.used, jobId, now, id)
      const job = this.creationJob(jobId)
      if (job === undefined) throw new SkillStoreError('skills/misconfigured', 'the creation claim disappeared after its write')
      return { claimed: true as const, job, signalIds }
    })
  }

  /** The signals one claim froze, in id order. */
  jobSignals(job: CreationJobRow): SignalRow[] {
    let ids: number[]
    try {
      const parsed: unknown = JSON.parse(job.signals)
      ids = Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number' && Number.isSafeInteger(id)) : []
    } catch {
      ids = []
    }
    return ids.map(id => this.signal(id)).filter((row): row is SignalRow => row !== undefined).sort((left, right) => left.id - right.id)
  }

  /**
   * Turn a failed (or restart-interrupted running) claim back into a running
   * one with its attempt counted, so a later tick resumes the same child
   * instead of starting a second claim.
   */
  resumeCreationJob({ id, childSession }: { readonly id: number; readonly childSession?: string }): boolean {
    const now = Date.now()
    const result = this.#db.prepare(
      `UPDATE skill_creation_job
          SET state = ?, attempts = attempts + 1, next_retry_at = NULL, updated_at = ?
        WHERE id = ? AND state IN (?, ?) AND deleted_at IS NULL`,
    ).run(CREATION_JOB_STATE.running, now, id, CREATION_JOB_STATE.running, CREATION_JOB_STATE.failed) as ChangeResult
    if (Number(result.changes) > 0 && childSession !== undefined) {
      this.#db.prepare('UPDATE skill_creation_job SET child_session = ?, updated_at = ? WHERE id = ?').run(childSession, now, id)
    }
    return Number(result.changes) > 0
  }

  /** Point a running claim at the child that will (or did) produce its outcome. */
  setCreationChild({ id, childSession }: { readonly id: number; readonly childSession: string }): boolean {
    const result = this.#db.prepare(
      'UPDATE skill_creation_job SET child_session = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    ).run(childSession, Date.now(), id) as ChangeResult
    return Number(result.changes) > 0
  }

  /**
   * Record the one candidate a running claim submitted. A second call for the
   * same claim changes nothing: one claim produces at most one candidate.
   */
  setCreationCandidate({ id, versionId }: { readonly id: number; readonly versionId: number }): boolean {
    const result = this.#db.prepare(
      `UPDATE skill_creation_job SET candidate_version_id = ?, updated_at = ?
        WHERE id = ? AND state = ? AND candidate_version_id IS NULL AND deleted_at IS NULL`,
    ).run(versionId, Date.now(), id, CREATION_JOB_STATE.running) as ChangeResult
    return Number(result.changes) > 0
  }

  /** Keep the claim and its contributing signals, but record that this run failed. */
  failCreationJob({ id, retryDelayMs }: { readonly id: number; readonly retryDelayMs: number }): boolean {
    const now = Date.now()
    const result = this.#db.prepare(
      `UPDATE skill_creation_job
          SET state = ?, next_retry_at = ?, updated_at = ?
        WHERE id = ? AND state = ? AND deleted_at IS NULL`,
    ).run(CREATION_JOB_STATE.failed, now + Math.max(0, retryDelayMs), now, id, CREATION_JOB_STATE.running) as ChangeResult
    return Number(result.changes) > 0
  }

  /** Settle one running claim as a candidate or an explicit no-improvement. */
  completeCreationJob({ id, state, candidateVersionId }: {
    readonly id: number
    readonly state: typeof CREATION_JOB_STATE.candidate | typeof CREATION_JOB_STATE.noImprovement
    readonly candidateVersionId?: number
  }): boolean {
    const result = this.#db.prepare(
      `UPDATE skill_creation_job
          SET state = ?, candidate_version_id = ?, next_retry_at = NULL, updated_at = ?
        WHERE id = ? AND state = ? AND deleted_at IS NULL`,
    ).run(state, candidateVersionId ?? null, Date.now(), id, CREATION_JOB_STATE.running) as ChangeResult
    return Number(result.changes) > 0
  }

  /**
   * Forget a failed claim's child so the retry starts a fresh child under the
   * same claim (the persisted child no longer exists).
   */
  clearCreationChild(id: number): boolean {
    const result = this.#db.prepare(
      'UPDATE skill_creation_job SET child_session = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
    ).run(Date.now(), id) as ChangeResult
    return Number(result.changes) > 0
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
   * and to Phaethon. Archived identities keep their drafts out; a draft of an
   * archived identity is not reviewable.
   */
  pendingDrafts(shortId: number, isAdmin = false, limit = 50): PendingDraftRow[] {
    return rowsOf<PendingDraftRow>(this.#db.prepare(
      `SELECT v.*, s.name AS skill_name, s.scope AS skill_scope,
              s.owner_short_id AS skill_owner_short_id, s.proposed_by AS skill_proposed_by,
              s.archived_at AS skill_archived_at
         FROM skill_version v JOIN skill s ON s.id = v.skill_id
        WHERE v.status = ? AND v.deleted_at IS NULL AND s.deleted_at IS NULL AND s.archived_at IS NULL
          AND ((s.scope = ? AND s.owner_short_id = ?)
            OR (s.scope = ? AND (s.proposed_by = ? OR ? = 1)))
        ORDER BY v.created_at DESC, v.id DESC LIMIT ?`,
    ).all(VERSION_STATUS.pending, SKILL_SCOPE.personal, shortId, SKILL_SCOPE.common, shortId, isAdmin ? 1 : 0, limit))
  }

  /**
   * The recently decided versions this caller may see as a result.
   *
   * A personal decision belongs to its owner; a common decision is visible to
   * its proposer and to Phaethon. Only settled statuses are results (a
   * changes-requested draft is still a live candidate for its author), and the
   * read is bounded and newest-first.
   */
  recentDecisions({ shortId, isAdmin, limit }: {
    readonly shortId: number
    readonly isAdmin: boolean
    readonly limit: number
  }): DecidedVersionRow[] {
    return rowsOf<DecidedVersionRow>(this.#db.prepare(
      `SELECT v.id, v.skill_id, v.status, v.reviewed_at, v.updated_at,
              s.name AS skill_name, s.scope AS skill_scope, s.proposed_by AS skill_proposed_by
         FROM skill_version v JOIN skill s ON s.id = v.skill_id
        WHERE v.deleted_at IS NULL AND s.deleted_at IS NULL AND v.reviewed_at IS NOT NULL
          AND v.status IN (?, ?, ?)
          AND ((s.scope = ? AND s.owner_short_id = ?)
            OR (s.scope = ? AND (s.proposed_by = ? OR ? = 1)))
        ORDER BY v.reviewed_at DESC, v.id DESC LIMIT ?`,
    ).all(VERSION_STATUS.changesRequested, VERSION_STATUS.rejected, VERSION_STATUS.approvedCurrent,
      SKILL_SCOPE.personal, shortId, SKILL_SCOPE.common, shortId, isAdmin ? 1 : 0, limit))
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
        this.#db.exec(SCHEMA_V2)
        this.#setVersion()
        return
      }
      if (version > SKILL_SCHEMA_VERSION) {
        throw new SkillStoreError('skills/schema-too-new', `the database file was written by schema version ${version}`)
      }
      if (version === SKILL_SCHEMA_VERSION) return
      if (version === 1) {
        // v1 shipped identity, versions and preferences only; v2 adds the three
        // learning tables and leaves every v1 row untouched. The statement is
        // CREATE IF NOT EXISTS, so a half-applied file converges here.
        this.#db.exec(SCHEMA_V2)
        this.#setVersion()
        return
      }
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
