/**
 * One safe, one-shot read of a session's event stream.
 *
 * `observeSession` hands back a live observation that holds its resources until
 * it is disposed. A caller that wants only a snapshot must release it in a
 * `finally` and detach `events`/`cursor` from the observation. Chat and
 * attachments both need exactly that read, so this module owns it instead of
 * each caller keeping its own copy of the pattern.
 *
 * No projection is requested: the callers project from the raw events
 * themselves, so the observation must not pay for a projection it discards.
 *
 * @module @ourfairy/dsh-sessions/src/events
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionId, SessionSeqCursor } from '@deepseek-ai/dsh-session'
// The dsh context's own seam: the session query service this read observes.
import type {} from '@deepseek-ai/dsh-session-query'

/**
 * Read one session's events and cursor once, then release the observation.
 *
 * @param ctx - any context carrying dsh's `sessionQuery`.
 * @param sessionId - the session to read.
 * @returns the observed events and the cursor the observation stopped at.
 */
export async function readSessionEvents(ctx: Context, sessionId: SessionId): Promise<{
  events: readonly SessionEvent[]
  cursor: SessionSeqCursor
}> {
  const observation = await ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
  try { return { events: observation.events, cursor: observation.cursor } }
  finally { observation[Symbol.dispose]() }
}
