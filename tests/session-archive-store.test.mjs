/**
 * Ticket #276: store acceptance for the session archive.
 *
 * `session-archive.test.mjs` drives archive and restore over real HTTP, so the
 * store's own rules — its file's schema and version, the two ways a version is
 * refused, the archive instants, and the archived list's filter and order —
 * were only ever visible through a boot. These cases instantiate
 * `SessionArchiveStore` directly.
 *
 * A raw `node:sqlite` connection writes the version fixtures and reads the
 * facts no public method answers: the stored version and table set, the archive
 * instant, and an operator-side logical deletion.
 *
 * @covers backend/sessions
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, describe, test } from 'node:test'
import { SessionArchiveStore } from '../backend/sessions/dist/archive-store.js'

const dir = mkdtempSync(join(tmpdir(), 'ourfairy-session-archive-store-'))
let fileSerial = 0

after(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** One case's own database file. */
function databasePath(name) {
  fileSerial += 1
  return join(dir, `${fileSerial}-${name}.sqlite`)
}

/**
 * A file carrying only the version table, so any DDL the store ran would change
 * the table set this case reads back. It is the minimum every versioned writer
 * leaves behind.
 */
function seedVersion(path, version) {
  const db = new DatabaseSync(path)
  try {
    db.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', version)
  } finally {
    db.close()
  }
}

/** What a store method does not answer: the stored version, table set and journal mode. */
function fileFacts(path) {
  const db = new DatabaseSync(path)
  try {
    return {
      version: db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get()?.value,
      tables: db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name),
      journalMode: db.prepare('PRAGMA journal_mode').get().journal_mode,
    }
  } finally {
    db.close()
  }
}

/** One stored archive row, in full, because the store answers only session ids. */
function archiveRow(path, sessionId) {
  const db = new DatabaseSync(path)
  try {
    return db.prepare('SELECT * FROM session_archive WHERE session_id = ?').get(sessionId)
  } finally {
    db.close()
  }
}

/** How many rows one session holds: an idempotent archive means one. */
function archiveRowCount(path, sessionId) {
  const db = new DatabaseSync(path)
  try {
    return Number(db.prepare('SELECT COUNT(*) AS count FROM session_archive WHERE session_id = ?').get(sessionId).count)
  } finally {
    db.close()
  }
}

/** A logical deletion as an operator-side cleanup would write it, not a store call. */
function tombstone(path, sessionId) {
  const db = new DatabaseSync(path)
  try {
    const now = Date.now()
    db.prepare('UPDATE session_archive SET deleted_at = ?, updated_at = ? WHERE session_id = ?').run(now, now, sessionId)
  } finally {
    db.close()
  }
}

/**
 * Spin until the millisecond clock is strictly past a recorded instant.
 *
 * `archive` stamps `Date.now()` itself, so a same-millisecond retry could not
 * show whether the first instant was kept; waiting removes that ambiguity.
 */
function afterInstant(instant) {
  while (Date.now() <= instant) {
    // Date.now() moves at millisecond resolution.
  }
}

describe('a fresh archive file', () => {
  test('gets the archive tables, schema version 1 and WAL journaling', () => {
    const path = databasePath('fresh')
    const store = new SessionArchiveStore({ path })
    store.close()

    const facts = fileFacts(path)
    assert.deepEqual(facts.tables, ['meta', 'session_archive', 'sqlite_sequence'],
      'a fresh file holds the version table, the archive table and its AUTOINCREMENT bookkeeping')
    assert.equal(facts.version, '1', 'the fresh file records the current schema version')
    assert.equal(facts.journalMode, 'wal', 'the store opens the file in WAL mode')
  })
})

describe('refusing an archive file this module cannot read', () => {
  test('refuses a newer schema version without touching the file', () => {
    const path = databasePath('future')
    seedVersion(path, '2')

    assert.throws(() => new SessionArchiveStore({ path }), error =>
      error.constructor === Error
      && error.message === 'the session archive file was written by schema version 2'
      && error.code === undefined
      && error.status === undefined,
    'the archive store refuses through a plain Error, which is what fails the boot')

    const facts = fileFacts(path)
    assert.deepEqual(facts.tables, ['meta'], 'a refused file gains none of the current tables')
    assert.equal(facts.version, '2', 'a refused file keeps the version it was written with')
  })

  test('refuses an unreadable schema version without restamping it', () => {
    const path = databasePath('unreadable')
    seedVersion(path, 'not-a-number')

    assert.throws(() => new SessionArchiveStore({ path }), error =>
      error.constructor === Error
      && error.message === 'the session archive file declares an unreadable schema version not-a-number'
      && error.code === undefined
      && error.status === undefined,
    'an unreadable version is a refusal, never an empty file to rewrite')

    const facts = fileFacts(path)
    assert.deepEqual(facts.tables, ['meta'], 'a refused file gains none of the current tables')
    assert.equal(facts.version, 'not-a-number', 'the unreadable version must not be restamped')
  })
})

describe('archive instants', () => {
  test('archiving twice keeps the first instant and the single row', () => {
    const path = databasePath('idempotent')
    const store = new SessionArchiveStore({ path })
    try {
      store.archive({ sessionId: 'session-once', ownerShortId: 7 })
      const first = archiveRow(path, 'session-once')
      assert.equal(first.owner_short_id, 7)
      assert.equal(first.status, 1)
      assert.equal(first.deleted_at, null, 'an archived row keeps the logical-delete column empty')
      assert.ok(Number.isSafeInteger(first.archived_at), 'the archive records an epoch-ms instant')

      afterInstant(first.archived_at)
      store.archive({ sessionId: 'session-once', ownerShortId: 7 })

      const again = archiveRow(path, 'session-once')
      assert.equal(archiveRowCount(path, 'session-once'), 1, 'a repeated archive is one row, not a second one')
      assert.equal(again.id, first.id, 'the repeated archive updates the same row')
      assert.equal(again.archived_at, first.archived_at, 'asking again must not push the archive instant later')
      assert.deepEqual(store.archivedSessionIds(7), ['session-once'])
    } finally {
      store.close()
    }
  })

  test('a restored session archived again takes a new instant', () => {
    const path = databasePath('restored')
    const store = new SessionArchiveStore({ path })
    try {
      store.archive({ sessionId: 'session-again', ownerShortId: 3 })
      const first = archiveRow(path, 'session-again')

      assert.equal(store.restore({ sessionId: 'session-again', ownerShortId: 3 }), true)
      const restored = archiveRow(path, 'session-again')
      assert.equal(restored.status, 0, 'restoring moves the row back to active')
      assert.equal(restored.archived_at, null, 'an active row carries no archive instant')
      assert.deepEqual(store.archivedSessionIds(3), [])

      afterInstant(first.archived_at)
      store.archive({ sessionId: 'session-again', ownerShortId: 3 })

      const again = archiveRow(path, 'session-again')
      assert.equal(again.id, first.id, 'restore and re-archive are the same row')
      assert.equal(again.status, 1)
      assert.ok(again.archived_at > first.archived_at,
        'a restored session archived again takes the new archive instant, not the first one')
      assert.deepEqual(store.archivedSessionIds(3), ['session-again'])
    } finally {
      store.close()
    }
  })
})

describe('the archived list', () => {
  test('answers live archived rows of one caller, most recently archived first', () => {
    const path = databasePath('list')
    const store = new SessionArchiveStore({ path })
    try {
      store.archive({ sessionId: 'session-first', ownerShortId: 1 })
      const first = archiveRow(path, 'session-first')
      afterInstant(first.archived_at)
      store.archive({ sessionId: 'session-second', ownerShortId: 1 })
      const second = archiveRow(path, 'session-second')
      assert.ok(second.id > first.id, 'the second archive is the later row')

      // Re-archive the older id: its archive instant is now the newest while its
      // id is still the smallest. Ordering by instant and ordering by id
      // therefore answer opposite lists, so this order can only come from time.
      assert.equal(store.restore({ sessionId: 'session-first', ownerShortId: 1 }), true)
      afterInstant(second.archived_at)
      store.archive({ sessionId: 'session-first', ownerShortId: 1 })
      assert.deepEqual(store.archivedSessionIds(1), ['session-first', 'session-second'],
        'the list reads archived_at descending, not insertion order')

      store.archive({ sessionId: 'session-foreign', ownerShortId: 2 })
      assert.deepEqual(store.archivedSessionIds(1), ['session-first', 'session-second'],
        'another caller\'s archive never answers this caller\'s list')
      assert.deepEqual(store.archivedSessionIds(2), ['session-foreign'])

      store.archive({ sessionId: 'session-restored', ownerShortId: 1 })
      assert.ok(store.archivedSessionIds(1).includes('session-restored'))
      assert.equal(store.restore({ sessionId: 'session-restored', ownerShortId: 1 }), true)
      const restored = archiveRow(path, 'session-restored')
      assert.equal(restored.status, 0)
      assert.equal(restored.archived_at, null)
      assert.ok(!store.archivedSessionIds(1).includes('session-restored'),
        'a status = 0 row is not an archived id even though the row still exists')

      store.archive({ sessionId: 'session-deleted', ownerShortId: 1 })
      assert.ok(store.archivedSessionIds(1).includes('session-deleted'))
      tombstone(path, 'session-deleted')
      const deleted = archiveRow(path, 'session-deleted')
      assert.equal(deleted.status, 1)
      assert.notEqual(deleted.deleted_at, null)
      assert.ok(!store.archivedSessionIds(1).includes('session-deleted'),
        'a logically deleted row is not an archived id even with status = 1')

      assert.deepEqual(store.archivedSessionIds(1), ['session-first', 'session-second'],
        'the filtered rows leave the order of the live archived rows untouched')
    } finally {
      store.close()
    }
  })
})
