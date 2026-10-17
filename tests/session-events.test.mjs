/**
 * Ticket #66: one safe one-shot read of a session's event stream, shared by
 * chat and attachments.
 *
 * The helper is exported by the sessions package so both callers delegate to
 * one implementation. Its whole observable contract is the call it makes, the
 * observation it releases, and the snapshot it returns; this test drives that
 * contract through a fake `sessionQuery`, never through a caller's private
 * method.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readSessionEvents } from '../backend/sessions/src/events.mjs'

/** A sessionQuery double recording every observation it hands out and releases. */
function fakeSessionQuery(events, cursor) {
  const calls = { observed: [], disposed: 0 }
  return {
    calls,
    async observeSession(sessionId, options) {
      calls.observed.push({ sessionId, options })
      let open = true
      return {
        events,
        cursor,
        [Symbol.dispose]() {
          if (!open) throw new Error('the observation was disposed twice')
          open = false
          calls.disposed++
        },
      }
    },
  }
}

test('a session read observes without a projection, releases the observation, and returns its snapshot', async () => {
  const events = [{ seq: 0, type: 'session/created', data: {} }]
  const sessionQuery = fakeSessionQuery(events, 1)

  const snapshot = await readSessionEvents({ sessionQuery }, 'session-1')

  assert.deepEqual(sessionQuery.calls.observed, [
    { sessionId: 'session-1', options: { projectionMode: 'none' } },
  ])
  assert.equal(sessionQuery.calls.disposed, 1, 'the one-shot read must dispose the observation it opened')
  assert.deepEqual(snapshot, { events, cursor: 1 })
})
