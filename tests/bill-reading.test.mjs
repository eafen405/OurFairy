/**
 * Ticket #320: the reading the Fairy sees at the end of her own context.
 *
 * The rendered string is the whole product decision of this ticket, so it is
 * tested as a pure function first: the two throttles, the two distinct
 * "no number" cases (no previous interaction yet, versus usage the provider
 * never reported), and the register — reference data, no second person, no
 * invitation to speak. The integration side (where the string is appended, how
 * often, and who sees it) is `tests/bill-context.test.mjs`.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import './helpers/dsh-peers.mjs'

const { DENNY_DAY_BUCKET, TOKENS_PER_DENNY, renderBillReading } = await import('../backend/bill/dist/index.js')

/** One usage record with the four disjoint buckets. */
function tokens({ input = 0, cacheRead = 0, cacheWrite = 0, output = 0 } = {}) {
  return { inputTokens: input, cacheReadTokens: cacheRead, cacheWriteTokens: cacheWrite, outputTokens: output }
}

/** A fully available reading: a settled previous interaction and a settled day. */
function reading(previousTokens, dayTokens) {
  return {
    previous: { kind: 'settled', tokens: previousTokens },
    day: { kind: 'settled', day: '2026-01-15', tokens: dayTokens },
  }
}

test('the Denny rate is one named constant with the narrative source beside it', () => {
  assert.equal(TOKENS_PER_DENNY, 3000, '1 Denny = 3000 tokens: 1.8e9 tokens folded to 600000 Denny')
  assert.equal(DENNY_DAY_BUCKET, 10000, 'the day total is reported in 10 000-Denny steps')
})

test('the previous interaction is reported to the whole Denny', () => {
  // 1 431 000 tokens / 3000 = 477 Denny exactly; the four buckets are summed first.
  const text = renderBillReading(reading(tokens({ input: 1_000_000, cacheRead: 400_000, output: 31_000 }), tokens()))
  assert.match(text, /上一次互动 477 丁尼/, `the settled previous interaction reads as a whole Denny count; got ${text}`)

  // 1 500 000 / 3000 = 500; a fraction of a Denny rounds to the nearest one
  // rather than being truncated, so the number she quotes is the closer one.
  const rounded = renderBillReading(reading(tokens({ input: 1_499_000 }), tokens()))
  assert.match(rounded, /上一次互动 500 丁尼/, `a fractional Denny rounds to the nearest whole one; got ${rounded}`)
})

test('the day total is throttled to 10 000-Denny buckets', () => {
  // 120 000 000 tokens / 3000 = 40 000 Denny = four buckets.
  const text = renderBillReading(reading(tokens({ input: 1 }), tokens({ input: 120_000_000 })))
  assert.match(text, /本日累计约 4 万丁尼/, `the day reads as a coarse bucket; got ${text}`)

  // The bucket must actually quantise: 40 000 and 44 000 Denny are the same
  // reading, 46 000 is the next one. Without this the "constant within a turn"
  // property would rest on the previous-interaction figure alone.
  const low = renderBillReading(reading(tokens({ input: 1 }), tokens({ input: 120_000_000 })))
  const near = renderBillReading(reading(tokens({ input: 1 }), tokens({ input: 132_000_000 })))
  const next = renderBillReading(reading(tokens({ input: 1 }), tokens({ input: 138_000_000 })))
  assert.equal(low, near, 'two days inside one bucket render the same reading')
  assert.notEqual(near, next, 'the reading moves when the day crosses into the next bucket')
})

test('a previous interaction below one whole Denny is stated, not rounded to nothing', () => {
  // 305 tokens is 0.10 Denny: it rounds to 0, and a bare "0 丁尼" would read as
  // "that interaction was free" when it was merely small.
  const text = renderBillReading(reading(tokens({ input: 305 }), tokens({ input: 305 })))
  assert.match(text, /上一次互动 不足 1 丁尼/, `a sub-Denny interaction says so; got ${text}`)
  assert.equal(/上一次互动 0 丁尼/.test(text), false, `it must not claim a measured zero; got ${text}`)
})

test('a first turn says so instead of reporting a zero it never measured', () => {
  const text = renderBillReading({
    previous: { kind: 'none' },
    day: { kind: 'settled', day: '2026-01-15', tokens: tokens({ input: 3_000 }) },
  })
  assert.match(text, /上一次互动 尚无已结算的互动/, `a session with no completed turn says so; got ${text}`)
  assert.equal(/上一次互动[^；]*0 丁尼/.test(text), false, `the absent interaction is never rendered as 0; got ${text}`)
})

test('missing usage is worded differently from a missing interaction', () => {
  const absent = renderBillReading({
    previous: { kind: 'none' },
    day: { kind: 'settled', day: '2026-01-15', tokens: tokens({ input: 3_000 }) },
  })
  const unreported = renderBillReading({
    previous: { kind: 'unavailable' },
    day: { kind: 'settled', day: '2026-01-15', tokens: tokens({ input: 3_000 }) },
  })
  assert.match(unreported, /上一次互动 用量数据不可用/, `an unreported usage states the limitation; got ${unreported}`)
  assert.notEqual(absent, unreported, 'the two "no number" cases must not read the same')
  assert.equal(/上一次互动[^；]*0 丁尼/.test(unreported), false, `unreported usage is never rendered as 0; got ${unreported}`)
})

test('an unreadable day total is stated, not shown as zero', () => {
  const text = renderBillReading({
    previous: { kind: 'settled', tokens: tokens({ input: 3_000 }) },
    day: { kind: 'unavailable' },
  })
  assert.match(text, /本日累计 用量数据不可用/, `a day total that could not be computed says so; got ${text}`)
  assert.equal(/本日累计[^；]*0 丁尼/.test(text), false, `the uncomputed day is never rendered as 0; got ${text}`)
})

test('a day with no spend and a day below one bucket are both stated', () => {
  const empty = renderBillReading(reading(tokens({ input: 3_000 }), tokens()))
  assert.match(empty, /本日累计 尚无消耗/, `a genuinely empty day says it is empty; got ${empty}`)
  const tiny = renderBillReading(reading(tokens({ input: 3_000 }), tokens({ input: 3_000_000 })))
  assert.match(tiny, /本日累计 不足 1 万丁尼/, `spend below half a bucket is not rounded away to nothing; got ${tiny}`)
})

test('the reading is inert reference data, not an instruction to speak', () => {
  const text = renderBillReading(reading(tokens({ input: 1_431_000 }), tokens({ input: 120_000_000 })))
  // It must not address her: the persona is not asked to perform a number.
  for (const address of ['你', '您', '请']) {
    assert.equal(text.includes(address), false, `the reading contains no second person or request (${address}): ${text}`)
  }
  // One line, one sentence per fact: it is appended to a snapshot whose other
  // sections are single lines in the same neutral register.
  assert.equal(text.includes('\n'), false, `the reading is one line: ${JSON.stringify(text)}`)
  assert.match(text, /^电费读数：/, 'the line names itself as a reading, like the other operational sections')
})
