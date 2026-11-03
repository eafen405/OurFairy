/**
 * One safe, one-shot read of a session's event stream, plus the title facts
 * derivable from a stored log.
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
 * Titles are read through `sessionQuery.readTitleSnapshots`: it folds the
 * log-only `session/title` events for a whole batch, using one persistence
 * listing and no live agent. A session that has no title event (every session
 * written before the title rows were mounted) gets the same deterministic
 * fallback dsh would have written, derived here from the first human message.
 * That derivation is read-only: it never appends an event and never calls a
 * model.
 *
 * @module @ourfairy/dsh-sessions/src/events
 */
import type { Context } from '@deepseek-ai/cordis'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface'
import { fallbackSessionTitle, normalizeSessionTitle } from '@deepseek-ai/dsh-session-title'
import type { SessionEvent, SessionId, SessionSeqCursor } from '@deepseek-ai/dsh-session'
import type { SessionTitleSnapshot } from '@deepseek-ai/dsh-session-title'
// The dsh context's own seam: the session query service this read observes.
import type {} from '@deepseek-ai/dsh-session-query'

/** Maximum whitespace-delimited words in the deterministic fallback title. */
export const FALLBACK_MAX_WORDS = 5
/** Maximum UTF-8 bytes in the deterministic fallback title. */
export const FALLBACK_MAX_BYTES = 40
/** Maximum UTF-8 bytes in any accepted title, fallback or model. */
export const MAX_TITLE_BYTES = 80

/**
 * Wire codes for where a session title came from.
 *
 * AGENTS.md requires one numeric encoding for a finite enum on both the
 * interface and the client; the Android client mirrors these three numbers.
 * The source is meaningful only when `title` is non-empty.
 */
export const TITLE_SOURCE = Object.freeze({ fallback: 0, provider: 1, user: 2 })

/** One wire title source code. */
export type TitleSourceCode = (typeof TITLE_SOURCE)[keyof typeof TITLE_SOURCE]

/** The title fact one session exposes on the wire. */
export interface SessionTitleFact {
  /** Normalized non-empty title text, or the empty string when there is none. */
  readonly title: string
  /** Where the title came from; meaningful only when {@link title} is non-empty. */
  readonly source: TitleSourceCode
}

/** The title of a session with no derivable title. */
export const NO_TITLE: SessionTitleFact = Object.freeze({ title: '', source: TITLE_SOURCE.fallback })

/** Wire code of one logged title source. */
const TITLE_SOURCE_OF = Object.freeze({
  fallback: TITLE_SOURCE.fallback,
  provider: TITLE_SOURCE.provider,
  user: TITLE_SOURCE.user,
} as const)

/**
 * Map one logged title snapshot onto the wire fact.
 * @param snapshot - the folded `session/title` snapshot.
 * @returns the title text and its numeric source code.
 */
export function titleFactOf(snapshot: Pick<SessionTitleSnapshot, 'title' | 'source'>): SessionTitleFact {
  return { title: snapshot.title, source: TITLE_SOURCE_OF[snapshot.source.kind] }
}

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
 * The text of the first eligible human message in one log.
 *
 * Eligibility is dsh's own rule for title input: an append-origin
 * `user/message` whose source is the user, with at least one visible character
 * after normalization. The text blocks are joined with a newline exactly as
 * the native title input does.
 *
 * @param events - one session's events, in seq order.
 * @returns the first eligible message text, or undefined.
 */
export function firstHumanMessageText(events: readonly SessionEvent[]): string | undefined {
  for (const event of events) {
    if (event.type !== 'user/message' || !isAppendSurfaceEvent(event)) continue
    if (event.data.source.kind !== 'user') continue
    const text = event.data.content
      .filter((block): block is Extract<(typeof event.data.content)[number], { type: 'text' }> => block.type === 'text')
      .map(block => block.text)
      .join('\n')
    if (normalizeSessionTitle(text, Number.MAX_SAFE_INTEGER).length === 0) continue
    return text
  }
  return undefined
}

/**
 * Derive the read-only fallback title for one stored log.
 *
 * This is the same text `session-title` would append on the first human
 * message, computed without writing it; an empty result means the session has
 * no title to show.
 *
 * @param events - one session's events, in seq order.
 * @returns the fallback title fact, or {@link NO_TITLE}.
 */
export function deriveFallbackTitle(events: readonly SessionEvent[]): SessionTitleFact {
  const text = firstHumanMessageText(events)
  if (text === undefined) return NO_TITLE
  const title = fallbackSessionTitle(text, FALLBACK_MAX_WORDS, FALLBACK_MAX_BYTES)
  return title === '' ? NO_TITLE : { title, source: TITLE_SOURCE.fallback }
}

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

/**
 * Read the title of every named session in one batch.
 *
 * One `readTitleSnapshots` call folds every stored title with a single
 * persistence listing. Only the sessions it reports without a title need their
 * events read, and that read is the existing one-shot observation. A log that
 * cannot be read keeps the list available: the session answers an empty title
 * and the client shows its placeholder.
 *
 * @param ctx - any context carrying dsh's `sessionQuery`.
 * @param sessionIds - the sessions to title, in the caller's order.
 * @returns one title fact per requested session.
 */
export async function readSessionTitles(
  ctx: Context,
  sessionIds: readonly SessionId[],
): Promise<Map<SessionId, SessionTitleFact>> {
  const titles = new Map<SessionId, SessionTitleFact>()
  const unique = [...new Set(sessionIds)]
  if (unique.length === 0) return titles
  const observations = await ctx.sessionQuery.readTitleSnapshots(unique)
  const untitled: SessionId[] = []
  for (const observation of observations) {
    if (observation.status === 'fulfilled' && observation.value.title !== undefined) {
      titles.set(observation.sessionId, titleFactOf(observation.value.title))
    } else {
      untitled.push(observation.sessionId)
    }
  }
  for (const sessionId of untitled) {
    try {
      titles.set(sessionId, deriveFallbackTitle((await readSessionEvents(ctx, sessionId)).events))
    } catch {
      titles.set(sessionId, NO_TITLE)
    }
  }
  return titles
}
