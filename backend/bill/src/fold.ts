/**
 * The pure per-session fold: one durable session log in, per-local-day token
 * buckets out.
 *
 * A bill is not a second ledger. Every model call already reports its usage in
 * the session log, so this module only folds that log. The two places usage is
 * recorded are both read here — a settled message's `data.usage` and a retried
 * attempt's own stream — because a retried attempt leaves no message of its own
 * and its tokens would otherwise vanish.
 *
 * One complete turn is folded by dsh's own `deriveTurnTokenUsage`, which fails
 * closed when the lifecycle boundaries, the attempt usage, or the totals do not
 * hold together. This module never repairs such a turn; it is simply absent
 * from the bill, which is the same conservative semantics the rest of the
 * product uses.
 *
 * The day a turn is billed to is the local day it **started**. A turn that
 * begins at 23:59 and closes at 00:05 belongs to the day the interaction
 * began, which is also the day a reader would name when asked when they said
 * it.
 *
 * @module @ourfairy/dsh-bill/fold
 */
import { deriveTurnTokenUsage } from '@deepseek-ai/dsh-token-meter/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * The deployment's civil time zone.
 *
 * Day and month boundaries are cut here, not in UTC: "today" has to mean the
 * user's today. The name is a constant because every boundary in the product —
 * this fold, the aggregate's today/month windows, and the 30-day series — must
 * cut in the same zone.
 */
export const TIME_ZONE = 'Asia/Shanghai'

/** One day's token totals: the four provider buckets, which are disjoint. */
export interface TokenBuckets {
  /** Uncached prompt input. */
  readonly inputTokens: number
  /** Prompt tokens served from the provider's cache. */
  readonly cacheReadTokens: number
  /** Prompt tokens written to the provider's cache. */
  readonly cacheWriteTokens: number
  /** Completion tokens, including reasoning. */
  readonly outputTokens: number
}

/** One local day's totals, keyed by its civil date (`YYYY-MM-DD`). */
export interface DailyTokens {
  /** The local civil date in {@link TIME_ZONE}. */
  readonly day: string
  /** That day's four disjoint buckets. */
  readonly tokens: TokenBuckets
}

/** All four buckets at zero; a fresh accumulator and the public empty value. */
export function zeroBuckets(): TokenBuckets {
  return { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }
}

/** Sum two bucket records. */
export function addBuckets(left: TokenBuckets, right: TokenBuckets): TokenBuckets {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    cacheReadTokens: left.cacheReadTokens + right.cacheReadTokens,
    cacheWriteTokens: left.cacheWriteTokens + right.cacheWriteTokens,
    outputTokens: left.outputTokens + right.outputTokens,
  }
}

/**
 * The local civil date one instant falls on in {@link TIME_ZONE}.
 * @param time - the instant, in epoch milliseconds.
 * @returns `YYYY-MM-DD` in the deployment's zone.
 */
export function localDay(time: number): string {
  // `en-CA` formats as YYYY-MM-DD, which is the key the aggregate compares and
  // sorts by. Formatting (rather than date arithmetic) is what makes the
  // zone's own DST and offset rules decide the boundary.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(time))
}

/** One complete turn, located at the seq range and start time it occupied. */
export interface TurnSpan {
  /** The local civil date the turn started on. */
  readonly day: string
  /** The turn's events, `turn/start` through `turn/end`. */
  readonly events: readonly SessionEvent[]
}

/**
 * Split one session log into its complete turns.
 *
 * A turn that never saw `turn/end` is dropped: the process died inside it, so
 * nothing proves its usage was complete. Everything before the first
 * `turn/start` belongs to no turn and is dropped with it.
 * @param events - one session's whole durable log, in seq order.
 * @returns the complete turns, in log order.
 */
export function turnSpans(events: readonly SessionEvent[]): TurnSpan[] {
  const spans: TurnSpan[] = []
  let open: { day: string, events: SessionEvent[] } | undefined
  for (const event of events) {
    if (event.type === 'turn/start') {
      // A `turn/start` inside an open turn means the log does not describe
      // turns we can trust; the safer reading is to abandon the open one.
      open = { day: localDay(event.time), events: [event] }
      continue
    }
    if (open === undefined) continue
    open.events.push(event)
    if (event.type === 'turn/end') {
      spans.push(open)
      open = undefined
    }
  }
  return spans
}

/**
 * Fold one session's log into its per-day token totals.
 *
 * Days with no tokens are absent rather than zero: the caller's series builder
 * is what fills the gaps, and a fold that padded them would have to know how
 * far back the series reaches.
 * @param events - one session's whole durable log, in seq order.
 * @returns one entry per local day that has usage, oldest first.
 */
export function foldDailyTokens(events: readonly SessionEvent[]): DailyTokens[] {
  const byDay = new Map<string, TokenBuckets>()
  for (const span of turnSpans(events)) {
    const usage = deriveTurnTokenUsage(span.events)
    if (usage === undefined) continue
    const buckets: TokenBuckets = {
      inputTokens: usage.uncachedInputTokens,
      cacheReadTokens: usage.cacheReadTokens ?? 0,
      cacheWriteTokens: usage.cacheWriteTokens ?? 0,
      outputTokens: usage.outputTokens,
    }
    // A turn that reported nothing is not a day with zero usage; skip it so an
    // all-silent log folds to an empty bill rather than a zero row.
    if (buckets.inputTokens === 0 && buckets.cacheReadTokens === 0
      && buckets.cacheWriteTokens === 0 && buckets.outputTokens === 0) continue
    byDay.set(span.day, addBuckets(byDay.get(span.day) ?? zeroBuckets(), buckets))
  }
  return [...byDay.entries()]
    .map(([day, tokens]) => ({ day, tokens }))
    .sort((left, right) => left.day.localeCompare(right.day))
}
