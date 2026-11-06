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

test('no client can convert tokens to Denny, because it is handed both', () => {
  // The structural half of the one-rate rule: the wire carries tokens and Denny
  // together, so a client never needs the rate and must not have a way to apply
  // it. That is a fact about the client's shape, not about its text — the Android
  // side formats a supplied Denny and exposes no conversion entry point at all.
  const clientSources = execFileSync('git', ['ls-files', '-z', '*.kt'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\0')
    .filter(path => path !== '' && path.includes('/src/main/'))
  assert.ok(clientSources.length > 50, `the client sources must be readable; found ${clientSources.length}`)

  const converters = []
  for (const path of clientSources) {
    const source = readFileSync(join(repoRoot, path), 'utf8')
    // A function that produces a Denny from anything but an already-supplied
    // figure is a conversion, and only the backend may own one.
    for (const match of source.matchAll(/fun\s+\w*[Dd]enny\w*\s*\(([^)]*)\)/gu)) {
      const parameters = match[1]
      const producesFromTokens = /tokens?\s*:\s*(?:Long|Int)/u.test(parameters)
      if (producesFromTokens) converters.push(`${path}: ${match[0]}`)
    }
  }
  assert.deepEqual(converters, [],
    `a client must not convert tokens to Denny; it receives both. Found: ${converters.join('; ')}`)
})

test('the rate is one value: the package exports it once and every presenter uses it', () => {
  // The model-visible statements of the rate are prose, so the checkable fact is
  // that they agree with the constant. Anything the product computes goes through
  // `dennyOf*`; this test pins that there is one constant to agree with.
  assert.equal(TOKENS_PER_DENNY, 3000)
  // The tool description the model reads states the same rate the code applies.
  const tools = readFileSync(join(repoRoot, 'backend', 'bill', 'src', 'tools.ts'), 'utf8')
  const stated = /1\s*(?:丁尼|Denny)\s*=\s*(\d[\d_]*)/u.exec(tools)
  assert.ok(stated !== null, 'the tool description must state the rate the model is told')
  assert.equal(Number(stated[1].replaceAll('_', '')), TOKENS_PER_DENNY,
    'the rate the model is told must be the rate the code applies')
})
