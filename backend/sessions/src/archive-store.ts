/**
 * The session archive store: which sessions a caller has archived, in this
 * module's own SQLite file.
 *
 * dsh has no archive concept, so "delete a conversation" is a product decision
 * to keep the session and stop offering it. That fact has to be durable and
 * product-owned. It lives in the sessions module rather than the identity store
 * because it is session lifecycle, not an account fact; putting it in the
 * account schema would move that version for a foreign concern.
 *
 * Ownership stays `SessionHeader.owner`. `owner_short_id` is the caller the
 * archive is scoped to, never a second ownership authority: every write goes
 * through the service's header authorization first, and the read is scoped so
 * one caller's archive never answers another caller's list.
 *
 * The file is the memory store's shape: one synchronous `node:sqlite`
 * connection, WAL, a versioned `meta.schema_version` and idempotent schema
 * re-execution on upgrade.
 *
 * @module @ourfairy/dsh-sessions/src/archive-store
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'

/**
 * Numeric codes for one archive row's lifecycle state, as AGENTS.md requires
 * for a finite enum. This module writes `archived`; `active` is the value the
 * restore half of the feature writes.
 */
export const ARCHIVE_STATUS = Object.freeze({ active: 0, archived: 1 })

const SCHEMA_VERSION = 1

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS session_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,              -- SessionHeader.id, exactly as the store wrote it
  owner_short_id INTEGER NOT NULL,       -- the caller the archive is scoped to (actor, not ownership)
  status INTEGER NOT NULL DEFAULT 0,     -- 0 active, 1 archived
  archived_at INTEGER,                   -- epoch ms when archived; NULL while active
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER                     -- logical delete, required on every business table
);
CREATE UNIQUE INDEX IF NOT EXISTS session_archive_by_session ON session_archive(session_id);
`

/** One archived session's identifier, the only column a list read needs. */
type ArchivedSessionRow = { session_id: string }

/** The SQLite driver types every column as `SQLOutputValue`; the schema decides the row shape. */
function rowsOf<T extends Record<string, SQLOutputValue>>(rows: Record<string, SQLOutputValue>[]): T[] {
  return rows as T[]
}

/** One version row, read as the text its column holds. */
function rowOf<T extends Record<string, SQLOutputValue>>(row: Record<string, SQLOutputValue> | undefined): T | undefined {
  return row as T | undefined
}

export class SessionArchiveStore {
  #db: DatabaseSync

  constructor({ path }: { path: string }) {
    if (typeof path !== 'string' || path === '') {
      throw new Error('the session archive store needs a database path')
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

  /**
   * The session ids one caller has archived.
   *
   * One read answers the whole list, so `/sessions/list` filters with a set
   * rather than one query per session.
   */
  archivedSessionIds(ownerShortId: number): Set<string> {
    const rows = rowsOf<ArchivedSessionRow>(this.#db.prepare(
      'SELECT session_id FROM session_archive WHERE owner_short_id = ? AND status = ? AND deleted_at IS NULL',
    ).all(ownerShortId, ARCHIVE_STATUS.archived))
    return new Set(rows.map(row => row.session_id))
  }

  /**
   * Archive one session for one caller.
   *
   * Archiving is idempotent, and the first archive fixes `archived_at`: asking
   * again is the same durable fact, not a later one. A restored row
   * (`status = 0, archived_at = NULL`) that is archived again takes the new
   * instant.
   */
  archive({ sessionId, ownerShortId }: { readonly sessionId: string; readonly ownerShortId: number }): void {
    const now = Date.now()
    this.#db.prepare(`INSERT INTO session_archive
      (session_id, owner_short_id, status, archived_at, created_by, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET
        owner_short_id = excluded.owner_short_id,
        status = excluded.status,
        archived_at = COALESCE(session_archive.archived_at, excluded.archived_at),
        updated_by = excluded.updated_by,
        updated_at = excluded.updated_at,
        deleted_at = NULL`).run(
      sessionId, ownerShortId, ARCHIVE_STATUS.archived, now, ownerShortId, ownerShortId, now, now,
    )
  }

  /**
   * Restore one archived session for one caller, answering whether a row moved.
   *
   * Restoring is the same row going back to active: `status = 0` and
   * `archived_at = NULL`, which is what lets a later archive take a new instant.
   * The update matches only a row this caller holds as archived, so it is the
   * store itself that refuses a session that is not in the caller's archive:
   * a foreign, unknown or merely active session changes nothing here.
   */
  restore({ sessionId, ownerShortId }: { readonly sessionId: string; readonly ownerShortId: number }): boolean {
    const now = Date.now()
    const result = this.#db.prepare(`UPDATE session_archive
      SET status = ?, archived_at = NULL, updated_by = ?, updated_at = ?
      WHERE session_id = ? AND owner_short_id = ? AND status = ? AND deleted_at IS NULL`).run(
      ARCHIVE_STATUS.active, ownerShortId, now, sessionId, ownerShortId, ARCHIVE_STATUS.archived,
    )
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
      if (version > SCHEMA_VERSION) {
        throw new Error(`the session archive file was written by schema version ${String(version)}`)
      }
      if (version === SCHEMA_VERSION) return
      this.#db.exec(SCHEMA)
      this.#setVersion()
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
      throw new Error(`the session archive file declares an unreadable schema version ${row.value}`)
    }
    return version
  }

  #setVersion(): void {
    this.#db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run('schema_version', String(SCHEMA_VERSION))
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
