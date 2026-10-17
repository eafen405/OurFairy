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
import { Service } from '@deepseek-ai/cordis'
import { ownerOf } from '@ourfairy/dsh-identity/owner'

/** Error carrying the HTTP status one request path answers with. */
export class SessionScopeError extends Error {
  constructor(status, code, message) {
    super(message)
    this.name = 'SessionScopeError'
    this.status = status
    this.code = code
  }
}

/**
 * The deterministic primary session id of one identity. The `ourfairy-user-`
 * namespace is this product's own, so a primary id cannot collide with a native
 * `session-<n>` id.
 */
export function primarySessionIdOf(shortId) {
  return `ourfairy-user-${Number(shortId)}-primary`
}

/**
 * A fresh ordinary (non-primary) session id for one identity. A UUID, because
 * the native `session-<n>` counter restarts at 1 after a process restart.
 */
export function sessionIdOf(shortId) {
  return `ourfairy-user-${Number(shortId)}-${randomUUID()}`
}

/** The product-owned service the composition reads as `ctx.ourfairySessions`. */
export class OwnedSessionService extends Service {
  _inFlight = new Map()

  constructor(ctx, { sessions, persistence, identity }) {
    super(ctx, 'ourfairySessions')
    this.sessions = sessions
    this.persistence = persistence
    this.identity = identity
  }

  /** The user the presented credential speaks for, or undefined. */
  authenticate(request) {
    return this.identity.authenticateRequest(request)
  }

  /** One session as the product exposes it. */
  expose(header, shortId) {
    return {
      id: header.id,
      owner: header.owner ?? null,
      primary: header.id === primarySessionIdOf(shortId),
      createdAt: header.createdAt,
    }
  }

  /** `persistence.stat` answers a snapshot `{header, revision, ...}`, never a bare header. */
  async _headerOf(id) {
    return await this.persistence.stat(id)
  }

  /**
   * Resolve one session for a caller. An unknown id, an ownerless header and a
   * foreign owner's header are refused identically, before any handle is opened.
   */
  async _ownedHeader(owner, sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new SessionScopeError(400, 'sessions/invalid-request', 'name the session this request acts on')
    }
    const snapshot = await this._headerOf(sessionId)
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
  async list(owner) {
    const snapshots = await this.persistence.list()
    const owned = snapshots
      .map(snapshot => snapshot.header)
      .filter(header => header.owner === ownerOf(owner.shortId))
      .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0) || left.id.localeCompare(right.id))
    const primaryId = primarySessionIdOf(owner.shortId)
    return {
      sessions: owned,
      primarySessionId: owned.some(header => header.id === primaryId) ? primaryId : null,
    }
  }

  /** Persist one owned header; a later request resumes the empty session through the agent factory. */
  async _materialize(owner, id) {
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
  async _exclusively(owner, work) {
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
  async create(owner) {
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
  async primary(owner) {
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
  async read(owner, sessionId) {
    return await this._ownedHeader(owner, sessionId)
  }
}
