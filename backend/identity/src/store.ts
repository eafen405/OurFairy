/**
 * The OurFairy business store: users, short numbers, invites, sessions, groups,
 * upload lifecycle and delivery coordination in one SQLite file, apart from the
 * dsh session logs.
 *
 * Every mutation that spans more than one statement runs inside one
 * `BEGIN IMMEDIATE` transaction. The schema declares no UNIQUE constraint and no
 * foreign key, so duplicate names, short-number allocation and association
 * existence are checked explicitly inside that transaction.
 *
 * Deletion is a stored state: reads skip deleted rows and a login name or short
 * number stays reserved once issued.
 *
 * @module @ourfairy/dsh-identity/src/store
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from 'node:sqlite'
import {
  canonicalInviteCode,
  hashPassword,
  mintInviteCode,
  mintSessionToken,
  sessionTokenDigest,
  verifyPassword,
} from './codes.js'
import { DELIVERIES_SCHEMA } from './schema/deliveries.js'
import { GROUPS_SCHEMA } from './schema/groups.js'
import { INDEXES_SCHEMA } from './schema/indexes.js'
import { UPLOADS_SCHEMA } from './schema/uploads.js'
import { USERS_SCHEMA } from './schema/users.js'

/** The Phaethon short number: the deployment's first identity, reserved by rule. */
export const PHAETHON_SHORT_ID = 1

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000
const SCHEMA_VERSION = 6

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
${USERS_SCHEMA}
${INDEXES_SCHEMA}
${GROUPS_SCHEMA}
${UPLOADS_SCHEMA}
${DELIVERIES_SCHEMA}
`

/** Error carrying the HTTP status a request path answers with. */
export class IdentityError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'IdentityError'
    this.status = status
    this.code = code
  }
}

/**
 * One row of the `users` table.
 *
 * The row shapes below are type aliases, not interfaces, so each one carries
 * the implicit index signature the SQLite driver rows have.
 */
type UserRow = {
  id: number
  short_id: number
  name: string
  is_admin: number
  password: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** One row of the `invites` table. */
type InviteRow = {
  code: string
  created_by: number
  created_at: number
  updated_at: number
  redeemed_by: number | null
  redeemed_at: number | null
  deleted_at: number | null
}

/** One row of the session/user join the credential lookup reads. */
type SessionUserRow = {
  digest: string
  expires_at: number
  revoked_at: number | null
  id: number
  short_id: number
  name: string
  is_admin: number
  password: string | null
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** One row of the `groups` table. */
type GroupRow = {
  id: number
  name: string
  owner_short_id: number
  created_by: number
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** One row of the `group_members` table. */
type GroupMemberRow = {
  id: number
  group_id: number
  user_short_id: number
  created_by: number
  updated_by: number
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** One row of the `uploads` table. */
type UploadRow = {
  upload_id: string
  owner_short_id: number
  session_id: string
  name: string
  mime: string
  size: number
  sha256: string
  status: number
  offset: number
  original_ref: string | null
  image_ref: string | null
  expires_at: number
  created_by: number
  updated_by: number
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** One row of the `deliveries` table. */
type DeliveryRow = {
  delivery_id: string
  sender_short_id: number
  sender_session_id: string
  recipient_short_id: number
  recipient_session_id: string
  text: string
  attachments_json: string
  status: number
  message_id: string | null
  accepted_seq: number | null
  created_by: number
  updated_by: number
  created_at: number
  updated_at: number
  deleted_at: number | null
}

/** One stored user as the product exposes it (never the password record). */
export type PublicUser = {
  shortId: number
  name: string
  isAdmin: boolean
  createdAt: number
}

/** One live agent as the roster exposes it: only the short number and the name. */
export type AgentPresence = {
  shortId: number
  name: string
}

/**
 * One file a delivery names: the selector it points at and the prepared row,
 * if any. Both are the delivery package's own JSON; the store carries them
 * without reading them.
 */
export type DeliveryFile = {
  selector: unknown
  prepared?: unknown
}

/** One delivery the product asks the store to coordinate. */
export type DeliveryInput = {
  deliveryId: string
  senderShortId: number
  senderSessionId: string
  recipientShortId: number
  sessionId: string
  text: string
  files?: DeliveryFile[]
}

/** One delivery row as the product's face exposes it. */
export type Delivery = {
  deliveryId: string
  senderShortId: number
  senderSessionId: string
  recipientShortId: number
  sessionId: string
  text: string
  status: number
  messageId: string | null
  acceptedSeq: number | null
  files: DeliveryFile[]
}

/** The receipt one settled delivery answers with. */
export type DeliveryReceipt = {
  messageId: string
  acceptedSeq: number
}

/** One upload the product asks the store to record. */
export type UploadInput = {
  uploadId: string
  owner: number
  sessionId: string
  name: string
  mime: string
  size: number
  sha256: string
  status: number
  offset: number
  expiresAt: number
  createdAt: number
  updatedAt: number
}

/** One upload row as the product's face exposes it. */
export type Upload = {
  uploadId: string
  owner: number
  sessionId: string
  name: string
  mime: string
  size: number
  sha256: string
  status: number
  offset: number
  expiresAt: number
  createdAt: number
  updatedAt: number
  original: unknown
  image: unknown
}

/** The lifecycle facts one upload update may change. */
export type UploadChanges = {
  status?: number
  offset?: number
  original?: unknown
  image?: unknown
}

/** One group as the product's face exposes it. */
export type Group = {
  id: number
  name: string
  ownerShortId: number
  memberShortIds: number[]
}

/** The group one creation request names. */
export type GroupRequest = {
  name?: unknown
  ownerShortId?: unknown
}

/** The membership change one request names. */
export type GroupMemberRequest = {
  groupId?: unknown
  userShortId?: unknown
  action?: unknown
}

/**
 * One row read as the row shape its table declares, or undefined when the
 * query found none.
 *
 * The SQLite driver types every column as `SQLOutputValue`; the schema is the
 * authority on which columns are numbers, which are text and which may be
 * NULL. The assertion is confined to this one boundary so every read site
 * keeps a typed row.
 * @param row - the driver's row, or undefined when the query found none.
 * @returns the row as the table's row shape.
 */
function rowOf<T extends Record<string, SQLOutputValue>>(row: Record<string, SQLOutputValue> | undefined): T | undefined {
  return row as T | undefined
}

/**
 * One row that must exist, read as the row shape its table declares.
 * @param row - the driver's row.
 * @returns the row as the table's row shape.
 * @throws {IdentityError} when the query found no row.
 */
function requiredRow<T extends Record<string, SQLOutputValue>>(row: Record<string, SQLOutputValue> | undefined): T {
  if (row === undefined) {
    throw new IdentityError(500, 'identity/missing-row', 'the row this step depends on is gone')
  }
  return row as T
}

/** Every row of one query, read as the row shape its table declares. */
function rowsOf<T extends Record<string, SQLOutputValue>>(rows: Record<string, SQLOutputValue>[]): T[] {
  return rows as T[]
}

/** One JSON column read back as the opaque value it holds. */
function jsonValue(text: string): unknown {
  const parsed: unknown = JSON.parse(text)
  return parsed
}

/** Whether a value is a positive safe integer short number. */
function isShortId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Whether a value is the membership action this store accepts. */
function isMemberAction(value: unknown): value is 1 | 2 {
  return value === 1 || value === 2
}

/** One stored user as the product exposes it (never the password record). */
function publicUser(row: UserRow): PublicUser {
  return {
    shortId: row.short_id,
    name: row.name,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
  }
}

/** Validate a login name the same way at registration and sign-in. */
function assertName(name: unknown): string {
  const value = String(name ?? '').trim()
  if (!/^[A-Za-z0-9_-]{2,32}$/u.test(value)) {
    throw new IdentityError(400, 'identity/invalid-name',
      'name must be 2-32 characters of letters, digits, underscore, or hyphen')
  }
  return value
}

/** Validate a password the same way at registration and sign-in. */
function assertPassword(password: unknown): string {
  const value = String(password ?? '')
  if (value.length < 8) {
    throw new IdentityError(400, 'identity/weak-password', 'password must be at least 8 characters')
  }
  return value
}

/** The identity module's persistent business state. */
export class IdentityStore {
  #db: DatabaseSync
  #now: () => number
  #sessionTtlMilliseconds: number

  constructor({ path, sessionTtlDays = 30, now = () => Date.now() }: {
    path?: string
    sessionTtlDays?: number
    now?: () => number
  } = {}) {
    if (typeof path !== 'string' || path === '') {
      throw new IdentityError(500, 'identity/misconfigured', 'the identity store needs a database path')
    }
    this.#now = now
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
  }

  /**
   * Bring a supported file to `SCHEMA_VERSION` inside one immediate transaction.
   *
   * Only files whose schema version is this module's own history are upgraded.
   * The one legacy case is a file that wrote no schema version: it is in this
   * module's current shape, so recording the version is all it needs.
   */
  #migrate(): void {
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
  #storedVersion(): number | undefined {
    const hasMeta = this.#db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get() !== undefined
    if (!hasMeta) return undefined
    const row = rowOf<{ value: string }>(this.#db.prepare('SELECT value FROM meta WHERE key = ?').get('schema_version'))
    return row === undefined ? undefined : Number(row.value)
  }

  #setVersion(): void {
    this.#db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
      .run('schema_version', String(SCHEMA_VERSION))
  }

  /** One delivery row; the package's own reads, never a published operation. */
  #readDelivery(id: string): Delivery | undefined {
    const row = rowOf<DeliveryRow>(this.#db.prepare('SELECT * FROM deliveries WHERE delivery_id = ? AND deleted_at IS NULL').get(id))
    if (row === undefined) return undefined
    // `deliveries.attachments_json` holds this store's own file list, so the
    // JSON column is read as that list at the row boundary and the parsed
    // value is handed on as it is.
    const files = jsonValue(row.attachments_json) as DeliveryFile[]
    return {
      deliveryId: row.delivery_id,
      senderShortId: row.sender_short_id,
      senderSessionId: row.sender_session_id,
      recipientShortId: row.recipient_short_id,
      sessionId: row.recipient_session_id,
      text: row.text,
      status: row.status,
      messageId: row.message_id,
      acceptedSeq: row.accepted_seq,
      files,
    }
  }

  /** Coordinate one delivery: the same identity, recipient and content, or a conflict. */
  prepareDelivery(row: DeliveryInput): Delivery | undefined {
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
      const now = this.#now()
      this.#db.prepare(`INSERT INTO deliveries
        (delivery_id,sender_short_id,sender_session_id,recipient_short_id,recipient_session_id,text,attachments_json,status,created_by,updated_by,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.deliveryId,row.senderShortId,row.senderSessionId,row.recipientShortId,
          row.sessionId,row.text,JSON.stringify(row.files ?? []),(row.files?.length ? 2 : 0),row.senderShortId,row.senderShortId,now,now)
      return this.#readDelivery(row.deliveryId)
    })
  }

  /** Persist each immutable file before moving on; null entries alone are retried. */
  prepareDeliveryFile(id: string, index: number, prepared: unknown): Delivery | undefined {
    return this.#transaction(() => {
      const row = this.#readDelivery(id)
      const file = row?.files[index]
      if (row === undefined || file === undefined) {
        throw new TypeError(`no delivery file at index ${index} of ${id}`)
      }
      file.prepared = prepared
      const status = row.files.every(entry => entry.prepared !== null) ? 0 : 2
      this.#db.prepare(`UPDATE deliveries SET attachments_json = ?, status = ?,
        updated_by = sender_short_id, updated_at = ? WHERE delivery_id = ? AND deleted_at IS NULL`)
        .run(JSON.stringify(row.files),status,this.#now(),id)
      return this.#readDelivery(id)
    })
  }

  /** Every delivery still waiting to be settled. */
  pendingDeliveries(): Delivery[] {
    const rows = rowsOf<DeliveryRow>(this.#db.prepare('SELECT delivery_id FROM deliveries WHERE status = 0 AND deleted_at IS NULL ORDER BY created_at,delivery_id')
      .all())
    return rows.flatMap(row => {
      const delivery = this.#readDelivery(row.delivery_id)
      return delivery === undefined ? [] : [delivery]
    })
  }

  /** Mark one delivery durably delivered. */
  completeDelivery(id: string, { messageId, acceptedSeq }: DeliveryReceipt): void {
    this.#db.prepare('UPDATE deliveries SET status = 1, message_id = ?, accepted_seq = ?, updated_by = sender_short_id, updated_at = ? WHERE delivery_id = ? AND deleted_at IS NULL')
      .run(messageId,acceptedSeq,this.#now(),id)
  }

  /** Insert an opaque upload receipt after the staging file exists. */
  insertUpload(row: UploadInput): void {
    this.#db.prepare(`INSERT INTO uploads
      (upload_id,owner_short_id,session_id,name,mime,size,sha256,status,offset,expires_at,created_by,updated_by,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(row.uploadId,row.owner,row.sessionId,row.name,row.mime,row.size,row.sha256,
        row.status,row.offset,row.expiresAt,row.owner,row.owner,row.createdAt,row.updatedAt)
  }

  /** Read lifecycle facts. Session ownership is checked by the attachment service. */
  readUpload(id: string): Upload | undefined {
    const row = rowOf<UploadRow>(this.#db.prepare('SELECT * FROM uploads WHERE upload_id = ? AND deleted_at IS NULL').get(id))
    if (!row) return undefined
    return {
      uploadId: row.upload_id,
      owner: row.owner_short_id,
      sessionId: row.session_id,
      name: row.name,
      mime: row.mime,
      size: row.size,
      sha256: row.sha256,
      status: row.status,
      offset: row.offset,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      original: row.original_ref === null ? null : jsonValue(row.original_ref),
      image: row.image_ref === null ? null : jsonValue(row.image_ref),
    }
  }

  /** One atomic lifecycle update; no message-acceptance state is stored here. */
  updateUpload(id: string, changes: UploadChanges): void {
    const updates = Object.entries(changes).map(([key, value]): { column: string; value: SQLInputValue } => {
      switch (key) {
        case 'status':
        case 'offset': {
          // `schema/uploads.ts` declares both columns INTEGER, so the caller's
          // own type is the authority on the value: the assertion restores the
          // declared type that `Object.entries` widens away. SQLite applies its
          // affinity and NOT NULL rules to whatever is bound, so the binding
          // carries no check of its own.
          return { column: key, value: value as number }
        }
        case 'original':
        case 'image': {
          if (value === null) return { column: key === 'original' ? 'original_ref' : 'image_ref', value: null }
          // `schema/uploads.ts` declares both columns TEXT, so the encoded
          // value is the row's own JSON text: the assertion names that declared
          // type at the binding boundary. A value JSON cannot encode leaves the
          // encoding undefined, and the driver refuses to bind it.
          const encoded: string | undefined = JSON.stringify(value)
          return { column: key === 'original' ? 'original_ref' : 'image_ref', value: encoded as string }
        }
        default:
          throw new Error('unknown upload lifecycle field')
      }
    })
    this.#db.prepare(`UPDATE uploads SET ${updates.map(update => `${update.column} = ?`).join(', ')},
      updated_by = owner_short_id, updated_at = ? WHERE upload_id = ? AND deleted_at IS NULL`)
      .run(...updates.map(update => update.value),this.#now(),id)
  }

  /** A group's public state; membership is read from the same business store. */
  #group(row: GroupRow): Group {
    const members = rowsOf<{ user_short_id: number }>(this.#db.prepare('SELECT user_short_id FROM group_members WHERE group_id = ? AND deleted_at IS NULL ORDER BY user_short_id').all(row.id))
    return {
      id: row.id,
      name: row.name,
      ownerShortId: row.owner_short_id,
      memberShortIds: members.map(member => member.user_short_id),
    }
  }

  /** Current member groups only; system management does not grant file access. */
  groupsForMember(shortId: number): Group[] {
    const rows = rowsOf<GroupRow>(this.#db.prepare(`SELECT groups.* FROM groups JOIN group_members ON group_members.group_id = groups.id
      WHERE group_members.user_short_id = ? AND group_members.deleted_at IS NULL AND groups.deleted_at IS NULL ORDER BY groups.id`)
      .all(shortId))
    return rows.map(row => this.#group(row))
  }

  /** Whether one short number owns a live group. */
  ownsGroup(shortId: number): boolean {
    return this.#db.prepare('SELECT 1 FROM groups WHERE owner_short_id = ? AND deleted_at IS NULL').get(shortId) !== undefined
  }

  /** Phaethon creates and designates an existing owner, who joins atomically. */
  createGroup(callerShortId: number, { name, ownerShortId }: GroupRequest): Group {
    const groupName = typeof name === 'string' ? name.trim() : ''
    if (!groupName || groupName.length > 100 || !isShortId(ownerShortId)) {
      throw new IdentityError(400, 'groups/invalid-request', 'provide a group name (1-100 characters) and an existing owner short number')
    }
    return this.#transaction(() => {
      const caller = this.userByShortId(callerShortId)
      if (caller === undefined || caller.shortId !== PHAETHON_SHORT_ID || !caller.isAdmin) {
        throw new IdentityError(403, 'groups/forbidden', 'only Phaethon may create a group')
      }
      if (!this.userByShortId(ownerShortId)) throw new IdentityError(404, 'groups/unknown-user', 'no active user has that short number')
      const now = this.#now()
      const info = this.#db.prepare('INSERT INTO groups (name, owner_short_id, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
        .run(groupName, ownerShortId, callerShortId, now, now)
      const groupId = Number(info.lastInsertRowid)
      this.#db.prepare('INSERT INTO group_members (group_id, user_short_id, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(groupId, ownerShortId, callerShortId, callerShortId, now, now)
      return this.#group(requiredRow<GroupRow>(this.#db.prepare('SELECT * FROM groups WHERE id = ?').get(groupId)))
    })
  }

  /** Change only the caller's own group, with authorization and write together. */
  changeGroupMember(callerShortId: number, { groupId, userShortId, action }: GroupMemberRequest): Group {
    if (!isShortId(groupId) || !isShortId(userShortId) || !isMemberAction(action)) {
      throw new IdentityError(400, 'groups/invalid-request', 'provide groupId, userShortId and action 1 (add) or 2 (remove)')
    }
    return this.#transaction(() => {
      const group = rowOf<GroupRow>(this.#db.prepare('SELECT * FROM groups WHERE id = ? AND deleted_at IS NULL').get(groupId))
      if (!this.userByShortId(callerShortId) || !group || group.owner_short_id !== callerShortId) {
        throw new IdentityError(403, 'groups/forbidden', 'only the current owner of this group may change its members')
      }
      if (!this.userByShortId(userShortId)) throw new IdentityError(404, 'groups/unknown-user', 'no active user has that short number')
      if (action === 2 && userShortId === group.owner_short_id) {
        throw new IdentityError(409, 'groups/owner-required', 'the designated group owner must remain a member')
      }
      const member = rowOf<GroupMemberRow>(this.#db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_short_id = ?').get(groupId, userShortId))
      const now = this.#now()
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
  close(): void {
    this.#db.close()
  }

  /** Run `work` inside one immediate transaction, rolling back on any failure. */
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

  /**
   * Persist the initial Phaethon identity, idempotently. A password is written
   * only while the account has none; a logically deleted Phaethon row is refused
   * rather than recreated beside itself.
   */
  seedPhaethon({ name = 'phaethon', password }: { name?: string; password?: string | undefined } = {}): { user: PublicUser; created: boolean } {
    const login = assertName(name)
    return this.#transaction(() => {
      const existing = rowOf<UserRow>(this.#db.prepare('SELECT * FROM users WHERE short_id = ?').get(PHAETHON_SHORT_ID))
      if (existing !== undefined && existing.deleted_at === null) {
        if (password !== undefined && password !== '' && existing.password === null) {
          this.#db.prepare('UPDATE users SET password = ?, updated_at = ? WHERE id = ?')
            .run(hashPassword(assertPassword(password)), this.#now(), existing.id)
          const refreshed = requiredRow<UserRow>(this.#db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id))
          return { user: publicUser(refreshed), created: false }
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
      const now = this.#now()
      const info = this.#db.prepare(
        'INSERT INTO users (short_id, name, is_admin, password, created_at, updated_at) VALUES (?, ?, 1, ?, ?, ?)',
      ).run(PHAETHON_SHORT_ID, login, password === undefined || password === '' ? null : hashPassword(assertPassword(password)), now, now)
      const row = requiredRow<UserRow>(this.#db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid))
      return { user: publicUser(row), created: true }
    })
  }

  /** One user by short number. */
  userByShortId(shortId: number): PublicUser | undefined {
    const row = rowOf<UserRow>(this.#db.prepare('SELECT * FROM users WHERE short_id = ? AND deleted_at IS NULL').get(Number(shortId)))
    return row === undefined ? undefined : publicUser(row)
  }

  /** Every live agent, in short-number order, for the read-only roster. */
  listAgents(): AgentPresence[] {
    return rowsOf<{ short_id: number; name: string }>(
      this.#db.prepare('SELECT short_id, name FROM users WHERE deleted_at IS NULL ORDER BY short_id').all(),
    ).map(row => ({ shortId: row.short_id, name: row.name }))
  }

  /** Mint one invite code for an administrator. */
  createInvite(adminShortId: number): { code: string; createdAt: number } {
    return this.#transaction(() => {
      const admin = rowOf<UserRow>(this.#db.prepare('SELECT * FROM users WHERE short_id = ? AND deleted_at IS NULL').get(Number(adminShortId)))
      if (admin === undefined) throw new IdentityError(403, 'identity/forbidden', 'the caller is not a known identity')
      if (admin.is_admin !== 1) {
        throw new IdentityError(403, 'identity/forbidden', 'only Phaethon may create invites')
      }
      const code = mintInviteCode()
      const now = this.#now()
      this.#db.prepare('INSERT INTO invites (code, created_by, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(code, admin.id, now, now)
      return { code, createdAt: now }
    })
  }

  /**
   * Redeem one invite and create the invited identity atomically. A refusal
   * leaves no user, no redemption and no session behind.
   */
  register({ inviteCode, name, password }: { inviteCode?: unknown; name?: unknown; password?: unknown } = {}): { user: PublicUser; token: string } {
    const code = canonicalInviteCode(inviteCode)
    const login = assertName(name)
    const secret = assertPassword(password)
    return this.#transaction(() => {
      const invite = rowOf<InviteRow>(this.#db.prepare('SELECT * FROM invites WHERE code = ? AND deleted_at IS NULL').get(code))
      if (invite === undefined) throw new IdentityError(403, 'identity/unknown-invite', 'that invite code was not issued here')
      if (invite.redeemed_by !== null) {
        throw new IdentityError(409, 'identity/invite-used', 'that invite code has already been used')
      }
      if (this.#db.prepare('SELECT 1 FROM users WHERE name = ?').get(login) !== undefined) {
        throw new IdentityError(409, 'identity/name-taken', 'that name is already registered')
      }
      const now = this.#now()
      // Allocation reads every row, deleted ones included, so a removed identity's
      // short number is never handed out a second time.
      const next = requiredRow<{ value: number }>(this.#db.prepare('SELECT COALESCE(MAX(short_id), 0) + 1 AS value FROM users').get())
      const shortId = Number(next.value)
      if (shortId <= PHAETHON_SHORT_ID) {
        throw new IdentityError(500, 'identity/unseeded', 'the Phaethon identity has not been seeded')
      }
      const info = this.#db.prepare(
        'INSERT INTO users (short_id, name, is_admin, password, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)',
      ).run(shortId, login, hashPassword(secret), now, now)
      this.#db.prepare('UPDATE invites SET redeemed_by = ?, redeemed_at = ?, updated_at = ? WHERE code = ?')
        .run(info.lastInsertRowid, now, now, code)
      const user = publicUser(requiredRow<UserRow>(this.#db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)))
      return { user, token: this.#mintSession(info.lastInsertRowid, now) }
    })
  }

  /** Verify a login name and password, answering the user and a fresh session token. */
  signIn({ name, password }: { name?: unknown; password?: unknown } = {}): { user: PublicUser; token: string } {
    const row = rowOf<UserRow>(this.#db.prepare('SELECT * FROM users WHERE name = ? AND deleted_at IS NULL').get(String(name ?? '').trim()))
    if (row === undefined || row.password === null || !verifyPassword(String(password ?? ''), row.password)) {
      throw new IdentityError(401, 'identity/bad-credentials', 'name and password do not match an identity')
    }
    const now = this.#now()
    return { user: publicUser(row), token: this.#mintSession(row.id, now) }
  }

  /** The identity a bearer token speaks for, or undefined when unknown, expired or revoked. */
  authenticate(token: unknown): PublicUser | undefined {
    if (typeof token !== 'string' || token === '') return undefined
    const row = rowOf<SessionUserRow>(this.#db.prepare(`
      SELECT sessions.digest AS digest, sessions.expires_at AS expires_at, sessions.revoked_at AS revoked_at, users.*
      FROM sessions JOIN users ON users.id = sessions.user_id
      WHERE sessions.digest = ? AND sessions.deleted_at IS NULL AND users.deleted_at IS NULL
    `).get(sessionTokenDigest(token)))
    if (row === undefined) return undefined
    if (row.revoked_at !== null) return undefined
    if (row.expires_at <= this.#now()) return undefined
    return publicUser(row)
  }

  /** Revoke one session token; answers whether a live session was revoked. */
  signOut(token: string): boolean {
    const now = this.#now()
    const info = this.#db.prepare(
      'UPDATE sessions SET revoked_at = ?, updated_at = ? WHERE digest = ? AND revoked_at IS NULL AND deleted_at IS NULL',
    ).run(now, now, sessionTokenDigest(token))
    return info.changes > 0
  }

  /** Mint and store one session for a user row id. */
  #mintSession(userId: number | bigint, now: number): string {
    const token = mintSessionToken()
    this.#db.prepare(
      'INSERT INTO sessions (digest, user_id, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?)',
    ).run(sessionTokenDigest(token), userId, now, now, now + this.#sessionTtlMilliseconds)
    return token
  }
}
