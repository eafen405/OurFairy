/**
 * Projection units (ticket #89): the incremental folds registered on the native
 * sessionProjections registry must reproduce, field for field, what the
 * per-read full folds derive today.
 *
 * The old folds (`projection.mjs`, `history.mjs`) stay in the tree for this
 * comparison and are the independent side of every assertion here: expected
 * values are what today's code returns for the same log, not a re-derivation of
 * the new implementation. `/chat/read`, `/chat/page` and `/chat/observe` are
 * unchanged in this ticket, so their HTTP-level tests keep covering the old
 * path.
 *
 * The unit interfaces under test are the ones the native registry uses —
 * `init`/`apply`/`stateVersion`/`stateSchema` — plus the pure read functions the
 * later tickets call to turn unit state back into the wire shape.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before any product
// module below is loaded; it must stay the first import of this file.
import './helpers/dsh-peers.mjs'

const { receiptIn, transcript } = await import('../backend/chat/src/projection.mjs')
const { projectSession } = await import('../backend/chat/src/history.mjs')
const units = await import('../backend/chat/src/units.mjs')

const SESSION = 'session-1'

/** One committed native event, at the seq the fixture names. */
function event(seq, type, data, extra = {}) {
  return { seq, type, time: 1_700_000_000_000 + seq, data, ...extra }
}

const userMessage = (id, text, { rpcId, attachments } = {}) => ({
  id, role: 'user', content: [{ type: 'text', text }],
  source: { kind: 'user', ...(rpcId === undefined ? {} : { rpcId }), ...(attachments === undefined ? {} : { attachments }) },
})
const assistantMessage = (id, text) => ({ id, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } })
const noticeMessage = (id, text) => ({ id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'tool-jobs' } })
const attachment = (uploadId, bytes) => ({ uploadId, name: `${uploadId}.png`, mime: 'image/png', original: { name: `${uploadId}.png`, mime: 'image/png', bytes }, image: { width: 4, height: 4 } })

/** A compact assistant stream carrying only visible text, as the log stores it. */
const textStream = text => [{ type: 'text-chunks', time0: 1, index: 0, dt: [0], texts: [text] }]

const job = (overrides = {}) => ({ id: 'job-1', kind: 'task', label: 'work', status: 'running', startedAt: 10,
  output: { earliest: 0, total: 0 }, ...overrides })

/**
 * One transcript-focused log: a queued message spliced then appended, an
 * assistant message, a settled attempt, a delivery, an interrupted assistant
 * message, and two ignored shapes (a replacement surface copy and a
 * non-user-authored user message).
 */
function transcriptLog() {
  return [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [userMessage('u1', 'hello', { rpcId: 'r1', attachments: [attachment('up-1', 12)] })] }),
    event(2, 'user/message', userMessage('u1', 'hello', { rpcId: 'r1', attachments: [attachment('up-1', 12)] }), { surfaceOp: 'append' }),
    event(3, 'step/start', { turn: 1, step: 1 }),
    event(4, 'assistant/message', { turn: 1, step: 1, message: assistantMessage('a1', 'hi there'), stream: textStream('hi there') }, { surfaceOp: 'append' }),
    event(5, 'assistant/attempt', { turn: 1, step: 1, stream: textStream('half') }),
    event(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(7, 'assistant/attempt', { turn: 2, step: 1, stream: textStream('orphan') }),
    event(8, 'user/message', userMessage('u-replacement', 'replaced copy'), { surfaceOp: { op: 'replace', startSeq: 2, endSeq: 2 } }),
    event(9, 'user/message', noticeMessage('n1', 'notice'), { surfaceOp: 'append' }),
    event(10, 'delivery/message', { deliveryId: 'd1', origin: { sessionId: 'sender-1' }, message: assistantMessage('dmsg', 'delivered') }, { surfaceOp: 'append' }),
    event(11, 'assistant/message', { turn: 2, step: 1, message: assistantMessage('a2', 'cut off'), stream: textStream('cut off'), interrupted: true }, { surfaceOp: 'append' }),
  ]
}

/**
 * One task/activity-focused log: a background task settles, its completion is
 * queued, a turn consumes the notice, another turn is aborted, and a restored
 * process-local task closes the log.
 */
function workLog() {
  return [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [userMessage('u1', 'start a job', { rpcId: 'r1' })] }),
    event(2, 'user/message', userMessage('u1', 'start a job', { rpcId: 'r1' }), { surfaceOp: 'append' }),
    event(3, 'jobs/lifecycle', { generation: 'g1', phase: 'registered', job: job() }),
    event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    event(5, 'jobs/lifecycle', { generation: 'g1', phase: 'settled', job: job({ status: 'completed', finishedAt: 20 }) }),
    event(6, 'jobs/report', { generation: 'g1', jobId: 'job-1', delivery: 'wakeup', messageId: 'n1' }),
    event(7, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 0, inserted: [noticeMessage('n1', 'job done')] }),
    event(8, 'turn/start', { turn: 2 }),
    event(9, 'user/message', noticeMessage('n1', 'job done'), { surfaceOp: 'append' }),
    event(10, 'assistant/message', { turn: 2, step: 1, message: assistantMessage('a2', 'done'), stream: textStream('done') }, { surfaceOp: 'append' }),
    event(11, 'turn/end', { turn: 2, reason: { kind: 'aborted' } }),
    event(12, 'jobs/lifecycle', { generation: 'g1', phase: 'registered', job: job({ id: 'job-2', status: 'stopping', startedAt: 30 }) }),
    event(13, 'session/end-seed', {}),
  ]
}

/** A log whose queued task notice is discarded from the inbox rather than delivered. */
function canceledNoticeLog() {
  return [
    event(0, 'jobs/lifecycle', { generation: 'g1', phase: 'registered', job: job() }),
    event(1, 'jobs/lifecycle', { generation: 'g1', phase: 'settled', job: job({ status: 'failed', finishedAt: 20, detail: 'exit code: 3' }) }),
    event(2, 'jobs/report', { generation: 'g1', jobId: 'job-1', delivery: 'failed', messageId: 'n1', reason: 'no delivery' }),
    event(3, 'agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 0, inserted: [noticeMessage('n1', 'job failed')] }),
    event(4, 'agent/inbox/spliced', { target: 'next-step', start: 0, removedCount: 1, inserted: [], outcome: 'canceled' }),
    event(5, 'turn/start', { turn: 1 }),
    event(6, 'turn/end', { turn: 1, reason: { kind: 'error' } }),
  ]
}

/** A restored log: real work ran before a restart, then the seed marker closes it. */
function restoredLog() {
  return [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'jobs/lifecycle', { generation: 'g1', phase: 'registered', job: job({ status: 'running' }) }),
    event(2, 'jobs/report', { generation: 'g1', jobId: 'job-1', delivery: 'quiet-context', messageId: 'q1' }),
    event(3, 'session/end-seed', { inherited: true }),
  ]
}

/** One delivery and one removed job inside a single episode, for its own summary fields. */
function deliveryLog() {
  return [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'delivery/message', { deliveryId: 'd1', origin: { sessionId: 'sender-1' }, message: assistantMessage('dmsg', 'delivered') }, { surfaceOp: 'append' }),
    event(2, 'jobs/lifecycle', { generation: 'g1', phase: 'registered', job: job() }),
    event(3, 'jobs/lifecycle', { generation: 'g1', phase: 'settled', job: job({ status: 'completed', finishedAt: 20 }) }),
    event(4, 'jobs/report', { generation: 'g1', jobId: 'job-1', delivery: 'none' }),
    event(5, 'jobs/lifecycle', { generation: 'g1', phase: 'removed', job: job({ status: 'completed', finishedAt: 20 }) }),
    event(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
}

/** Fold one log with one unit definition, asserting the intermediate states stay plain JSON. */
function fold(definition, log, header = { id: SESSION, version: 4, createdAt: 1, isSeeded: false }) {
  let state = definition.init(header, 0)
  assert.deepEqual(JSON.parse(JSON.stringify(state)), state, `${definition.key} init state must be plain JSON`)
  for (const item of log) {
    state = definition.apply(state, item)
    assert.deepEqual(JSON.parse(JSON.stringify(state)), state, `${definition.key} state must stay plain JSON after seq ${item.seq}`)
  }
  return state
}

/** The new unit's read-side result for one log, at the log's own end. */
function unitProjection(log, { running = false, liveJobs = [] } = {}) {
  const ctx = { jobs: { generation: 'g1', list: () => liveJobs } }
  const work = fold(units.workDefinition, log)
  const work1 = units.tasksAndActivityAt(work, ctx, SESSION, running, log.at(-1)?.seq ?? -1)
  const messages = units.transcriptAt(fold(units.transcriptDefinition, log), log.at(-1)?.seq ?? Infinity)
  return { ...work1, messages }
}

test('the transcript unit reproduces the full transcript fold, including ignored shapes', () => {
  const log = transcriptLog()

  assert.deepEqual(unitProjection(log).messages, transcript(log, SESSION))
})

test('the work unit reproduces the task and activity fold', () => {
  const cases = [
    { log: workLog(), running: false, liveJobs: [] },
    { log: workLog(), running: false, liveJobs: [job({ status: 'running' })] },
    { log: workLog(), running: false, liveJobs: [job({ status: 'running' }), job({ id: 'job-2', status: 'running' })] },
    { log: workLog(), running: true, liveJobs: [job({ status: 'running' })] },
    // A live job whose id belongs to an older registry generation never matches.
    { log: workLog(), running: false, liveJobs: [job({ status: 'running', owner: 'session-1' })] },
    { log: workLog(), running: false, liveJobs: [job({ status: 'running', owner: 'session-2' })] },
    { log: canceledNoticeLog(), running: false, liveJobs: [] },
    { log: canceledNoticeLog(), running: true, liveJobs: [job({ status: 'failed', finishedAt: 20, detail: 'exit code: 3' })] },
    { log: restoredLog(), running: false, liveJobs: [job({ status: 'running' })] },
    { log: restoredLog(), running: true, liveJobs: [] },
    { log: deliveryLog(), running: false, liveJobs: [] },
    { log: deliveryLog(), running: false, liveJobs: [job({ status: 'completed', finishedAt: 20 })] },
    { log: deliveryLog(), running: true, liveJobs: [] },
    { log: [], running: false, liveJobs: [] },
    { log: [], running: true, liveJobs: [] },
  ]
  for (const { log, running, liveJobs } of cases) {
    const ctx = { jobs: { generation: 'g1', list: () => liveJobs } }
    assert.deepEqual(
      unitProjection(log, { running, liveJobs }),
      { ...projectSession(ctx, log, SESSION, running), messages: unitProjection(log).messages },
      `work unit must match the full fold for running=${running}, ${liveJobs.length} live jobs, ${log.length} events`,
    )
  }
})

test('a unit applies an unrelated event as the same state reference', () => {
  const unrelated = [
    event(0, 'step/start', { turn: 1, step: 1 }),
    event(1, 'step/end', { turn: 1, step: 1 }),
    event(2, 'request/header', { header: {}, reason: 'initial' }),
    event(3, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'job_start', arguments: '{}' }),
    event(4, 'tool/result', { turn: 1, step: 1, message: { id: 't1', role: 'tool', content: [], source: { kind: 'tool' }, toolCallId: 'c1' } }, { surfaceOp: 'append' }),
    event(5, 'system/message', { turn: 1, step: 1, message: { id: 's1', role: 'system', content: [], source: { kind: 'system-prompt' } } }, { surfaceOp: 'append' }),
    event(6, 'session/title', { title: 'named' }),
  ]
  const transcriptState = fold(units.transcriptDefinition, transcriptLog())
  const workState = fold(units.workDefinition, workLog())
  for (const item of unrelated) {
    assert.equal(units.transcriptDefinition.apply(transcriptState, item), transcriptState, `transcript must ignore ${item.type}`)
    assert.equal(units.workDefinition.apply(workState, item), workState, `work must ignore ${item.type}`)
  }
})

test('a unit declares a stable key and a positive stateVersion for the native registry', () => {
  for (const definition of [units.transcriptDefinition, units.workDefinition]) {
    assert.equal(typeof definition.key, 'string')
    assert.ok(Number.isSafeInteger(definition.stateVersion) && definition.stateVersion >= 1,
      `${definition.key} needs a positive integer stateVersion`)
    assert.equal(definition.wire, undefined, `${definition.key} is host-only and must not publish a wire view`)
    assert.deepEqual(definition.stateSchema.parse(definition.init({ id: SESSION }, 0)), definition.init({ id: SESSION }, 0))
  }
})

test('every cut of the transcript matches the full fold of the same prefix', () => {
  const log = transcriptLog()
  const state = fold(units.transcriptDefinition, log)
  // Cuts on both sides of the splice/append pair, of an attempt and its turn
  // end, and of the last event.
  const cuts = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, log.length]
  for (const cut of cuts) {
    const expected = cut < 0 ? [] : transcript(log.slice(0, cut + 1), SESSION)
    assert.deepEqual(units.transcriptAt(state, cut), expected, `transcript at cut ${cut} must equal the fold of that prefix`)
  }
})

test('the work read reports the observed log end, not a fold position it never saw', () => {
  const log = workLog()
  const state = fold(units.workDefinition, log)
  const ctx = { jobs: { generation: 'g1', list: () => [] } }
  // Tasks and activity are read at the current end only: the page contract
  // keeps them out, and an event this unit ignores (a step, a tool result)
  // must not create state just to remember where the log ended. The caller's
  // observed cursor is therefore the read's `throughSeq`.
  const atEnd = units.tasksAndActivityAt(state, ctx, SESSION, false, log.at(-1).seq)
  const folded = projectSession(ctx, log, SESSION, false)
  assert.deepEqual(atEnd, folded)

  const empty = fold(units.workDefinition, [])
  assert.equal(units.tasksAndActivityAt(empty, ctx, SESSION, false, -1).activity.throughSeq, -1)
})

test('the transcript unit answers receipts without reading the log', () => {
  const log = [
    event(0, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [userMessage('u1', 'hello', { rpcId: 'r1', attachments: [attachment('up-1', 12)] })] }),
    event(1, 'user/message', userMessage('u1', 'hello', { rpcId: 'r1', attachments: [attachment('up-1', 12)] }), { surfaceOp: 'append' }),
    // A resend with the same request id must keep the first acceptance.
    event(2, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 0, inserted: [userMessage('u1', 'hello', { rpcId: 'r1', attachments: [attachment('up-1', 12)] })] }),
  ]
  const state = fold(units.transcriptDefinition, log)

  assert.deepEqual(units.receiptFrom(state, SESSION, 'r1'), {
    receipt: { sessionId: SESSION, requestId: 'r1', messageId: 'u1', acceptedSeq: 0 },
    text: 'hello', uploadIds: ['up-1'],
  })
  assert.equal(units.receiptFrom(state, SESSION, 'missing'), null)
  // The receipt query must agree with the log-scanning implementation it replaces.
  assert.deepEqual(units.receiptFrom(state, SESSION, 'r1'), receiptIn(log, SESSION, 'r1'))
})

test('the two units fold the same log identically whether it starts cold or warm', () => {
  const log = [...workLog(), ...transcriptLog().map(item => ({ ...item, seq: item.seq + workLog().length }))]
  const header = { id: SESSION, version: 4, createdAt: 1, isSeeded: false }
  const cold = units.workDefinition.apply(units.workDefinition.init(header, 0), log[0])
  const warm = fold(units.workDefinition, log.slice(0, 1))
  assert.deepEqual(cold, warm, 'the first event must produce the same state either way')

  // `init`'s immutable header is the only input beyond the events: a session id
  // is the only field the fold uses, and it must not leak into fold semantics.
  const otherHeader = units.transcriptDefinition.init({ id: 'other', version: 4, createdAt: 9, isSeeded: true }, 3)
  assert.deepEqual(units.transcriptDefinition.init({ id: SESSION, version: 4, createdAt: 1, isSeeded: false }, 0),
    units.transcriptDefinition.init(header, 7))
  assert.notEqual(otherHeader.sessionId, SESSION)
})

test('both units register on the native registry and serve their state through stateOf', async () => {
  const { Context } = await import('@deepseek-ai/cordis')
  const { default: SessionProjectionRegistry } = await import('@deepseek-ai/dsh-session-projection')
  const ctx = new Context()
  const registry = new SessionProjectionRegistry(ctx)
  const disposers = units.registerProjectionUnits(ctx)
  const header = { id: SESSION, version: 4, createdAt: 1, isSeeded: false }
  const log = [...transcriptLog()]
  // The registry's cold-read recipe is the public one: refold the stored events
  // from each unit's `init` and hand back the checkpointed states.
  const restored = registry.restore({}, log.map((item, index) => ({ ...item, seq: index })), 0, header, 0)
  const transcriptState = restored.checkpoint.ourfairyTranscript
  const workState = restored.checkpoint.ourfairyWork
  assert.equal(transcriptState.ver, units.transcriptDefinition.stateVersion)
  assert.equal(workState.ver, units.workDefinition.stateVersion)
  assert.deepEqual(units.transcriptAt(transcriptState.val), transcript(log, SESSION))
  assert.equal(typeof registry.stateOf, 'function')
  assert.equal(disposers.length, 2)
  for (const dispose of disposers) dispose()
})

test('the transcript read at a cut keeps the old first-appearance order, not seq order', () => {
  // A message appended before the message spliced later: the old Map fold keeps
  // each key's first insertion position, so the array order is not seq order.
  const log = [
    event(0, 'user/message', userMessage('u-first', 'appended first'), { surfaceOp: 'append' }),
    event(1, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [userMessage('u-second', 'queued later', { rpcId: 'r2' })] }),
    event(2, 'assistant/message', { turn: 1, step: 1, message: assistantMessage('a1', 'reply'), stream: textStream('reply') }, { surfaceOp: 'append' }),
    // Re-appending an existing id keeps its original position.
    event(3, 'user/message', userMessage('u-first', 'appended first'), { surfaceOp: 'append' }),
  ]
  const state = fold(units.transcriptDefinition, log)
  const rows = units.transcriptAt(state, Infinity)

  assert.deepEqual(rows.map(row => row.messageId), transcript(log, SESSION).map(row => row.messageId))
  assert.deepEqual(rows.map(row => row.messageId), ['u-first', 'u-second', 'a1'])
  assert.equal(rows[0].seq, 3, 'the re-appended row keeps its position and takes the later seq')
})
