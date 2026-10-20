/**
 * Projection units (tickets #89/#90): the incremental folds registered on the
 * native sessionProjections registry must produce the values the per-read full
 * folds produced, including shapes those folds returned by accident.
 *
 * Ticket #90 deleted the folds, so the expected values are frozen in
 * `fixtures/projection-expected.json`: they were captured from the folds at
 * `integration/spec-72` commit `9092e52`, before deletion. The logs and live
 * cases they were captured from stay in `fixtures/projection-logs.mjs`, so a
 * change to either side breaks this comparison instead of silently drifting.
 *
 * The unit interfaces under test are the ones the native registry uses —
 * `init`/`apply`/`stateVersion`/`stateSchema` — plus the pure read functions
 * the runtime and service call to turn unit state back into the wire shape.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
// Registers Node resolution for the pinned dsh checkout before any product
// module below is loaded; it must stay the first import of this file.
import './helpers/dsh-peers.mjs'
import {
  SESSION, attachment, event, transcriptLog, userMessage, workCases, workLog,
} from './fixtures/projection-logs.mjs'

const units = await import('../backend/chat/src/units.mjs')
const expected = JSON.parse(readFileSync(new URL('./fixtures/projection-expected.json', import.meta.url), 'utf8'))

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

test('the transcript unit reproduces the frozen transcript, including ignored shapes', () => {
  assert.deepEqual(unitProjection(transcriptLog()).messages, expected.transcriptLog.messages)
})

test('the work unit reproduces the frozen task and activity values', () => {
  const cases = workCases()
  assert.equal(cases.length, expected.workCases.length, 'every frozen case needs its log')
  cases.forEach(({ log, running, liveJobs }, index) => {
    const { tasks, activity } = unitProjection(log, { running, liveJobs })
    assert.deepEqual({ tasks, activity }, expected.workCases[index],
      `work unit must match the frozen values for running=${running}, ${liveJobs.length} live jobs, ${log.length} events`)
  })
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

test('every cut of the transcript matches the frozen value for that prefix', () => {
  const log = transcriptLog()
  const state = fold(units.transcriptDefinition, log)
  for (const [key, messages] of Object.entries(expected.transcriptCuts)) {
    const cut = Number(key)
    assert.deepEqual(units.transcriptAt(state, cut), messages, `transcript at cut ${cut} must match the frozen prefix`)
  }
  // Cuts on both sides of the splice/append pair, of an attempt and its turn end, and beyond the end.
  assert.deepEqual(Object.keys(expected.transcriptCuts).map(Number).sort((a, b) => a - b),
    [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, log.length])
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
  assert.deepEqual(atEnd, expected.workCases[0])

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

  assert.deepEqual(units.receiptFrom(state, SESSION, 'r1'), expected.receipt.expected)
  assert.equal(units.receiptFrom(state, SESSION, 'missing'), null)
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
  assert.deepEqual(units.transcriptAt(transcriptState.val), expected.transcriptLog.messages)
  assert.equal(typeof registry.stateOf, 'function')
  assert.equal(disposers.length, 2)
  for (const dispose of disposers) dispose()
})

test('the transcript read at a cut keeps the frozen first-appearance order, not seq order', () => {
  // A message appended before the message spliced later: the old Map fold kept
  // each key's first insertion position, so the array order is not seq order.
  const log = [
    event(0, 'user/message', userMessage('u-first', 'appended first'), { surfaceOp: 'append' }),
    event(1, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [userMessage('u-second', 'queued later', { rpcId: 'r2' })] }),
    event(2, 'assistant/message', { turn: 1, step: 1, message: { id: 'a1', role: 'assistant', content: [{ type: 'text', text: 'reply' }], source: { kind: 'model' } }, stream: [] }, { surfaceOp: 'append' }),
    // Re-appending an existing id keeps its original position.
    event(3, 'user/message', userMessage('u-first', 'appended first'), { surfaceOp: 'append' }),
  ]
  const state = fold(units.transcriptDefinition, log)
  const rows = units.transcriptAt(state, Infinity)

  assert.deepEqual(rows, expected.firstAppearance.messages)
  assert.deepEqual(rows.map(row => row.messageId), ['u-first', 'u-second', 'a1'])
  assert.equal(rows[0].seq, 3, 'the re-appended row keeps its position and takes the later seq')
})
