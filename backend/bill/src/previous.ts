/**
 * Which completed interaction a reading reports, and what it cost.
 *
 * "The previous interaction" is a fact about this session's own log, and the
 * question the channel has to answer is fixed for a whole turn: it is the last
 * turn that closed before the one now open. Locating it needs the open turn's
 * start — which is what dsh's `turnBoundary` projection carries, because the
 * Agent interface exposes no turn or step — and pricing it reuses the bill's
 * own fold, so the number in her context and the number on the bill page come
 * from `deriveTurnTokenUsage` alike.
 *
 * A turn that closed without the provider reporting usage is not a zero: the
 * fold refuses to produce a total, and the reading says so. A turn that made no
 * model call at all is the same fact from the reader's side — there is no
 * interaction to price — so the search continues to the last turn that has one.
 *
 * @module @ourfairy/dsh-bill/previous
 */
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import { turnSpans, type TokenBuckets } from './fold.js'
import type { PreviousReading } from './reading.js'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** The four disjoint buckets one completed turn settled, or `undefined` when unprovable. */
function settledBuckets(events: readonly SessionEvent[]): TokenBuckets | undefined {
  const usage = deriveTurnTokenUsage(events)
  if (usage === undefined) return undefined
  return {
    inputTokens: usage.uncachedInputTokens,
    cacheReadTokens: usage.cacheReadTokens ?? 0,
    cacheWriteTokens: usage.cacheWriteTokens ?? 0,
    outputTokens: usage.outputTokens,
  }
}

/**
 * Price the last completed interaction before the open turn.
 *
 * The whole per-turn fold lives in {@link turnSpans} + `deriveTurnTokenUsage`;
 * this function only decides *which* turn is the one to report.
 * @param events - this session's log, in seq order.
 * @param openTurnStartSeq - seq of the open turn's `turn/start`, or `null`
 *   when no turn is open (the last completed turn is then the previous one).
 * @returns the previous interaction's settled total, that there is none yet, or
 *   that a completed turn exists whose usage cannot be proven.
 */
export function previousInteraction(
  events: readonly SessionEvent[],
  openTurnStartSeq: number | null,
): PreviousReading {
  const completed = turnSpans(events)
    // A turn that began after the open one cannot have closed before it; the
    // filter also keeps a resumed log's inherited prefix from outranking it.
    .filter(span => openTurnStartSeq === null || (span.events[0]?.seq ?? 0) < openTurnStartSeq)
  for (let index = completed.length - 1; index >= 0; index -= 1) {
    const tokens = settledBuckets((completed[index] as { events: readonly SessionEvent[] }).events)
    if (tokens !== undefined) return { kind: 'settled', tokens }
  }
  // No closed turn at all is the first-turn case; closed turns that all refuse
  // to price are the "usage was never reported" case, and they read differently.
  return completed.length === 0 ? { kind: 'none' } : { kind: 'unavailable' }
}
