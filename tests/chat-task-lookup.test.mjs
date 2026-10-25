/**
 * Ticket #227 (spec #225 T2): task access is one narrow lookup over the work
 * projection unit and the native jobs registry.
 *
 * Each case opens a real `SessionRuntime` live session through `runtime.open`
 * on the shared fake native world, installs the production `installJobs`
 * operations and drives `jobOutput` / `jobStop`. `world.reads` records every
 * `sessionQuery.observeSession` call — the event-window seed — so the cases
 * assert task access performs zero event reads at that native seam instead of
 * inspecting the runtime's window shape. The modules under test are the real
 * `backend/chat/dist/units.js`, `runtime.js` and `jobs.js`; only the native
 * seams are fake.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before any product
// module below is loaded; it must stay the first import of this file.
import './helpers/dsh-peers.mjs'
import { OWNER, SESSION, job, makeWorld, openWorld } from './helpers/chat-world.mjs'

const { installJobs } = await import('../backend/chat/dist/jobs.js')

/** The existing 404 both task operations answer for a missing or foreign task. */
async function assertNotFound(promise) {
  await assert.rejects(promise, error => {
    assert.equal(error.status, 404, `task access must map to the documented 404; got ${error.status}`)
    assert.equal(error.code, 'chat/job-not-found', `task access must carry chat/job-not-found; got ${error.code}`)
    return true
  })
}

/** Fold one registered native job (and optionally its report) into a session. */
function taskSession(world, { sessionId = SESSION, generation = 'g1', jobId = 'job-1', native = {}, report } = {}) {
  const session = world.session(sessionId)
  session.append('jobs/lifecycle', { generation, phase: 'registered', job: job({ id: jobId, owner: sessionId, ...native }) })
  if (report !== undefined) session.append('jobs/report', { generation, jobId, ...report })
  return session
}

/** Open a live session on the world and the production task operations over it. */
async function taskAccess(world, sessionId = SESSION) {
  const { runtime, state } = await openWorld(world, sessionId)
  const { jobOutput, jobStop } = installJobs(world.ctx, runtime)
  return { runtime, state, jobOutput, jobStop }
}

test('a missing, foreign or non-row id is the existing 404 and reads no events', async () => {
  const world = makeWorld()
  taskSession(world)
  const { runtime, state, jobOutput, jobStop } = await taskAccess(world)

  await assertNotFound(jobOutput(OWNER, { sessionId: SESSION, taskId: 'g1/missing', from: 0 }))
  await assertNotFound(jobStop(OWNER, { sessionId: SESSION, taskId: 'g1/missing' }))
  // taskId is untrusted JSON: a non-string, or a name that is not an own row
  // (`__proto__` and friends would otherwise read Object.prototype and
  // fabricate a task instead of the documented 404).
  for (const taskId of [42, null, undefined, '__proto__', 'constructor', 'toString', '']) {
    await assertNotFound(jobOutput(OWNER, { sessionId: SESSION, taskId, from: 0 }))
    await assertNotFound(jobStop(OWNER, { sessionId: SESSION, taskId }))
    assert.equal(runtime.taskOf(state, taskId), null, `taskOf(${String(taskId)}) must not name a row`)
  }
  assert.equal(runtime.taskOf(state, 'g1/job-1')?.task.taskId, 'g1/job-1', 'the folded row is still found')
  assert.equal(world.reads.length, 0, 'task access must not observe the event stream')
})

test('a task is scoped to its session and a row from another session is a 404', async () => {
  const world = makeWorld()
  taskSession(world, { sessionId: SESSION, jobId: 'job-1' })
  taskSession(world, { sessionId: 'session-2', jobId: 'job-2' })
  const { jobOutput, jobStop } = await taskAccess(world, 'session-2')

  await assertNotFound(jobOutput(OWNER, { sessionId: 'session-2', taskId: 'g1/job-1', from: 0 }))
  await assertNotFound(jobStop(OWNER, { sessionId: 'session-2', taskId: 'g1/job-1' }))
  await assertNotFound(jobOutput(OWNER, { sessionId: SESSION, taskId: 'g1/job-2', from: 0 }))
  await assertNotFound(jobStop(OWNER, { sessionId: SESSION, taskId: 'g1/job-2' }))
  assert.equal(world.reads.length, 0, 'task access must not observe the event stream')
})

test('an old-generation task is unavailable even beside a same-named live job', async () => {
  const world = makeWorld()
  taskSession(world, { native: { output: { earliest: 4, total: 12 } } })
  world.setJobGeneration('g2')
  world.setLiveJobs([job({ id: 'job-1', owner: SESSION, status: 'running', output: { earliest: 9, total: 20 } })])
  world.setJobOutput('job-1', { chunks: [{ at: 9, text: 'new run' }], next: 20, lossy: false })
  world.setKillResult('requested')
  const { jobOutput, jobStop } = await taskAccess(world)

  assert.deepEqual(await jobOutput(OWNER, { sessionId: SESSION, taskId: 'g1/job-1', from: 0 }),
    { taskId: 'g1/job-1', availability: 0, chunks: [], next: 12, earliest: 4, total: 12, lossy: true, status: 0 })
  assert.equal(await jobStop(OWNER, { sessionId: SESSION, taskId: 'g1/job-1' }), 0)
  assert.deepEqual(world.jobCalls.readAt, [], 'an old-generation task never reads the live same-named job')
  assert.deepEqual(world.jobCalls.get, [])
  assert.deepEqual(world.jobCalls.kill, [], 'an unavailable task keeps returning 0 without calling kill')
  assert.equal(world.reads.length, 0, 'task access must not observe the event stream')
})

test('an available task reads and stops the job through the returned native id', async () => {
  const world = makeWorld()
  taskSession(world, { native: { output: { earliest: 3, total: 12 } } })
  world.setLiveJobs([job({ id: 'job-1', owner: SESSION, status: 'running', output: { earliest: 3, total: 12 } })])
  world.setJobOutput('job-1', { chunks: [{ at: 3, text: '你好', channel: 'stdout' }], next: 9, lossy: false })
  world.setKillResult('requested')
  const { jobOutput, jobStop } = await taskAccess(world)

  assert.deepEqual(await jobOutput(OWNER, { sessionId: SESSION, taskId: 'g1/job-1', from: 3 }), {
    taskId: 'g1/job-1', availability: 1, chunks: [{ at: 3, text: '你好', channel: 'stdout' }],
    next: 9, lossy: false, earliest: 3, total: 12, status: 1,
  })
  assert.deepEqual(world.jobCalls.readAt, [{ id: 'job-1', from: 3, caller: SESSION }],
    'the output read must use the native JobId the lookup returned')
  assert.deepEqual(world.jobCalls.get, [{ id: 'job-1', caller: SESSION }],
    'the latest output/status projection comes from the registry get')

  assert.equal(await jobStop(OWNER, { sessionId: SESSION, taskId: 'g1/job-1' }), 1)
  world.setKillResult('already-finished')
  assert.equal(await jobStop(OWNER, { sessionId: SESSION, taskId: 'g1/job-1' }), 2)
  assert.deepEqual(world.jobCalls.kill, [
    { id: 'job-1', caller: SESSION, reason: 'cancelled by the user' },
    { id: 'job-1', caller: SESSION, reason: 'cancelled by the user' },
  ], 'stop must use the native JobId the lookup returned')
  assert.deepEqual(world.flushes, [SESSION, SESSION], 'stop still enters the durability barrier')
  assert.equal(world.reads.length, 0, 'task access must not observe the event stream')
})

test('a retained task whose live job the current registry no longer holds is unavailable', async () => {
  const world = makeWorld()
  taskSession(world, { native: { status: 'completed', finishedAt: 20, output: { earliest: 0, total: 7 } } })
  // Same generation, but the registry no longer lists the job: a retained row,
  // not a task this process can read or stop.
  const { jobOutput, jobStop } = await taskAccess(world)

  assert.deepEqual(await jobOutput(OWNER, { sessionId: SESSION, taskId: 'g1/job-1', from: 0 }),
    { taskId: 'g1/job-1', availability: 0, chunks: [], next: 7, earliest: 0, total: 7, lossy: true, status: 3 })
  assert.equal(await jobStop(OWNER, { sessionId: SESSION, taskId: 'g1/job-1' }), 0)
  assert.deepEqual(world.jobCalls.kill, [])
  assert.equal(world.reads.length, 0, 'task access must not observe the event stream')
})

test('the looked-up row is the list row projection, including report degradation', async () => {
  const world = makeWorld()
  taskSession(world, { report: { delivery: 'wakeup' } })
  world.setLiveJobs([job({ id: 'job-1', owner: SESSION, status: 'running' })])
  const { runtime, state } = await taskAccess(world)

  assert.deepEqual(runtime.taskOf(state, 'g1/job-1'), {
    task: { taskId: 'g1/job-1', kind: 'task', label: 'work', status: 1, availability: 1,
      startedAt: 10, output: { earliest: 0, total: 0 }, report: { status: 1 } },
    jobId: 'job-1',
  })
  // The same folded row with no live job: current generation, unavailable
  // native task, and a pending report degrades exactly as the full list does.
  world.setLiveJobs([])
  assert.deepEqual(runtime.taskOf(state, 'g1/job-1'), {
    task: { taskId: 'g1/job-1', kind: 'task', label: 'work', status: 0, availability: 0,
      startedAt: 10, output: { earliest: 0, total: 0 }, report: { status: 6 } },
    jobId: null,
  })
  assert.equal(world.reads.length, 0, 'task access must not observe the event stream')
})
