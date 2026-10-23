/**
 * Owned sessions: which authenticated identity a session belongs to, and which
 * of that identity's sessions is its fixed primary session.
 *
 * `SessionHeader.owner` is the only ownership authority. A user's primary id is
 * derived from their permanent short number, so the binding needs no stored
 * column.
 *
 * @module @ourfairy/dsh-sessions/src/service
 */
import { randomUUID } from 'node:crypto'
import { Service, type Context } from '@deepseek-ai/cordis'
import { ownerOf } from '@ourfairy/dsh-identity/owner'
import type { IdentityService } from '@ourfairy/dsh-identity'
import type { SessionHeader, SessionId, SessionStore } from '@deepseek-ai/dsh-session'
import type { SessionPersistence, SessionPersistenceSnapshot } from '@deepseek-ai/dsh-session-persistence'
import type { IncomingMessage } from 'node:http'

/** Error carrying the HTTP status one request path answers with. */
export class SessionScopeError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'SessionScopeError'
    this.status = status
    this.code = code
  }
}

/**
 * The owner facts the owned-session service reads.
 *
 * The ownership decision is the short number alone: the service compares the
 * owner string of a session with the owner string of the caller, and never
 * reads anything else about the caller.
 */
export interface SessionOwner {
  readonly shortId: number
}

/**
 * The deterministic primary session id of one identity. The `ourfairy-user-`
 * namespace is this product's own, so a primary id cannot collide with a native
 * `session-<n>` id.
 */
export function primarySessionIdOf(shortId: number): SessionId {
  // dsh brands a session id so it cannot be confused with any other string; the
  // id this function writes is the id the store persists under.
  return `ourfairy-user-${Number(shortId)}-primary` as SessionId
}

/**
 * A fresh ordinary (non-primary) session id for one identity. A UUID, because
 * the native `session-<n>` counter restarts at 1 after a process restart.
 */
export function sessionIdOf(shortId: number): SessionId {
  return `ourfairy-user-${Number(shortId)}-${randomUUID()}` as SessionId
}

/** The product-owned service the composition reads as `ctx.ourfairySessions`. */
export class OwnedSessionService extends Service {
  /** One in-flight operation per owner, so a primary and a create cannot race. */
  readonly _inFlight = new Map<number, Promise<void>>()
  /** The dsh session store this module prepares owned headers with. */
  readonly sessions: SessionStore
  /** The durable store this module reads and writes session headers through. */
  readonly persistence: SessionPersistence
  /** The identity service that names the caller. */
  readonly identity: IdentityService

  constructor(ctx: Context, { sessions, persistence, identity }: {
    sessions: SessionStore
    persistence: SessionPersistence
    identity: IdentityService
  }) {
    super(ctx, 'ourfairySessions')
    this.sessions = sessions
    this.persistence = persistence
    this.identity = identity
  }

  /** The user the presented credential speaks for, or undefined. */
  authenticate(request: IncomingMessage): SessionOwner | undefined {
    return this.identity.authenticateRequest(request)
  }

  /** One session as the product exposes it. */
  expose(header: SessionHeader, shortId: number): {
    id: string
    owner: string | null
    primary: boolean
    createdAt: number
  } {
    return {
      id: header.id,
      owner: header.owner ?? null,
      primary: header.id === primarySessionIdOf(shortId),
      createdAt: header.createdAt,
    }
  }

  /** `persistence.stat` answers a snapshot `{header, revision, ...}`, never a bare header. */
  async _headerOf(id: SessionId): Promise<SessionPersistenceSnapshot | undefined> {
    return await this.persistence.stat(id)
  }

  /**
   * Resolve one session for a caller. An unknown id, an ownerless header and a
   * foreign owner's header are refused identically, before any handle is opened.
   */
  async _ownedHeader(owner: SessionOwner, sessionId: unknown): Promise<SessionHeader> {
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new SessionScopeError(400, 'sessions/invalid-request', 'name the session this request acts on')
    }
    // The request names the session by its own id; dsh brands that id so it
    // cannot be confused with any other string, and the store reads the very
    // same string.
    const snapshot = await this._headerOf(sessionId as SessionId)
    if (snapshot === undefined) {
      throw new SessionScopeError(404, 'sessions/unknown-session', 'no session with that identifier is visible to you')
    }
    if (snapshot.header.owner === undefined) {
      throw new SessionScopeError(403, 'sessions/unowned-session', 'that session carries no ownership record and is never adopted')
    }
    if (snapshot.header.owner !== ownerOf(owner.shortId)) {
      throw new SessionScopeError(404, 'sessions/unknown-session', 'no session with that identifier is visible to you')
    }
    return snapshot.header
  }

  /** Every stored session this identity owns, plus its primary id (or null). Reads headers only. */
  async list(owner: SessionOwner): Promise<{ sessions: SessionHeader[]; primarySessionId: string | null }> {
    const snapshots = await this.persistence.list()
    const owned = snapshots
      .map(snapshot => snapshot.header)
      .filter(header => header.owner === ownerOf(owner.shortId))
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    const primaryId = primarySessionIdOf(owner.shortId)
    return {
      sessions: owned,
      primarySessionId: owned.some(header => header.id === primaryId) ? primaryId : null,
    }
  }

  /** Persist one owned header; a later request resumes the empty session through the agent factory. */
  async _materialize(owner: SessionOwner, id: SessionId): Promise<SessionHeader> {
    const session = this.sessions.prepare(id, { meta: { owner: ownerOf(owner.shortId) } })
    const handle = await this.persistence.create(session.header)
    try {
      await handle.flush()
      return session.header
    } finally {
      await handle.close()
    }
  }

  /**
   * Run `work` as the only operation in flight for one owner, so a `/primary`
   * racing a `/create` cannot both observe "no primary" across their awaits.
   */
  async _exclusively<T>(owner: SessionOwner, work: () => Promise<T>): Promise<T> {
    const key = owner.shortId
    const running = this._inFlight.get(key) ?? Promise.resolve()
    const started = running.then(work, work)
    const tail = started.then(() => {}, () => {})
    this._inFlight.set(key, tail)
    try {
      return await started
    } finally {
      if (this._inFlight.get(key) === tail) this._inFlight.delete(key)
    }
  }

  /** An identity that owns nothing gets its deterministic primary; anyone else gets an ordinary session. */
  async create(owner: SessionOwner): Promise<SessionHeader> {
    return await this._exclusively(owner, async () => {
      const primaryId = primarySessionIdOf(owner.shortId)
      const existing = await this._headerOf(primaryId)
      if (existing === undefined) return await this._materialize(owner, primaryId)
      if (existing.header.owner === undefined) {
        throw new SessionScopeError(409, 'sessions/unowned-primary', 'the reserved primary identifier exists without an owner and is never adopted')
      }
      if (existing.header.owner !== ownerOf(owner.shortId)) {
        throw new SessionScopeError(409, 'sessions/primary-taken', 'the reserved primary identifier belongs to another identity and is never rebound')
      }
      return await this._materialize(owner, sessionIdOf(owner.shortId))
    })
  }

  /** Return the fixed primary session, creating it when it does not exist yet. */
  async primary(owner: SessionOwner): Promise<SessionHeader> {
    return await this._exclusively(owner, async () => {
      const primaryId = primarySessionIdOf(owner.shortId)
      const existing = await this._headerOf(primaryId)
      if (existing === undefined) return await this._materialize(owner, primaryId)
      if (existing.header.owner === undefined) {
        throw new SessionScopeError(409, 'sessions/unowned-primary', 'the reserved primary identifier exists without an owner and is never adopted')
      }
      if (existing.header.owner !== ownerOf(owner.shortId)) {
        throw new SessionScopeError(409, 'sessions/primary-taken', 'the reserved primary identifier belongs to another identity and is never rebound')
      }
      return existing.header
    })
  }

  /** Read one owned session. */
  async read(owner: SessionOwner, sessionId: unknown): Promise<SessionHeader> {
    return await this._ownedHeader(owner, sessionId)
  }
}
