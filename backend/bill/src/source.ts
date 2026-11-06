/**
 * The session facts the bill reads, resolved from the running composition.
 *
 * This is the only module that knows where session logs live. It maps dsh's
 * session services onto {@link BillSource}:
 *
 * - `list` is the cheap header observation (`sessionPersistence.list()`), which
 *   is what makes the session count visible without reading a byte of log.
 * - `stat` is the per-session revision. It must be called per session: the
 *   header listing does not carry a revision.
 * - `read` loads and replay-validates one log through the native query service,
 *   which is live-preferred: a session this process is running answers from its
 *   in-memory snapshot, a cold one from storage. That is the different path the
 *   live case takes, and why the aggregate never revision-guards it.
 *
 * A created-but-unwritten session reports a revision minted at creation that
 * never moves, so it is reported as not materialized (its `sizeBytes` is
 * absent) and the aggregate refuses to cache it.
 *
 * @module @ourfairy/dsh-bill/source
 */
import type { BillSessionHeader, BillSessionRevision, BillSource } from './aggregate.js'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-query'

/**
 * The slice of the dsh context this adapter reads.
 *
 * The context itself satisfies it. Stating the three services here (rather than
 * importing the whole context type) keeps the adapter's dependency exactly the
 * three seams it uses, which is what lets the row's type-check catch a read of
 * something it did not declare.
 */
export interface BillSessionServices {
  readonly sessions: {
    get(id: SessionId): unknown
  }
  readonly sessionPersistence: {
    list(): Promise<readonly { readonly header: { readonly id: SessionId }, readonly sizeBytes?: number }[]>
    stat(id: SessionId): Promise<{ readonly header: { readonly id: SessionId }, readonly revision: string, readonly sizeBytes?: number } | undefined>
  }
  readonly sessionQuery: {
    readSession(id: SessionId): Promise<{ readonly events: readonly SessionEvent[] }>
  }
}

/**
 * Resolve the bill's session facts from the composition's own services.
 * @param ctx - the context carrying the three services.
 * @returns the source the aggregate reads.
 */
export function sessionSource(ctx: BillSessionServices): BillSource {
  return {
    async list(): Promise<readonly BillSessionHeader[]> {
      const snapshots = await ctx.sessionPersistence.list()
      return snapshots.map(({ header }) => ({ id: header.id, live: ctx.sessions.get(header.id) !== undefined }))
    },
    async stat(id: string): Promise<BillSessionRevision | undefined> {
      const snapshot = await ctx.sessionPersistence.stat(id as SessionId)
      if (snapshot === undefined) return undefined
      // `sizeBytes` is present only for a real artifact. Its absence is the
      // materialization fact this adapter knows and the aggregate must not.
      return { revision: snapshot.revision, materialized: snapshot.sizeBytes !== undefined }
    },
    async read(id: string): Promise<readonly SessionEvent[]> {
      const snapshot = await ctx.sessionQuery.readSession(id as SessionId)
      return snapshot.events
    },
  }
}
