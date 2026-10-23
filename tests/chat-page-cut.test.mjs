/**
 * `/chat/page` takes its event range at the fixed cut (ticket #91).
 *
 * The page used to read the whole session log and slice it in memory. These
 * assertions pin the behaviour that replaced it: a page asks only for its own
 * `K..end-1` range through the native read handle, and a page served from an
 * already-seeded live window slices that window instead of reading again.
 *
 * The fake context is the seam the runtime already exposes (`ctx.sessionPersistence`),
 * so this file never reaches into a private method: it counts the ranges the
 * runtime asks the native handle for, which is exactly the observable the
 * ticket's acceptance criterion names ("only this page's events, not the full log").
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before product modules load.
import './helpers/dsh-peers.mjs'

const { SessionRuntime } = await import('../backend/chat/dist/runtime.js')

/** One committed event at `seq`. */
const at = seq => ({ seq, type: 'test/event', data: {} })
const log = count => Array.from({ length: count }, (_, seq) => at(seq))

/** A persistence service that records every range it is asked for. */
function persistenceOf(events) {
  const reads = []
  const opened = []
  return {
    reads,
    opened,
    open: async (sessionId, access) => {
      opened.push({ sessionId, access })
      return {
        read: async (offset, length) => {
          reads.push({ offset, length })
          return { eventState: 'owned', events: events.slice(offset, offset + length) }
        },
        close: async () => {},
      }
    },
  }
}

const stateOf = (overrides = {}) => ({ sessionId: 'session-1', window: null, ...overrides })
/** Paging touches only the persistence seam; the native history seam is constructed, never read. */
const contextOf = persistence => ({ sessionPersistence: persistence, on: () => () => {}, effect: execute => execute() })

test('a page asks the native handle for exactly its own range', async () => {
  const persistence = persistenceOf(log(100))
  const runtime = new SessionRuntime(contextOf(persistence))
  const events = await runtime.pageEvents(stateOf(), 40, 64)

  assert.deepEqual(events.map(event => event.seq), Array.from({ length: 24 }, (_, index) => 40 + index))
  assert.deepEqual(persistence.reads, [{ offset: 40, length: 24 }], 'only the page range is read')
  assert.deepEqual(persistence.opened, [{ sessionId: 'session-1', access: 'read' }])
})

test('the page cut comes from the seeded window or the live session end', () => {
  const runtime = new SessionRuntime(contextOf(persistenceOf(log(100))))

  assert.equal(runtime.cursorOf({ session: { seq: 12 }, window: null }), 11,
    'before a seed the live session knows the observed end')
  assert.equal(runtime.cursorOf({ session: { seq: 12 }, window: { events: log(5) } }), 4,
    'a seeded window is the observed authority')
  assert.equal(runtime.cursorOf({ session: { seq: 0 }, window: null }), -1)
})

test('a page slices a seeded window instead of reading the log again', async () => {
  const persistence = persistenceOf(log(100))
  const runtime = new SessionRuntime(contextOf(persistence))
  const state = stateOf({ window: { events: log(100), nextSeq: 100, buffer: [] } })
  const events = await runtime.pageEvents(state, 10, 12)

  assert.deepEqual(events.map(event => event.seq), [10, 11])
  assert.deepEqual(persistence.reads, [], 'a seeded window needs no log read')
})

test('an empty page range reads nothing and returns no events', async () => {
  const persistence = persistenceOf(log(10))
  const runtime = new SessionRuntime(contextOf(persistence))
  const events = await runtime.pageEvents(stateOf(), 0, 0)

  assert.deepEqual(events, [])
  assert.deepEqual(persistence.reads, [{ offset: 0, length: 0 }])
})
