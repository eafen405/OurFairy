/**
 * The memory store: long-term memories in their own SQLite file.
 *
 * The file is separate from the identity store so memory growth never reshapes
 * the identity schema. One synchronous `node:sqlite` connection, WAL, a
 * versioned `meta.schema_version` and `BEGIN IMMEDIATE` transactions follow the
 * repository's business-store pattern; the difference is deletion. An invalid
 * memory is removed with a physical `DELETE` and its number is never reused, so
 * an old search result cannot point at a new memory
 * ([ADR-0002](../../../docs/adr/0002-physical-memory-deletion.md)).
 *
 * The impression table is created here, once, so its ticket adds behaviour
 * rather than a second migration. The maintenance state is driven by this row:
 * one row per source session records the completed watermark, the frozen cut of
 * the interval now being maintained, and the child session that owns that
 * interval.
 *
 * @module @ourfairy/dsh-memory/src/store
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite'
import { MemoryError } from './tool-kit.js'

const SCHEMA_VERSION = 2

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  is_private INTEGER NOT NULL DEFAULT 0,         -- 0 normal, 1 private
  source_session TEXT NOT NULL,                  -- the owner is derived from this session's header
  created_at INTEGER NOT NULL,
  content_updated_at INTEGER NOT NULL            -- last add or content edit; search dates use it
);
CREATE INDEX IF NOT EXISTS memories_by_layer_time ON memories(is_private, content_updated_at);
CREATE TABLE IF NOT EXISTS impressions (
  short_id INTEGER PRIMARY KEY,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS maintenance_state (
  source_session TEXT PRIMARY KEY,
  watermark_seq INTEGER NOT NULL DEFAULT -1,     -- last event position a completed cut covered
  cut_seq INTEGER,                               -- frozen cut of the active interval / latest observed closed turn
  last_closed_at INTEGER,                        -- the newest closed user turn's time
  child_session TEXT,                            -- the maintenance child session of the active or last interval
  status INTEGER NOT NULL DEFAULT 0,             -- 0 idle, 1 running, 2 failed
  updated_at INTEGER NOT NULL
);
`

/** One row of the `memories` table, as every read site sees it. */
export type MemoryRow = {
  id: number
  content: string
  /** 0 normal, 1 private; the tool surface passes it as a boolean. */
  is_private: number
  source_session: string
  created_at: number
  content_updated_at: number
}

/** One row of the `maintenance_state` table, as the engine reads it. */
export type MaintenanceRow = {
  source_session: string
  watermark_seq: number
  cut_seq: number | null
  last_closed_at: number | null
  child_session: string | null
  /** 0 idle, 1 running, 2 failed. */
  status: number
  updated_at: number
}

/** One row of the `impressions` table: one current body per user. */
export type ImpressionRow = {
  short_id: number
  content: string
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** One search in one layer, with this search's own limits. */
export type MemorySearchQuery = {
  readonly query: string
  readonly isPrivate: boolean
  readonly startAt?: number
  readonly endAt?: number
  readonly limit: number
  readonly characterBudget: number
}

/** What one search found and what it had to leave out. */
export type MemorySearchResult = {
  readonly rows: MemoryRow[]
  readonly matched: number
  readonly characters: number
  readonly truncated: boolean
}

/** The primary key SQLite assigned to one inserted row. */
type InsertResult = { readonly lastInsertRowid: number | bigint }

/** The row count and change count one statement reports. */
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

/** The single number one `COUNT(*)` statement reports. */
function countOf(row: Record<string, SQLOutputValue> | undefined): number {
  const total = rowOf<{ total: number }>(row)?.total
  return typeof total === 'number' ? total : 0
}

export class MemoryStore {
  #db: DatabaseSync

  constructor({ path }: { path: string }) {
    if (typeof path !== 'string' || path === '') {
      throw new MemoryError(500, 'memory/misconfigured', 'the memory store needs a database path')
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
   * Store one memory and answer the number SQLite assigned. `AUTOINCREMENT`
   * makes that number monotone for the life of the file, so a deleted number is
   * not handed out again.
   */
  add({ content, isPrivate, sourceSession }: { readonly content: string; readonly isPrivate: boolean; readonly sourceSession: string }): number {
    const now = Date.now()
    const result = this.#db.prepare('INSERT INTO memories (content, is_private, source_session, created_at, content_updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(content, isPrivate ? 1 : 0, sourceSession, now, now) as InsertResult
    return Number(result.lastInsertRowid)
  }

  /**
   * Search one layer by literal substring, optionally between two content-update
   * instants (both bounds inclusive).
   *
   * Results come newest content first, then by number, which is the order the
   * budget cuts. A memory is included whole or omitted whole: content is never
   * clipped, and one memory whose own content exceeds the character budget is
   * omitted like any other, so no over-budget body reaches the model.
   */
  search({ query, isPrivate, startAt, endAt, limit, characterBudget }: MemorySearchQuery): MemorySearchResult {
    const conditions = ['is_private = ?', 'instr(content, ?) > 0']
    const parameters: SQLInputValue[] = [isPrivate ? 1 : 0, query]
    if (startAt !== undefined && endAt !== undefined) {
      conditions.push('content_updated_at BETWEEN ? AND ?')
      parameters.push(startAt, endAt)
    }
    const where = conditions.join(' AND ')
    const matched = countOf(this.#db.prepare(`SELECT COUNT(*) AS total FROM memories WHERE ${where}`).get(...parameters))
    const rows = rowsOf<MemoryRow>(this.#db.prepare(`SELECT * FROM memories WHERE ${where} ORDER BY content_updated_at DESC, id DESC`).all(...parameters))
    const selected: MemoryRow[] = []
    let characters = 0
    for (const row of rows) {
      if (selected.length >= limit) break
      const size = [...row.content].length
      if (characters + size > characterBudget) break
      selected.push(row)
      characters += size
    }
    return { rows: selected, matched, characters, truncated: selected.length < matched }
  }

  /** One memory of one layer, or undefined when the number does not name one there. */
  find({ id, isPrivate }: { readonly id: number; readonly isPrivate: boolean }): MemoryRow | undefined {
    return rowOf<MemoryRow>(this.#db.prepare('SELECT * FROM memories WHERE id = ? AND is_private = ?').get(id, isPrivate ? 1 : 0))
  }

  /**
   * Replace one memory's content. The source session is the session that
   * supports the new content, so an edit re-attributes the memory; the content
   * time moves with it, while the number and layer stay.
   */
  edit({ id, isPrivate, content, sourceSession }: {
    readonly id: number
    readonly isPrivate: boolean
    readonly content: string
    readonly sourceSession: string
  }): boolean {
    const result = this.#db.prepare('UPDATE memories SET content = ?, source_session = ?, content_updated_at = ? WHERE id = ? AND is_private = ?')
      .run(content, sourceSession, Date.now(), id, isPrivate ? 1 : 0) as ChangeResult
    return Number(result.changes) > 0
  }

  /** Remove one memory physically; no tombstone row survives. */
  remove({ id, isPrivate }: { readonly id: number; readonly isPrivate: boolean }): boolean {
    const result = this.#db.prepare('DELETE FROM memories WHERE id = ? AND is_private = ?')
      .run(id, isPrivate ? 1 : 0) as ChangeResult
    return Number(result.changes) > 0
  }

  /** One user's current impression, or undefined when they have none (yet). */
  impression({ shortId }: { readonly shortId: number }): ImpressionRow | undefined {
    return rowOf<ImpressionRow>(this.#db.prepare('SELECT * FROM impressions WHERE short_id = ? AND deleted_at IS NULL').get(shortId))
  }

  /**
   * Replace one user's whole impression. The body is stored exactly as given;
   * the first write creates the row, later writes keep its creation time and
   * move only the update time. Nothing about the row expires.
   */
  saveImpression({ shortId, content }: { readonly shortId: number; readonly content: string }): ImpressionRow {
    const now = Date.now()
    this.#db.prepare(`INSERT INTO impressions (short_id, content, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(short_id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at, deleted_at = NULL`)
      .run(shortId, content, now, now)
    const row = this.impression({ shortId })
    if (row === undefined) {
      throw new MemoryError(500, 'memory/misconfigured', 'the impression row disappeared after its write')
    }
    return row
  }

  /**
   * Flip one memory's layer, inside one transaction so the read decides the
   * write. Nothing else about the row changes — no content, no source, no
   * content time.
   */
  flip({ id }: { readonly id: number }): MemoryRow | undefined {
    return this.#transaction(() => {
      const row = rowOf<MemoryRow>(this.#db.prepare('SELECT * FROM memories WHERE id = ?').get(id))
      if (row === undefined) return undefined
      const next = row.is_private === 1 ? 0 : 1
      this.#db.prepare('UPDATE memories SET is_private = ? WHERE id = ?').run(next, id)
      return { ...row, is_private: next }
    })
  }

  /** One source session's maintenance state, or undefined before its first observation. */
  maintenance(sourceSession: string): MaintenanceRow | undefined {
    return rowOf<MaintenanceRow>(this.#db.prepare('SELECT * FROM maintenance_state WHERE source_session = ?').get(sourceSession))
  }

  /** Every source session the memory row has observed, for the restart scan. */
  maintenanceRows(): MaintenanceRow[] {
    return rowsOf<MaintenanceRow>(this.#db.prepare('SELECT * FROM maintenance_state').all())
  }

  /**
   * Record the latest closed user turn an idle source session has shown.
   *
   * The frozen cut doubles as the latest observed position while no interval is
   * active: a newer closed turn moves it and its time, while an older or equal
   * position leaves the stored time alone. That second rule is what lets an
   * operator-visible time adjustment stand instead of being overwritten by the
   * next evaluation.
   */
  observeMaintenance({ sourceSession, lastClosedSeq, lastClosedAt }: {
    readonly sourceSession: string
    readonly lastClosedSeq: number
    readonly lastClosedAt: number
  }): void {
    const now = Date.now()
    const row = this.maintenance(sourceSession)
    if (row === undefined) {
      this.#db.prepare(`INSERT INTO maintenance_state
        (source_session, watermark_seq, cut_seq, last_closed_at, child_session, status, updated_at)
        VALUES (?, -1, ?, ?, NULL, 0, ?)`).run(sourceSession, lastClosedSeq, lastClosedAt, now)
      return
    }
    if (row.status !== 0) return
    if (row.cut_seq !== null && lastClosedSeq <= row.cut_seq && row.last_closed_at !== null) return
    this.#db.prepare('UPDATE maintenance_state SET cut_seq = ?, last_closed_at = ?, updated_at = ? WHERE source_session = ?')
      .run(lastClosedSeq, lastClosedAt, now, sourceSession)
  }

  /**
   * Freeze one interval and take it for one child, in one immediate transaction.
   *
   * A running or failed interval is never claimed again: the same child owns
   * it until it completes, and a failed child is resumed rather than replaced.
   * @returns whether this call froze the interval.
   */
  claimMaintenance({ sourceSession, cutSeq, lastClosedAt, childSession }: {
    readonly sourceSession: string
    readonly cutSeq: number
    readonly lastClosedAt: number
    readonly childSession: string
  }): boolean {
    return this.#transaction(() => {
      const row = this.maintenance(sourceSession)
      if (row !== undefined && row.status !== 0) return false
      const now = Date.now()
      if (row === undefined) {
        this.#db.prepare(`INSERT INTO maintenance_state
          (source_session, watermark_seq, cut_seq, last_closed_at, child_session, status, updated_at)
          VALUES (?, -1, ?, ?, ?, 1, ?)`).run(sourceSession, cutSeq, lastClosedAt, childSession, now)
        return true
      }
      this.#db.prepare(`UPDATE maintenance_state
        SET cut_seq = ?, last_closed_at = ?, child_session = ?, status = 1, updated_at = ?
        WHERE source_session = ?`).run(cutSeq, lastClosedAt, childSession, now, sourceSession)
      return true
    })
  }

  /** Keep the failed interval and its child for a resume; the watermark stays put. */
  failMaintenance({ sourceSession, childSession }: {
    readonly sourceSession: string
    readonly childSession: string
  }): void {
    this.#db.prepare(`UPDATE maintenance_state
      SET child_session = ?, status = 2, updated_at = ?
      WHERE source_session = ?`).run(childSession, Date.now(), sourceSession)
  }

  /**
   * Mark the frozen interval complete. Zero writes complete just like any
   * other run: the watermark is the frozen cut, so the next interval begins
   * after it.
   */
  completeMaintenance({ sourceSession, cutSeq, childSession }: {
    readonly sourceSession: string
    readonly cutSeq: number
    readonly childSession: string
  }): void {
    this.#db.prepare(`UPDATE maintenance_state
      SET watermark_seq = ?, child_session = ?, status = 0, updated_at = ?
      WHERE source_session = ?`).run(cutSeq, childSession, Date.now(), sourceSession)
  }

  /**
   * Drop the frozen cut and child without advancing the watermark, so a child
   * that never came into existence can be replaced by a fresh one.
   */
  resetMaintenance(sourceSession: string): void {
    this.#db.prepare(`UPDATE maintenance_state
      SET cut_seq = NULL, child_session = NULL, status = 0, updated_at = ?
      WHERE source_session = ?`).run(Date.now(), sourceSession)
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
        throw new MemoryError(500, 'memory/schema-too-new', `the database file was written by schema version ${String(version)}`)
      }
      if (version === SCHEMA_VERSION) return
      if (version < 2) {
        // Version 1 shipped the maintenance table without the frozen cut.
        // SQLite cannot express `ADD COLUMN IF NOT EXISTS`, so the column list
        // decides; a file already carrying the column is left alone.
        const columns = rowsOf<{ name: string }>(this.#db.prepare('PRAGMA table_info(maintenance_state)').all())
        if (!columns.some(column => column.name === 'cut_seq')) {
          this.#db.exec('ALTER TABLE maintenance_state ADD COLUMN cut_seq INTEGER')
        }
      }
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
      throw new MemoryError(500, 'memory/schema-too-new', `the database file declares an unreadable schema version ${row.value}`)
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
