/**
 * The bills's model-visible reading: the one or two sentences appended to the
 * end of a user session's runtime context.
 *
 * This module is pure. It takes the two facts the reading is made of — the
 * settled total of the previous completed turn, and this local day's total —
 * and renders them. Everything that makes those facts true (which turn is
 * "previous", where the day total comes from) is the row's job, because it
 * needs I/O that a synchronous provider may not do.
 *
 * Two throttles live here, and both are load-bearing rather than cosmetic. The
 * runtime-context channel only ever appends: it never rewrites the snapshot it
 * wrote before. A value that drifts inside a turn would therefore leave one
 * permanent message per drift. The previous interaction is reported to the
 * whole Denny because it cannot drift at all inside a turn; the day total is
 * reported in 10 000-Denny steps because it is a running total, and a step that
 * moves about four times a day costs about four snapshots a day.
 *
 * @module @ourfairy/dsh-bill/reading
 */
import type { TokenBuckets } from './fold.js'

/**
 * Tokens per Denny.
 *
 * A narrative constant, not a price: "four-card server, 1.8e9 tokens a month,
 * about 6000 yuan of electricity" folds to 600000 Denny, hence 1 Denny = 3000
 * tokens. The bill itself is derived and stored in tokens so that changing this
 * number re-presents history instead of re-deriving it.
 */
export const TOKENS_PER_DENNY = 3000

/** The step the day total is reported in: 10 000 Denny. */
export const DENNY_DAY_BUCKET = 10_000

/** The total of the four disjoint provider buckets, in tokens. */
function tokenTotal(tokens: TokenBuckets): number {
  return tokens.inputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens + tokens.outputTokens
}

/**
 * Convert token buckets to whole Denny.
 *
 * The conversion happens at the presenting layer only. A fraction is rounded to
 * the nearest Denny rather than truncated, so the figure she quotes is the
 * closer of the two.
 * @param tokens - one total's four disjoint buckets.
 * @returns that total in whole Denny.
 */
export function dennyOfBuckets(tokens: TokenBuckets): number {
  return Math.round(tokenTotal(tokens) / TOKENS_PER_DENNY)
}

/** What the reading knows about the previous completed interaction. */
export type PreviousReading =
  /** A completed turn settled this many tokens. */
  | { readonly kind: 'settled'; readonly tokens: TokenBuckets }
  /** No turn has completed in this session yet: there is nothing to report. */
  | { readonly kind: 'none' }
  /** A turn completed, but the provider's usage could not be proven. */
  | { readonly kind: 'unavailable' }

/** What the reading knows about this local day's total. */
export type DayReading =
  /** The day's aggregate, in tokens. */
  | { readonly kind: 'settled'; readonly tokens: TokenBuckets }
  /** The aggregate could not be computed. */
  | { readonly kind: 'unavailable' }

/** The two facts one reading is made of. */
export interface BillReading {
  /** The last completed turn's settled total. */
  readonly previous: PreviousReading
  /** This local day's aggregate. */
  readonly day: DayReading
}

/** The previous-interaction clause of one reading. */
function previousClause(previous: PreviousReading): string {
  switch (previous.kind) {
    case 'settled':
      // Whole Denny, and a genuine zero is a measured zero: it is only the
      // *absent* cases that must never be written as a number.
      return `上一次互动 ${dennyOfBuckets(previous.tokens)} 丁尼`
    case 'none':
      return '上一次互动 尚无已结算的互动'
    case 'unavailable':
      return '上一次互动 用量数据不可用'
  }
}

/** The day-total clause of one reading. */
function dayClause(day: DayReading): string {
  switch (day.kind) {
    case 'settled': {
      const total = tokenTotal(day.tokens)
      // A quiet day and a day too small to round up to one step are different
      // facts, and neither is the same as "could not compute".
      if (total === 0) return '本日累计 尚无消耗'
      const steps = Math.round((total / TOKENS_PER_DENNY) / DENNY_DAY_BUCKET)
      if (steps === 0) return `本日累计 不足 ${DENNY_DAY_BUCKET / 10_000} 万丁尼`
      return `本日累计约 ${steps} 万丁尼`
    }
    case 'unavailable':
      return '本日累计 用量数据不可用'
  }
}

/**
 * Render one reading as the single line the runtime-context channel carries.
 *
 * The register is the neutral one the other operational sections use: a name
 * for the reading, then the facts. It is not a self-report about "this very
 * interaction", and it neither addresses her in the second person nor asks her
 * to say anything — the persona is what decides whether the number is relevant.
 * @param reading - the previous interaction and the day total.
 * @returns the line, without a trailing newline.
 */
export function renderBillReading(reading: BillReading): string {
  return `电费读数：${previousClause(reading.previous)}；${dayClause(reading.day)}。`
}

/**
 * The reading that states both facts are unavailable.
 *
 * Used before the row has any observation at all: it claims nothing it has not
 * measured, so a first request that races the row's first read cannot tell her
 * a false "no spend".
 */
export const UNAVAILABLE_READING: BillReading = Object.freeze({
  previous: Object.freeze({ kind: 'unavailable' as const }),
  day: Object.freeze({ kind: 'unavailable' as const }),
})
