/**
 * The Denny: the narrative unit the Fairy speaks in, and the only place the
 * rate is written down.
 *
 * The bill itself is stored and derived in tokens; Denny exists only so a
 * number can be said in her own measure. Keeping the rate here means an
 * adjustment is one edit and never a re-derivation of history — and, because
 * `dennyOf` is the single conversion, the bill page and the Fairy's context
 * reading cannot print two different numbers for the same snapshot.
 *
 * The value is narrative, not a market price: 1.8e9 tokens ≈ 600000 Denny,
 * from the estimate "a four-card server handles 1.8 billion tokens a month for
 * about 6000 yuan". Hence 1 Denny = 3000 tokens, ≈ 333.33 Denny per million.
 *
 * A bill's Denny is reported to a tenth rather than as an integer: an integer
 * would render a small but real spend as zero, while the exact quotient would
 * imply a precision the narrative rate never had. The tokens travel beside it
 * in every response, so the underlying figure stays checkable either way.
 *
 * @module @ourfairy/dsh-bill/denny
 */
import type { TokenBuckets } from './fold.js'

/**
 * Tokens to one Denny: the narrative exchange rate, not a market price.
 *
 * From "1.8e9 tokens ≈ 600000 Denny" (`600000 / 1.8e9` tokens per Denny).
 */
export const TOKENS_PER_DENNY = 3000

/** The four buckets' sum: the token count one total stands for. */
export function tokensOf(buckets: TokenBuckets): number {
  return buckets.inputTokens + buckets.cacheReadTokens + buckets.cacheWriteTokens + buckets.outputTokens
}

/**
 * One token count in Denny, rounded to a tenth.
 * @param tokens - tokens from {@link tokensOf} or any other count.
 * @returns the Denny value the page and the Fairy both quote.
 */
export function dennyOfTokens(tokens: number): number {
  return Math.round(tokens / TOKENS_PER_DENNY * 10) / 10
}

/**
 * One total in Denny, rounded to a tenth.
 * @param buckets - the total's four disjoint buckets.
 * @returns the Denny value the page and the Fairy both quote.
 */
export function dennyOf(buckets: TokenBuckets): number {
  return dennyOfTokens(tokensOf(buckets))
}
