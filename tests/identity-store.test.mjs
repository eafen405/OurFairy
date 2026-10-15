/**
 * Store acceptance for the v1 -> v2 schema migration and the no-unique/no-foreign-key
 * rules the review (#24/#26 findings 1 and 2) requires.
 *
 * The fixture is a genuine v1 database: the exact shipped v1 DDL, including its
 * UNIQUE constraints and `REFERENCES users(id)` clauses, written by plain
 * `node:sqlite` before any IdentityStore sees the file. IdentityStore must then
 * migrate it in place, keep every previously stored credential and invite usable,
 * and drop the forbidden constraints. Only the public store API drives the
 * behavioural assertions; the raw database is used to plant a logical deletion and
 * to prove the schema itself obeys AGENTS.md.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, describe, test } from 'node:test'
import { IdentityStore, PHAETHON_SHORT_ID } from '../backend/identity/src/store.mjs'
import { hashPassword, sessionTokenDigest } from '../backend/identity/src/codes.mjs'

const PHAETHON_PASSWORD = 'v1-phaethon-password'
const MEMBER_PASSWORD = 'v1-member-password'
const NOW = 1_700_000_000_000
const LIVE_TOKEN = 'v1-live-session-token'
const REVOKED_TOKEN = 'v1-revoked-session-token'

/** The shipped v1 schema, verbatim, including the constraints AGENTS.md forbids. */
const V1_SCHEMA = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  is_admin INTEGER NOT NULL DEFAULT 0,
  password TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  redeemed_by INTEGER REFERENCES users(id),
  redeemed_at INTEGER
);
CREATE TABLE sessions (
  digest TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX sessions_by_user ON sessions(user_id);
`

const dir = mkdtempSync(join(tmpdir(), 'ourfairy-v1-migration-'))
const v1Path = join(dir, 'legacy-v1.sqlite')
const freshPath = join(dir, 'fresh-v2.sqlite')
const futurePath = join(dir, 'future-v99.sqlite')
const tombstonePath = join(dir, 'tombstoned-v2.sqlite')
let store

/**
 * Plant a logical deletion straight into the durable file with a real SQLite
 * connection, the way any future operator-side removal would write it.
 *
 * The store has no deletion operation to call, so this is the only honest way to
 * put a row into the deleted state; every assertion afterwards goes back through
 * the public store API.
 */
function tombstone(path, table, column, value) {
  const db = new DatabaseSync(path)
  db.prepare(`UPDATE ${table} SET deleted_at = ?, updated_at = ? WHERE ${column} = ? AND deleted_at IS NULL`)
    .run(NOW + 20, NOW + 20, value)
  db.close()
}

/** Write the v1 fixture with real hashes, real digests, and no IdentityStore involved. */
function seedV1Database(path) {
  const db = new DatabaseSync(path)
  db.exec(V1_SCHEMA)
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', '1')
  const insertUser = db.prepare(
    'INSERT INTO users (id, short_id, name, is_admin, password, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
  insertUser.run(1, PHAETHON_SHORT_ID, 'phaethon', 1, hashPassword(PHAETHON_PASSWORD), NOW)
  insertUser.run(2, 2, 'rosie', 0, hashPassword(MEMBER_PASSWORD), NOW + 1)
  const insertInvite = db.prepare(
    'INSERT INTO invites (code, created_by, created_at, redeemed_by, redeemed_at) VALUES (?, ?, ?, ?, ?)',
  )
  insertInvite.run('OLDFRESHCODE', 1, NOW + 2, null, null)
  insertInvite.run('OLDUSEDCODE', 1, NOW + 3, 2, NOW + 4)
  const insertSession = db.prepare(
    'INSERT INTO sessions (digest, user_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, ?)',
  )
  insertSession.run(sessionTokenDigest(LIVE_TOKEN), 2, NOW + 5, NOW + 10_000_000_000, null)
  insertSession.run(sessionTokenDigest(REVOKED_TOKEN), 2, NOW + 5, NOW + 10_000_000_000, NOW + 6)
  db.close()
}

/** Every table definition and index name SQLite actually stored. */
function schemaFacts(path) {
  const db = new DatabaseSync(path)
  const sql = db.prepare('SELECT type, name, sql FROM sqlite_master ORDER BY type, name').all()
  const facts = {
    tables: db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name),
    tablesSql: Object.fromEntries(sql.filter(row => row.type === 'table').map(row => [row.name, row.sql ?? ''])),
    indexes: db.prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' ORDER BY name").all(),
  }
  for (const table of facts.tables) {
    facts[`index_list_${table}`] = db.prepare(`PRAGMA index_list(${table})`).all()
    facts[`foreign_key_list_${table}`] = db.prepare(`PRAGMA foreign_key_list(${table})`).all()
    facts[`columns_${table}`] = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name)
  }
  db.close()
  return facts
}

before(() => {
  seedV1Database(v1Path)
  store = new IdentityStore({ path: v1Path, now: () => NOW + 10 })
})

after(() => {
  store?.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('migrating a genuine v1 database', () => {
  test('keeps the ids and passwords the v1 file already held', () => {
    assert.equal(store.seedPhaethon({ name: 'phaethon', password: PHAETHON_PASSWORD }).created, false,
      'the existing Phaethon must not be recreated')
    const phaethon = store.userByShortId(PHAETHON_SHORT_ID)
    assert.equal(phaethon.name, 'phaethon')
    assert.equal(phaethon.isAdmin, true)

    const signedIn = store.signIn({ name: 'rosie', password: MEMBER_PASSWORD })
    assert.equal(signedIn.user.shortId, 2, 'the v1 row id must survive the migration')
    assert.ok(typeof signedIn.token === 'string' && signedIn.token.length > 0)

    const admin = store.signIn({ name: 'phaethon', password: PHAETHON_PASSWORD })
    assert.equal(admin.user.shortId, PHAETHON_SHORT_ID, 'the v1 password hash must still verify')
  })

  test('keeps the v1 session digests usable', () => {
    const caller = store.authenticate(LIVE_TOKEN)
    assert.ok(caller !== undefined, 'an unrevoked v1 session digest must still authenticate')
    assert.equal(caller.shortId, 2)
    assert.equal(store.authenticate(REVOKED_TOKEN), undefined, 'a revoked v1 session stays revoked')
  })

  test('keeps a v1 unredeemed invite redeemable and refuses the redeemed one', () => {
    assert.equal(store.inviteState('old-fresh-code').redeemed, false)
    assert.equal(store.inviteState('old-used-code').redeemed, true)

    const registered = store.register({ inviteCode: 'old-fresh-code', name: 'tinker', password: 'newcomer-password' })
    assert.equal(registered.user.shortId, 3, 'allocation must continue after the v1 short numbers, never recycle one')
    assert.equal(store.inviteState('old-fresh-code').redeemed, true)

    assert.throws(() => store.register({ inviteCode: 'old-used-code', name: 'widget', password: 'another-password' }),
      error => error.code === 'identity/invite-used', 'a v1 redeemed invite must stay redeemed')
  })

  test('refuses a duplicate name without a unique index backing it', () => {
    assert.throws(() => store.register({ inviteCode: store.createInvite(PHAETHON_SHORT_ID).code, name: 'rosie', password: 'some-password' }),
      error => error.code === 'identity/name-taken' && error.status === 409)
  })

  test('never reuses a short number once an identity is gone', () => {
    assert.deepEqual(store.listUsers().map(user => user.shortId), [1, 2, 3])
    tombstone(v1Path, 'users', 'short_id', 3)

    const fresh = store.createInvite(PHAETHON_SHORT_ID)
    const replacement = store.register({ inviteCode: fresh.code, name: 'widget', password: 'another-password' })
    assert.equal(replacement.user.shortId, 4, 'a deleted identity keeps its number out of circulation')
  })

  test('a removed user no longer signs in, authenticates, or appears in a listing', () => {
    const token = store.signIn({ name: 'widget', password: 'another-password' }).token
    assert.ok(store.authenticate(token) !== undefined)

    tombstone(v1Path, 'users', 'short_id', 4)
    assert.throws(() => store.signIn({ name: 'widget', password: 'another-password' }),
      error => error.code === 'identity/bad-credentials' && error.status === 401)
    assert.equal(store.authenticate(token), undefined, 'a removed user must not authenticate')
    assert.equal(store.userByName('widget'), undefined)
    assert.deepEqual(store.listUsers().map(user => user.shortId), [1, 2],
      'listing hides the removed identities')
  })

  test('a removed name stays reserved, deleted rows included', () => {
    assert.throws(() => store.register({ inviteCode: store.createInvite(PHAETHON_SHORT_ID).code, name: 'widget', password: 'another-password' }),
      error => error.code === 'identity/name-taken',
      'a name freed by deletion is not reusable: checking all rows is the original invariant')
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
    const path = join(dir, 'named-v2.sqlite')
    const empty = new IdentityStore({ path, now: () => NOW })
    empty.close()

    // Another identity already holds the requested login name.
    const db = new DatabaseSync(path)
    db.prepare('INSERT INTO users (short_id, name, is_admin, password, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)')
      .run(2, 'rosie', hashPassword(MEMBER_PASSWORD), NOW, NOW)
    db.close()

    const seeded = new IdentityStore({ path, now: () => NOW })
    try {
      assert.throws(() => seeded.seedPhaethon({ name: 'rosie', password: PHAETHON_PASSWORD }),
        error => error.code === 'identity/name-taken' && error.status === 409,
        'seeding must refuse a name another row already owns')
    } finally {
      seeded.close()
    }
  })
})

describe('the stored schema obeys AGENTS.md', () => {
  test('carries logical deletion and update timestamps on the business tables', () => {
    const facts = schemaFacts(v1Path)
    for (const table of ['users', 'invites', 'sessions', 'groups', 'group_members', 'uploads']) {
      const columns = facts[`columns_${table}`]
      assert.ok(columns.includes('deleted_at'), `${table} must carry a logical deletion field`)
      assert.ok(columns.includes('updated_at'), `${table} must carry an update timestamp`)
      assert.ok(columns.includes('created_at'), `${table} must carry a creation timestamp`)
    }
    assert.ok(facts.columns_users.includes('short_id') && facts.columns_users.includes('name'),
      'the v1 identity columns must survive')
    assert.deepEqual(facts.tables.filter(name => name.endsWith('_v1')), [],
      'the migration must not leave its rebuild tables behind')
  })

  test('keeps the associated person column on every business table', () => {
    const facts = schemaFacts(v1Path)
    assert.ok(facts.columns_invites.includes('created_by') && facts.columns_invites.includes('redeemed_by'))
    assert.ok(facts.columns_sessions.includes('user_id'))
    assert.ok(facts.columns_groups.includes('owner_short_id') && facts.columns_groups.includes('created_by'))
    assert.ok(facts.columns_group_members.includes('user_short_id') && facts.columns_group_members.includes('updated_by'))
    assert.ok(facts.columns_uploads.includes('owner_short_id') && facts.columns_uploads.includes('created_by') && facts.columns_uploads.includes('updated_by'))
  })

  test('carries no foreign key and no unique constraint beyond the primary key', () => {
    const facts = schemaFacts(v1Path)
    for (const table of ['users', 'invites', 'sessions', 'groups', 'group_members', 'uploads', 'meta']) {
      assert.deepEqual(facts[`foreign_key_list_${table}`], [], `${table} must declare no foreign key`)
    }
    for (const row of facts.indexes) {
      assert.ok(row.sql === null || !/unique/iu.test(row.sql),
        `index ${row.name} must not be unique: ${row.sql}`)
    }
    assert.ok(!/unique/iu.test(facts.tablesSql.users), 'users must not declare UNIQUE')
    assert.ok(!/references/iu.test(facts.tablesSql.invites), 'invites must not declare REFERENCES')
    assert.ok(!/references/iu.test(facts.tablesSql.sessions), 'sessions must not declare REFERENCES')
  })

  test('keeps the ordinary lookup index the queries actually need', () => {
    const facts = schemaFacts(v1Path)
    assert.ok(facts.indexes.some(row => row.name === 'sessions_by_user' && row.tbl_name === 'sessions'),
      'the session lookup by user needs its ordinary index')
  })

  test('a fresh database lands directly on the migrated schema', () => {
    const fresh = new IdentityStore({ path: freshPath, now: () => NOW })
    try {
      const facts = schemaFacts(freshPath)
      for (const table of ['users', 'invites', 'sessions', 'groups', 'group_members', 'uploads']) {
        assert.ok(facts[`columns_${table}`].includes('deleted_at'))
      }
      assert.deepEqual(facts.foreign_key_list_users, [])
      assert.equal(fresh.seedPhaethon({ name: 'phaethon', password: PHAETHON_PASSWORD }).created, true)
    } finally {
      fresh.close()
    }
  })

  test('refuses a database newer than this module understands, leaving it untouched', () => {
    const db = new DatabaseSync(futurePath)
    db.exec(V1_SCHEMA)
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', '99')
    db.close()

    assert.throws(() => new IdentityStore({ path: futurePath }),
      error => error.code === 'identity/schema-too-new')

    const facts = schemaFacts(futurePath)
    assert.ok(!facts.columns_users.includes('deleted_at'),
      'a refused file must not be rebuilt: the version is checked before any DDL')
    assert.equal(new DatabaseSync(futurePath).prepare('SELECT value FROM meta WHERE key = ?').get('schema_version').value, '99')
  })

  test('signing out a logically deleted session reports nothing to revoke', () => {
    const live = new IdentityStore({ path: join(dir, 'signout-v2.sqlite'), now: () => NOW })
    const path = join(dir, 'signout-v2.sqlite')
    try {
      live.seedPhaethon({ name: 'phaethon', password: PHAETHON_PASSWORD })
      const { token } = live.signIn({ name: 'phaethon', password: PHAETHON_PASSWORD })
      assert.equal(live.signOut(token), true, 'a live session revokes')
      assert.equal(live.signOut(token), false, 'a revoked session is not revoked twice')
      assert.equal(live.signOut(token), false)
    } finally {
      live.close()
    }

    const again = new IdentityStore({ path, now: () => NOW })
    try {
      const { token } = again.signIn({ name: 'phaethon', password: PHAETHON_PASSWORD })
      again.close()
      tombstone(path, 'sessions', 'digest', sessionTokenDigest(token))
      const third = new IdentityStore({ path, now: () => NOW })
      try {
        assert.equal(third.signOut(token), false, 'a deleted session is skipped rather than re-stamped')
      } finally {
        third.close()
      }
    } finally {
      // the handle was closed above; nothing left to release
    }
  })
})

// A frozen v2 fixture, before any group tables existed. Raw SQL is only fixture
// construction/schema inspection; behavior is exercised through the store API.
test('v2 credentials and invites survive the additive group migration', () => {
  const path = join(dir, 'frozen-v2.sqlite')
  const db = new DatabaseSync(path)
  db.exec(V1_SCHEMA.replaceAll(' UNIQUE', '').replaceAll(' REFERENCES users(id)', '')
    .replaceAll('created_at INTEGER NOT NULL', 'created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER'))
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('schema_version', '2')
  db.prepare('INSERT INTO users (short_id, name, is_admin, password, created_at, updated_at) VALUES (1, ?, 1, ?, ?, ?)')
    .run('phaethon', hashPassword(PHAETHON_PASSWORD), NOW, NOW)
  db.prepare('INSERT INTO invites (code, created_by, created_at, updated_at) VALUES (?, 1, ?, ?)').run('V2INVITECODE', NOW, NOW)
  db.close()
  const migrated = new IdentityStore({ path, now: () => NOW + 10 })
  try {
    assert.equal(migrated.signIn({ name: 'phaethon', password: PHAETHON_PASSWORD }).user.shortId, 1)
    const owner = migrated.register({ name: 'v2-owner', password: MEMBER_PASSWORD, inviteCode: 'V2INVITECODE' }).user
    const group = migrated.createGroup(1, { name: 'Retained credentials lab', ownerShortId: owner.shortId })
    assert.deepEqual(migrated.groupsForMember(owner.shortId), [group])
    assert.deepEqual(migrated.groupsForMember(1), [])
  } finally { migrated.close() }
})

// Frozen v3 business shape: group ownership/membership exist before uploads.
test('v3 group membership and credentials survive the additive upload migration', () => {
  const path = join(dir, 'frozen-v3.sqlite'), db = new DatabaseSync(path)
  db.exec(V1_SCHEMA.replaceAll(' UNIQUE', '').replaceAll(' REFERENCES users(id)', '')
    .replaceAll('created_at INTEGER NOT NULL', 'created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER'))
  db.exec(`CREATE TABLE groups (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, owner_short_id INTEGER NOT NULL,
    created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);
    CREATE TABLE group_members (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id INTEGER NOT NULL, user_short_id INTEGER NOT NULL,
    created_by INTEGER NOT NULL, updated_by INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER);`)
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('schema_version', '3')
  db.prepare('INSERT INTO users (short_id,name,is_admin,password,created_at,updated_at) VALUES (1,?,1,?,?,?)')
    .run('phaethon', hashPassword(PHAETHON_PASSWORD), NOW, NOW)
  db.prepare('INSERT INTO groups (id,name,owner_short_id,created_by,created_at,updated_at) VALUES (1,?,1,1,?,?)').run('Existing group', NOW, NOW)
  db.prepare('INSERT INTO group_members (group_id,user_short_id,created_by,updated_by,created_at,updated_at) VALUES (1,1,1,1,?,?)').run(NOW, NOW)
  db.close()
  const store = new IdentityStore({ path, now: () => NOW + 10 })
  try {
    assert.equal(store.signIn({ name: 'phaethon', password: PHAETHON_PASSWORD }).user.shortId, 1)
    assert.equal(store.groupsForMember(1)[0].name, 'Existing group')
    const upload = { uploadId: 'a'.repeat(32), owner: 1, sessionId: 'owned-session', name: 'note.txt', mime: 'text/plain',
      size: 4, sha256: 'b'.repeat(64), status: 0, offset: 0, expiresAt: NOW + 1000, createdAt: NOW, updatedAt: NOW }
    store.insertUpload(upload)
    assert.equal(store.readUpload(upload.uploadId).sessionId, 'owned-session')
    assert.equal(store.readUpload(upload.uploadId).status, 0)
  } finally { store.close() }
})

// Pre-checklist v5 delivery rows: immutable text identities must survive the one-column extension.
test('v5 text deliveries survive the additive file preparation checklist migration', () => {
  const path=join(dir,'v5-delivery-checklist.sqlite'),db=new DatabaseSync(path)
  db.exec(V1_SCHEMA.replaceAll(' UNIQUE','').replaceAll(' REFERENCES users(id)','')
    .replaceAll('created_at INTEGER NOT NULL','created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER'))
  db.exec(`CREATE TABLE deliveries (delivery_id TEXT PRIMARY KEY,sender_short_id INTEGER NOT NULL,sender_session_id TEXT NOT NULL,
    recipient_short_id INTEGER NOT NULL,recipient_session_id TEXT NOT NULL,text TEXT NOT NULL,status INTEGER NOT NULL DEFAULT 0,
    message_id TEXT,accepted_seq INTEGER,created_by INTEGER NOT NULL,updated_by INTEGER NOT NULL,created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,deleted_at INTEGER);`)
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run('schema_version','5')
  db.prepare('INSERT INTO users (short_id,name,is_admin,password,created_at,updated_at) VALUES (1,?,1,?,?,?)')
    .run('phaethon',hashPassword(PHAETHON_PASSWORD),NOW,NOW)
  db.prepare(`INSERT INTO deliveries (delivery_id,sender_short_id,sender_session_id,recipient_short_id,recipient_session_id,text,
    status,message_id,accepted_seq,created_by,updated_by,created_at,updated_at) VALUES ('old-delivery',1,'sender',2,'receiver','Original delivered text',1,'same-message',7,1,1,?,?)`).run(NOW,NOW)
  db.close()
  const store=new IdentityStore({path,now:()=>NOW+10})
  try{
    assert.equal(store.signIn({name:'phaethon',password:PHAETHON_PASSWORD}).user.shortId,1)
    const row=store.prepareDelivery({deliveryId:'old-delivery',senderShortId:1,senderSessionId:'sender',recipientShortId:2,sessionId:'receiver',text:'Original delivered text'})
    assert.deepEqual(row.files,[])
    assert.equal(row.status,1)
    assert.equal(row.messageId,'same-message')
    assert.equal(row.acceptedSeq,7)
  }finally{store.close()}
})
