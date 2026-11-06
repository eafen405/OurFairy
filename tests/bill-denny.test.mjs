/**
 * Ticket #319, spec claim 44: the exchange rate is one named constant.
 *
 * The spec says the rate "lives in exactly one place" and "is a named constant
 * with its source in a comment". Both are checkable rather than assertable:
 * this file pins the constant's value against the spec's worked example, and
 * scans the tracked TypeScript for a second copy of the rate. A second copy
 * would let the page and the Fairy's context reading print two different
 * numbers for one snapshot — the failure the one-place rule exists to prevent.
 *
 * The arithmetic is checked against the spec's own figures, not against the
 * implementation's formula: 18亿 tokens → 600000 Denny, 1 Denny = 3000 tokens,
 * ≈ 333.33 Denny per million. Those are the numbers a reader can verify by hand.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { dennyOf, dennyOfTokens, TOKENS_PER_DENNY, tokensOf } from '../backend/bill/dist/denny.js'
import { repoRoot } from './helpers/backend.mjs'

/** The zero bucket struct, the value an all-zero total has. */
const ZERO = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }

test('the rate is the spec\'s narrative constant, not a market price', () => {
  assert.equal(TOKENS_PER_DENNY, 3000, '1 Denny = 3000 tokens')
  // The spec's two other statements of the same fact, computed here by hand:
  // 1.8e9 tokens / 3000 = 600000 Denny, and 1e6 / 3000 ≈ 333.33 Denny.
  assert.equal(1_800_000_000 / TOKENS_PER_DENNY, 600_000)
  assert.equal(Math.round(1_000_000 / TOKENS_PER_DENNY * 100) / 100, 333.33)

  // The constant carries its provenance where a reader will look for it.
  const source = readFileSync(join(repoRoot, 'backend', 'bill', 'src', 'denny.ts'), 'utf8')
  assert.match(source, /narrative/iu, 'the comment must say the rate is narrative, not a market price')
  assert.match(source, /1\.8e9|18亿|600000/u,
    'the comment must record the estimate the rate comes from, so the next reader can re-derive it')
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

test('the rate literal appears in exactly one tracked source file', () => {
  // Read the tracked sources, not the working tree: a scratch file under the
  // gitignored `work/tmp/` is not a second copy of the rate in the product.
  const tracked = execFileSync('git', ['ls-files', '-z', '*.ts', '*.mjs', '*.kt'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(path => path !== '')
  // The one authority is the file allowed to hold the number; this test states
  // the figures it checks against and is not a copy the product reads.
  const OWNER = 'backend/bill/src/denny.ts'
  const offenders = []
  for (const path of tracked) {
    // Excluding the authority and this test is what keeps the scan honest rather
    // than self-satisfying: every other file is a copy if it holds the number.
    if (path === OWNER || path === 'tests/bill-denny.test.mjs') continue
    const source = readFileSync(join(repoRoot, path), 'utf8')
    // A named constant equal to the rate, or the denominator written inline. The
    // second is what a copy-paste conversion looks like.
    if (/TOKENS_PER_DENNY\s*=\s*3000/u.test(source) || /\/\s*3_?000(?:[^\d]|$)/u.test(source)) offenders.push(path)
  }
  assert.deepEqual(offenders, [],
    `the Denny rate must be one named constant in backend/bill/src/denny.ts; copies found in: ${offenders.join(', ')}`)
})
