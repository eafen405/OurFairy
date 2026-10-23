/**
 * Store acceptance for identity, invites, sessions and the schema rules the
 * store keeps: logical deletion and timestamps on business tables (AGENTS.md),
 * no foreign key and no unique index beyond the primary key.
 *
 * Assertions drive the public store API. A raw `node:sqlite` connection only
 * writes older-format fixtures, plants logical deletions and inspects the
 * stored schema.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, test } from 'node:test'
import { IdentityStore, PHAETHON_SHORT_ID } from '../backend/identity/dist/store.js'
import { hashPassword, sessionTokenDigest } from '../backend/identity/dist/codes.js'

const PHAETHON_PASSWORD = 'store-phaethon-password'
const MEMBER_PASSWORD = 'store-member-password'
const NOW = 1_700_000_000_000

/**
 * A schema-version-2 file: identities, invites and sessions before the group,
 * upload and delivery tables. Every later version only adds tables and columns,
 * so this fixture stands in for any file this module wrote before v6.
 */
const V2_SCHEMA = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  redeemed_by INTEGER,
  redeemed_at INTEGER,
  deleted_at INTEGER
);
CREATE TABLE sessions (
  digest TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX sessions_by_user ON sessions(user_id);
`

const dir = mkdtempSync(join(tmpdir(), 'ourfairy-identity-store-'))
const legacyPath = join(dir, 'legacy.sqlite')
const futurePath = join(dir, 'future.sqlite')
const tombstonePath = join(dir, 'tombstoned.sqlite')
const livePath = join(dir, 'live.sqlite')
let store

/** Logical deletion as an operator-side removal would write it. */
function tombstone(path, table, column, value) {
  const db = new DatabaseSync(path)
  db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE ${column} = ? AND deleted_at IS NULL`)
    .run(NOW + 20, NOW + 20, value)
  db.close()
}

/** Write the v2 fixture through plain SQLite, with no IdentityStore involved. */
function seedV2(path) {
  const db = new DatabaseSync(path)
  db.exec(V2_SCHEMA)
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', '2')
  db.prepare('INSERT INTO users (id, short_id, name, is_admin, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(1, PHAETHON_SHORT_ID, 'phaethon', 1, hashPassword(PHAETHON_PASSWORD), NOW, NOW)
  db.close()
}

/** Every table definition, index and per-table column/FK list SQLite actually stored. */
function schemaFacts(path) {
  const db = new DatabaseSync(path)
  const sql = db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all()
  const facts = {
    tables: db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name),
    tablesSql: Object.fromEntries(sql.filter(row => row.type === 'table').map(row => [row.name, row.sql ?? ''])),
    indexes: db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' ORDER BY name").all(),
  }
  for (const table of facts.tables) {
    facts[`columns_${table}`] = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name)
    facts[`foreign_key_list_${table}`] = db.prepare(`PRAGMA foreign_key_list(${table})`).all()
  }
  db.close()
  return facts
}

before(() => {
  seedV2(legacyPath)
  store = new IdentityStore({ path: legacyPath, now: () => NOW + 10 })
})

after(() => {
  store?.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('upgrading a v2 file', () => {
  test('adds the tables and columns v2 lacked and keeps the stored credential', () => {
    const seeded = store.seedPhaethon({ name: 'phaethon', password: PHAETHON_PASSWORD })
    assert.equal(seeded.created, false, 'the existing Phaethon must not be recreated')
    assert.equal(seeded.user.shortId, PHAETHON_SHORT_ID)

    const facts = schemaFacts(legacyPath)
    for (const table of ['users', 'invites', 'sessions', 'groups', 'group_members', 'uploads', 'deliveries']) {
      assert.ok(facts[`columns_${table}`].includes('deleted_at'), `${table} must carry a logical deletion field`)
      if (table !== 'deliveries') assert.ok(facts[`columns_${table}`].includes('updated_at'), `${table} must carry an update timestamp`)
    }
  })

  test('carries no foreign key and no unique constraint beyond the primary key', () => {
    const facts = schemaFacts(legacyPath)
    for (const table of facts.tables) {
      assert.deepEqual(facts[`foreign_key_list_${table}`], [], `${table} must declare no foreign key`)
    }
    for (const row of facts.indexes) {
      assert.ok(row.sql === null || !/unique/iu.test(row.sql), `index ${row.name} must not be unique: ${row.sql}`)
    }
    assert.ok(!/references/iu.test(facts.tablesSql.invites), 'invites must not declare REFERENCES')
    assert.ok(!/references/iu.test(facts.tablesSql.sessions), 'sessions must not declare REFERENCES')
  })

  test('keeps the associated person column on every business table', () => {
    const facts = schemaFacts(legacyPath)
    assert.ok(facts.columns_invites.includes('created_by') && facts.columns_invites.includes('redeemed_by'))
    assert.ok(facts.columns_sessions.includes('user_id'))
    assert.ok(facts.columns_groups.includes('owner_short_id') && facts.columns_groups.includes('created_by'))
    assert.ok(facts.columns_group_members.includes('user_short_id') && facts.columns_group_members.includes('updated_by'))
    assert.ok(facts.columns_uploads.includes('owner_short_id') && facts.columns_uploads.includes('created_by'))
    assert.ok(facts.columns_deliveries.includes('attachments_json'))
  })

  test('keeps the ordinary lookup index the queries need', () => {
    const facts = schemaFacts(legacyPath)
    assert.ok(facts.indexes.some(row => row.name === 'sessions_by_user' && row.tbl_name === 'sessions'))
  })

  test('refuses a database newer than this module understands, leaving it untouched', () => {
    const db = new DatabaseSync(futurePath)
    db.exec(V2_SCHEMA)
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', '99')
    db.close()

    assert.throws(() => new IdentityStore({ path: futurePath }), error => error.code === 'identity/schema-too-new')
    assert.deepEqual(schemaFacts(futurePath).tables.filter(name => name !== 'sqlite_sequence'),
      ['invites', 'meta', 'sessions', 'users'],
      'a refused file must not be altered: the version is checked before any DDL')
    const check = new DatabaseSync(futurePath)
    assert.equal(check.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version').value, '99')
    check.close()
  })
})

describe('identity rules checked in the store, without unique indexes', () => {
  test('refuses a duplicate name', () => {
    const invite = store.createInvite(PHAETHON_SHORT_ID)
    store.register({ inviteCode: invite.code, name: 'rosie', password: MEMBER_PASSWORD })
    assert.throws(() => store.register({ inviteCode: store.createInvite(PHAETHON_SHORT_ID).code, name: 'rosie', password: MEMBER_PASSWORD }),
      error => error.code === 'identity/name-taken' && error.status === 409)
  })

  test('never reuses a short number once an identity is gone', () => {
    tombstone(legacyPath, 'users', 'short_id', 2)
    const invite = store.createInvite(PHAETHON_SHORT_ID)
    const replacement = store.register({ inviteCode: invite.code, name: 'widget', password: MEMBER_PASSWORD })
    assert.equal(replacement.user.shortId, 3, 'a deleted identity keeps its number out of circulation')
  })

  test('a removed user no longer signs in or authenticates', () => {
    const token = store.signIn({ name: 'widget', password: MEMBER_PASSWORD }).token
    assert.ok(store.authenticate(token) !== undefined)

    tombstone(legacyPath, 'users', 'short_id', 3)
    assert.throws(() => store.signIn({ name: 'widget', password: MEMBER_PASSWORD }),
      error => error.code === 'identity/bad-credentials' && error.status === 401)
    assert.equal(store.authenticate(token), undefined, 'a removed user must not authenticate')
  })

  test('a removed name stays reserved', () => {
    assert.throws(() => store.register({ inviteCode: store.createInvite(PHAETHON_SHORT_ID).code, name: 'widget', password: MEMBER_PASSWORD }),
      error => error.code === 'identity/name-taken', 'a name freed by deletion is not reusable')
  })
})

describe('seeding against a deleted Phaethon', () => {
  test('refuses to recreate short number 1 beside a tombstoned row', () => {
    const seeded = new IdentityStore({ path: tombstonePath, now: () => NOW })
    try {
      assert.equal(seeded.seedPhaethon({ name: 'phaethon', password: PHAETHON_PASSWORD }).created, true)
      assert.equal(seeded.seedPhaethon({ name: 'phaethon' }).created, false, 'a live Phaethon is left alone')
    } finally {
      seeded.close()
    }

    tombstone(tombstonePath, 'users', 'short_id', PHAETHON_SHORT_ID)

    const reopened = new IdentityStore({ path: tombstonePath, now: () => NOW })
    try {
      assert.throws(() => reopened.seedPhaethon({ name: 'phaethon', password: PHAETHON_PASSWORD }),
        error => error.code === 'identity/phaethon-removed' && error.status === 409,
        'a deleted Phaethon must be refused explicitly, not silently recreated')
      const db = new DatabaseSync(tombstonePath)
      const rows = Number(db.prepare('SELECT COUNT(*) AS value FROM users WHERE short_id = ?').get(PHAETHON_SHORT_ID).value)
      db.close()
      assert.equal(rows, 1, 'the deleted row must not be joined by a second short number 1')
    } finally {
      reopened.close()
    }
  })

  test('refuses an initial seed whose name belongs to another row', () => {
    const path = join(dir, 'named.sqlite')
    new IdentityStore({ path, now: () => NOW }).close()

    const db = new DatabaseSync(path)
    db.prepare('INSERT INTO users (short_id, name, is_admin, password, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)')
      .run(2, 'rosie', hashPassword(MEMBER_PASSWORD), NOW, NOW)
    db.close()

    const seeded = new IdentityStore({ path, now: () => NOW })
    try {
      assert.throws(() => seeded.seedPhaethon({ name: 'rosie', password: PHAETHON_PASSWORD }),
        error => error.code === 'identity/name-taken' && error.status === 409)
    } finally {
      seeded.close()
    }
  })
})

describe('sessions', () => {
  test('a live session revokes once, and a deleted one reports nothing to revoke', () => {
    const live = new IdentityStore({ path: livePath, now: () => NOW })
    live.seedPhaethon({ name: 'phaethon', password: PHAETHON_PASSWORD })
    const { token } = live.signIn({ name: 'phaethon', password: PHAETHON_PASSWORD })
    assert.equal(live.signOut(token), true, 'a live session revokes')
    assert.equal(live.signOut(token), false, 'a revoked session is not revoked twice')
    live.close()

    const again = new IdentityStore({ path: livePath, now: () => NOW })
    const second = again.signIn({ name: 'phaethon', password: PHAETHON_PASSWORD }).token
    again.close()
    tombstone(livePath, 'sessions', 'digest', sessionTokenDigest(second))

    const third = new IdentityStore({ path: livePath, now: () => NOW })
    try {
      assert.equal(third.signOut(second), false, 'a deleted session is skipped rather than re-stamped')
    } finally {
      third.close()
    }
  })
})
