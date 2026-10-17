/**
 * Owned sessions: which authenticated identity a session belongs to, and which
 * of that identity's sessions is its fixed primary session.
 *
 * Ownership authority is `SessionHeader.owner` alone — no second index, table,
 * or database. A user's primary id is derived from their permanent short number,
 * so the binding needs no stored column and cannot drift.
 *
 * Every read path checks the owner before returning content or before any path
 * that could open, repair, or rewrite an artifact, using only the stored header
 * (`stat`/`list`).
 *
 * @module @ourfairy/dsh-sessions/src/service
 */
import { randomUUID } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'

/** Error carrying the HTTP status one request path must answer with. */
export class SessionScopeError extends Error {
  /**
   * @param status - HTTP status the caller answers with.
   * @param code - stable machine-readable reason.
   * @param message - human-readable explanation.
   */
  constructor(status, code, message) {
    super(message)
    this.name = 'SessionScopeError'
    this.status = status
    this.code = code
  }
}

/**
 * The one rule that names an identity's fixed primary session.
 *
 * The namespace is reserved for this product and disjoint from both the store's
 * `session-<n>` ids and the ordinary sessions minted below, so a primary id can
 * never collide with anything the store or a client chose.
 *
 * @param shortId - the identity's permanent short number.
 * @returns the deterministic primary session id.
 */
export function primarySessionIdOf(shortId) {
  return `ourfairy-user-${Number(shortId)}-primary`
}

/**
 * The id of one ordinary (non-primary) session of an identity.
 *
 * A UUID, never the store's process-local `session-<n>` counter: that counter
 * restarts at 1, so after a restart it would hand out an id that already belongs
 * to a persisted session.
 *
 * @param shortId - the identity's permanent short number.
 * @returns a fresh session id in this product's own namespace.
 */
export function sessionIdOf(shortId) {
  return `ourfairy-user-${Number(shortId)}-${randomUUID()}`
}

/** The product-owned service the composition reads as `ctx.ourfairySessions`. */
export class OwnedSessionService extends Service {
  _inFlight = new Map()

  /**
   * @param ctx - owning plugin context.
   * @param options - the dsh session store, its persistence, and identity.
   */
  constructor(ctx, { sessions, persistence, identity }) {
    super(ctx, 'ourfairySessions')
    this.sessions = sessions
    this.persistence = persistence
    this.identity = identity
  }

  /**
   * The identity one request speaks for, or undefined.
   *
   * The caller is derived only from the presented credential. Nothing in a
   * request body can name a different user.
   *
   * @param request - the node:http request.
   * @returns the authenticated user, or undefined.
   */
  authenticate(request) {
    return this.identity.authenticateRequest(request)
  }

  /**
   * One session as the product exposes it.
   *
   * @param header - a stored or live session header.
   * @param shortId - the requesting identity's short number.
   * @returns the public fields, including whether this is the owner's primary.
   */
  expose(header, shortId) {
    return {
      id: header.id,
      owner: header.owner ?? null,
      primary: header.id === primarySessionIdOf(shortId),
      createdAt: header.createdAt,
    }
  }

  /**
   * Read one stored snapshot without opening a write, recovery, or repair path.
   *
   * `persistence.stat` answers with a snapshot `{header, revision, ...}`, not a
   * bare header; every owner check below reads `snapshot.header.owner`.
   *
   * @param id - the session id.
   * @returns the stored snapshot, or undefined when nothing is stored under it.
   */
  async _headerOf(id) {
    return await this.persistence.stat(id)
  }

  /**
   * Resolve one session for a caller, refusing anything they do not own.
   *
   * An unknown id, an ownerless header, and a foreign owner's header are refused
   * with the same answer, before any handle is opened: nothing is adopted,
   * rebound, or repaired.
   *
   * @param owner - the authenticated identity.
   * @param sessionId - the requested session id.
   * @returns the stored header.
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
    if (snapshot.header.owner !== `user:${owner.shortId}`) {
      throw new SessionScopeError(404, 'sessions/unknown-session', 'no session with that identifier is visible to you')
    }
    return snapshot.header
  }

  /**
   * Every stored session this identity owns, and its primary.
   *
   * Listing reads stored headers only and never creates a session.
   *
   * @param owner - the authenticated identity.
   * @returns the owned headers plus the primary session id (or null).
   */
  async list(owner) {
    const snapshots = await this.persistence.list()
    const owned = snapshots
      .map(snapshot => snapshot.header)
      .filter(header => header.owner === `user:${owner.shortId}`)
      .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0) || left.id.localeCompare(right.id))
    const primaryId = primarySessionIdOf(owner.shortId)
    return {
      sessions: owned,
      primarySessionId: owned.some(header => header.id === primaryId) ? primaryId : null,
    }
  }

  /**
   * Materialize one session durably, owned by the given identity.
   *
   * Only persist the header here; the agent factory owns live publication and
   * write ownership when a later request resumes this empty session.
   *
   * @param owner - the authenticated identity.
   * @param id - the id to mint for this session.
   * @returns the persisted header.
   */
  async _materialize(owner, id) {
    const session = this.sessions.prepare(id, { meta: { owner: `user:${owner.shortId}` } })
    const handle = await this.persistence.create(session.header)
    try {
      await handle.flush()
      return session.header
    } finally {
      await handle.close()
    }
  }

  /**
   * Run `work` as the only operation in flight for one owner.
   *
   * "Does this identity already have a primary" and the answer that mints one are
   * separated by an await, so two overlapping operations could both answer "no"
   * and both mint. Serializing (not coalescing) keeps them honest: a `/primary`
   * racing a `/create` runs after it, and still resolves the deterministic main,
   * rather than inheriting whichever ordinary session the other call minted.
   *
   * The queue is per-request state cleared in `finally` — no lock framework, and
   * a failed operation leaves nothing behind for the next one.
   *
   * @param owner - the identity the work belongs to.
   * @param work - the operation to run at most once at a time.
   * @returns whatever `work` resolves to.
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

  /**
   * Create one session for an identity.
   *
   * An identity that owns nothing gets its deterministic primary; anyone else
   * gets a new ordinary session. Creating never moves an existing primary, and
   * the client supplies neither an id nor an owner.
   *
   * @param owner - the authenticated identity.
   * @returns the persisted header.
   */
  async create(owner) {
    return await this._exclusively(owner, async () => {
      const primaryId = primarySessionIdOf(owner.shortId)
      const existing = await this._headerOf(primaryId)
      if (existing === undefined) {
        const header = await this._materialize(owner, primaryId)
        return header
      }
      if (existing.header.owner === undefined) {
        throw new SessionScopeError(409, 'sessions/unowned-primary', 'the reserved primary identifier exists without an owner and is never adopted')
      }
      if (existing.header.owner !== `user:${owner.shortId}`) {
        throw new SessionScopeError(409, 'sessions/primary-taken', 'the reserved primary identifier belongs to another identity and is never rebound')
      }
      return await this._materialize(owner, sessionIdOf(owner.shortId))
    })
  }

  /**
   * Return to the fixed primary session, creating it if it does not exist yet.
   *
   * @param owner - the authenticated identity.
   * @returns the persisted header.
   */
  async primary(owner) {
    return await this._exclusively(owner, async () => {
      const primaryId = primarySessionIdOf(owner.shortId)
      const existing = await this._headerOf(primaryId)
      if (existing === undefined) return await this._materialize(owner, primaryId)
      if (existing.header.owner === undefined) {
        throw new SessionScopeError(409, 'sessions/unowned-primary', 'the reserved primary identifier exists without an owner and is never adopted')
      }
      if (existing.header.owner !== `user:${owner.shortId}`) {
        throw new SessionScopeError(409, 'sessions/primary-taken', 'the reserved primary identifier belongs to another identity and is never rebound')
      }
      return existing.header
    })
  }

  /**
   * Read one owned session.
   *
   * @param owner - the authenticated identity.
   * @param sessionId - the session the client named.
   * @returns the stored header.
   */
  async read(owner, sessionId) {
    return await this._ownedHeader(owner, sessionId)
  }

  /**
   * Make one owned session the caller's current session.
   *
   * Switching is a client-side choice only: it delegates to {@link read} and
   * moves no persistent binding, so the two answer identically. It stays a
   * separate name because "which session is current" is a real product concept
   * and the client contract has its own path for it; if switching ever gains a
   * persisted effect, this is where it goes and only this method changes.
   *
   * @param owner - the authenticated identity.
   * @param sessionId - the session the client named.
   * @returns the stored header.
   */
  async select(owner, sessionId) {
    return await this.read(owner, sessionId)
  }
}
