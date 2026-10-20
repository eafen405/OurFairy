/**
 * The shared task/activity fold reads every event once (tickets #53/#90).
 *
 * `units.mjs` owns the only fold now: `ourfairyWork` produces the task roster
 * and its activity summary in one pass, and `tasksAndActivityAt` is the read
 * function the runtime calls. This seam is dependency-free apart from the
 * registry contract, so it can be exercised directly — the same reason
 * `queues.mjs` is tested on its own (ticket #51). The observable here is fold
 * count, not time: a counting log fails the moment the read applies events a
 * second time, and the read itself must not fold at all.
 *
 * Expected task/activity values are derived from the documented wire contract
 * (`backend/chat/README.md`), so a semantic change in the shared fold fails here
 * as well as in the end-to-end suites.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before any product
// module below is loaded; it must stay the first import of this file.
import './helpers/dsh-peers.mjs'

const units = await import('../backend/chat/src/units.mjs')

const job = (overrides = {}) => ({ id: 'job-1', owner: 'session-1', kind: 'task', label: 'work',
  startedAt: 10, output: { earliest: 0, total: 0 }, ...overrides })

/** Fold a log through the unit, counting how many events the fold touches. */
function foldLog(log) {
  const counter = { applied: 0 }
  let state = units.workDefinition.init({ id: 'session-1' }, 0)
  for (const event of log) {
    counter.applied += 1
    state = units.workDefinition.apply(state, event)
  }
  return { state, counter }
}

/** A turn around one background task that settles while the registry job still runs. */
function oneTaskLog() {
  return [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'jobs/lifecycle', data: { phase: 'started', generation: 'g1', job: job({ status: 'running' }) } },
    { seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
    { seq: 3, type: 'jobs/lifecycle', data: { phase: 'settled', generation: 'g1', job: job({ status: 'completed', finishedAt: 20 }) } },
  ]
}

test('tasks and activity share one fold, and the read does not fold again', () => {
  const ctx = { jobs: { generation: 'g1', list: () => [job({ status: 'running' })] } }
  const { state, counter } = foldLog(oneTaskLog())
  assert.equal(counter.applied, 4, 'the unit must fold every event exactly once')

  const read = () => {
    const before = counter.applied
    const value = units.tasksAndActivityAt(state, ctx, 'session-1', false, 3)
    assert.equal(counter.applied, before, 'reading a unit must not fold the log again')
    return value
  }

  assert.deepEqual(read(), {
    tasks: [{ taskId: 'g1/job-1', kind: 'task', label: 'work', status: 1, availability: 1,
      startedAt: 10, output: { earliest: 0, total: 0 }, report: { status: 0 } }],
    activity: { status: 2, reasons: [2], episodeId: 'session-1/0', startedSeq: 0, throughSeq: 3 },
  })
})

test('an empty log with a running agent still opens an episode at seq 0', () => {
  const ctx = { jobs: { generation: 'g1', list: () => [] } }
  const { state } = foldLog([])

  const { tasks, activity } = units.tasksAndActivityAt(state, ctx, 'session-1', true, -1)

  assert.deepEqual(tasks, [])
  assert.equal(activity.status, 2)
  assert.deepEqual(activity.reasons, [1])
  assert.equal(activity.episodeId, 'session-1/0')
  assert.equal(activity.startedSeq, 0)
  assert.equal(activity.throughSeq, -1)
})

test('a turn end closes the episode it leaves idle, while a running task keeps it open', () => {
  const ctx = { jobs: { generation: 'g1', list: () => [job({ status: 'completed', finishedAt: 20 })] } }
  const log = [
    { seq: 0, type: 'turn/start', data: { turn: 1 } },
    { seq: 1, type: 'jobs/lifecycle', data: { phase: 'registered', generation: 'g1', job: job({ status: 'running' }) } },
    { seq: 2, type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted' } } },
    { seq: 3, type: 'jobs/lifecycle', data: { phase: 'settled', generation: 'g1', job: job({ status: 'completed', finishedAt: 20 }) } },
    // The report consumes the settled decision; without it the episode stays open.
    { seq: 4, type: 'jobs/report', data: { generation: 'g1', jobId: 'job-1', delivery: 'none' } },
    { seq: 5, type: 'turn/start', data: { turn: 2 } },
    { seq: 6, type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } },
  ]
  const { state } = foldLog(log)

  // At the aborted turn end the task is still running, so the episode stays open.
  const open = foldLog(log.slice(0, 3))
  const runningCtx = { jobs: { generation: 'g1', list: () => [job({ status: 'running' })] } }
  const openActivity = units.tasksAndActivityAt(open.state, runningCtx, 'session-1', false, 2).activity
  assert.equal(openActivity.episodeId, 'session-1/0')
  assert.equal(openActivity.completed, undefined)
  assert.deepEqual(openActivity.reasons, [2])

  // The settled notice closes the first episode once its report consumes the
  // decision; the second turn then opens and closes its own episode.
  const settledState = foldLog(log.slice(0, 5)).state
  const closed = units.tasksAndActivityAt(settledState, ctx, 'session-1', false, 4).activity
  assert.deepEqual(closed, { status: 1, reasons: [], episodeId: 'session-1/0', startedSeq: 0,
    throughSeq: 4, completed: { episodeId: 'session-1/0', startedSeq: 0, finishedSeq: 4 } })

  const { tasks, activity } = units.tasksAndActivityAt(state, ctx, 'session-1', false, 6)
  assert.deepEqual(tasks, [{ taskId: 'g1/job-1', kind: 'task', label: 'work', status: 3, availability: 1,
    startedAt: 10, finishedAt: 20, output: { earliest: 0, total: 0 }, report: { status: 0 } }])
  assert.deepEqual(activity, { status: 1, reasons: [], episodeId: 'session-1/5', startedSeq: 5,
    throughSeq: 6, completed: { episodeId: 'session-1/5', startedSeq: 5, finishedSeq: 6 } })
})
