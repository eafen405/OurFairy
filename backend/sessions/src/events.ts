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
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import type { SessionEvent, SessionId, SessionSeqCursor } from '@deepseek-ai/dsh-session'
// The dsh context's own seam: the session query service this read observes.
import type {} from '@deepseek-ai/dsh-session-query'

/**
 * Whether a session's log already carries a message.
 *
 * The product's create path reuses a session while its log has no message, so
 * this predicate is the single authority for "empty". It is deliberately
 * narrow: only append-origin message events count, so a replacement copy or a
 * non-message event (attempt, job, inbox splice) does not make a session
 * non-empty on its own. A tool-jobs report is a `user/message`, so it counts.
 *
 * @param events - one session's events, as {@link readSessionEvents} returns them.
 * @returns true when at least one message event is present.
 */
export function hasMessages(events: readonly SessionEvent[]): boolean {
  return events.some(event => MESSAGE_EVENT_TYPES.has(event.type) && isAppendSurfaceEvent(event))
}

/** The message-bearing surface event types a human transcript is built from. */
const MESSAGE_EVENT_TYPES = new Set<string>(['user/message', 'assistant/message', 'delivery/message'])

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
