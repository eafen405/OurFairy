/**
 * Owned sessions: which authenticated identity a session belongs to, which of
 * that identity's sessions is its fixed primary session, and which sessions the
 * caller has archived.
 *
 * `SessionHeader.owner` is the only ownership authority. A user's primary id is
 * derived from their permanent short number, so the binding needs no stored
 * column. Archiving is the one product fact this module stores itself, in its
 * own file (`./archive-store`): it is scoped to the caller but never becomes a
 * second owner.
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
import type { SessionArchiveStore } from './archive-store.js'
import { hasMessages, NO_TITLE, readSessionEvents, readSessionTitles, type SessionTitleFact } from './events.js'

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
  /** The product's archive rows: one per session, scoped to the caller. */
  readonly archiveStore: SessionArchiveStore

  constructor(ctx: Context, { sessions, persistence, identity, archive }: {
    sessions: SessionStore
    persistence: SessionPersistence
    identity: IdentityService
    archive: SessionArchiveStore
  }) {
    super(ctx, 'ourfairySessions')
    this.sessions = sessions
    this.persistence = persistence
    this.identity = identity
    this.archiveStore = archive
  }

  /** The user the presented credential speaks for, or undefined. */
  authenticate(request: IncomingMessage): SessionOwner | undefined {
    return this.identity.authenticateRequest(request)
  }

  /** One session as the product exposes it. */
  expose(header: SessionHeader, shortId: number, title: SessionTitleFact = NO_TITLE): {
    id: string
    owner: string | null
    primary: boolean
    createdAt: number
    title: string
    titleSource: number
  } {
    return {
      id: header.id,
      owner: header.owner ?? null,
      primary: header.id === primarySessionIdOf(shortId),
      createdAt: header.createdAt,
      title: title.title,
      titleSource: title.source,
    }
  }

  /**
   * Fold the titles of a batch of sessions for the wire.
   *
   * One batch read is what keeps `/sessions/list` to one pass over the stored
   * titles; the read is the `./events` authority and never opens an agent.
   */
  async titlesOf(sessionIds: readonly SessionId[]): Promise<Map<SessionId, SessionTitleFact>> {
    return await readSessionTitles(this.ctx, sessionIds)
  }

  /** The title fact of one session; the single-session form of {@link titlesOf}. */
  async titleOf(sessionId: SessionId): Promise<SessionTitleFact> {
    return (await this.titlesOf([sessionId])).get(sessionId) ?? NO_TITLE
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

  /**
   * Every stored session this identity owns in the requested view, plus the
   * primary id when that session appears in the view. Reads headers only.
   *
   * This is the archive's only filter point. The default view excludes archived
   * sessions, which is what also keeps them out of the empty-session reuse
   * (`_newestEmptyOrdinary` lists), out of conversation search (the search tool
   * lists), and out of every other caller that asks this module what the user
   * has. Adding a per-caller filter would be a second authority for the same
   * fact.
   *
   * The archived view never carries the primary session: the primary is the
   * delivery target and cannot be archived. It answers no standing default for
   * the same reason — a session that is not in the view cannot be the one the
   * view stands in.
   */
  async list(owner: SessionOwner, { archived = false }: { archived?: boolean } = {}): Promise<{
    sessions: SessionHeader[]
    primarySessionId: string | null
  }> {
    const snapshots = await this.persistence.list()
    const archivedIds = this.archiveStore.archivedSessionIds(owner.shortId)
    const archivedRank = new Map(archivedIds.map((id, index) => [id, index]))
    const owned = snapshots.map(snapshot => snapshot.header).filter(header => header.owner === ownerOf(owner.shortId))
    const sessions = archived
      // The archived view keeps the order the store answered: most recently
      // archived first. Creation order would bury the session just deleted, and
      // the archive instant is recorded for exactly this.
      ? owned
        .filter(header => archivedRank.has(header.id))
        .sort((left, right) => (archivedRank.get(left.id) as number) - (archivedRank.get(right.id) as number))
      : owned
        .filter(header => !archivedRank.has(header.id))
        .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    const primaryId = primarySessionIdOf(owner.shortId)
    return {
      sessions,
      primarySessionId: sessions.some(header => header.id === primaryId) ? primaryId : null,
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

  /**
   * Whether one session's log carries no message, so create may enter it again.
   *
   * The read is the one-shot `./events` observation; nothing here projects or
   * interprets the events beyond asking whether a message is present.
   */
  async _isEmpty(sessionId: SessionId): Promise<boolean> {
    return !hasMessages((await readSessionEvents(this.ctx, sessionId)).events)
  }

  /**
   * The newest empty ordinary session of one owner, or undefined when every
   * ordinary session already has content. `list` orders by createdAt ascending,
   * so the reverse walk answers "newest first" without a second sort.
   */
  async _newestEmptyOrdinary(owner: SessionOwner): Promise<SessionHeader | undefined> {
    const primaryId = primarySessionIdOf(owner.shortId)
    const { sessions } = await this.list(owner)
    for (let index = sessions.length - 1; index >= 0; index -= 1) {
      const header = sessions[index] as SessionHeader
      if (header.id === primaryId) continue
      if (await this._isEmpty(header.id)) return header
    }
    return undefined
  }

  /**
   * Enter the identity's empty session, or create one when there is none.
   *
   * An identity that owns nothing gets its deterministic primary. Once the
   * primary exists and belongs to the caller, an empty log is entered again
   * rather than duplicated: the primary while it is still empty, otherwise the
   * newest empty ordinary session. Only a session whose log already carries a
   * message forces a new ordinary session.
   */
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
      if (await this._isEmpty(primaryId)) return existing.header
      const empty = await this._newestEmptyOrdinary(owner)
      if (empty !== undefined) return empty
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

  /**
   * Archive one owned session: stop offering it in the default views while its
   * log, its messages and its history stay exactly where they are.
   *
   * The primary session is refused here, not only hidden by a client. It is
   * where replies, deliveries and notifications land, so archiving it would
   * lose the place they land; the caller gets its own code for that rather than
   * being told the session does not exist.
   *
   * Authorization is the header's, like every other route: a session the caller
   * does not own is refused before the archive is touched, so one identity can
   * neither archive nor disturb another's.
   */
  async archive(owner: SessionOwner, sessionId: unknown): Promise<SessionHeader> {
    const header = await this._ownedHeader(owner, sessionId)
    if (header.id === primarySessionIdOf(owner.shortId)) {
      throw new SessionScopeError(409, 'sessions/primary-not-archivable',
        'the primary session is where replies land and is never archived')
    }
    this.archiveStore.archive({ sessionId: header.id, ownerShortId: owner.shortId })
    return header
  }

  /**
   * Restore one session the caller archived: it goes back into the default
   * views with its log, its messages and its history untouched — restoring
   * writes the archive row, never a session log.
   *
   * Authorization is the header's, like every other route, so a session the
   * caller does not own is refused before the archive is looked at. Then the
   * row itself must be this caller's and archived: a session that is not
   * archived — including the primary, which can never be — answers its own code
   * rather than "unknown session", because the session does exist and saying
   * otherwise would hide the real reason. Nothing is written in that case.
   */
  async restore(owner: SessionOwner, sessionId: unknown): Promise<SessionHeader> {
    const header = await this._ownedHeader(owner, sessionId)
    if (!this.archiveStore.restore({ sessionId: header.id, ownerShortId: owner.shortId })) {
      throw new SessionScopeError(409, 'sessions/not-archived', 'that session is not in your archive')
    }
    return header
  }
}
