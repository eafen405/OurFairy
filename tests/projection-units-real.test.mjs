/**
 * Field-for-field differential between the projection units and the full folds,
 * over a REAL session log (ticket #89).
 *
 * The unit-level suite (`projection-units.test.mjs`) pins the folds against
 * hand-written logs covering each event shape. This suite proves the same
 * equality on events the product actually wrote: it boots the real backend
 * against the model double, drives a conversation containing a tool call, a
 * settled reply and an attempt that ends without a visible message, pages the
 * whole log back through `/chat/page`, and folds that log with both
 * implementations.
 *
 * The page endpoint still reads the log itself in this ticket (that switch is
 * #90/#91); it is used here only as the public way to obtain the committed
 * events, so the comparison never reaches into a private event reader.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { describeRun, makeHome, registerUser, removeHome, repoRoot, runBackendAsync, startArgs, startedPort } from './helpers/backend.mjs'
// Registers Node resolution for the pinned dsh checkout before the product
// modules below are loaded (they are dynamic imports for that reason).
import './helpers/dsh-peers.mjs'

const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const { startMockLlmServer } = await import(join(combo.repos.dsh.localPath, 'packages/test-support/llm-mock-server/lib/index.js'))
const { transcript } = await import('../backend/chat/src/projection.mjs')
const { projectSession } = await import('../backend/chat/src/history.mjs')
const units = await import('../backend/chat/src/units.mjs')

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

/** Fold one log both ways and assert the wire projections agree. */
function assertSameProjection(events, sessionId, running = false) {
  const ctx = { jobs: { generation: 'no-live-registry', list: () => [] } }
  const transcriptState = events.reduce(units.transcriptDefinition.apply, units.transcriptDefinition.init({ id: sessionId }, 0))
  const workState = events.reduce(units.workDefinition.apply, units.workDefinition.init({ id: sessionId }, 0))
  const work = units.tasksAndActivityAt(workState, ctx, sessionId, running, events.at(-1)?.seq ?? -1)
  assert.deepEqual(units.transcriptAt(transcriptState), transcript(events, sessionId), 'transcript must match the full fold')
  assert.deepEqual(work, projectSession(ctx, events, sessionId, running), 'tasks and activity must match the full fold')
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

test('the units reproduce the full folds over a real session log', async () => {
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

  // The same equality must hold at every cut the transcript claims to answer.
  const transcriptState = events.reduce(units.transcriptDefinition.apply, units.transcriptDefinition.init({ id: sessionId }, 0))
  for (const event of events.filter(item => ['user/message', 'assistant/message', 'delivery/message', 'assistant/attempt', 'turn/end'].includes(item.type))) {
    assert.deepEqual(units.transcriptAt(transcriptState, event.seq), transcript(events.slice(0, event.seq + 1), sessionId),
      `transcript at cut ${event.seq} (${event.type}) must equal the prefix fold`)
  }

  // The read face the runtime will use keeps the same activity at the cursor.
  const read = await post('/chat/read', alice.token, { sessionId })
  const logDerived = ({ availability, ...task }) => task
  assert.deepEqual(work.tasks.filter(task => task.availability === 0).map(logDerived),
    read.projection.tasks.filter(task => task.availability === 0).map(logDerived),
    'the folded roster must carry the same log-derived fields the live projection serves')
  assert.equal(work.activity.status, read.projection.activity.status)
  assert.deepEqual(work.activity.reasons, read.projection.activity.reasons)
})
