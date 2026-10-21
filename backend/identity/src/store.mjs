/**
 * The OurFairy business store: users, short numbers, invites, sessions, groups,
 * upload lifecycle and delivery coordination in one SQLite file, apart from the
 * dsh session logs.
 *
 * Every mutation that spans more than one statement runs inside one
 * `BEGIN IMMEDIATE` transaction. The schema declares no UNIQUE constraint and no
 * foreign key (AGENTS.md forbids both), so duplicate names, short-number
 * allocation and association existence are checked explicitly inside that
 * transaction.
 *
 * Deletion is a stored state: reads skip deleted rows and a login name or short
 * number stays reserved once issued.
 *
 * @module @ourfairy/dsh-identity/src/store
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  canonicalInviteCode,
  hashPassword,
  mintInviteCode,
  mintSessionToken,
  sessionTokenDigest,
  verifyPassword,
} from './codes.mjs'

/** The Phaethon short number: the deployment's first identity, reserved by rule. */
export const PHAETHON_SHORT_ID = 1

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const SCHEMA_VERSION = 6

/** Users, invites and sessions. Primary keys and the lookup indexes the queries use, nothing else. */
const TABLE_DDL = {
  users: `CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
)`,
  invites: `CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  redeemed_by INTEGER,
  redeemed_at INTEGER,
  deleted_at INTEGER
)`,
  sessions: `CREATE TABLE IF NOT EXISTS sessions (
  digest TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  deleted_at INTEGER
)`,
}

const INDEX_DDL = `
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS users_by_short_id ON users(short_id);
CREATE INDEX IF NOT EXISTS users_by_name ON users(name);
`

/** Group ownership and membership; uniqueness is checked inside the transactions. */
const GROUP_SCHEMA = `
CREATE TABLE IF NOT EXISTS groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  owner_short_id INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE TABLE IF NOT EXISTS group_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL,
  user_short_id INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS groups_by_owner ON groups(owner_short_id);
CREATE INDEX IF NOT EXISTS group_members_by_user ON group_members(user_short_id);
CREATE INDEX IF NOT EXISTS group_members_by_group ON group_members(group_id);
`

/** Upload lifecycle only; native session messages own admitted references. */
const UPLOAD_SCHEMA = `
CREATE TABLE IF NOT EXISTS uploads (
  upload_id TEXT PRIMARY KEY,
  owner_short_id INTEGER NOT NULL,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0, -- 0 uploading, 1 complete, 2 expired
  offset INTEGER NOT NULL DEFAULT 0,
  original_ref TEXT,
  image_ref TEXT,
  expires_at INTEGER NOT NULL,
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
`

/** Delivery coordination only; the native log is the delivered-content authority. */
const DELIVERY_SCHEMA = `
CREATE TABLE IF NOT EXISTS deliveries (
  delivery_id TEXT PRIMARY KEY,
  sender_short_id INTEGER NOT NULL,
  sender_session_id TEXT NOT NULL,
  recipient_short_id INTEGER NOT NULL,
  recipient_session_id TEXT NOT NULL,
  text TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  status INTEGER NOT NULL DEFAULT 0, -- 0 ready coordination, 1 durably delivered, 2 preparing files
  message_id TEXT,
  accepted_seq INTEGER,
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
`

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
${Object.values(TABLE_DDL).join(';\n')};
${INDEX_DDL}
${GROUP_SCHEMA}
${UPLOAD_SCHEMA}
${DELIVERY_SCHEMA}
`

/** Error carrying the HTTP status a request path answers with. */
export class IdentityError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'IdentityError'
    this.status = status
    this.code = code
  }
}

/** One stored user as the product exposes it (never the password record). */
function publicUser(row) {
  return {
    shortId: row.short_id,
    name: row.name,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
  }
}

/** Validate a login name the same way at registration and sign-in. */
function assertName(name) {
  const value = String(name ?? '').trim()
  if (!/^[A-Za-z0-9_-]{2,32}$/u.test(value)) {
    throw new IdentityError(400, 'identity/invalid-name',
      'name must be 2-32 characters of letters, digits, underscore, or hyphen')
  }
  return value
}

/** Validate a password the same way at registration and sign-in. */
function assertPassword(password) {
  const value = String(password ?? '')
  if (value.length < 8) {
    throw new IdentityError(400, 'identity/weak-password', 'password must be at least 8 characters')
  }
  return value
}

/** The identity module's persistent business state. */
export class IdentityStore {
  #db
  #sessionTtlMilliseconds

  constructor({ path, sessionTtlDays = 30, now = () => Date.now() } = {}) {
    if (typeof path !== 'string' || path === '') {
      throw new IdentityError(500, 'identity/misconfigured', 'the identity store needs a database path')
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
    this.#sessionTtlMilliseconds = sessionTtlDays * DAY_MILLISECONDS
    this.now = now
  }

  /**
   * Bring a supported file to `SCHEMA_VERSION` inside one immediate transaction.
   *
   * Only files whose schema version is this module's own history are upgraded.
   * The one legacy case is a file that wrote no schema version: it is in this
   * module's current shape, so recording the version is all it needs.
   */
  #migrate() {
    this.#transaction(() => {
      const version = this.#storedVersion()
      if (version === undefined) {
        this.#db.exec(SCHEMA)
        this.#setVersion()
        return
      }
      if (version > SCHEMA_VERSION) {
        throw new IdentityError(500, 'identity/schema-too-new',
          `this identity store speaks schema version ${SCHEMA_VERSION}, the file is version ${version}`)
      }
      if (version === SCHEMA_VERSION) return
      if (version < 1) {
        throw new IdentityError(500, 'identity/schema-unsupported', `unsupported identity schema version ${version}`)
      }
      // Every version this module itself shipped is reached by adding what the
      // current shape has and the older one lacked. All statements are idempotent.
      this.#db.exec(SCHEMA)
      if (!this.#db.prepare('PRAGMA table_info(deliveries)').all().some(column => column.name === 'attachments_json')) {
        this.#db.exec("ALTER TABLE deliveries ADD COLUMN attachments_json TEXT NOT NULL DEFAULT '[]'")
      }
      this.#setVersion()
    })
  }

  /** The recorded schema version, or undefined for a file that records none. */
  #storedVersion() {
    const hasMeta = this.#db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get() !== undefined
    if (!hasMeta) return undefined
    const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version')
    return row === undefined ? undefined : Number(row.value)
  }

  #setVersion() {
    this.#db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
      .run('schema_version', String(SCHEMA_VERSION))
  }

  /** One delivery row; the package's own reads, never a published operation. */
  #readDelivery(id) {
    const row = this.#db.prepare('SELECT * FROM deliveries WHERE delivery_id = ? AND deleted_at IS NULL').get(id)
    return row && { deliveryId: row.delivery_id, senderShortId: row.sender_short_id, senderSessionId: row.sender_session_id,
      recipientShortId: row.recipient_short_id, sessionId: row.recipient_session_id, text: row.text,
      status: row.status, messageId: row.message_id, acceptedSeq: row.accepted_seq, files: JSON.parse(row.attachments_json) }
  }
  prepareDelivery(row) {
    return this.#transaction(() => {
      const existing = this.#readDelivery(row.deliveryId)
      if (existing) {
        if (existing.senderShortId !== row.senderShortId || existing.senderSessionId !== row.senderSessionId
          || existing.recipientShortId !== row.recipientShortId || existing.text !== row.text
          || JSON.stringify(existing.files.map(file => file.selector)) !== JSON.stringify((row.files ?? []).map(file => file.selector))) {
          throw new IdentityError(409, 'delivery/conflict', 'this delivery identity already names different content or recipient')
        }
        return existing
      }
      const now = this.now()
      this.#db.prepare(`INSERT INTO deliveries
        (delivery_id,sender_short_id,sender_session_id,recipient_short_id,recipient_session_id,text,attachments_json,status,created_by,updated_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.deliveryId,row.senderShortId,row.senderSessionId,row.recipientShortId,
          row.sessionId,row.text,JSON.stringify(row.files ?? []),(row.files?.length ? 2 : 0),row.senderShortId,row.senderShortId,now,now)
      return this.#readDelivery(row.deliveryId)
    })
  }
  /** Persist each immutable file before moving on; null entries alone are retried. */
  prepareDeliveryFile(id, index, prepared) {
    return this.#transaction(() => {
      const row = this.#readDelivery(id)
      row.files[index].prepared = prepared
      const status = row.files.every(file => file.prepared !== null) ? 0 : 2
      this.#db.prepare(`UPDATE deliveries SET attachments_json = ?, status = ?,
        updated_by = sender_short_id, updated_at = ? WHERE delivery_id = ? AND deleted_at IS NULL`)
        .run(JSON.stringify(row.files),status,this.now(),id)
      return this.#readDelivery(id)
    })
  }
  pendingDeliveries() {
    return this.#db.prepare('SELECT delivery_id FROM deliveries WHERE status = 0 AND deleted_at IS NULL ORDER BY created_at,delivery_id')
      .all().map(row => this.#readDelivery(row.delivery_id))
  }
  completeDelivery(id, { messageId, acceptedSeq }) {
    this.#db.prepare('UPDATE deliveries SET status = 1, message_id = ?, accepted_seq = ?, updated_by = sender_short_id, updated_at = ? WHERE delivery_id = ? AND deleted_at IS NULL')
      .run(messageId,acceptedSeq,this.now(),id)
  }

  /** Insert an opaque upload receipt after the staging file exists. */
  insertUpload(row) {
    this.#db.prepare(`INSERT INTO uploads
      (upload_id,owner_short_id,session_id,name,mime,size,sha256,status,offset,expires_at,created_by,updated_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.uploadId,row.owner,row.sessionId,row.name,row.mime,row.size,row.sha256,
        row.status,row.offset,row.expiresAt,row.owner,row.owner,row.createdAt,row.updatedAt)
  }
  /** Read lifecycle facts. Session ownership is checked by the attachment service. */
  readUpload(id) {
    const row = this.#db.prepare('SELECT * FROM uploads WHERE upload_id = ? AND deleted_at IS NULL').get(id)
    if (!row) return undefined
    return { uploadId: row.upload_id, owner: row.owner_short_id, sessionId: row.session_id,
      name: row.name, mime: row.mime, size: row.size, sha256: row.sha256, status: row.status, offset: row.offset,
      expiresAt: row.expires_at, createdAt: row.created_at, updatedAt: row.updated_at,
      original: row.original_ref === null ? null : JSON.parse(row.original_ref),
      image: row.image_ref === null ? null : JSON.parse(row.image_ref) }
  }
  /** One atomic lifecycle update; no message-acceptance state is stored here. */
  updateUpload(id, changes) {
    const columns = { status: 'status', offset: 'offset', original: 'original_ref', image: 'image_ref' }
    const entries = Object.entries(changes)
    if (entries.some(([key]) => !Object.hasOwn(columns, key))) throw new Error('unknown upload lifecycle field')
    const values = entries.map(([key, value]) => key === 'original' || key === 'image' ? value === null ? null : JSON.stringify(value) : value)
    this.#db.prepare(`UPDATE uploads SET ${entries.map(([key]) => columns[key] + ' = ?').join(', ')},
      updated_by = owner_short_id, updated_at = ? WHERE upload_id = ? AND deleted_at IS NULL`).run(...values,this.now(),id)
  }

  /** A group's public state; membership is read from the same business store. */
  #group(row) {
    return { id: row.id, name: row.name, ownerShortId: row.owner_short_id,
      memberShortIds: this.#db.prepare('SELECT user_short_id FROM group_members WHERE group_id = ? AND deleted_at IS NULL ORDER BY user_short_id').all(row.id).map(member => member.user_short_id) }
  }

  /** Current member groups only; system management does not grant file access. */
  groupsForMember(shortId) {
    return this.#db.prepare(`SELECT groups.* FROM groups JOIN group_members ON group_members.group_id = groups.id
      WHERE group_members.user_short_id = ? AND group_members.deleted_at IS NULL AND groups.deleted_at IS NULL ORDER BY groups.id`)
      .all(shortId).map(row => this.#group(row))
  }

  ownsGroup(shortId) {
    return this.#db.prepare('SELECT 1 FROM groups WHERE owner_short_id = ? AND deleted_at IS NULL').get(shortId) !== undefined
  }

  /** Phaethon creates and designates an existing owner, who joins atomically. */
  createGroup(callerShortId, { name, ownerShortId }) {
    const groupName = typeof name === 'string' ? name.trim() : ''
    if (!groupName || groupName.length > 100 || !Number.isSafeInteger(ownerShortId) || ownerShortId < 1) {
      throw new IdentityError(400, 'groups/invalid-request', 'provide a group name (1-100 characters) and an existing owner short number')
    }
    return this.#transaction(() => {
      const caller = this.userByShortId(callerShortId)
      if (caller?.shortId !== PHAETHON_SHORT_ID || !caller.isAdmin) {
        throw new IdentityError(403, 'groups/forbidden', 'only Phaethon may create a group')
      }
      if (!this.userByShortId(ownerShortId)) throw new IdentityError(404, 'groups/unknown-user', 'no active user has that short number')
      const now = this.now()
      const info = this.#db.prepare('INSERT INTO groups (name, owner_short_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(groupName, ownerShortId, callerShortId, now, now)
      const groupId = Number(info.lastInsertRowid)
      this.#db.prepare('INSERT INTO group_members (group_id, user_short_id, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(groupId, ownerShortId, callerShortId, callerShortId, now, now)
      return this.#group(this.#db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId))
    })
  }

  /** Change only the caller's own group, with authorization and write together. */
  changeGroupMember(callerShortId, { groupId, userShortId, action }) {
    if (![groupId, userShortId].every(value => Number.isSafeInteger(value) && value > 0) || (action !== 1 && action !== 2)) {
      throw new IdentityError(400, 'groups/invalid-request', 'provide groupId, userShortId and action 1 (add) or 2 (remove)')
    }
    return this.#transaction(() => {
      const group = this.#db.prepare('SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL').get(groupId)
      if (!this.userByShortId(callerShortId) || !group || group.owner_short_id !== callerShortId) {
        throw new IdentityError(403, 'groups/forbidden', 'only the current owner of this group may change its members')
      }
      if (!this.userByShortId(userShortId)) throw new IdentityError(404, 'groups/unknown-user', 'no active user has that short number')
      if (action === 2 && userShortId === group.owner_short_id) {
        throw new IdentityError(409, 'groups/owner-required', 'the designated group owner must remain a member')
      }
      const member = this.#db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_short_id = ?').get(groupId, userShortId)
      const now = this.now()
      if (action === 1 && !member) {
        this.#db.prepare('INSERT INTO group_members (group_id, user_short_id, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
          .run(groupId, userShortId, callerShortId, callerShortId, now, now)
      } else if (member && ((action === 1 && member.deleted_at !== null) || (action === 2 && member.deleted_at === null))) {
        this.#db.prepare('UPDATE group_members SET deleted_at = ?, updated_by = ?, updated_at = ? WHERE id = ?')
          .run(action === 1 ? null : now, callerShortId, now, member.id)
      }
      this.#db.prepare('UPDATE groups SET updated_at = ? WHERE id = ?').run(now, groupId)
      return this.#group(group)
    })
  }

  /** Close the underlying database. */
  close() {
    this.#db.close()
  }

  /** Run `work` inside one immediate transaction, rolling back on any failure. */
  #transaction(work) {
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

  /**
   * Persist the initial Phaethon identity, idempotently. A password is written
   * only while the account has none; a logically deleted Phaethon row is refused
   * rather than recreated beside itself.
   */
  seedPhaethon({ name = 'phaethon', password } = {}) {
    const login = assertName(name)
    return this.#transaction(() => {
      const existing = this.#db.prepare('SELECT * FROM users WHERE short_id = ?').get(PHAETHON_SHORT_ID)
      if (existing !== undefined && existing.deleted_at === null) {
        if (password !== undefined && password !== '' && existing.password === null) {
          this.#db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ?')
            .run(hashPassword(assertPassword(password)), this.now(), existing.id)
          return { user: publicUser(this.#db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id)), created: false }
        }
        return { user: publicUser(existing), created: false }
      }
      if (existing !== undefined) {
        throw new IdentityError(409, 'identity/phaethon-removed',
          'the Phaethon identity has been removed and its short number stays reserved')
      }
      if (this.#db.prepare('SELECT 1 FROM users WHERE name = ?').get(login) !== undefined) {
        throw new IdentityError(409, 'identity/name-taken', 'that name is already registered')
      }
      const now = this.now()
      const info = this.#db.prepare(
        'INSERT INTO users (short_id, name, is_admin, password, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)',
      ).run(PHAETHON_SHORT_ID, login, password === undefined || password === '' ? null : hashPassword(assertPassword(password)), now, now)
      const row = this.#db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
      return { user: publicUser(row), created: true }
    })
  }

  /** One user by short number. */
  userByShortId(shortId) {
    const row = this.#db.prepare('SELECT * FROM users WHERE short_id = ? AND deleted_at IS NULL').get(Number(shortId))
    return row === undefined ? undefined : publicUser(row)
  }

  /** One user by login name. */
  userByName(name) {
    const row = this.#db.prepare('SELECT * FROM users WHERE name = ? AND deleted_at IS NULL').get(String(name ?? '').trim())
    return row === undefined ? undefined : publicUser(row)
  }

  /** Every live user in short-number order. */
  listUsers() {
    return this.#db.prepare('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY short_id').all().map(publicUser)
  }

  /** Mint one invite code for an administrator. */
  createInvite(adminShortId) {
    return this.#transaction(() => {
      const admin = this.#db.prepare('SELECT * FROM users WHERE short_id = ? AND deleted_at IS NULL').get(Number(adminShortId))
      if (admin === undefined) throw new IdentityError(403, 'identity/forbidden', 'the caller is not a known identity')
      if (admin.is_admin !== 1) {
        throw new IdentityError(403, 'identity/forbidden', 'only Phaethon may create invites')
      }
      const code = mintInviteCode()
      const now = this.now()
      this.#db.prepare('INSERT INTO invites (code, created_by, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(code, admin.id, now, now)
      return { code, createdAt: now }
    })
  }

  /** One invite's state, without exposing who redeemed it. */
  inviteState(code) {
    const row = this.#db.prepare('SELECT * FROM invites WHERE code = ? AND deleted_at IS NULL').get(canonicalInviteCode(code))
    if (row === undefined) return undefined
    return {
      code: row.code,
      createdAt: row.created_at,
      redeemed: row.redeemed_by !== null,
      redeemedAt: row.redeemed_at,
    }
  }

  /**
   * Redeem one invite and create the invited identity atomically. A refusal
   * leaves no user, no redemption and no session behind.
   */
  register({ inviteCode, name, password } = {}) {
    const code = canonicalInviteCode(inviteCode)
    const login = assertName(name)
    const secret = assertPassword(password)
    return this.#transaction(() => {
      const invite = this.#db.prepare('SELECT * FROM invites WHERE code = ? AND deleted_at IS NULL').get(code)
      if (invite === undefined) throw new IdentityError(403, 'identity/unknown-invite', 'that invite code was not issued here')
      if (invite.redeemed_by !== null) {
        throw new IdentityError(409, 'identity/invite-used', 'that invite code has already been used')
      }
      if (this.#db.prepare('SELECT 1 FROM users WHERE name = ?').get(login) !== undefined) {
        throw new IdentityError(409, 'identity/name-taken', 'that name is already registered')
      }
      const now = this.now()
      // Allocation reads every row, deleted ones included, so a removed identity's
      // short number is never handed out a second time.
      const next = this.#db.prepare('SELECT COALESCE(MAX(short_id), 0) + 1 AS value FROM users').get()
      const shortId = Number(next.value)
      if (shortId <= PHAETHON_SHORT_ID) {
        throw new IdentityError(500, 'identity/unseeded', 'the Phaethon identity has not been seeded')
      }
      const info = this.#db.prepare(
        'INSERT INTO users (short_id, name, is_admin, password, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)',
      ).run(shortId, login, hashPassword(secret), now, now)
      this.#db.prepare('UPDATE invites SET redeemed_by = ?, redeemed_at = ?, updated_at = ? WHERE code = ?')
        .run(info.lastInsertRowid, now, now, code)
      const user = publicUser(this.#db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid))
      return { user, token: this.#mintSession(info.lastInsertRowid, now) }
    })
  }

  /** Verify a login name and password, answering the user and a fresh session token. */
  signIn({ name, password } = {}) {
    const row = this.#db.prepare('SELECT * FROM users WHERE name = ? AND deleted_at IS NULL').get(String(name ?? '').trim())
    if (row === undefined || row.password === null || !verifyPassword(String(password ?? ''), row.password)) {
      throw new IdentityError(401, 'identity/bad-credentials', 'name and password do not match an identity')
    }
    const now = this.now()
    return { user: publicUser(row), token: this.#mintSession(row.id, now) }
  }

  /** The identity a bearer token speaks for, or undefined when unknown, expired or revoked. */
  authenticate(token) {
    if (typeof token !== 'string' || token === '') return undefined
    const row = this.#db.prepare(`
      SELECT sessions.digest AS digest, sessions.expires_at AS expires_at, sessions.revoked_at AS revoked_at, users.*
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.digest = ? AND sessions.deleted_at IS NULL AND users.deleted_at IS NULL
    `).get(sessionTokenDigest(token))
    if (row === undefined) return undefined
    if (row.revoked_at !== null) return undefined
    if (row.expires_at <= this.now()) return undefined
    return publicUser(row)
  }

  /** Revoke one session token; answers whether a live session was revoked. */
  signOut(token) {
    const now = this.now()
    const info = this.#db.prepare(
      'UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE digest = ? AND revoked_at IS NULL AND deleted_at IS NULL',
    ).run(now, now, sessionTokenDigest(token))
    return info.changes > 0
  }

  /** Live session count for one short number. */
  liveSessionCount(shortId) {
    const user = this.#db.prepare('SELECT id FROM users WHERE short_id = ? AND deleted_at IS NULL').get(Number(shortId))
    if (user === undefined) return 0
    return Number(this.#db.prepare(
      'SELECT COUNT(*) AS value FROM sessions WHERE user_id = ? AND deleted_at IS NULL AND revoked_at IS NULL AND expires_at > ?',
    ).get(user.id, this.now()).value)
  }

  /** Mint and store one session for a user row id. */
  #mintSession(userId, now) {
    const token = mintSessionToken()
    this.#db.prepare(
      'INSERT INTO sessions (digest, user_id, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    ).run(sessionTokenDigest(token), userId, now, now, now + this.#sessionTtlMilliseconds)
    return token
  }
}
