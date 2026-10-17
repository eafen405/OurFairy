/**
 * One projection folds the native event log once (ticket #53).
 *
 * `history.mjs` is the dependency-free derivation the live runtime calls: it
 * takes the jobs registry through `ctx` and imports nothing from the pinned dsh
 * peers, so this seam can be exercised directly — the same reason `queues.mjs`
 * is tested on its own (ticket #51). The observable here is fold count, not
 * time: a counting event source fails the moment tasks and activity stop
 * sharing one pass over the log. Expected task/activity values are derived from
 * the documented wire contract (`backend/chat/README.md`), so a semantic change
 * in the shared fold fails here as well as in the end-to-end suites.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { projectSession } from '../backend/chat/src/history.mjs'

/** Wrap the event log so every full iteration is counted. */
function countedEvents(events) {
  const source = { reads: 0 }
  source[Symbol.iterator] = () => {
    source.reads += 1
    return events[Symbol.iterator]()
  }
  return source
}

const job = (overrides = {}) => ({ id: 'job-1', owner: 'session-1', kind: 'task', label: 'work',
  startedAt: 10, output: { earliest: 0, total: 0 }, ...overrides })

/** A turn around one background task that settles while the registry job still runs. */
function oneTaskLog() {
  return [
    { seq: 0, type: 'turn/start', data: { turn: 't1' } },
    { seq: 1, type: 'jobs/lifecycle', data: { phase: 'started', generation: 'g1', job: job({ status: 'running' }) } },
    { seq: 2, type: 'turn/end', data: { turn: 't1', reason: { kind: 'completed' } } },
    { seq: 3, type: 'jobs/lifecycle', data: { phase: 'settled', generation: 'g1', job: job({ status: 'completed', finishedAt: 20 }) } },
  ]
}

test('tasks and activity share one fold of the event log', () => {
  const ctx = { jobs: { generation: 'g1', list: () => [job({ status: 'running' })] } }
  const events = countedEvents(oneTaskLog())

  const { tasks, activity } = projectSession(ctx, events, 'session-1', false)

  assert.equal(events.reads, 1, 'the projection must fold the event log exactly once')
  assert.deepEqual(tasks, [{ taskId: 'g1/job-1', kind: 'task', label: 'work', status: 1, availability: 1,
    startedAt: 10, output: { earliest: 0, total: 0 }, report: { status: 0 } }])
  assert.deepEqual(activity, { status: 2, reasons: [2], episodeId: 'session-1/0', startedSeq: 0, throughSeq: 3 })
})

test('an empty log with a running agent still opens an episode at seq 0', () => {
  const ctx = { jobs: { generation: 'g1', list: () => [] } }

  const { tasks, activity } = projectSession(ctx, countedEvents([]), 'session-1', true)

  assert.deepEqual(tasks, [])
  assert.equal(activity.status, 2)
  assert.deepEqual(activity.reasons, [1])
  assert.equal(activity.episodeId, 'session-1/0')
  assert.equal(activity.startedSeq, 0)
  assert.equal(activity.throughSeq, -1)
})
