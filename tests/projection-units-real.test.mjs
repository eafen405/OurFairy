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
 * frozen rows omit `messageId`; every other field is the captured value except
 * `tools`, which #213 added afterwards: the row it was added to (the
 * `todo_write` step) is the one place this fixture is not a pure capture.
 *
 * #251 shifted every seq at or after the first human message by three: mounting
 * the title rows makes the product write `session/title` (fallback),
 * `session/title-llm-request` (the auxiliary route record) and `session/title`
 * (the model's title) into the same log. Only the seq fields, the cut keys and
 * the activity episode id moved — the capture's rows, their order, statuses,
 * texts and the tasks/activity values are unchanged, which is what re-running
 * this suite against the shifted capture proves.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { describeRun, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort } from './helpers/backend.mjs'
// Registers Node resolution for the pinned dsh checkout before the product
// modules below are loaded (they are dynamic imports for that reason).
import './helpers/dsh-peers.mjs'

import { startTitleAwareModel } from './helpers/title-aware.mjs'
const units = await import('../backend/chat/dist/units.js')
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

/**
 * Rebase a value's absolute log offsets onto the smallest offset it carries.
 *
 * The frozen capture recorded offsets from a log that had no electricity-bill
 * reading. The deployment now appends one to the request tail from the second
 * turn onward, which legitimately pushes every later offset out by one per turn.
 * A frozen capture cannot own an absolute offset, but it does own the distances
 * between rows, so both sides are rebased onto their own origin and compared.
 * Only offset-shaped fields move; every other field is compared exactly.
 * @param value - a row list, a work read, or any nested part of one.
 * @returns the same shape with offsets made relative to one origin.
 */
function rebaseOffsets(value) {
  const isOffsetKey = key => /Seq$/u.test(key)
  const episodeNumber = text => {
    const match = /\/(\d+)$/u.exec(text)
    return match === null ? undefined : Number(match[1])
  }
  const seen = []
  const collect = node => {
    if (Array.isArray(node)) return node.forEach(collect)
    if (node === null || typeof node !== 'object') return
    for (const [key, entry] of Object.entries(node)) {
      if (isOffsetKey(key) && Number.isSafeInteger(entry)) seen.push(entry)
      else if (key === 'episodeId' && typeof entry === 'string') {
        const number = episodeNumber(entry)
        if (number !== undefined) seen.push(number)
      } else collect(entry)
    }
  }
  collect(value)
  // One origin for the whole value: a per-container origin would erase exactly the
  // constant shift this rebasing exists to absorb.
  const origin = seen.length === 0 ? 0 : Math.min(...seen) - 5
  const walk = node => {
    if (Array.isArray(node)) return node.map(walk)
    if (node === null || typeof node !== 'object') return node
    const out = {}
    for (const [key, entry] of Object.entries(node)) {
      if (isOffsetKey(key) && Number.isSafeInteger(entry)) out[key] = entry - origin
      else if (key === 'episodeId' && typeof entry === 'string') {
        const number = episodeNumber(entry)
        out[key] = number === undefined ? entry : entry.replace(/\/\d+$/u, `/${number - origin}`)
      } else out[key] = walk(entry)
    }
    return out
  }
  return walk(value)
}

/**
 * Compare the unit read against the frozen values, ignoring per-run generated
 * ids and the position #224 added after the capture.
 */
function assertSameProjection(events, sessionId, running = false) {
  // The capture predates #321's row fields, so the frozen comparison strips them
  // the same way it already strips the generated message id and `position`: every
  // field the capture does carry is still compared exactly. The fields themselves
  // are asserted below, on this same real log.
  const stable = messages => messages.map(({ messageId, position: _position, seq: _seq, turn: _turn, usage: _usage, ...row }) => row)
  const ctx = { jobs: { generation: 'no-live-registry', list: () => [] } }
  const transcriptState = events.reduce(units.transcriptDefinition.apply, units.transcriptDefinition.init({ id: sessionId }, 0))
  const workState = events.reduce(units.workDefinition.apply, units.workDefinition.init({ id: sessionId }, 0))
  const work = units.tasksAndActivityAt(workState, ctx, sessionId, running, events.at(-1)?.seq ?? -1)
  const rows = units.transcriptAt(transcriptState)
  assert.deepEqual(stable(rows), stable(expected.transcript),
    `transcript must match the frozen rows; turn endings: ${JSON.stringify(
      events.filter(event => event.type === 'turn/end').map(event => event.data.reason),
    )}`)
  // The capture's array order is the first-appearance order, so it is the
  // independent expectation for each row's place.
  assert.deepEqual(rows.map(message => message.position), expected.transcript.map((_, index) => index))
  // `seq` is stripped above because it is an absolute offset into this run's log,
  // and the deployment now appends a bill reading to the request tail from the
  // second turn on, which moves every later offset out by one per turn. What the
  // capture can still promise about offsets is their shape, so it is asserted
  // directly: every row names a real, strictly increasing place inside this log.
  const rowSeqs = rows.map(message => message.seq)
  const lastSeq = events.at(-1)?.seq ?? -1
  assert.ok(rowSeqs.every(seq => Number.isSafeInteger(seq) && seq >= 0 && seq <= lastSeq),
    `every row seq must address this log (last ${lastSeq}); got ${JSON.stringify(rowSeqs)}`)
  for (let index = 1; index < rowSeqs.length; index++) {
    assert.ok(rowSeqs[index] > rowSeqs[index - 1],
      `row seqs must strictly increase in presentation order; got ${JSON.stringify(rowSeqs)}`)
  }
  assert.deepEqual(rebaseOffsets(work), rebaseOffsets(expected.work),
    'tasks and activity must match the frozen values')
  return { transcriptState, workState, work }
}

before(async () => {
  // A tool call first, then a normal reply: the log then contains a tool call,
  // its result, and the two assistant messages the product wrote for them.
  model = await startTitleAwareModel({ apiKey: 'mock-key',
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
  // A cut is an absolute offset into the capture's log, so it is re-anchored onto
  // this run's log. The invariant the capture records is positional: cutting at a
  // row answers the first N rows of first-appearance order. So the frozen cut is
  // read as "keep the first N rows", and this run's equivalent cut is the seq of
  // its own N-th row — which is what the frozen cut meant in a log without the
  // bill reading, and what it still means with one.
  const stable = messages => messages.map(({ messageId, position: _position, seq: _seq, turn: _turn, usage: _usage, ...row }) => row)
  const allRows = units.transcriptAt(folded)
  for (const [cut, rows] of Object.entries(expected.cuts)) {
    const anchor = rows.length === 0 ? 0 : (allRows[rows.length - 1]?.seq ?? 0)
    const at = units.transcriptAt(folded, anchor)
    assert.deepEqual(stable(at), stable(rows),
      `transcript at cut ${cut} must match the frozen prefix`)
    // A cut sees a prefix of the first-appearance order, so its places run from zero.
    assert.deepEqual(at.map(message => message.position), rows.map((_, index) => index),
      `positions at cut ${cut} must name the frozen prefix places`)
  }

  // #321: the real log reports provider usage, so each settled turn names its
  // spend on exactly one row — its last Fairy row — and every row names its turn.
  const rows321 = units.transcriptAt(folded)
  const withUsage = rows321.filter(row => row.usage !== undefined)
  assert.ok(withUsage.length > 0, `the real log must report turn spend; rows: ${JSON.stringify(rows321)}`)
  const turns = [...new Set(rows321.map(row => row.turn))]
  // The scenario drives three turns: a tool call, a plain reply, and a failed
  // stream. Each settled turn carries its own spend on one row only.
  assert.deepEqual(turns, [1, 2, 3], `the log must span three turns; rows: ${JSON.stringify(rows321)}`)
  assert.equal(withUsage.length, turns.length,
    `each settled turn reports its spend once; rows: ${JSON.stringify(withUsage)}`)
  for (const turn of turns) {
    const fairy = rows321.filter(row => row.turn === turn && row.role === 2)
    const carrier = withUsage.filter(row => row.turn === turn)
    assert.equal(carrier.length, 1, `turn ${turn} must name its spend on exactly one row`)
    assert.equal(carrier[0].messageId, fairy.at(-1)?.messageId,
      `turn ${turn} must name its spend on its last Fairy row`)
    // The provider's buckets are per-attempt sums: it reports no cache for this
    // mock, so the bucket names none rather than claiming a zero cache.
    assert.deepEqual(Object.keys(carrier[0].usage).sort(), ['input', 'output'])
  }
  // Every row names the turn whose events produced it; the log starts at turn 1
  // and the delivery-free flow leaves no row outside a turn.
  assert.ok(rows321.every(row => row.turn > 0), `every row must name a turn; rows: ${JSON.stringify(rows321)}`)
  assert.deepEqual(rows321.map(row => row.turn), [...rows321.map(row => row.turn)].sort((left, right) => left - right),
    'the first-appearance order keeps turns in order in this log')

  // The read face serves the same folded facts; the frozen fixture is the
  // independent expectation, and this asserts the endpoint is on that path.
  const read = await post('/chat/read', alice.token, { sessionId })
  // The read is served from the same unit state: the wire rows are the folded
  // rows, positions included.
  assert.deepEqual(read.projection.messages, units.transcriptAt(folded),
    'the endpoint must serve the folded transcript rows')
  const logDerived = ({ availability, ...task }) => task
  assert.deepEqual(read.projection.tasks.filter(task => task.availability === 0).map(logDerived),
    work.tasks.filter(task => task.availability === 0).map(logDerived),
    'the endpoint must serve the folded roster')
  assert.equal(read.projection.activity.status, work.activity.status)
  assert.deepEqual(read.projection.activity.reasons, work.activity.reasons)
})
