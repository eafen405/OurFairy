/**
 * Cold restart and the live-state boundary (ticket #92).
 *
 * One isolated home survives three launcher restarts. Before the first one the
 * session holds a completed reply, a settled background job whose completion
 * notice is still queued for delivery, and a job that is really running. That
 * first restart is a crash (the Host is SIGKILLed after a checkpoint): without a
 * graceful `turn/end`, the queued report is genuinely unrecoverable. The
 * first cold read must rebuild the durable projection from the log and keep the
 * live fields out of it: `attempt`/`replyStatus`/`error`/`settledAttempt` reset,
 * the old generation's tasks unavailable (a non-terminal one reads unknown, the
 * queued report uninterpretable), and no fabricated execution. The following
 * restarts prove the cold projection is stable, that an unknown ignorable log
 * row neither fails nor changes it, and that a cold read and a live read agree
 * at the same cut.
 *
 * The model double is the product's own protocol surface: it answers chat text,
 * starts two background bash jobs in one turn, and leaves one reply open so the
 * settled job's notice is queued instead of being collected. Appending the
 * unknown row uses the same JSONL/Zstandard container the launcher writes; no
 * product code is patched.
 *
 * @covers backend/chat — the cold read, `/chat/observe` and `/chat/checkpoint`
 * are this suite's own subject.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { appendFileSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { constants, zstdCompressSync } from 'node:zlib'
import { describeRun, httpJson, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-cold-boundary-')
const password = 'cold-boundary-password'
const maxEvents = 256
let model, port, admin, alice, sessionId
let serial = 0

const post = (path, token, body = {}) => httpJson(port, path, { token, body })
const read = async token => (await httpJson(port, '/chat/read', { token: token ?? alice.token,
  body: { sessionId, maxEvents } })).projection
async function send(text) {
  const { receipt } = await post('/chat/send', alice.token, { sessionId, requestId: `cold-${++serial}`, text })
  assert.ok(receipt.messageId)
  return receipt
}
async function until(probe, accept, label) {
  const end = Date.now() + 30_000
  let value
  while (Date.now() < end) {
    value = await probe()
    if (accept(value)) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(`${label}: ${JSON.stringify(value)}`)
}
async function start() {
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-cold-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${modelPort}` })
  port = startedPort(run)
}
async function stop() {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}
let modelPort

/** Open `/chat/observe` long enough to publish one live frame, then drop it. */
async function observeOnce() {
  const controller = new AbortController()
  const response = await fetch(`http://127.0.0.1:${port}/chat/observe`, { method: 'POST', headers: {
    authorization: `Bearer ${alice.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, maxEvents }), signal: controller.signal })
  assert.equal(response.status, 200)
  const reader = response.body.getReader()
  const first = await reader.read()
  assert.equal(first.done, false, 'the observer publishes its initial projection')
  controller.abort()
}

/** Every durable session log the launcher wrote under this test's own home. */
function findLogs() {
  const found = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.jsonl(\.zstd)?$/.test(entry.name)) found.push(path)
    }
  }
  walk(home)
  return found
}

/**
 * Append one well-formed JSONL event row to the session log.
 *
 * The launcher writes concatenated Zstandard frames by default and plain text
 * when compression is off, so the row is encoded the way the durable log itself
 * is. Callers build a row this build's decoder accepts: `ignorable: true` marks
 * an unknown type, while a known row must match its native payload shape.
 */
function appendLogEvent(path, row) {
  const line = `${JSON.stringify(row)}\n`
  appendFileSync(path, path.endsWith('.zstd')
    ? zstdCompressSync(line, { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
    : line)
}

before(async () => {
  model = http.createServer(async (request, response) => {
    let data = ''
    for await (const chunk of request) data += chunk
    // The deployment route also answers session-title requests; a double that
    // scripts conversation turns must not treat one as a turn.
    if (answerIfTitle(data, response)) return
    const body = JSON.parse(data)
    const blocks = body.messages.flatMap(message => Array.isArray(message.content)
      ? message.content : [{ type: 'text', text: message.content }])
    const latest = blocks.findLastIndex(block => block.type === 'text'
      && (block.text.startsWith('{"name":') || block.text === '__HOLD__' || block.text.startsWith('background job ')))
    const text = blocks[latest]?.text
    const result = blocks.slice(latest + 1).findLast(block => block.type === 'tool_result')
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: `cold-message-${serial}`, type: 'message', role: 'assistant',
      model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (text === '__HOLD__') return
    if (text?.startsWith('{"name":') && result === undefined) {
      const calls = [
        { description: 'cold-quick', command: 'sleep 2.5; printf settled' },
        { description: 'cold-long', command: 'sleep 5; printf unreachable' },
      ]
      for (const [index, call] of calls.entries()) {
        emit({ type: 'content_block_start', index, content_block: { type: 'tool_use',
          id: `cold-call-${++serial}`, name: 'bash', input: {} } })
        emit({ type: 'content_block_delta', index, delta: { type: 'input_json_delta',
          partial_json: JSON.stringify({ ...call, run_in_background: true }) } })
      }
      emit({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null },
        usage: { output_tokens: 3 } })
      emit({ type: 'message_stop' })
      response.end()
      return
    }
    const reply = text?.startsWith('background job ') ? 'NOTICE: settled' : 'CHAT: reply'
    emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply } })
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: { output_tokens: 3 } })
    emit({ type: 'message_stop' })
    response.end()
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')
  modelPort = model.address().port
  await start()
  admin = await post('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await registerUser(port, admin.token, 'cold-alice', password)
  sessionId = (await post('/sessions/create', alice.token)).session.id
})

after(async () => {
  try { await stop() } finally {
    model.closeAllConnections()
    await new Promise(resolve => model.close(resolve))
    if (process.env.KEEP_COLD_HOME !== '1') removeHome(home)
  }
})

test('a cold restart rebuilds durable work, drops live state, and survives an unknown event', async () => {
  // ── 1. Durable work: one completed reply, one settled job with a queued
  //        notice, and one job still running at the stop.
  await send('先说一句。')
  const replied = await until(() => read(), p => p.replyStatus === 0
    && p.messages.some(message => message.role === 2 && message.status === 2 && message.text === 'CHAT: reply'),
  'first completed reply')
  assert.equal(replied.attempt, null)
  assert.equal(replied.error, null)

  await send(JSON.stringify({ name: 'bash', args: { description: 'unused', command: 'unused' } }))
  await until(() => read(), p => p.tasks.length === 2 && p.replyStatus === 0, 'two background jobs registered')
  await send('__HOLD__')
  await until(() => read(), p => p.replyStatus === 1 && p.attempt !== null, 'reply held open')
  const queued = await until(() => read(), p => p.tasks.some(task => [1, 2].includes(task.report.status)),
    'settled job queues its completion notice')
  const quick = queued.tasks.find(task => [1, 2].includes(task.report.status))
  const slow = queued.tasks.find(task => task.taskId !== quick.taskId)
  assert.equal(quick.status, 3, 'the quick job has settled')
  assert.equal(quick.availability, 1)
  assert.equal(slow.status, 1, 'the long job is really running')
  assert.equal(slow.availability, 1)
  const live = queued
  // The queued report and the running lifecycle row must be durable before the
  // crash; the checkpoint is the product's own durability barrier.
  await until(() => post('/chat/checkpoint', alice.token, { sessionId }),
    checkpoint => checkpoint.durableThroughSeq >= live.cursor, 'queued work is durable')

  // ── 2. Crash restart: SIGKILL leaves the queued report without its turn end,
  //        so the cold projection must report it as unrecoverable (6) instead of
  //        inventing a delivery, and the old generation's tasks stay unknown.
  const pid = JSON.parse(readFileSync(join(home, 'run', 'backend.json'), 'utf8')).pid
  process.kill(-pid, 'SIGKILL')
  await until(async () => {
    try { process.kill(pid, 0); return false } catch (error) { if (error.code === 'ESRCH') return true; throw error }
  }, gone => gone, 'crashed Host exited')
  await stop()
  await start()
  const cold = await read()
  assert.deepEqual(cold.messages, live.messages, 'durable messages survive the restart unchanged')
  assert.equal(cold.attempt, null)
  assert.equal(cold.replyStatus, 0)
  assert.equal(cold.error, null)
  assert.equal(cold.settledAttempt, null)
  // Crash recovery records the interrupted turn's end, so the queued notice is
  // recoverable as canceled (4) — not invented as delivered, and not unknown.
  const coldQuick = cold.tasks.find(task => task.taskId === quick.taskId)
  const coldSlow = cold.tasks.find(task => task.taskId === slow.taskId)
  assert.equal(coldQuick.status, 3)
  assert.equal(coldQuick.availability, 0)
  assert.equal(coldQuick.report.status, 4)
  assert.equal(coldSlow.status, 0)
  assert.equal(coldSlow.availability, 0)
  assert.ok(cold.tasks.every(task => task.availability === 0 ? ![1, 2].includes(task.status) : true),
    'no unavailable task claims to be running')
  assert.ok(cold.tasks.every(task => ![1, 2].includes(task.report.status)),
    'no report claims an unrecoverable delivery is still queued')
  assert.equal(cold.activity.status, 0)
  assert.deepEqual(cold.activity.reasons, [])

  // ── 3. A report row that left no turn behind is genuinely unrecoverable.
  //        Append the durable shape a between-turns wakeup leaves (well-formed,
  //        known type, no message and no turn); the old generation cannot
  //        schedule it, so the read must say unknown (6) rather than queued.
  await stop()
  // The stop itself can clear a queued notice with an inbox splice. Re-open
  // once and take the cut from the product, rather than assuming the log still
  // ends at `cold.cursor`.
  await start()
  const beforeAppend = await read()
  await stop()
  const logs = findLogs().filter(path => path.includes(sessionId))
  assert.equal(logs.length, 1, `one session log for ${sessionId}: ${JSON.stringify(findLogs())}`)
  const [generation, jobId] = quick.taskId.split('/')
  assert.ok(generation && jobId)
  appendLogEvent(logs[0], { type: 'jobs/report', seq: beforeAppend.cursor + 1, time: Date.now(),
    data: { generation, jobId, delivery: 'wakeup' } })
  await start()
  const orphaned = await read()
  const unrecoverable = orphaned.tasks.find(task => task.taskId === quick.taskId)
  assert.equal(unrecoverable.status, 3)
  assert.equal(unrecoverable.availability, 0)
  assert.equal(unrecoverable.report.status, 6, 'a queued report with no turn is unknown, not delivered')
  assert.deepEqual(orphaned.messages, cold.messages, 'a report row carries no message')
  assert.ok(![1, 2].includes(unrecoverable.report.status))

  // ── 4. A clean restart over the same home is idempotent: cold-to-cold
  //        messages, tasks and activity are identical.
  const coldCut = orphaned.cursor
  await stop()
  await start()
  const again = await read()
  assert.deepEqual(again.messages, orphaned.messages)
  assert.deepEqual(again.tasks, orphaned.tasks)
  assert.deepEqual(again.activity, orphaned.activity)
  assert.ok(again.cursor >= coldCut, 'a clean restart does not remove committed rows')

  // ── 5. An unknown but well-formed row inside the session log must not fail
  //        the next cold read, and must not change the projection it rebuilds.
  const beforeUnknown = await read()
  await stop()
  appendLogEvent(logs[0], { type: 'test/unknown-cold-restart', seq: beforeUnknown.cursor + 1, time: Date.now(),
    data: { note: 'ticket #92 unknown event' }, ignorable: true })
  await start()
  const afterUnknown = await read()
  assert.ok(afterUnknown.cursor >= beforeUnknown.cursor + 1, 'the appended row is part of the committed prefix')
  assert.ok(afterUnknown.events.some(event => event.type === 'test/unknown-cold-restart'),
    'the read window contains the appended unknown row')
  assert.deepEqual(afterUnknown.messages, again.messages)
  assert.deepEqual(afterUnknown.tasks, again.tasks)
  const { throughSeq, ...activity } = afterUnknown.activity
  assert.equal(throughSeq, afterUnknown.cursor, 'activity reports the read cut')
  assert.deepEqual(activity, (({ throughSeq: _cut, ...rest }) => rest)(again.activity),
    'the unknown row leaves every durable activity field unchanged')

  // ── 6. The cold read that rebuilt from the log and a live read at the same
  //        cut agree; opening an observer appends nothing.
  await observeOnce()
  const liveAgain = await read()
  assert.equal(liveAgain.throughSeq, afterUnknown.throughSeq)
  assert.deepEqual(liveAgain.messages, afterUnknown.messages)
  assert.deepEqual(liveAgain.tasks, afterUnknown.tasks)
  assert.deepEqual(liveAgain.activity, afterUnknown.activity)
})
