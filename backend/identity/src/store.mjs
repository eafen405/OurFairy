/**
 * The OurFairy business store: users, their short numbers, invites, and
 * sessions, in one SQLite file owned by the identity module and kept apart from
 * the dsh session logs.
 *
 * Every mutation that spans more than one statement runs inside one
 * `BEGIN IMMEDIATE` transaction on a synchronous connection, so a failed
 * registration leaves no identity behind and two racing registrations cannot
 * share a short number. The UNIQUE constraints are the second line of defence:
 * they hold even if a caller forgets the transaction.
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
const SCHEMA_VERSION = 1

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  short_id INTEGER NOT NULL UNIQUE,
  name TEXT NOT NULL UNIQUE,
  is_admin INTEGER NOT NULL DEFAULT 0,
  password TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  redeemed_by INTEGER REFERENCES users(id),
  redeemed_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  digest TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS sessions_by_user ON sessions(user_id);
`

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
    this.#db.exec('PRAGMA foreign_keys = ON')
    this.#db.exec(SCHEMA)
    this.#db.prepare('INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)')
      .run('schema_version', String(SCHEMA_VERSION))
    this.#sessionTtlMilliseconds = sessionTtlDays * DAY_MILLISECONDS
    this.now = now
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
      const existing = this.#db.prepare('SELECT * FROM users WHERE short_id = ?').get(PHAETHON_SHORT_ID)
      if (existing !== undefined) {
        if (password !== undefined && password !== '' && existing.password === null) {
          this.#db.prepare('UPDATE users SET password = ? WHERE id = ?')
            .run(hashPassword(assertPassword(password)), existing.id)
          return { user: publicUser(this.#db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id)), created: false }
        }
        return { user: publicUser(existing), created: false }
      }
      const now = this.now()
      const info = this.#db.prepare(
        'INSERT INTO users (short_id, name, is_admin, password, created_at) VALUES (?, ?, 1, ?, ?)',
      ).run(PHAETHON_SHORT_ID, login, password === undefined || password === '' ? null : hashPassword(assertPassword(password)), now)
      const row = this.#db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)
      return { user: publicUser(row), created: true }
    })
  }

  /** One user by short number, or undefined. */
  userByShortId(shortId) {
    const row = this.#db.prepare('SELECT * FROM users WHERE short_id = ?').get(Number(shortId))
    return row === undefined ? undefined : publicUser(row)
  }

  /** One user by login name, or undefined. */
  userByName(name) {
    const row = this.#db.prepare('SELECT * FROM users WHERE name = ?').get(String(name ?? '').trim())
    return row === undefined ? undefined : publicUser(row)
  }

  /** Every user, in short-number order. */
  listUsers() {
    return this.#db.prepare('SELECT * FROM users ORDER BY short_id').all().map(publicUser)
  }

  /**
   * Mint one invite code for an administrator.
   * @param adminShortId - short number the authenticated caller speaks for.
   * @returns the created invite.
   */
  createInvite(adminShortId) {
    return this.#transaction(() => {
      const admin = this.#db.prepare('SELECT * FROM users WHERE short_id = ?').get(Number(adminShortId))
      if (admin === undefined) throw new IdentityError(403, 'identity/forbidden', 'the caller is not a known identity')
      if (admin.is_admin !== 1) {
        throw new IdentityError(403, 'identity/forbidden', 'only Phaethon may create invites')
      }
      const code = mintInviteCode()
      const now = this.now()
      this.#db.prepare('INSERT INTO invites (code, created_by, created_at) VALUES (?, ?, ?)')
        .run(code, admin.id, now)
      return { code, createdAt: now }
    })
  }

  /** One invite's state, without exposing who redeemed it. */
  inviteState(code) {
    const row = this.#db.prepare('SELECT * FROM invites WHERE code = ?').get(canonicalInviteCode(code))
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
      const invite = this.#db.prepare('SELECT * FROM invites WHERE code = ?').get(code)
      if (invite === undefined) throw new IdentityError(403, 'identity/unknown-invite', 'that invite code was not issued here')
      if (invite.redeemed_by !== null) {
        throw new IdentityError(409, 'identity/invite-used', 'that invite code has already been used')
      }
      if (this.#db.prepare('SELECT 1 FROM users WHERE name = ?').get(login) !== undefined) {
        throw new IdentityError(409, 'identity/name-taken', 'that name is already registered')
      }
      const now = this.now()
      const next = this.#db.prepare('SELECT COALESCE(MAX(short_id), 0) + 1 AS value FROM users').get()
      const shortId = Number(next.value)
      if (shortId <= PHAETHON_SHORT_ID) {
        throw new IdentityError(500, 'identity/unseeded', 'the Phaethon identity has not been seeded')
      }
      const info = this.#db.prepare(
        'INSERT INTO users (short_id, name, is_admin, password, created_at) VALUES (?, ?, 0, ?, ?)',
      ).run(shortId, login, hashPassword(secret), now)
      this.#db.prepare('UPDATE invites SET redeemed_by = ?, redeemed_at = ? WHERE code = ?')
        .run(info.lastInsertRowid, now, code)
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
    const row = this.#db.prepare('SELECT * FROM users WHERE name = ?').get(String(name ?? '').trim())
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
      WHERE sessions.digest = ?
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
    const info = this.#db.prepare('UPDATE sessions SET revoked_at = ? WHERE digest = ? AND revoked_at IS NULL')
      .run(this.now(), sessionTokenDigest(token))
    return info.changes > 0
  }

  /** Every live session count for one short number; used to observe revocation. */
  liveSessionCount(shortId) {
    const user = this.#db.prepare('SELECT id FROM users WHERE short_id = ?').get(Number(shortId))
    if (user === undefined) return 0
    return Number(this.#db.prepare(
      'SELECT COUNT(*) AS value FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?',
    ).get(user.id, this.now()).value)
  }

  /** Mint and store one session for a user row id. */
  #mintSession(userId, now) {
    const token = mintSessionToken()
    this.#db.prepare('INSERT INTO sessions (digest, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(sessionTokenDigest(token), userId, now, now + this.#sessionTtlMilliseconds)
    return token
  }
}
