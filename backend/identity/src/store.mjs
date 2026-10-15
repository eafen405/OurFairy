/**
 * The OurFairy business store: users, their short numbers, invites, and
 * sessions, in one SQLite file owned by the identity module and kept apart from
 * the dsh session logs.
 *
 * Every mutation that spans more than one statement runs inside one
 * `BEGIN IMMEDIATE` transaction on a synchronous connection, so a failed
 * registration leaves no identity behind and two racing registrations cannot
 * share a short number. That transaction is the only guard the module needs:
 * the schema declares no UNIQUE constraint and no foreign key, because AGENTS.md
 * forbids both, so duplicate names, short-number allocation, and association
 * existence are all checked explicitly inside the transaction.
 *
 * The business tables carry a logical deletion field and an update timestamp;
 * reads skip deleted rows and writes refresh `updated_at`. Short numbers are
 * allocated from the highest number ever issued, including deleted ones, so a
 * removed identity's number is never handed to someone else.
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
const SCHEMA_VERSION = 2

/**
 * The current shape. No UNIQUE constraint and no REFERENCES clause: AGENTS.md
 * forbids both, and the `BEGIN IMMEDIATE` transactions below already refuse the
 * duplicates and orphan rows those constraints used to catch. Only ordinary
 * primary keys and the lookup indexes the queries actually use remain.
 *
 * Held per table so the v1 migration can rebuild one table at a time.
 */
const TABLE_DDL = {
  users: `CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
)`,
  invites: `CREATE TABLE invites (
  code TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  redeemed_by INTEGER,
  redeemed_at INTEGER,
  deleted_at INTEGER
)`,
  sessions: `CREATE TABLE sessions (
  digest TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  deleted_at INTEGER
)`,
}

/** The v1 column list of each table, in the order the rebuild copies them. */
const V1_COLUMNS = {
  users: ['id', 'short_id', 'name', 'is_admin', 'password', 'created_at'],
  invites: ['code', 'created_by', 'created_at', 'redeemed_by', 'redeemed_at'],
  sessions: ['digest', 'user_id', 'created_at', 'expires_at', 'revoked_at'],
}

const INDEX_DDL = `
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS users_by_short_id ON users(short_id);
CREATE INDEX IF NOT EXISTS users_by_name ON users(name);
`

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
${Object.values(TABLE_DDL).map(ddl => ddl.replace('CREATE TABLE ', 'CREATE TABLE IF NOT EXISTS ')).join(';\n')};
${INDEX_DDL}
`

/**
 * Rebuild one v1 table into the current shape inside the caller's transaction.
 *
 * v1 declared UNIQUE constraints and `REFERENCES users(id)` clauses that
 * AGENTS.md forbids, and carried no deletion or update columns. Rebuilding
 * through a temporary table is the only way SQLite drops them; every value the
 * v1 file held is copied across, ids included, so credentials, invite
 * redemptions and session digests survive untouched.
 */
function rebuildTable(db, table) {
  const carried = V1_COLUMNS[table].join(', ')
  db.exec(`ALTER TABLE ${table} RENAME TO ${table}_v1`)
  db.exec(TABLE_DDL[table])
  db.prepare(`
    INSERT INTO ${table} (${carried}, updated_at, deleted_at)
    SELECT ${carried}, created_at, NULL FROM ${table}_v1
  `).run()
  db.exec(`DROP TABLE ${table}_v1`)
}


/** Error carrying the HTTP status a request path must answer with. */
export class IdentityError extends Error {
  /**
   * @param status - HTTP status the caller answers with.
   * @param code - stable machine-readable reason.
   * @param message - human-readable explanation.
   */
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
export function assertName(name) {
  const value = String(name ?? '').trim()
  if (!/^[A-Za-z0-9_-]{2,32}$/u.test(value)) {
    throw new IdentityError(400, 'identity/invalid-name',
      'name must be 2-32 characters of letters, digits, underscore, or hyphen')
  }
  return value
}

/** Validate a password the same way at registration and sign-in. */
export function assertPassword(password) {
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

  /**
   * Open (creating when absent) the business database.
   * @param options - `path` of the SQLite file and the session lifetime.
   */
  constructor({ path, sessionTtlDays = 30, now = () => Date.now() } = {}) {
    if (typeof path !== 'string' || path === '') {
      throw new IdentityError(500, 'identity/misconfigured', 'the identity store needs a database path')
    }
    mkdirSync(dirname(path), { recursive: true })
    this.#db = new DatabaseSync(path)
    this.#db.exec('PRAGMA journal_mode = WAL')
    // The current schema declares no foreign key; a v1 file may still carry the
    // clauses it used to, and rebuilding those tables must not enforce them.
    this.#db.exec('PRAGMA foreign_keys = OFF')
    this.#db.exec(SCHEMA)
    this.#migrate()
    this.#sessionTtlMilliseconds = sessionTtlDays * DAY_MILLISECONDS
    this.now = now
  }

  /**
   * Bring an existing file up to `SCHEMA_VERSION`, atomically.
   *
   * A file with no recorded version is new and already carries the current
   * shape. A version newer than this module understands is refused rather than
   * downgraded, so a downgrade never silently discards later data.
   */
  #migrate() {
    const row = this.#db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version')
    if (row === undefined) {
      this.#db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
        .run('schema_version', String(SCHEMA_VERSION))
      return
    }
    const version = Number(row.value)
    if (!Number.isInteger(version) || version > SCHEMA_VERSION) {
      throw new IdentityError(500, 'identity/schema-too-new',
        `this identity store speaks schema version ${SCHEMA_VERSION}, the file is version ${row.value}`)
    }
    if (version === SCHEMA_VERSION) return
    this.#transaction(() => {
      for (const table of Object.keys(TABLE_DDL)) rebuildTable(this.#db, table)
      this.#db.exec(INDEX_DDL)
      this.#db.prepare('UPDATE meta SET value = ? WHERE key = ?')
        .run(String(SCHEMA_VERSION), 'schema_version')
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
      try {
        this.#db.exec('ROLLBACK')
      } catch {
        // A rollback that cannot run means the transaction already ended.
      }
      throw error
    }
  }

  /**
   * Persist the initial Phaethon identity.
   *
   * Idempotent: an existing Phaethon keeps its identity and short number 1. A
   * password is only written while the account has none, so restarting with a
   * different environment value cannot silently change the credential.
   *
   * @param options - Phaethon's name and, when the operator provisioned one, its password.
   * @returns the stored user, and whether this call created it.
   */
  seedPhaethon({ name = 'phaethon', password } = {}) {
    const login = assertName(name)
    return this.#transaction(() => {
      const existing = this.#db.prepare('SELECT * FROM users WHERE short_id = ? AND deleted_at IS NULL').get(PHAETHON_SHORT_ID)
      if (existing !== undefined) {
        if (password !== undefined && password !== '' && existing.password === null) {
          this.#db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ?')
            .run(hashPassword(assertPassword(password)), this.now(), existing.id)
          return { user: publicUser(this.#db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id)), created: false }
        }
        return { user: publicUser(existing), created: false }
      }
      const now = this.now()
      const info = this.#db.prepare(
        'INSERT INTO users (short_id, name, is_admin, password, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)',
      ).run(PHAETHON_SHORT_ID, login, password === undefined || password === '' ? null : hashPassword(assertPassword(password)), now, now)
      const row = this.#db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
      return { user: publicUser(row), created: true }
    })
  }

  /** One user by short number, or undefined. */
  userByShortId(shortId) {
    const row = this.#db.prepare('SELECT * FROM users WHERE short_id = ? AND deleted_at IS NULL').get(Number(shortId))
    return row === undefined ? undefined : publicUser(row)
  }

  /** One user by login name, or undefined. */
  userByName(name) {
    const row = this.#db.prepare('SELECT * FROM users WHERE name = ? AND deleted_at IS NULL').get(String(name ?? '').trim())
    return row === undefined ? undefined : publicUser(row)
  }

  /** Every user, in short-number order; removed identities are not listed. */
  listUsers() {
    return this.#db.prepare('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY short_id').all().map(publicUser)
  }

  /**
   * Logically remove one identity.
   *
   * The row stays, so the short number it was issued is never handed to another
   * identity and the removal is auditable. A removed identity stops signing in,
   * stops authenticating, and gives its name back only after this process.
   *
   * @param shortId - short number to remove.
   * @returns whether a live identity was removed.
   */
  removeUser(shortId) {
    const now = this.now()
    return this.#transaction(() => {
      const info = this.#db.prepare(
        'UPDATE users SET deleted_at = ?, updated_at = ? WHERE short_id = ? AND deleted_at IS NULL',
      ).run(now, now, Number(shortId))
      if (info.changes === 0) return false
      this.#db.prepare('UPDATE sessions SET deleted_at = ?, updated_at = ? WHERE user_id = ? AND deleted_at IS NULL')
        .run(now, now, Number(this.#db.prepare('SELECT id FROM users WHERE short_id = ?').get(Number(shortId)).id))
      return true
    })
  }

  /**
   * Mint one invite code for an administrator.
   * @param adminShortId - short number the authenticated caller speaks for.
   * @returns the created invite.
   */
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

  /** Logically remove one invite so it can no longer be redeemed. */
  removeInvite(code) {
    const now = this.now()
    return this.#transaction(() => {
      const info = this.#db.prepare(
        'UPDATE invites SET deleted_at = ?, updated_at = ? WHERE code = ? AND deleted_at IS NULL',
      ).run(now, now, canonicalInviteCode(code))
      return info.changes > 0
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
   * Redeem one invite and create the invited identity, atomically.
   *
   * A repeated submission of the same invite, a name already in use, or any
   * other refusal leaves no user, no redemption, and no session behind.
   *
   * @param options - invite code plus the newcomer's name and password.
   * @returns the created user and its first session token.
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
      if (this.#db.prepare('SELECT 1 FROM users WHERE name = ? AND deleted_at IS NULL').get(login) !== undefined) {
        throw new IdentityError(409, 'identity/name-taken', 'that name is already registered')
      }
      const now = this.now()
      // Allocation reads every row, deleted ones included, so a removed identity's
      // short number is never reused and a name freed by removal can be taken again.
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

  /**
   * Verify a login name and password.
   * @param options - name and password.
   * @returns the user and a fresh session token.
   */
  signIn({ name, password } = {}) {
    const row = this.#db.prepare('SELECT * FROM users WHERE name = ? AND deleted_at IS NULL').get(String(name ?? '').trim())
    if (row === undefined || row.password === null || !verifyPassword(String(password ?? ''), row.password)) {
      throw new IdentityError(401, 'identity/bad-credentials', 'name and password do not match an identity')
    }
    const now = this.now()
    return { user: publicUser(row), token: this.#mintSession(row.id, now) }
  }

  /**
   * Resolve the identity a bearer token speaks for.
   *
   * The returned record is the whole authorization input for a request: the
   * caller never names a user, so a client cannot choose whose identity it acts
   * as.
   *
   * @param token - bearer value presented by a client.
   * @returns the user, or undefined when the token is unknown, expired, or revoked.
   */
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

  /**
   * Revoke one session token.
   * @param token - bearer value to revoke.
   * @returns whether a live session was revoked.
   */
  signOut(token) {
    const info = this.#db.prepare('UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE digest = ? AND revoked_at IS NULL')
      .run(this.now(), this.now(), sessionTokenDigest(token))
    return info.changes > 0
  }

  /** Every live session count for one short number; used to observe revocation. */
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
