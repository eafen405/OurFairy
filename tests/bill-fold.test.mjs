/**
 * Ticket #318: the per-session log folds into local-day token buckets.
 *
 * The fold is the bill's foundation: one durable log in, per-day sums of the
 * four disjoint provider buckets out. The usage lives in two places (a settled
 * message's `data.usage` and a retried attempt's own stream), so these cases
 * cover both, plus the shapes that must contribute nothing: a call that
 * reported no usage and a turn that never closed.
 *
 * The day a turn belongs to is a decision this ticket had to make: the local
 * day the turn STARTED, so a turn that straddles midnight is billed to the day
 * the interaction began. The boundary cases below pin that choice.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import './helpers/dsh-peers.mjs'
import {
  JANUARY_15, closedTurn, hangingTurn, replacedSampleTurn, retriedTurn, silentTurn, usage,
} from './fixtures/bill-logs.mjs'

const { TIME_ZONE, foldDailyTokens } = await import('../backend/bill/dist/fold.js')

/** The one day key a log produced, or a failure naming what the fold returned. */
function onlyDay(log) {
  const days = foldDailyTokens(log)
  assert.equal(days.length, 1, `the log must fold into one day; it produced ${JSON.stringify(days)}`)
  return days[0]
}

test('the fold sums one closed turn into the four disjoint buckets of its local day', () => {
  const day = onlyDay(closedTurn(0, {
    samples: [usage({ inputTokens: 100, cacheReadTokens: 50, cacheWriteTokens: 10, outputTokens: 20 })],
  }))

  assert.equal(day.day, '2026-01-15', '11:00 Shanghai on 15 January is that local day')
  assert.deepEqual(day.tokens, { inputTokens: 100, cacheReadTokens: 50, cacheWriteTokens: 10, outputTokens: 20 })
  assert.equal(TIME_ZONE, 'Asia/Shanghai')
})

test('a turn with several steps adds every settled step', () => {
  const day = onlyDay(closedTurn(0, {
    samples: [usage({ inputTokens: 10 }), usage({ inputTokens: 20 }), usage({ inputTokens: 30 })],
  }))
  assert.equal(day.tokens.inputTokens, 60)
  assert.equal(day.tokens.outputTokens, 60)
})

test('turns on different local days are bucketed apart, oldest first', () => {
  // 2026-01-15 23:59 and 2026-01-16 00:01 Shanghai, one hour apart.
  const lateNight = Date.UTC(2026, 0, 15, 15, 59, 0)
  const justAfterMidnight = Date.UTC(2026, 0, 15, 16, 1, 0)
  const days = foldDailyTokens([
    ...closedTurn(0, { turn: 1, time: lateNight, samples: [usage({ inputTokens: 7 })] }),
    ...closedTurn(10, { turn: 2, time: justAfterMidnight, samples: [usage({ inputTokens: 9 })] }),
  ])

  assert.deepEqual(days.map(day => day.day), ['2026-01-15', '2026-01-16'])
  assert.deepEqual(days.map(day => day.tokens.inputTokens), [7, 9])
})

test('a turn that straddles local midnight is billed to the day it started', () => {
  // Starts at 23:59 on 15 January; it is closed after midnight.
  const start = Date.UTC(2026, 0, 15, 15, 59, 0)
  const turn = closedTurn(0, { turn: 1, time: start, samples: [usage({ inputTokens: 11 })] })
  // Move only the closer past local midnight: the rest of the turn keeps its times.
  const closedLate = turn.map(event => event.type === 'turn/end'
    ? { ...event, time: Date.UTC(2026, 0, 15, 16, 5, 0) }
    : event)

  assert.deepEqual(foldDailyTokens(closedLate).map(day => day.day), ['2026-01-15'])
})

test('a retried attempt and the settlement that replaced it are both counted', () => {
  const day = onlyDay(retriedTurn(0, {
    failed: usage({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 50 }),
    retried: usage({ inputTokens: 40, outputTokens: 10, cacheReadTokens: 20 }),
  }))

  assert.deepEqual(day.tokens, {
    inputTokens: 140, cacheReadTokens: 70, cacheWriteTokens: 0, outputTokens: 30,
  })
})

test('a later settlement sample replaces the earlier stream sample of the same attempt', () => {
  const day = onlyDay(replacedSampleTurn(0, {
    streamed: usage({ inputTokens: 100, outputTokens: 20 }),
    settled: usage({ inputTokens: 30, outputTokens: 5 }),
  }))
  assert.deepEqual(day.tokens, { inputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 5 })
})

test('a call the provider reported no usage for contributes nothing and does not fail the fold', () => {
  const days = foldDailyTokens([
    ...silentTurn(0, { turn: 1 }),
    ...closedTurn(10, { turn: 2, samples: [usage({ inputTokens: 5, outputTokens: 1 })] }),
  ])

  assert.equal(days.length, 1, `the silent turn must not create a day: ${JSON.stringify(days)}`)
  assert.deepEqual(days[0].tokens, { inputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 1 })
})

test('a hanging turn without turn/end is not counted', () => {
  assert.deepEqual(foldDailyTokens(hangingTurn(0, { sample: usage() })), [],
    'an unclosed turn cannot prove its usage, so it contributes no day')
})

test('every call reporting no usage folds to no days at all', () => {
  assert.deepEqual(foldDailyTokens(silentTurn(0)), [])
  assert.deepEqual(foldDailyTokens([]), [], 'an empty log is an empty fold, not a failure')
})
