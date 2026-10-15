/**
 * Owned sessions: which authenticated identity a session belongs to, and which
 * of that identity's sessions is its fixed primary session.
 *
 * There is no second ownership index. The **only** authority for ownership is
 * `SessionHeader.owner`, the durable header field dsh already stores and
 * replays (#25). A product database here would be a second source that can
 * disagree with the artifact it describes, so this module has no tables at all.
 *
 * The fixed primary is derived, not stored: an identity's primary session id is
 * a pure function of its permanent, never-recycled short number. That makes the
 * binding identical before and after a restart, needs no extra column, and
 * cannot drift because nobody wrote it down twice.
 *
 * Every read path checks the owner **before** any content is returned and
 * before any path that could open, repair, or rewrite an artifact is taken. The
 * check reads only the stored header (`stat`/`list`), so refusing a foreign or
 * ownerless session leaves the artifact byte-for-byte untouched.
 *
 * @module @ourfairy/dsh-sessions/src/service
 */
import { randomUUID } from 'node:crypto'

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
export class OwnedSessionService {
  #inFlight = new Map()

  /**
   * @param ctx - owning plugin context.
   * @param options - the dsh session store, its persistence, and identity.
   */
  constructor(ctx, { sessions, persistence, identity }) {
    this.ctx = ctx
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
   * Read one stored header without opening a write, recovery, or repair path.
   *
   * @param id - the session id.
   * @returns the stored snapshot, or undefined when nothing is stored under it.
   */
  async #headerOf(id) {
    return await this.persistence.stat(id)
  }

  /**
   * Resolve one session for a caller, refusing anything they do not own.
   *
   * An unknown id, a header with no owner, and a header owned by somebody else
   * are all refused with the same answer, and all are refused before any handle
   * is opened — nothing is adopted, rebound, or repaired.
   *
   * @param owner - the authenticated identity.
   * @param sessionId - the requested session id.
   * @returns the stored header.
   */
  async #ownedHeader(owner, sessionId) {
    if (typeof sessionId !== 'string' || sessionId === '') {
      throw new SessionScopeError(400, 'sessions/invalid-request', 'name the session this request acts on')
    }
    const snapshot = await this.#headerOf(sessionId)
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
   * Listing reads stored headers only. It never creates a session, so a user who
   * has none gets an empty list rather than a side effect.
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
   * The header is persisted explicitly: dsh's persistence keeps a created
   * session unmaterialized until something is appended, so a session created
   * here and never written to would not survive a restart at all.
   *
   * @param owner - the authenticated identity.
   * @param id - the id to mint for this session.
   * @returns the persisted header.
   */
  async #materialize(owner, id) {
    const session = this.sessions.create(id, { meta: { owner: `user:${owner.shortId}` } })
    await this.persistence.persistHeader(session.header, 0)
    return session.header
  }

  /**
   * Run `work` as the single in-flight operation for one owner.
   *
   * Two concurrent first creates (or a create racing a primary request) would
   * otherwise mint two different sessions for the same identity, because the
   * "does this user have a session yet" question and the answer are separated by
   * an await. Coalescing is deliberately per-request state, cleared in `finally`:
   * it is not a lock framework, and it leaves nothing behind when it fails.
   *
   * @param owner - the identity the work belongs to.
   * @param work - the operation to run at most once at a time.
   * @returns whatever `work` resolves to.
   */
  async #exclusively(owner, work) {
    const key = owner.shortId
    const running = this.#inFlight.get(key)
    if (running !== undefined) return await running
    const started = (async () => work())()
    this.#inFlight.set(key, started)
    try {
      return await started
    } finally {
      if (this.#inFlight.get(key) === started) this.#inFlight.delete(key)
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
    return await this.#exclusively(owner, async () => {
      const primaryId = primarySessionIdOf(owner.shortId)
      const existing = await this.#headerOf(primaryId)
      if (existing === undefined) {
        const header = await this.#materialize(owner, primaryId)
        return header
      }
      if (existing.owner === undefined) {
        throw new SessionScopeError(409, 'sessions/unowned-primary', 'the reserved primary identifier exists without an owner and is never adopted')
      }
      if (existing.owner !== `user:${owner.shortId}`) {
        throw new SessionScopeError(409, 'sessions/primary-taken', 'the reserved primary identifier belongs to another identity and is never rebound')
      }
      return await this.#materialize(owner, sessionIdOf(owner.shortId))
    })
  }

  /**
   * Return to the fixed primary session, creating it if it does not exist yet.
   *
   * @param owner - the authenticated identity.
   * @returns the persisted header.
   */
  async primary(owner) {
    return await this.#exclusively(owner, async () => {
      const primaryId = primarySessionIdOf(owner.shortId)
      const existing = await this.#headerOf(primaryId)
      if (existing === undefined) return await this.#materialize(owner, primaryId)
      if (existing.owner === undefined) {
        throw new SessionScopeError(409, 'sessions/unowned-primary', 'the reserved primary identifier exists without an owner and is never adopted')
      }
      if (existing.owner !== `user:${owner.shortId}`) {
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
    return await this.#ownedHeader(owner, sessionId)
  }

  /**
   * Make one owned session the caller's current session.
   *
   * Switching is a client-side choice only: it checks the owner exactly as
   * `read` does and moves no persistent binding.
   *
   * @param owner - the authenticated identity.
   * @param sessionId - the session the client named.
   * @returns the stored header.
   */
  async select(owner, sessionId) {
    return await this.#ownedHeader(owner, sessionId)
  }
}
