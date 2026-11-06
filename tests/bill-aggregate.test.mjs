/**
 * Ticket #318: the cross-session aggregator and its revision-keyed cache.
 *
 * The bill is one Fairy's consumption, so it is summed over every session,
 * ownership ignored: maintenance and learning children burn the same
 * electricity. The interesting behaviour is not the sum, it is what the
 * aggregator decides to re-read. Every case below drives it through the
 * session-fact port it reads logs with, so the assertions are about the reads it
 * performs and the numbers it returns — never about a private cache structure.
 *
 * The three totals and the series come from ONE call: a snapshot is one
 * observation, and splitting it would let two numbers disagree.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import './helpers/dsh-peers.mjs'
import { closedTurn, usage } from './fixtures/bill-logs.mjs'

const { createBillService, SERIES_DAYS } = await import('../backend/bill/dist/aggregate.js')

/** 2026-01-20 12:00 Asia/Shanghai: "now" for every case that does not move it. */
const NOW = Date.UTC(2026, 0, 20, 4, 0, 0)

/** One closed turn worth `tokens` uncached input, starting on the given local day. */
function turnOn([year, month, day], tokens, { turn = 1 } = {}) {
  return closedTurn(0, { turn, time: Date.UTC(year, month - 1, day, 3, 0, 0), samples: [usage({ inputTokens: tokens })] })
}

/** Several turns folded into one session log, renumbered from seq 0. */
function logOf(...turns) {
  const events = []
  for (const turnEvents of turns) {
    for (const event of turnEvents) events.push({ ...event, seq: events.length })
  }
  return events
}

/**
 * One session the aggregator can see.
 *
 * `revision` is what the persistence `stat` reports and `materialized` is
 * whether the log has reached durable storage; a created-but-unwritten session
 * reports a placeholder revision that never moves, so it must never be cached.
 */
function session(id, { events = [], revision = 'r1', materialized = true, live = false } = {}) {
  return { id, events, revision, materialized, live }
}

/**
 * A fake session-fact port that records every durable read it serves.
 *
 * `list` is the cheap header observation, `stat` is the per-session revision,
 * `live` is the snapshot path, and `read` is the one expensive call: loading a
 * whole log.
 */
function port(sessions) {
  const reads = []
  const stats = []
  const listed = []
  // Read through the array on every call: a case that changes a session's log
  // replaces its entry, and the fake must observe the replacement.
  const byId = () => new Map(sessions.map(entry => [entry.id, entry]))
  return {
    reads,
    stats,
    listed,
    async list() {
      listed.push(1)
      return [...byId().values()].map(entry => ({ id: entry.id, live: entry.live }))
    },
    async stat(id) {
      stats.push(id)
      const entry = byId().get(id)
      if (entry === undefined) return undefined
      return { revision: entry.revision, materialized: entry.materialized }
    },
    live(id) {
      const entry = byId().get(id)
      return entry?.live === true ? entry.events : undefined
    },
    async read(id) {
      reads.push(id)
      const entry = byId().get(id)
      if (entry === undefined) throw new Error(`no such session ${id}`)
      return entry.events
    },
  }
}

/** A clock the test moves by assignment; the service reads it per snapshot. */
function clock(now = NOW) {
  const state = { now }
  const read = () => state.now
  read.set = value => { state.now = value }
  return read
}

const ZERO = { inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0 }

test('an empty session set is a zero bill, not a failure', async () => {
  const bill = await createBillService(port([]), clock()).snapshot()

  assert.deepEqual(bill.today, ZERO)
  assert.deepEqual(bill.month, ZERO)
  assert.deepEqual(bill.allTime, ZERO)
  assert.equal(bill.days.length, SERIES_DAYS, 'the series is always 30 days, even when nothing was spent')
  assert.equal(bill.days[0].day, '2025-12-22', 'the series starts 29 days before today')
  assert.equal(bill.days.at(-1).day, '2026-01-20')
  assert.ok(bill.days.every(day => day.tokens.inputTokens === 0), 'zero days are present and zero, never missing')
})

test('the three totals and the 30-day series come from one pass over every session', async () => {
  const source = port([
    session('a', { events: logOf(turnOn([2026, 1, 20], 100)) }),
    session('b', { events: logOf(turnOn([2026, 1, 3], 200)) }),
    session('c', { events: logOf(turnOn([2025, 12, 31], 400)) }),
    session('d', { events: logOf(turnOn([2025, 6, 1], 800)) }),
  ])

  const bill = await createBillService(source, clock()).snapshot()

  // Each turn is `usage({ inputTokens: n })`, whose default output is 20.
  assert.deepEqual(bill.today, { inputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 20 })
  assert.deepEqual(bill.month, { inputTokens: 300, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 40 })
  assert.deepEqual(bill.allTime, { inputTokens: 1500, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 80 })

  const series = new Map(bill.days.map(day => [day.day, day.tokens.inputTokens]))
  assert.equal(series.get('2026-01-20'), 100)
  assert.equal(series.get('2026-01-03'), 200)
  assert.equal(series.get('2025-12-31'), 400, 'the series reaches back past the month boundary')
  assert.equal(series.size, SERIES_DAYS, 'the series carries exactly 30 day keys, all of them present')
  assert.equal(bill.days.reduce((sum, day) => sum + day.tokens.inputTokens, 0), 700,
    'the series only carries the last 30 days; the all-time total carries everything')
})

test('the local month boundary is the first of the month at local midnight', async () => {
  // 2026-01-01 00:00 Shanghai is January; one second earlier is December's.
  const firstInstant = Date.UTC(2025, 11, 31, 16, 0, 0)
  const source = port([
    session('a', { events: logOf(closedTurn(0, { time: firstInstant - 1000, samples: [usage({ inputTokens: 7 })] })) }),
    session('b', { events: logOf(closedTurn(0, { time: firstInstant, samples: [usage({ inputTokens: 11 })] })) }),
  ])

  const bill = await createBillService(source, clock(Date.UTC(2026, 0, 2, 4, 0, 0))).snapshot()
  assert.equal(bill.month.inputTokens, 11, 'only the turn at or after local midnight on the 1st is this month')
  assert.equal(bill.allTime.inputTokens, 18, 'both turns are in the all-time total')
})

test('child sessions alone are a complete bill', async () => {
  const source = port([
    session('ourfairy-memory-maintenance-child', { events: logOf(turnOn([2026, 1, 20], 40)) }),
    session('ourfairy-skill-learning-child', { events: logOf(turnOn([2026, 1, 20], 80)) }),
  ])

  const bill = await createBillService(source, clock()).snapshot()
  assert.equal(bill.today.inputTokens, 120, 'the bill has no user session to depend on')
  assert.equal(bill.allTime.inputTokens, 120)
})

test('every session counts, including unowned maintenance and learning children', async () => {
  const source = port([
    session('ourfairy-user-1-primary', { events: logOf(turnOn([2026, 1, 20], 10)) }),
    session('ourfairy-user-2-primary', { events: logOf(turnOn([2026, 1, 20], 20)) }),
    session('ourfairy-memory-maintenance-child', { events: logOf(turnOn([2026, 1, 20], 40)) }),
    session('ourfairy-skill-learning-child', { events: logOf(turnOn([2026, 1, 20], 80)) }),
  ])

  const bill = await createBillService(source, clock()).snapshot()
  assert.equal(bill.today.inputTokens, 150, 'a child session costs electricity too')
})

test('a session whose revision did not change is not read again', async () => {
  const source = port([session('a', { events: logOf(turnOn([2026, 1, 20], 100)) })])
  const service = createBillService(source, clock())

  assert.equal((await service.snapshot()).today.inputTokens, 100)
  assert.deepEqual(source.reads, ['a'], 'the first snapshot loads the log once')

  assert.equal((await service.snapshot()).today.inputTokens, 100)
  assert.deepEqual(source.reads, ['a'], 'an unchanged revision must not be read again')
  assert.deepEqual(source.stats, ['a', 'a'], 'the revision is still observed on every snapshot')
  assert.equal(source.listed.length, 2, 'the header listing is still observed; it is what finds sessions')
})

test('a changed revision makes the session be read again and replaces its days', async () => {
  const sessions = [session('a', { events: logOf(turnOn([2026, 1, 20], 100)) })]
  const source = port(sessions)
  const service = createBillService(source, clock())
  assert.equal((await service.snapshot()).today.inputTokens, 100)

  // The log grew: the same session now holds two turns, with a new revision.
  sessions[0] = session('a', {
    revision: 'r2',
    events: logOf(turnOn([2026, 1, 20], 100), turnOn([2026, 1, 20], 50, { turn: 2 })),
  })

  assert.equal((await service.snapshot()).today.inputTokens, 150,
    'the new log replaces the cached days rather than adding to them')
  assert.deepEqual(source.reads, ['a', 'a'])
})

test('a session that has not materialized is never cached', async () => {
  const sessions = [session('a', { materialized: false, events: logOf(turnOn([2026, 1, 20], 100)) })]
  const source = port(sessions)
  const service = createBillService(source, clock())

  assert.equal((await service.snapshot()).today.inputTokens, 100)
  // The placeholder revision never moves, so caching on it would freeze the
  // bill at creation time: this session must be re-read every snapshot.
  sessions[0] = session('a', {
    materialized: false,
    events: logOf(turnOn([2026, 1, 20], 100), turnOn([2026, 1, 20], 25, { turn: 2 })),
  })

  assert.equal((await service.snapshot()).today.inputTokens, 125, 'an unmaterialized session is recomputed every time')
  assert.deepEqual(source.reads, ['a', 'a'])
})

test('a live session is read from its snapshot, never from persistence', async () => {
  const source = port([session('a', { live: true, events: logOf(turnOn([2026, 1, 20], 60)) })])

  const bill = await createBillService(source, clock()).snapshot()
  assert.equal(bill.today.inputTokens, 60)
  assert.deepEqual(source.reads, [], 'a live session never costs a durable read')
  assert.deepEqual(source.stats, [], 'a live session is not revision-guarded either')
})

test('a session read failure fails the snapshot instead of reporting zero', async () => {
  const source = port([session('a', { events: logOf(turnOn([2026, 1, 20], 100)) })])
  const failing = { ...source, read: async () => { throw new Error('corrupt log') } }

  await assert.rejects(createBillService(failing, clock()).snapshot(), /corrupt log/,
    'zero spend and "could not compute" must not be the same answer')
})

test('a snapshot is one observation: today is the last point of the same series', async () => {
  const source = port([
    session('a', { events: logOf(turnOn([2026, 1, 20], 100)) }),
    session('b', { events: logOf(turnOn([2026, 1, 19], 50)) }),
  ])

  const bill = await createBillService(source, clock()).snapshot()
  assert.deepEqual(bill.days.at(-1).tokens, bill.today, 'today is the last point of the same series, not a second read')
})

test('the first snapshot costs one durable read per session, each log crossing once', async () => {
  // The cost the spec asks to pin: listing reads headers only, then each
  // session's WHOLE log is loaded and replayed once. Nothing is read twice, so
  // the first snapshot is a function of the session count and the total bytes.
  const logs = [
    logOf(turnOn([2026, 1, 18], 10), turnOn([2026, 1, 19], 20, { turn: 2 })),
    logOf(turnOn([2026, 1, 20], 30)),
    logOf(turnOn([2026, 1, 20], 40), turnOn([2026, 1, 20], 50, { turn: 2 }), turnOn([2026, 1, 20], 60, { turn: 3 })),
  ]
  const sessions = logs.map((events, index) => session(`s${index}`, { events }))
  const source = port(sessions)
  const delivered = []
  const counting = {
    ...source,
    async read(id) {
      const events = await source.read(id)
      delivered.push(...events)
      return events
    },
  }

  await createBillService(counting, clock()).snapshot()

  assert.deepEqual(source.reads, ['s0', 's1', 's2'], 'one durable read per cold session, in listing order')
  assert.equal(delivered.length, logs.reduce((sum, events) => sum + events.length, 0),
    'every logged event crosses the seam exactly once: no log is read twice and none is truncated')
  assert.deepEqual(source.stats, ['s0', 's1', 's2'], 'one revision observation per session, no more')
  assert.equal(source.listed.length, 1, 'the header listing happens once per snapshot')
})

test('a snapshot taken on a new day moves the day and month windows without losing the series', async () => {
  const source = port([
    session('a', { events: logOf(turnOn([2026, 1, 31], 100), turnOn([2026, 2, 1], 9, { turn: 2 })) }),
  ])
  const when = clock(Date.UTC(2026, 0, 31, 4, 0, 0))
  const service = createBillService(source, when)

  const lastOfJanuary = await service.snapshot()
  assert.equal(lastOfJanuary.today.inputTokens, 100)
  assert.equal(lastOfJanuary.month.inputTokens, 100)

  when.set(Date.UTC(2026, 1, 1, 4, 0, 0))
  const firstOfFebruary = await service.snapshot()
  assert.equal(firstOfFebruary.today.inputTokens, 9, 'the February turn is today now')
  assert.equal(firstOfFebruary.month.inputTokens, 9, 'the month window moved to February')
  assert.equal(firstOfFebruary.allTime.inputTokens, 109)
  assert.equal(firstOfFebruary.days.at(-1).day, '2026-02-01')
  assert.deepEqual(source.reads, ['a'], 'moving the clock does not invalidate an unchanged log')
})
