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
  SESSION, assistantMessage, attachment, event, job, textStream, toolCallMessage, toolStream, transcriptLog, userMessage, workCases, workLog,
} from './fixtures/projection-logs.mjs'

const units = await import('../backend/chat/dist/units.js')
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

/**
 * Strip the fields later tickets added before comparing wire rows with the
 * frozen fixture.
 *
 * The fixture was captured from the folds ticket #90 deleted, before `position`
 * (#224) and before the row's turn and turn bucket (#321) existed. The tests
 * that follow name those fields as explicit literals of their own, so this
 * comparison still pins every other field of the same rows.
 */
const withoutPositions = messages => messages.map(({ position: _position, turn: _turn, usage: _usage, ...row }) => row)

test('the transcript unit reproduces the frozen transcript, including ignored shapes', () => {
  assert.deepEqual(withoutPositions(unitProjection(transcriptLog()).messages), expected.transcriptLog.messages)
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

test('an unmapped native job status is explicit unknown, not an absent field or a quiet session', () => {
  // Upstream may add a native JobStatus member before this product maps it.
  // The wire status must still be the numeric unknown, and the activity
  // summary must not read the unconverged task as quiet (1) or active (2).
  const log = [event(0, 'jobs/lifecycle', { generation: 'g1', phase: 'registered', job: job({ status: 'paused' }) })]
  const state = fold(units.workDefinition, log)
  const live = { ...job({ status: 'paused' }), owner: SESSION }

  const available = units.tasksAndActivityAt(state, { jobs: { generation: 'g1', list: () => [live] } }, SESSION, false, 0)
  assert.ok(Object.hasOwn(available.tasks[0], 'status'), 'the status field must be present, never undefined')
  assert.equal(available.tasks[0].status, 0)
  assert.equal(available.activity.status, 0)

  const unavailable = units.tasksAndActivityAt(state, { jobs: { generation: 'g1', list: () => [] } }, SESSION, false, 0)
  assert.equal(unavailable.tasks[0].status, 0)
  assert.equal(unavailable.activity.status, 0)
})

test('the work unit keeps only pending identities, not a second inbox copy', () => {
  const log = [
    event(0, 'agent/inbox/spliced', { target: 'next-turn', start: 0,
      inserted: [userMessage('u1', 'queued text must not enter the durable state', { rpcId: 'r1' })] }),
  ]
  const state = fold(units.workDefinition, log)

  assert.deepEqual(state.pending, { 'next-turn': [{ id: 'u1', kind: 'user' }] })
  assert.ok(!JSON.stringify(state).includes('queued text must not enter the durable state'),
    'the work unit must not copy the pending message body')
  assert.deepEqual(Object.keys(state.pending['next-turn'][0]).sort(), ['id', 'kind'])
  assert.deepEqual(units.workDefinition.stateSchema.parse(JSON.parse(JSON.stringify(state))).pending, state.pending)
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

test('the stateVersion constants bind the README contract', () => {
  // Bump these together with backend/chat/README.md and the evidence when the
  // fold semantics or state shape change; the registry discards older rows.
  // The README is read, not restated: the numbers below are this suite's
  // expectation, and the documented sentence must name the same ones, so a
  // version bump that forgets the prose fails here instead of shipping drift.
  const versions = { ourfairyTranscript: 8, ourfairyWork: 2 }
  const documented = { ourfairyTranscript: /transcript `(\d+)`/u, ourfairyWork: /\bwork `(\d+)`/u }
  const readme = readFileSync(new URL('../backend/chat/README.md', import.meta.url), 'utf8')
  for (const definition of [units.transcriptDefinition, units.workDefinition]) {
    assert.equal(typeof definition.key, 'string')
    assert.equal(definition.stateVersion, versions[definition.key], `${definition.key} stateVersion`)
    const match = documented[definition.key].exec(readme)
    assert.ok(match, `backend/chat/README.md must state the ${definition.key} stateVersion`)
    assert.equal(Number(match[1]), definition.stateVersion,
      `backend/chat/README.md documents ${definition.key} at ${match[1]}, but the unit is at ${definition.stateVersion}`)
    assert.equal(definition.wire, undefined, `${definition.key} is host-only and must not publish a wire view`)
  }
})

test('every cut of the transcript matches the frozen value for that prefix', () => {
  const log = transcriptLog()
  const state = fold(units.transcriptDefinition, log)
  for (const [key, messages] of Object.entries(expected.transcriptCuts)) {
    const cut = Number(key)
    assert.deepEqual(withoutPositions(units.transcriptAt(state, cut)), messages, `transcript at cut ${cut} must match the frozen prefix`)
  }
  // Cuts on both sides of the splice/append pair, of an attempt and its turn end, and beyond the end.
  assert.deepEqual(Object.keys(expected.transcriptCuts).map(Number).sort((a, b) => a - b),
    [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, log.length])
})

test('a windowed read starts at fromSeq and keeps a queued row moved across that boundary', () => {
  const log = transcriptLog()
  const state = fold(units.transcriptDefinition, log)
  const cuts = [-1, 0, 1, 2, 3, 4, 5, 6, 10, 12]
  for (const cut of cuts) {
    const all = units.transcriptAt(state, cut)
    for (const fromSeq of [0, 1, 2, 4, 5, 10, 12, 13]) {
      assert.deepEqual(units.transcriptAt(state, cut, fromSeq), all.filter(message => message.seq >= fromSeq),
        `windowed read at cut ${cut} from seq ${fromSeq} must equal the full cut view filtered to the window`)
    }
  }
  // The queued copy first appeared at seq 1 and was appended at seq 2; a page
  // whose window starts at 2 must still carry it even though no row has a
  // first appearance inside that range.
  assert.deepEqual(units.transcriptAt(state, 2, 2).map(({ messageId, seq, status }) => ({ messageId, seq, status })),
    [{ messageId: 'u1', seq: 2, status: 2 }])
})

test('a re-splice keeps first-appearance order and the cut row moves to the later seq', () => {
  const log = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'agent/inbox/spliced', { target: 'next-turn', start: 0,
      inserted: [userMessage('u1', 'first copy', { rpcId: 'r1' })] }),
    // Another row appears between the first and the re-splice: the rows array
    // must still be sorted by the *first* appearance for the window search.
    event(2, 'assistant/message', { turn: 1, step: 1, message: { id: 'a1', role: 'assistant',
      content: [{ type: 'text', text: 'reply' }], source: { kind: 'model' } }, stream: [] }, { surfaceOp: 'append' }),
    event(3, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 1,
      inserted: [userMessage('u1', 'second copy', { rpcId: 'r1' })] }),
    event(4, 'user/message', userMessage('u1', 'second copy', { rpcId: 'r1' }), { surfaceOp: 'append' }),
  ]
  const state = fold(units.transcriptDefinition, log)

  assert.deepEqual(units.transcriptAt(state).map(message => message.messageId), ['u1', 'a1'])
  assert.deepEqual(units.transcriptAt(state, 3, 3).map(({ messageId, seq, status }) => ({ messageId, seq, status })),
    [{ messageId: 'u1', seq: 3, status: 1 }], 'the re-splice moves the row into a window starting at its new seq')
  assert.deepEqual(units.transcriptAt(state, 4, 4).map(({ messageId, seq, status }) => ({ messageId, seq, status })),
    [{ messageId: 'u1', seq: 4, status: 2 }], 'the append after the re-splice is the later cut row')
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

test('a tool-call step carries its tool names in block order and nothing else', () => {
  // #213: a step that only requested tools used to reach the wire as an empty
  // text row, so the client had nothing to show. The names ride on the message;
  // arguments and tool output stay out of the projection.
  const log = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'assistant/message', { turn: 1, step: 1, message: toolCallMessage('a1', 'checking', [
      { id: 'c1', name: 'bash', arguments: '{"command":"secret-argument"}' },
      { id: 'c2', name: 'read', arguments: '{"path":"secret-path"}' },
    ]), stream: [] }, { surfaceOp: 'append' }),
    event(2, 'tool/result', { turn: 1, step: 1, message: { id: 't1', role: 'tool',
      content: [{ type: 'text', text: 'secret tool output' }], source: { kind: 'tool' }, toolCallId: 'c1' } }, { surfaceOp: 'append' }),
  ]
  const messages = units.transcriptAt(fold(units.transcriptDefinition, log))

  assert.equal(messages.length, 1, 'the tool result is not a transcript row')
  assert.deepEqual(messages[0].tools, ['bash', 'read'])
  assert.equal(messages[0].text, 'checking', 'the step text is unchanged')
  const wire = JSON.stringify(messages)
  for (const secret of ['secret-argument', 'secret-path', 'secret tool output']) {
    assert.ok(!wire.includes(secret), `the projection must not carry ${secret}`)
  }
})

test('a tool-only step still carries its tool names', () => {
  const log = [
    event(0, 'assistant/message', { turn: 1, step: 1, message: toolCallMessage('a1', '', [
      { id: 'c1', name: 'bash', arguments: '{}' },
    ]), stream: [] }, { surfaceOp: 'append' }),
  ]
  const messages = units.transcriptAt(fold(units.transcriptDefinition, log))
  assert.equal(messages[0].text, '')
  assert.deepEqual(messages[0].tools, ['bash'])
})

test('an aborted step keeps the tool it had already requested', () => {
  // A step can emit a tool call and then die before producing a message. The
  // attempt row is all the reader gets, so it must carry the name too.
  const log = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'assistant/attempt', { turn: 1, step: 1, stream: [...toolStream('c1', 'bash'), ...toolStream('c2', 'read')] }),
    event(2, 'turn/end', { turn: 1, reason: { kind: 'aborted' } }),
  ]
  const messages = units.transcriptAt(fold(units.transcriptDefinition, log))

  assert.equal(messages.length, 1, 'the attempt is the only row')
  assert.equal(messages[0].status, 3, 'the attempt is settled as interrupted')
  assert.deepEqual(messages[0].tools, ['bash', 'read'])
  assert.equal(messages[0].text, '')
})

test('a repeated tool-call id keeps its first name and an unnamed record adds nothing', () => {
  const stream = [
    { type: 'tool-call-chunks', time0: 1, index: 0, dt: [0], id: 'c1', name: 'bash', args: ['{}'] },
    { type: 'tool-call-chunks', time0: 2, index: 0, dt: [0], id: 'c1', name: 'bash', args: ['{}'] },
    { type: 'tool-call-chunks', time0: 3, index: 1, dt: [0], id: 'c2', args: ['{}'] },
  ]
  assert.deepEqual(units.attemptTools(stream), ['bash'])
})

test('a successful skill call derives exactly one activation row at the result seq', () => {
  const log = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'assistant/message', { turn: 1, step: 1, message: toolCallMessage('a1', '', [
      { id: 'call-skill', name: 'skill', arguments: '{"name":"pdf"}' },
    ]), stream: [] }, { surfaceOp: 'append' }),
    event(2, 'tool/call', { turn: 1, step: 1, callId: 'call-skill', name: 'skill', arguments: '{"name":"pdf"}' }),
    event(3, 'tool/result', { turn: 1, step: 1, message: { id: 't1', role: 'tool',
      content: [{ type: 'text', text: '<skill_content name="pdf">body</skill_content>' }],
      source: { kind: 'tool' }, toolCallId: 'call-skill' } }, { surfaceOp: 'append' }),
    event(4, 'tool/result', { turn: 1, step: 1, message: { id: 't2', role: 'tool',
      content: [{ type: 'text', text: 'unrelated' }], source: { kind: 'tool' }, toolCallId: 'other' } }, { surfaceOp: 'append' }),
  ]
  const state = fold(units.transcriptDefinition, log)
  const rows = units.transcriptAt(state)

  const activation = rows.filter(row => row.role === 3)
  assert.equal(activation.length, 1, 'one successful skill result makes one activation row')
  assert.deepEqual(activation[0], {
    messageId: 'skill-activation:call-skill',
    position: 1,
    seq: 3,
    requestId: null,
    role: 3,
    turn: 1,
    status: 2,
    text: '加载了skill:pdf',
    kind: 1,
    toolCallId: 'call-skill',
  })
  assert.deepEqual(Object.keys(state.skillCalls), [], 'the matching result consumes the pending call')
})

test('a failed skill result consumes the call without an activation row', () => {
  const log = [
    event(0, 'tool/call', { turn: 1, step: 1, callId: 'bad-skill', name: 'skill', arguments: '{"name":"missing"}' }),
    event(1, 'tool/result', { turn: 1, step: 1, message: { id: 't1', role: 'tool',
      content: [{ type: 'text', text: 'Error: skill "missing" is unknown' }], source: { kind: 'tool' },
      toolCallId: 'bad-skill', isError: true } }, { surfaceOp: 'append' }),
  ]
  const state = fold(units.transcriptDefinition, log)
  assert.deepEqual(units.transcriptAt(state), [])
  assert.deepEqual(Object.keys(state.skillCalls), [], 'a failed result still consumes the pending call')
})

test('only the skill tool pairs; other tools and malformed arguments do not', () => {
  const log = [
    event(0, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'read', arguments: '{"file_path":"/x"}' }),
    event(1, 'tool/result', { turn: 1, step: 1, message: { id: 't1', role: 'tool', content: [],
      source: { kind: 'tool' }, toolCallId: 'c1' } }, { surfaceOp: 'append' }),
    event(2, 'tool/call', { turn: 1, step: 1, callId: 'c2', name: 'skill', arguments: 'not json' }),
    event(3, 'tool/result', { turn: 1, step: 1, message: { id: 't2', role: 'tool', content: [],
      source: { kind: 'tool' }, toolCallId: 'c2' } }, { surfaceOp: 'append' }),
  ]
  assert.deepEqual(units.transcriptAt(fold(units.transcriptDefinition, log)), [],
    'an unrelated tool and a skill call without a name produce no activation row')
})

test('a duplicated skill result keeps the first appearance and adds no transition', () => {
  const log = [
    event(0, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: '{"name":"pdf"}' }),
    event(1, 'tool/result', { turn: 1, step: 1, message: { id: 't1', role: 'tool', content: [],
      source: { kind: 'tool' }, toolCallId: 'c1' } }, { surfaceOp: 'append' }),
    event(2, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: '{"name":"pdf"}' }),
    event(3, 'tool/result', { turn: 1, step: 1, message: { id: 't2', role: 'tool', content: [],
      source: { kind: 'tool' }, toolCallId: 'c1' } }, { surfaceOp: 'append' }),
  ]
  const state = fold(units.transcriptDefinition, log)
  const rows = units.transcriptAt(state)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].seq, 1, 'first appearance wins; the later duplicate does not move it')
  assert.deepEqual(state.rows[0].transitions, [])
})

test('two skill calls in one step produce two rows in result order', () => {
  const log = [
    event(0, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: '{"name":"alpha"}' }),
    event(1, 'tool/call', { turn: 1, step: 1, callId: 'c2', name: 'skill', arguments: '{"name":"beta"}' }),
    event(2, 'tool/result', { turn: 1, step: 1, message: { id: 't1', role: 'tool', content: [],
      source: { kind: 'tool' }, toolCallId: 'c1' } }, { surfaceOp: 'append' }),
    event(3, 'tool/result', { turn: 1, step: 1, message: { id: 't2', role: 'tool', content: [],
      source: { kind: 'tool' }, toolCallId: 'c2' } }, { surfaceOp: 'append' }),
  ]
  assert.deepEqual(units.transcriptAt(fold(units.transcriptDefinition, log))
    .map(message => [message.messageId, message.seq, message.text]),
  [['skill-activation:c1', 2, '加载了skill:alpha'], ['skill-activation:c2', 3, '加载了skill:beta']])
})

test('catalog and /name-shaped user messages never become activation rows', () => {
  const catalog = event(0, 'user/message', {
    id: 'catalog-1', role: 'user',
    content: [{ type: 'text', text: '<system-reminder><available_skills>- `pdf`: PDF</available_skills></system-reminder>' }],
    source: { kind: 'skill-catalog', form: 'catalog', entries: [{ name: 'pdf', description: 'PDF' }] },
  }, { surfaceOp: 'append' })
  const gesture = event(1, 'user/message', {
    id: 'n1', role: 'user', content: [{ type: 'text', text: 'please use /pdf' }],
    source: { kind: 'skill-invocation', name: 'pdf', form: 'instructions' },
  }, { surfaceOp: 'append' })
  assert.deepEqual(units.transcriptAt(fold(units.transcriptDefinition, [catalog, gesture])), [],
    'a catalog message and a /name gesture are not activations')
})

test('a cut before the skill result hides the activation row and a window at its seq carries it', () => {
  const log = [
    event(0, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: '{"name":"pdf"}' }),
    event(1, 'tool/result', { turn: 1, step: 1, message: { id: 't1', role: 'tool', content: [],
      source: { kind: 'tool' }, toolCallId: 'c1' } }, { surfaceOp: 'append' }),
  ]
  const state = fold(units.transcriptDefinition, log)
  assert.deepEqual(units.transcriptAt(state, 0), [])
  assert.deepEqual(units.transcriptAt(state, 1).map(message => message.messageId), ['skill-activation:c1'])
  assert.deepEqual(units.transcriptAt(state, 1, 1).map(message => message.messageId), ['skill-activation:c1'])
  assert.deepEqual(units.transcriptAt(state, 1, 2), [])
})

test('a checkpointed skill call continues exactly like a cold replay', () => {
  const log = [
    event(0, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'skill', arguments: '{"name":"pdf"}' }),
    event(1, 'tool/result', { turn: 1, step: 1, message: { id: 't1', role: 'tool', content: [],
      source: { kind: 'tool' }, toolCallId: 'c1' } }, { surfaceOp: 'append' }),
  ]
  const header = { id: SESSION, version: 4, createdAt: 1, isSeeded: false }
  const cold = fold(units.transcriptDefinition, log)
  let state = units.transcriptDefinition.init(header, 0)
  state = units.transcriptDefinition.apply(state, log[0])
  const checkpoint = units.transcriptDefinition.stateSchema.parse(JSON.parse(JSON.stringify(state)))
  state = units.transcriptDefinition.apply(checkpoint, log[1])
  assert.deepEqual(JSON.parse(JSON.stringify(state)), cold)
})

test('a successful skill_manage review result derives one kind-2 row with the backend display', () => {
  const display = '技能候选 demo（个人，版本 7，哈希 abc）\n新技能，420 字符\n适用：demo\n验证：实际执行 1，复用 0，未执行 0，失败 0\n查看全文：skill_manage inspect versionId=7 expand=skill'
  const log = [
    event(0, 'tool/call', { turn: 1, step: 1, callId: 'review-call', name: 'skill_manage', arguments: '{"action":"inspect","versionId":7}' }),
    event(1, 'tool/result', { turn: 1, step: 1, message: { id: 't1', role: 'tool',
      content: [{ type: 'text', text: JSON.stringify({ ok: true, action: 'inspect', kind: 'skill-review', display }) }],
      source: { kind: 'tool' }, toolCallId: 'review-call' } }, { surfaceOp: 'append' }),
  ]
  const state = fold(units.transcriptDefinition, log)
  const rows = units.transcriptAt(state)
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], {
    messageId: 'skill-review:review-call',
    position: 0,
    seq: 1,
    requestId: null,
    role: 3,
    turn: 1,
    status: 2,
    text: display,
    kind: 2,
    toolCallId: 'review-call',
  })
})

test('a bash result that prints a review display derives no row; only a paired skill_manage result does', () => {
  const display = 'a real backend display'
  const reviewJson = JSON.stringify({ ok: true, kind: 'skill-review', display })
  const log = [
    event(0, 'tool/call', { turn: 1, step: 1, callId: 'bash-call', name: 'bash', arguments: '{"command":"printf ..."}' }),
    event(1, 'tool/result', { turn: 1, step: 1, message: { id: 't1', role: 'tool',
      content: [{ type: 'text', text: reviewJson }], source: { kind: 'tool' }, toolCallId: 'bash-call' } }, { surfaceOp: 'append' }),
    event(2, 'tool/call', { turn: 1, step: 2, callId: 'review-call', name: 'skill_manage', arguments: '{"action":"inspect","versionId":7}' }),
    event(3, 'tool/result', { turn: 1, step: 2, message: { id: 't2', role: 'tool',
      content: [{ type: 'text', text: reviewJson }], source: { kind: 'tool' }, toolCallId: 'review-call' } }, { surfaceOp: 'append' }),
  ]
  const rows = units.transcriptAt(fold(units.transcriptDefinition, log))
  assert.equal(rows.length, 1, 'the unpaired bash result and the paired skill_manage result are not equal')
  assert.equal(rows[0].messageId, 'skill-review:review-call')
  assert.equal(rows[0].text, display)
})

test('a failed, malformed or unrelated skill_manage result derives no review row', () => {
  const failed = fold(units.transcriptDefinition, [
    event(0, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'skill_manage', arguments: '{"action":"inspect"}' }),
    event(1, 'tool/result', { turn: 1, step: 1, message: { id: 't1', role: 'tool',
      content: [{ type: 'text', text: JSON.stringify({ kind: 'skill-review', display: 'x' }) }],
      source: { kind: 'tool' }, toolCallId: 'c1', isError: true } }, { surfaceOp: 'append' }),
  ])
  assert.deepEqual(units.transcriptAt(failed), [], 'a failed call never publishes a review row')

  const malformed = fold(units.transcriptDefinition, [
    event(0, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'skill_manage', arguments: '{"action":"inspect"}' }),
    event(1, 'tool/result', { turn: 1, step: 1, message: { id: 't1', role: 'tool',
      content: [{ type: 'text', text: 'not json' }], source: { kind: 'tool' }, toolCallId: 'c1' } }, { surfaceOp: 'append' }),
    event(2, 'tool/call', { turn: 1, step: 2, callId: 'c2', name: 'skill_manage', arguments: '{"action":"list"}' }),
    event(3, 'tool/result', { turn: 1, step: 2, message: { id: 't2', role: 'tool',
      content: [{ type: 'text', text: JSON.stringify({ ok: true, pending: [], pool: [] }) }],
      source: { kind: 'tool' }, toolCallId: 'c2' } }, { surfaceOp: 'append' }),
  ])
  assert.deepEqual(units.transcriptAt(malformed), [], 'only a result naming a review display derives a row')
})

test('a duplicated review result keeps the first row and adds no transition', () => {
  const result = (seq, display) => event(seq, 'tool/result', { turn: 1, step: 1, message: { id: `t${String(seq)}`, role: 'tool',
    content: [{ type: 'text', text: JSON.stringify({ kind: 'skill-review', display }) }],
    source: { kind: 'tool' }, toolCallId: 'c1' } }, { surfaceOp: 'append' })
  const state = fold(units.transcriptDefinition, [
    event(0, 'tool/call', { turn: 1, step: 1, callId: 'c1', name: 'skill_manage', arguments: '{"action":"inspect"}' }),
    result(1, 'first display'),
    result(2, 'second display'),
  ])
  const rows = units.transcriptAt(state)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].text, 'first display')
  assert.equal(rows[0].seq, 1)
  assert.deepEqual(state.rows[0].transitions, [])
})

test('a delivered message is not an assistant step and names no tools', () => {
  // A delivery is another session's report; the ticket keeps its presentation
  // unchanged even if its content ever carried a tool call.
  const log = [
    event(0, 'delivery/message', { deliveryId: 'd1', origin: { sessionId: 'sender-1' },
      message: toolCallMessage('dmsg', 'delivered', [{ id: 'c1', name: 'bash', arguments: '{}' }]) }, { surfaceOp: 'append' }),
  ]
  const messages = units.transcriptAt(fold(units.transcriptDefinition, log))
  assert.equal(messages[0].text, 'delivered')
  assert.equal(messages[0].tools, undefined, 'a delivered message must not grow a tools field')
})

test('tool steps keep their place between ordinary messages', () => {
  const log = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'assistant/message', { turn: 1, step: 1, message: toolCallMessage('a1', '', [
      { id: 'c1', name: 'bash', arguments: '{}' }]), stream: [] }, { surfaceOp: 'append' }),
    event(2, 'assistant/message', { turn: 1, step: 2, message: { id: 'a2', role: 'assistant',
      content: [{ type: 'text', text: '中间' }], source: { kind: 'model' } }, stream: [] }, { surfaceOp: 'append' }),
    event(3, 'assistant/message', { turn: 1, step: 3, message: toolCallMessage('a3', '', [
      { id: 'c2', name: 'read', arguments: '{}' }]), stream: [] }, { surfaceOp: 'append' }),
  ]
  const messages = units.transcriptAt(fold(units.transcriptDefinition, log))

  assert.deepEqual(messages.map(message => message.messageId), ['a1', 'a2', 'a3'])
  assert.deepEqual(messages.map(message => message.tools), [['bash'], undefined, ['read']])
})

test('the transcript unit answers receipts without reading the log', () => {
  const log = [
    event(0, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [userMessage('u1', 'hello', { rpcId: 'r1', attachments: [attachment('up-1', 12)] })] }),
    event(1, 'user/message', userMessage('u1', 'hello', { rpcId: 'r1', attachments: [attachment('up-1', 12)] }), { surfaceOp: 'append' }),
    // A resend with the same request id must keep the first acceptance.
    event(2, 'agent/inbox/spliced', { target: 'next-turn', start: 0, removedCount: 0, inserted: [userMessage('u1', 'hello', { rpcId: 'r1', attachments: [attachment('up-1', 12)] })] }),
  ]
  const state = fold(units.transcriptDefinition, log)

  assert.deepEqual(units.receiptFrom(state, 'r1'), expected.receipt.expected)
  assert.equal(units.receiptFrom(state, 'missing'), null)
})

test('a checkpointed state continues the same fold as a cold replay', () => {
  const header = { id: SESSION, version: 4, createdAt: 1, isSeeded: false }
  const work = workLog()
  const transcript = transcriptLog()
  const foldFrom = (definition, log, checkpointAt) => {
    let state = definition.init(header, 0)
    for (const item of log.slice(0, checkpointAt)) state = definition.apply(state, item)
    // A persisted row is a JSON document validated by `stateSchema` before it
    // seeds a fold; the continuation must equal a replay from `init`.
    let persisted = definition.stateSchema.parse(JSON.parse(JSON.stringify(state)))
    for (const item of log.slice(checkpointAt)) persisted = definition.apply(persisted, item)
    return JSON.parse(JSON.stringify(persisted))
  }
  for (const [definition, log] of [[units.workDefinition, work], [units.transcriptDefinition, transcript]]) {
    const cold = JSON.parse(JSON.stringify(fold(definition, log)))
    for (const checkpointAt of [0, 1, Math.floor(log.length / 2), log.length]) {
      assert.deepEqual(foldFrom(definition, log, checkpointAt), cold,
        `${definition.key} must continue from a checkpoint at ${checkpointAt} like a cold replay`)
    }
  }

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
  const events = log.map((item, index) => ({ ...item, seq: index }))
  const restored = registry.restore({}, events, 0, header, 0)
  const transcriptState = restored.checkpoint.ourfairyTranscript
  const workState = restored.checkpoint.ourfairyWork
  assert.equal(transcriptState.ver, units.transcriptDefinition.stateVersion)
  assert.equal(workState.ver, units.workDefinition.stateVersion)
  assert.deepEqual(withoutPositions(units.transcriptAt(transcriptState.val)), expected.transcriptLog.messages)

  // A row from an older stateVersion is discarded and the log is refolded,
  // which is what makes a stateVersion bump safe for a persisted cache.
  const stale = {
    ourfairyTranscript: { ver: units.transcriptDefinition.stateVersion - 1, seq: -1, val: {} },
    ourfairyWork: { ver: units.workDefinition.stateVersion - 1, seq: -1, val: {} },
  }
  const refolded = registry.restore(stale, events, 0, header, 0)
  assert.equal(refolded.checkpoint.ourfairyTranscript.ver, units.transcriptDefinition.stateVersion)
  assert.deepEqual(refolded.checkpoint.ourfairyTranscript.val, transcriptState.val)
  assert.deepEqual(refolded.checkpoint.ourfairyWork.val, workState.val)

  // `stateOf` is the read face the runtime and service use; disposing the
  // registration must remove the key, and the test must observe both states.
  const session = { header, inheritedEventCount: 0, seq: events.length,
    snapshotEvents: () => events }
  assert.deepEqual(registry.stateOf(session, units.transcriptDefinition.key), transcriptState.val)
  assert.deepEqual(registry.stateOf(session, units.workDefinition.key), workState.val)
  assert.equal(disposers.length, 2)
  for (const dispose of disposers) dispose()
  assert.equal(registry.stateOf(session, units.transcriptDefinition.key), undefined)
  assert.equal(registry.stateOf(session, units.workDefinition.key), undefined)
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

  assert.deepEqual(withoutPositions(rows), expected.firstAppearance.messages)
  assert.deepEqual(rows.map(row => row.messageId), ['u-first', 'u-second', 'a1'])
  assert.equal(rows[0].seq, 3, 'the re-appended row keeps its position and takes the later seq')
})

test('every wire row carries the transcript position that keeps the probe order', () => {
  // The #223 probe fed the client the backend's own array [u-first,u-second,a1]
  // and the client showed [u-second,a1,u-first]: the rows' seq order disagrees
  // with their first-appearance order. Each row therefore names its place, and
  // that place is the row's index in the durable rows array.
  const log = [
    event(0, 'user/message', userMessage('u-first', 'appended first'), { surfaceOp: 'append' }),
    event(1, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [userMessage('u-second', 'queued later', { rpcId: 'r2' })] }),
    event(2, 'assistant/message', { turn: 1, step: 1, message: assistantMessage('a1', 'reply'), stream: [] }, { surfaceOp: 'append' }),
    // Re-appending an existing id keeps its place.
    event(3, 'user/message', userMessage('u-first', 'appended first'), { surfaceOp: 'append' }),
  ]
  const state = fold(units.transcriptDefinition, log)
  const rows = units.transcriptAt(state)

  assert.deepEqual(rows.map(({ messageId, position, seq }) => ({ messageId, position, seq })), [
    { messageId: 'u-first', position: 0, seq: 3 },
    { messageId: 'u-second', position: 1, seq: 1 },
    { messageId: 'a1', position: 2, seq: 2 },
  ])
  assert.equal(new Set(rows.map(row => row.position)).size, rows.length, 'positions are unique within the session')
  for (const cut of [-1, 0, 1, 2, 3, log.length]) {
    for (const fromSeq of [0, 1, 2, 3, 4]) {
      for (const row of units.transcriptAt(state, cut, fromSeq)) {
        const frozen = rows.find(candidate => candidate.messageId === row.messageId)
        assert.ok(frozen, `unexpected row ${row.messageId}`)
        assert.equal(row.position, frozen.position, `${row.messageId} keeps its position at cut ${cut} from ${fromSeq}`)
        // The wire value is the row's own index in durable state, so a read
        // that recomputed it from seq fails here.
        assert.equal(state.rows[row.position].messageId, row.messageId)
      }
    }
  }
})

test('one splice numbers its rows in inserted order and a later re-splice keeps them', () => {
  const log = [
    event(0, 'agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [
      userMessage('u1', 'one', { rpcId: 'r1' }),
      userMessage('u2', 'two', { rpcId: 'r2' }),
    ] }),
    event(1, 'turn/start', { turn: 1 }),
    // The re-splice moves u1's page seq to this event; its place does not move.
    event(2, 'agent/inbox/spliced', { target: 'next-turn', start: 1, removedCount: 1,
      inserted: [userMessage('u1', 'one again', { rpcId: 'r1' })] }),
    event(3, 'user/message', userMessage('u1', 'one again', { rpcId: 'r1' }), { surfaceOp: 'append' }),
    event(4, 'assistant/message', { turn: 1, step: 1, message: assistantMessage('a1', 'reply'), stream: [] }, { surfaceOp: 'append' }),
  ]
  const state = fold(units.transcriptDefinition, log)
  const rows = units.transcriptAt(state)

  assert.deepEqual(rows.map(({ messageId, position, seq, text }) => ({ messageId, position, seq, text })), [
    { messageId: 'u1', position: 0, seq: 3, text: 'one again' },
    { messageId: 'u2', position: 1, seq: 0, text: 'two' },
    { messageId: 'a1', position: 2, seq: 4, text: 'reply' },
  ])
  // A row a window carries because a later event moved it keeps its place.
  assert.deepEqual(units.transcriptAt(state, 2, 2).map(({ messageId, position }) => ({ messageId, position })),
    [{ messageId: 'u1', position: 0 }])
  assert.deepEqual(units.transcriptAt(state, 4, 4).map(({ messageId, position }) => ({ messageId, position })),
    [{ messageId: 'a1', position: 2 }])
})

test('a page window names the same position as the live read', () => {
  const log = transcriptLog()
  const state = fold(units.transcriptDefinition, log)
  const live = units.transcriptAt(state)
  // The documented page range: read at the fixed cut from the page's fromSeq,
  // then keep the rows whose authoritative seq is before the exclusive end.
  const throughSeq = 6
  const end = 5
  const fromSeq = 2
  const page = units.transcriptAt(state, throughSeq, fromSeq).filter(message => message.seq < end)

  assert.deepEqual(page.map(({ messageId, position }) => ({ messageId, position })), [
    { messageId: 'u1', position: 0 },
    { messageId: 'a1', position: 1 },
  ])
  for (const message of page) {
    assert.deepEqual(message, live.find(candidate => candidate.messageId === message.messageId),
      `${message.messageId} reads the same row with the same position in a page and in the live tail`)
  }
})

test('a windowed read touches only its window rows, not the whole transcript', () => {
  const rows = Array.from({ length: 5000 }, (_, seq) => ({ messageId: `m${seq}`, requestId: null, role: 2,
    text: 'x', attachments: null, tools: [], first: { seq, status: 2 }, transitions: [] }))
  let rowReads = 0
  const proxied = new Proxy(rows, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/u.test(property)) rowReads += 1
      return Reflect.get(target, property, receiver)
    },
  })
  const state = { sessionId: 's', rows: proxied, index: {}, attemptsByTurn: {}, turnEnds: {}, receipts: [], moves: [] }

  const at = units.transcriptAt(state, 5000, 4990)
  assert.deepEqual(at.map(message => message.seq), Array.from({ length: 10 }, (_, index) => 4990 + index))
  assert.ok(rowReads < 100, `a windowed read must not scan 5000 rows (read ${rowReads})`)
})

/* ------------------------------------------------- turn number and usage (#321) */

/** One `assistant/message` event carrying provider usage, in the log's own shape. */
const usageMessage = (seq, turn, id, text, usage, { step = 1, ...extra } = {}) => event(seq, 'assistant/message', {
  turn, step, message: assistantMessage(id, text), stream: [],
  ...usage === undefined ? {} : { usage }, ...extra,
}, { surfaceOp: 'append' })

test('every row names the turn it belongs to', () => {
  // The row carries its turn so a consumer can group rows into turns without
  // re-deriving turn boundaries from seq. An event that names a turn supplies
  // it; an event that names none (a user message, a delivery) takes the turn
  // that was open when it landed, and 0 when no turn was open at all.
  const log = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'user/message', userMessage('u1', 'first', { rpcId: 'r1' }), { surfaceOp: 'append' }),
    usageMessage(2, 1, 'a1', 'one'),
    // A delivery that lands mid-turn belongs to that turn: it arrived while the
    // turn was open, and the alternative is a row with no turn at all.
    event(3, 'delivery/message', { deliveryId: 'd1', origin: { sessionId: 'sender-1' },
      message: assistantMessage('dmid', 'delivered mid') }, { surfaceOp: 'append' }),
    event(4, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    // The same delivery shape outside any open turn has no turn to name.
    event(5, 'delivery/message', { deliveryId: 'd2', origin: { sessionId: 'sender-1' },
      message: assistantMessage('didle', 'delivered idle') }, { surfaceOp: 'append' }),
    event(6, 'turn/start', { turn: 2 }),
    event(7, 'user/message', userMessage('u2', 'second', { rpcId: 'r2' }), { surfaceOp: 'append' }),
    event(8, 'assistant/attempt', { turn: 2, step: 1, stream: textStream('half') }),
    usageMessage(9, 2, 'a2', 'two'),
  ]
  const messages = units.transcriptAt(fold(units.transcriptDefinition, log))

  assert.deepEqual(messages.map(({ messageId, turn }) => ({ messageId, turn })), [
    { messageId: 'u1', turn: 1 },
    { messageId: 'a1', turn: 1 },
    { messageId: 'dmid', turn: 1 },
    { messageId: 'didle', turn: 0 },
    { messageId: 'u2', turn: 2 },
    { messageId: 'attempt:session-1:8', turn: 2 },
    { messageId: 'a2', turn: 2 },
  ])
})

/** A compact assistant stream that reports one usage sample, as an adapter leaves it. */
const usageStream = (text, usage) => [...textStream(text), { type: 'chunk', time: 5, index: 1, chunk: { type: 'usage', usage } }]

/** The bucket one row reports, or undefined when the row reports none. */
const bucketsOf = (messages, messageId) => messages.find(row => row.messageId === messageId)?.usage

test('a turn reports its settled spend on its own last Fairy row only', () => {
  // Two steps, each with provider usage. The turn's spend is one number and it
  // rides the reply the reader is left with, so the earlier step's row stays
  // unadorned rather than each step reporting its own share.
  const log = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'user/message', userMessage('u1', 'go', { rpcId: 'r1' }), { surfaceOp: 'append' }),
    event(2, 'step/start', { turn: 1, step: 1 }),
    usageMessage(3, 1, 'a1', 'first', { inputTokens: 10, outputTokens: 2, cacheReadTokens: 4 }, { step: 1 }),
    event(4, 'step/end', { turn: 1, step: 1 }),
    event(5, 'step/start', { turn: 1, step: 2 }),
    usageMessage(6, 1, 'a2', 'second', { inputTokens: 20, outputTokens: 3, cacheReadTokens: 6 }, { step: 2 }),
    event(7, 'step/end', { turn: 1, step: 2 }),
    event(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
  const messages = units.transcriptAt(fold(units.transcriptDefinition, log))

  assert.equal(bucketsOf(messages, 'a1'), undefined, 'the earlier Fairy row of the turn reports no bucket')
  assert.deepEqual(bucketsOf(messages, 'a2'), { input: 30, cache: 10, output: 5 })
})

test('a turn that runs across several steps counts every attempt once', () => {
  // A retried step costs tokens twice: the failed attempt leaves its usage in
  // its own stream, and the successful message reports its own.
  const log = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'user/message', userMessage('u1', 'go', { rpcId: 'r1' }), { surfaceOp: 'append' }),
    event(2, 'step/start', { turn: 1, step: 1 }),
    event(3, 'assistant/attempt', { turn: 1, step: 1, stream: usageStream('half', { inputTokens: 7, outputTokens: 1 }) }),
    event(4, 'llm/retry', { retryId: 'r-1', turn: 1, step: 1, provider: 'p', mode: 'normal', policyKey: 'k', retry: 1, maxRetries: 2, delayMs: 1, failure: { code: 'X', message: 'x' } }),
    event(5, 'llm/retry-started', { retryId: 'r-1', turn: 1, step: 1, retry: 1 }),
    usageMessage(6, 1, 'a1', 'done', { inputTokens: 9, outputTokens: 2 }),
    event(7, 'step/end', { turn: 1, step: 1 }),
    event(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
  const messages = units.transcriptAt(fold(units.transcriptDefinition, log))

  // Neither attempt reported a cache figure, so the bucket names none: a zero
  // would claim the prompt was uncached.
  assert.deepEqual(bucketsOf(messages, 'a1'), { input: 16, output: 3 })
})

test('an interrupted turn reports the spend it already settled', () => {
  const log = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'user/message', userMessage('u1', 'go', { rpcId: 'r1' }), { surfaceOp: 'append' }),
    event(2, 'step/start', { turn: 1, step: 1 }),
    usageMessage(3, 1, 'a1', 'cut off', { inputTokens: 5, outputTokens: 4 }, { interrupted: true }),
    event(4, 'turn/end', { turn: 1, reason: { kind: 'aborted' } }),
  ]
  const messages = units.transcriptAt(fold(units.transcriptDefinition, log))

  const row = messages.find(message => message.messageId === 'a1')
  assert.equal(row?.status, 3, 'the reply is still the interrupted one')
  assert.deepEqual(row?.usage, { input: 5, output: 4 })
})

test('a turn whose attempts all failed reports its spend on the attempt row', () => {
  // The turn produced no reply at all, so the last Fairy row of the turn is the
  // settled attempt; the spend it already cost is still reportable.
  const log = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'user/message', userMessage('u1', 'go', { rpcId: 'r1' }), { surfaceOp: 'append' }),
    event(2, 'step/start', { turn: 1, step: 1 }),
    event(3, 'assistant/attempt', { turn: 1, step: 1, stream: usageStream('half', { inputTokens: 4, outputTokens: 1 }) }),
    event(4, 'step/end', { turn: 1, step: 1 }),
    event(5, 'turn/end', { turn: 1, reason: { kind: 'error' } }),
  ]
  const messages = units.transcriptAt(fold(units.transcriptDefinition, log))

  assert.deepEqual(bucketsOf(messages, 'attempt:session-1:3'), { input: 4, output: 1 })
})

test('a provider that reported no usage leaves the bucket off the row', () => {
  // The frozen fixtures are this case: their streams carry text only. Absence,
  // not zeros — nothing was reported, so nothing may be claimed.
  const log = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'user/message', userMessage('u1', 'go', { rpcId: 'r1' }), { surfaceOp: 'append' }),
    event(2, 'step/start', { turn: 1, step: 1 }),
    event(3, 'assistant/message', { turn: 1, step: 1, message: assistantMessage('a1', 'hi'), stream: textStream('hi') }, { surfaceOp: 'append' }),
    event(4, 'step/end', { turn: 1, step: 1 }),
    event(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
  const messages = units.transcriptAt(fold(units.transcriptDefinition, log))

  assert.deepEqual(messages.map(({ messageId, usage }) => ({ messageId, ...usage === undefined ? {} : { usage } })), [
    { messageId: 'u1' },
    { messageId: 'a1' },
  ])
})

test('the bucket appears only once the turn has ended', () => {
  // The value is a settlement, so it appears only after `turn/end` has been
  // folded. A prefix that stops inside the turn reports no bucket because the
  // turn is still spending — that is a fact about the folded log, not about a
  // read cut: a cut names where to read *in* a settled log, and a settled row
  // keeps its settled value wherever the window happens to start.
  const prefix = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'user/message', userMessage('u1', 'go', { rpcId: 'r1' }), { surfaceOp: 'append' }),
    event(2, 'step/start', { turn: 1, step: 1 }),
    usageMessage(3, 1, 'a1', 'reply', { inputTokens: 5, outputTokens: 2 }),
    event(4, 'step/end', { turn: 1, step: 1 }),
  ]
  const inside = fold(units.transcriptDefinition, prefix)
  const settled = fold(units.transcriptDefinition, [
    ...prefix,
    event(5, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ])

  assert.equal(bucketsOf(units.transcriptAt(inside), 'a1'), undefined, 'inside the turn the reply reports no bucket')
  assert.deepEqual(bucketsOf(units.transcriptAt(settled), 'a1'), { input: 5, output: 2 })
  // Once settled, a window that starts at or after the row still carries the
  // row's own settlement: paging a finished session back must not drop it.
  assert.deepEqual(bucketsOf(units.transcriptAt(settled, 3, 3), 'a1'), { input: 5, output: 2 })
})

test('one attempt without a cache figure keeps the bucket from claiming a cache total', () => {
  // Both figures are part of the same settlement, so an unknown one drops that
  // field instead of reporting the attempt that did answer as if it were all.
  const log = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'user/message', userMessage('u1', 'go', { rpcId: 'r1' }), { surfaceOp: 'append' }),
    event(2, 'step/start', { turn: 1, step: 1 }),
    usageMessage(3, 1, 'a1', 'first', { inputTokens: 10, outputTokens: 2, cacheReadTokens: 4 }, { step: 1 }),
    event(4, 'step/end', { turn: 1, step: 1 }),
    event(5, 'step/start', { turn: 1, step: 2 }),
    usageMessage(6, 1, 'a2', 'second', { inputTokens: 20, outputTokens: 3 }, { step: 2 }),
    event(7, 'step/end', { turn: 1, step: 2 }),
    event(8, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
  const messages = units.transcriptAt(fold(units.transcriptDefinition, log))

  assert.deepEqual(bucketsOf(messages, 'a2'), { input: 30, output: 5 })
})

test('a delivery that lands mid-turn does not carry that turn bill', () => {
  // The delivery names the open turn so it can be grouped with the turn it
  // arrived in, but it is another session's report: the spend stays on the row
  // this turn's own reply produced.
  const log = [
    event(0, 'turn/start', { turn: 1 }),
    event(1, 'user/message', userMessage('u1', 'go', { rpcId: 'r1' }), { surfaceOp: 'append' }),
    event(2, 'step/start', { turn: 1, step: 1 }),
    usageMessage(3, 1, 'a1', 'reply', { inputTokens: 5, outputTokens: 2 }),
    event(4, 'delivery/message', { deliveryId: 'd1', origin: { sessionId: 'sender-1' },
      message: assistantMessage('dmsg', 'delivered') }, { surfaceOp: 'append' }),
    event(5, 'step/end', { turn: 1, step: 1 }),
    event(6, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
  ]
  const messages = units.transcriptAt(fold(units.transcriptDefinition, log))

  assert.equal(bucketsOf(messages, 'dmsg'), undefined, 'a delivered message never carries this session bill')
  assert.deepEqual(bucketsOf(messages, 'a1'), { input: 5, output: 2 })
  assert.deepEqual(messages.map(({ messageId, turn }) => ({ messageId, turn })), [
    { messageId: 'u1', turn: 1 },
    { messageId: 'a1', turn: 1 },
    { messageId: 'dmsg', turn: 1 },
  ])
})
