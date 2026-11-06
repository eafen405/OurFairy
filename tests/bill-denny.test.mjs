/**
 * Ticket #319, spec claim 44: the exchange rate is one named constant.
 *
 * This file pins the public conversion against the spec's worked example.
 *
 * The arithmetic is checked against the spec's own figures, not against the
 * implementation's formula: 18亿 tokens → 600000 Denny, 1 Denny = 3000 tokens,
 * ≈ 333.33 Denny per million. Those are the numbers a reader can verify by hand.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dennyOf, dennyOfTokens, TOKENS_PER_DENNY, tokensOf } from '../backend/bill/dist/denny.js'

/** The zero bucket struct, the value an all-zero total has. */
const ZERO = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }

test('the rate is the spec\'s narrative constant, not a market price', () => {
  assert.equal(TOKENS_PER_DENNY, 3000, '1 Denny = 3000 tokens')
  // The spec's two other statements of the same fact, computed here by hand:
  // 1.8e9 tokens / 3000 = 600000 Denny, and 1e6 / 3000 ≈ 333.33 Denny.
  assert.equal(1_800_000_000 / TOKENS_PER_DENNY, 600_000)
  assert.equal(Math.round(1_000_000 / TOKENS_PER_DENNY * 100) / 100, 333.33)
})

test('the conversion is the spec\'s, rounded to a tenth of a Denny', () => {
  // Exactly one Denny, from the four disjoint buckets.
  assert.equal(dennyOf({ inputTokens: 2000, cacheReadTokens: 500, cacheWriteTokens: 300, outputTokens: 200 }), 1)
  assert.equal(dennyOf(ZERO), 0)

  // A single small turn is a fraction of a Denny, and stays visible: rounding to
  // an integer here would report a real spend as zero.
  assert.equal(dennyOf({ ...ZERO, inputTokens: 477 }), 0.2)
  assert.equal(dennyOfTokens(150), 0.1, 'a half-Denny rounds half up to a tenth')
  assert.equal(dennyOfTokens(149), 0)

  // The buckets sum before converting: 4 buckets of 750 are 3000, one Denny.
  assert.equal(dennyOf({ inputTokens: 750, cacheReadTokens: 750, cacheWriteTokens: 750, outputTokens: 750 }), 1)
  assert.equal(tokensOf({ inputTokens: 750, cacheReadTokens: 750, cacheWriteTokens: 750, outputTokens: 750 }), 3000)

  // The daily figures a page shows are the same conversion as the totals, so a
  // series that sums to the total also sums to it in Dennies.
  const days = [1200, 900, 0, 900].map(inputTokens => ({ ...ZERO, inputTokens }))
  assert.equal(days.reduce((sum, day) => sum + tokensOf(day), 0), 3000)
  assert.equal(days.reduce((sum, day) => sum + dennyOf(day), 0), 1)
})
