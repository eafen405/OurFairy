/**
 * The projection units over a REAL session log (tickets #89/#90).
 *
 * The unit-level suite (`projection-units.test.mjs`) pins the folds against
 * frozen values for hand-written logs covering each event shape. This suite
 * proves the same values on events the product actually wrote: it boots the
 * real backend against the model double, drives a conversation containing a
 * tool call, a settled reply and an attempt that ends without a visible
 * message, pages the whole log back through `/chat/page`, and folds that log
 * with the units.
 *
 * Ticket #90 deleted the full folds, so the expected transcript, tasks and
 * activity are frozen in `fixtures/projection-real-expected.json`, captured
 * from those folds at `integration/spec-72` commit `9092e52` over this same
 * scenario. Native message and session ids are generated per run, so the
 * frozen rows omit `messageId`; every other field is the captured value.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { dshDir, describeRun, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort } from './helpers/backend.mjs'
// Registers Node resolution for the pinned dsh checkout before the product
// modules below are loaded (they are dynamic imports for that reason).
import './helpers/dsh-peers.mjs'

const { startMockLlmServer } = await import(join(dshDir, 'packages/test-support/llm-mock-server/lib/index.js'))
const units = await import('../backend/chat/src/units.mjs')
const expected = JSON.parse(readFileSync(new URL('./fixtures/projection-real-expected.json', import.meta.url), 'utf8'))

const home = makeHome('ourfairy-projection-units-')
const password = 'projection-units-password'
let model, port, admin, alice

/** One product POST, asserting the HTTP status the existing suites expect. */
async function post(path, token, body = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST',
    headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
    body: JSON.stringify(body) })
  const value = await response.json()
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(value)}`)
  return value
}
async function send(token, sessionId, requestId, text) {
  const sent = await post('/chat/send', token, { sessionId, requestId, text })
  assert.ok(sent.receipt.messageId)
  return sent.receipt
}
async function until(read, accept, label) {
  const end = Date.now() + 30_000
  let value
  while (Date.now() < end) {
    value = await read()
    if (accept(value)) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(`${label}: ${JSON.stringify(value)}`)
}
async function start() {
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-key', OURFAIRY_MINIMAX_BASE_URL: model.baseURL })
  port = startedPort(run)
}
async function stop() {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}

/** The complete committed log of one session, paged from its frozen cut. */
async function readLog(token, sessionId) {
  const read = await post('/chat/read', token, { sessionId })
  const cut = read.projection.cursor
  const events = []
  let beforeSeq = cut + 1
  while (beforeSeq > 0) {
    const { page } = await post('/chat/page', token, { sessionId, throughSeq: cut, beforeSeq, maxEvents: 64 })
    events.unshift(...page.events)
    beforeSeq = page.beforeSeq ?? 0
  }
  assert.deepEqual(events.map(event => event.seq), Array.from({ length: cut + 1 }, (_, index) => index),
    'the paged log must be the contiguous committed prefix')
  return events
}

/** Compare the unit read against the frozen values, ignoring per-run generated ids. */
function assertSameProjection(events, sessionId, running = false) {
  const stable = messages => messages.map(({ messageId, ...row }) => row)
  const ctx = { jobs: { generation: 'no-live-registry', list: () => [] } }
  const transcriptState = events.reduce(units.transcriptDefinition.apply, units.transcriptDefinition.init({ id: sessionId }, 0))
  const workState = events.reduce(units.workDefinition.apply, units.workDefinition.init({ id: sessionId }, 0))
  const work = units.tasksAndActivityAt(workState, ctx, sessionId, running, events.at(-1)?.seq ?? -1)
  assert.deepEqual(stable(units.transcriptAt(transcriptState)), expected.transcript, 'transcript must match the frozen rows')
  assert.deepEqual(work, expected.work, 'tasks and activity must match the frozen values')
  return { transcriptState, workState, work }
}

before(async () => {
  // A tool call first, then a normal reply: the log then contains a tool call,
  // its result, and the two assistant messages the product wrote for them.
  model = await startMockLlmServer({ apiKey: 'mock-key',
    sequence: ['tool_call_success', 'slow_success', 'partial_eof', 'success'], repeatLast: true,
    successText: '工具之后回复。', partialText: '失败前原文\n**不能丢**。', chunkSize: 2,
    toolName: 'todo_write', toolArguments: JSON.stringify({ todos: [{ content: '检查投影', status: 'in_progress' }] }) })
  await start()
  admin = await post('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await registerUser(port, admin.token, 'projection-alice', password)
})
after(async () => {
  try { await stop() } finally { await model?.close(); removeHome(home) }
})

test('the units reproduce the frozen values over a real session log', async () => {
  const sessionId = (await post('/sessions/create', alice.token)).session.id
  await send(alice.token, sessionId, 'real-tool', '请先更新待办再回答。')
  await until(() => post('/chat/read', alice.token, { sessionId }), r => r.projection.replyStatus === 0
    && r.projection.messages.some(message => message.role === 2), 'tool-driven reply settled')
  await send(alice.token, sessionId, 'real-plain', '再说一次。')
  await until(() => post('/chat/read', alice.token, { sessionId }), r => r.projection.replyStatus === 0
    && r.projection.messages.filter(message => message.status === 2 && message.role === 2).length >= 2, 'second reply settled')
  // A failed stream leaves an `assistant/attempt` behind with no surface message.
  await send(alice.token, sessionId, 'real-failed', '这次允许失败。')
  await until(() => post('/chat/read', alice.token, { sessionId }),
    r => r.projection.replyStatus === 0 && r.projection.messages.some(message => message.status === 4), 'failed attempt settled')

  const events = await readLog(alice.token, sessionId)
  // The comparison is only meaningful if the real log actually exercised the
  // shapes under test, so each one is asserted before equality.
  assert.ok(events.some(event => event.type === 'assistant/attempt'), 'the log must contain an attempt')
  assert.ok(events.some(event => event.type === 'tool/call') || events.some(event => event.type === 'tool/result'),
    'the log must contain tool traffic')
  assert.ok(events.some(event => event.type === 'agent/inbox/spliced'), 'the log must contain inbox splices')
  const { work, transcriptState: folded } = assertSameProjection(events, sessionId)
  const failed = units.transcriptAt(folded).filter(message => message.status === 4)
  assert.ok(failed.length > 0 && failed.some(message => message.text.includes('失败前原文')),
    `the folded transcript must carry the failed attempt text; rows: ${JSON.stringify(units.transcriptAt(folded))}`)
  assert.ok(failed.every(message => message.requestId === null), 'an attempt row has no request id')

  // The same frozen value must hold at every cut the transcript claims to answer.
  const stable = messages => messages.map(({ messageId, ...row }) => row)
  for (const [cut, rows] of Object.entries(expected.cuts)) {
    assert.deepEqual(stable(units.transcriptAt(folded, Number(cut))), rows,
      `transcript at cut ${cut} must match the frozen prefix`)
  }

  // The read face serves the same folded facts; the frozen fixture is the
  // independent expectation, and this asserts the endpoint is on that path.
  const read = await post('/chat/read', alice.token, { sessionId })
  const logDerived = ({ availability, ...task }) => task
  assert.deepEqual(read.projection.tasks.filter(task => task.availability === 0).map(logDerived),
    work.tasks.filter(task => task.availability === 0).map(logDerived),
    'the endpoint must serve the folded roster')
  assert.equal(read.projection.activity.status, work.activity.status)
  assert.deepEqual(read.projection.activity.reasons, work.activity.reasons)
})
