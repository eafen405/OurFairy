/** @covers backend/chat backend/delivery — durable commands, observers and lifecycle races over authenticated HTTP. */
import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import http from 'node:http'
import { once } from 'node:events'
import { chmodSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { describeRun, httpJson, makeHome, messageBlocks, registerUser, removeHome, runBackendAsync, startArgs, startedPort, toolResultBlocks } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-command-recovery-')
const password = 'command-recovery-password'
const requests = []
let model, port, admin, alice, bob, holdSummary, heldSummary, holdMain, heldMain, holdDelivery, heldDelivery
let serial = 0
let failSummary = 0
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function until(work, check) {
  const deadline = Date.now() + 30000
  let value
  do {
    value = await work()
    if (check(value)) return value
    await delay(25)
  } while (Date.now() < deadline)
  assert.fail(`condition not reached: ${JSON.stringify(value)}`)
}
const call = (path, token, body = {}, expect = 200) => httpJson(port, path, { token, body, expect })
const read = async (sessionId, token = alice.token) => (await call('/chat/read', token, { sessionId, maxEvents: 256 })).projection
const create = async (token = alice.token) => (await call('/sessions/create', token)).session.id
async function send(sessionId, text, token = alice.token) {
  const seen = new Set((await read(sessionId, token)).messages.map(m => m.messageId))
  await call('/chat/send', token, { sessionId, requestId: `recovery-${++serial}`, text })
  return until(() => read(sessionId, token), p => p.replyStatus === 0 && p.messages.some(m => m.role === 2 && m.status === 2 && !seen.has(m.messageId)))
}
async function execute(input, token = alice.token) {
  await call('/chat/commands/execute', token, input)
  return until(async () => (await call('/chat/commands/status', token, input)).command, c => c?.status !== 1)
}
async function start() {
  port = startedPort(await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${model.address().port}`,
    OURFAIRY_MEMORY_MAINTENANCE_TURNS: '50', OURFAIRY_SKILL_LEARNING_TURNS: '50' }))
}
async function stop() {
  const result = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(result.code, 0, describeRun('stop', result))
}
function answer(response, reply) {
  if (response.destroyed) return
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  emit({ type: 'message_start', message: { id: `recovery-${requests.length}`, type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
  if (reply.tool) {
    emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: reply.tool.callId, name: reply.tool.name, input: {} } })
    emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(reply.tool.args) } })
  } else {
    emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
    emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: reply.text } })
  }
  emit({ type: 'content_block_stop', index: 0 })
  emit({ type: 'message_delta', delta: { stop_reason: reply.tool ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
  emit({ type: 'message_stop' })
  response.end()
}
function observe(sessionId, token = alice.token, maxEvents = 256) {
  const frames = []
  let response, request
  const ready = new Promise((resolve, reject) => {
    const payload = JSON.stringify({ sessionId, maxEvents })
    request = http.request({ host: '127.0.0.1', port, path: '/chat/observe', method: 'POST', agent: false,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, incoming => {
      response = incoming
      if (incoming.statusCode !== 200) { incoming.resume(); reject(new Error(`observe ${incoming.statusCode}`)); return }
      let buffer = ''
      incoming.setEncoding('utf8').on('data', chunk => {
        buffer += chunk
        let end
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const data = frame.split('\n').find(line => line.startsWith('data: '))
          if (data) { frames.push(JSON.parse(data.slice(6))); resolve() }
        }
      })
      incoming.on('error', reject)
    })
    request.on('error', reject).end(payload)
  })
  return { ready, frames, close() { response?.destroy(); request?.destroy() } }
}
function artifact(sessionId) {
  const root = join(home, 'dsh-home', 'sessions')
  const relative = readdirSync(root, { recursive: true }).find(p => p.includes(`${sessionId}/`) && /\.jsonl(\.zstd)?$/.test(p))
  assert.ok(relative)
  return join(root, relative)
}
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex')
before(async () => {
  model = http.createServer(async (incoming, response) => {
    const chunks = []
    for await (const chunk of incoming) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (answerIfTitle(raw, response)) return
    const body = JSON.parse(raw)
    requests.push(body)
    if (JSON.stringify(body.messages).includes('You are now acting as a compaction engine')) {
      if (failSummary > 0) {
        failSummary--
        response.writeHead(400, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'SUMMARY_REFUSED_345' } }))
        return
      }
      if (holdSummary) { holdSummary = false; await new Promise(resolve => { heldSummary = { release: resolve } }) }
      answer(response, { text: 'RECOVERY_SUMMARY_345' })
      return
    }
    const flat = (body.messages ?? []).flatMap(messageBlocks)
    const current = (body.messages ?? []).filter(m => m.role === 'user')
      .map(m => messageBlocks(m).filter(b => b.type === 'text').map(b => b.text).join(''))
      .filter(t => t && !t.startsWith('Current runtime context.') && !t.startsWith('<system-reminder>')).at(-1) ?? ''
    if (holdMain && current.includes('HELD_INPUT_345')) {
      holdMain = false
      await new Promise(resolve => { heldMain = { body, release: resolve } })
    }
    const index = current.startsWith('{"name":') ? flat.findLastIndex(b => b.type === 'text' && b.text === current) : -1
    const result = index < 0 ? undefined : flat.slice(index + 1).findLast(b => b.type === 'tool_result')
    if (index >= 0 && !result && JSON.parse(current).name === 'deliver_message' && holdDelivery) {
      holdDelivery = false
      await new Promise(resolve => { heldDelivery = { release: resolve } })
    }
    answer(response, index >= 0 && !result ? { tool: JSON.parse(current) }
      : { text: result ? `RESULT:${JSON.stringify(toolResultBlocks(result))}` : `REPLY:${requests.length}` })
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')
  await start()
  admin = await call('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await registerUser(port, admin.token, 'recovery-alice', password)
  bob = await registerUser(port, admin.token, 'recovery-bob', password)
})
after(async () => {
  heldSummary?.release()
  await stop()
  model.closeAllConnections()
  await new Promise(resolve => model.close(resolve))
  removeHome(home)
})

test('EACCES after durable acceptance exposes committed completion without reporting durable success, then recovers the old identity', async () => {
  const sessionId = await create()
  await send(sessionId, `WRITER_OLD_345 ${'x'.repeat(48000)}`)
  await send(sessionId, 'WRITER_RECENT_345')
  const stream = observe(sessionId)
  await stream.ready
  const input = { sessionId, requestId: 'writer-compact', command: 1 }
  holdSummary = true
  heldSummary = undefined
  const accepted = (await call('/chat/commands/execute', alice.token, input)).command
  assert.equal(accepted.status, 1)
  await until(async () => heldSummary, Boolean)
  const acknowledged = (await call('/chat/checkpoint', alice.token, { sessionId })).durableThroughSeq
  assert.ok(acknowledged >= accepted.acceptedSeq)
  const file = artifact(sessionId)
  const savedHash = hash(file)
  chmodSync(file, 0o400)
  try {
    heldSummary.release()
    const committed = await until(async () => stream.frames.at(-1), p => p?.messages.some(m => m.requestId === input.requestId && m.commandStatus === 2))
    const completion = committed.messages.find(m => m.requestId === input.requestId)
    assert.equal(committed.durableThroughSeq, acknowledged)
    assert.ok(completion.seq > committed.durableThroughSeq, 'committed is insufficient for a durable success presentation')
    assert.equal((await call('/chat/commands/status', alice.token, input, false)).status, 500)
    assert.equal((await call('/chat/commands/execute', alice.token, input, false)).status, 500)
    assert.equal((await call('/chat/checkpoint', alice.token, { sessionId }, false)).status, 500)
    assert.equal(hash(file), savedHash, 'the real permission failure left JSONL bytes unchanged')
  } finally {
    chmodSync(file, 0o600)
    stream.close()
    heldSummary.release()
  }
  await call('/chat/checkpoint', alice.token, { sessionId })
  const result = (await call('/chat/commands/status', alice.token, input)).command
  assert.equal(result.status, 2)
  assert.equal(result.commandId, accepted.commandId)
  assert.equal(result.acceptedSeq, accepted.acceptedSeq)
  assert.ok((await read(sessionId)).durableThroughSeq >= result.completedSeq)
  const count = requests.length
  await stop()
  await start()
  assert.deepEqual((await call('/chat/commands/status', alice.token, input)).command, result)
  assert.deepEqual((await call('/chat/commands/execute', alice.token, input)).command, result)
  assert.equal(requests.length, count, 'recovery never summarizes again')
  const recovered = await read(sessionId)
  assert.equal(recovered.events.filter(e => e.type === 'compaction/summary').length, 1)
  assert.equal(recovered.messages.filter(m => m.requestId === input.requestId).length, 1)
})

async function pagesAt(sessionId, cut) {
  const pages = [], events = [], messages = new Map()
  let beforeSeq = cut + 1
  while (beforeSeq > 0) {
    const body = { sessionId, throughSeq: cut, beforeSeq, maxEvents: 7 }
    const { page } = await call('/chat/page', alice.token, body)
    assert.ok(page.events.length <= 7)
    assert.ok(page.events.every(e => e.seq <= cut && e.seq < beforeSeq))
    pages.push({ body, page })
    events.unshift(...page.events)
    for (const message of page.messages) messages.set(message.messageId, message)
    beforeSeq = page.beforeSeq ?? 0
  }
  assert.deepEqual(events.map(e => e.seq), Array.from({ length: cut + 1 }, (_, i) => i))
  return { pages, events, messages: [...messages.values()].sort((a, b) => a.position - b.position) }
}
async function losePage(body) {
  await new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const request = http.request({ host: '127.0.0.1', port, path: '/chat/page', method: 'POST', agent: false,
      headers: { authorization: `Bearer ${alice.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, response => {
      assert.equal(response.statusCode, 200)
      response.destroy()
      request.destroy()
      resolve()
    })
    request.on('error', reject).end(payload)
  })
}
function compareVersion(left, right) {
  for (const key of ['sessionId', 'version', 'cursor', 'messages', 'attempt', 'settledAttempt', 'replyStatus', 'error', 'durableThroughSeq']) {
    assert.deepEqual(left[key], right[key], `common version ${left.version}: ${key}`)
  }
}
function commonVersions(left, right) {
  const index = new Map(right.frames.map(p => [p.version, p]))
  return left.frames.filter(p => index.has(p.version)).map(p => [p, index.get(p.version)])
}

test('two observers, reconnect and fixed cuts retain old history and one boundary through append, late retry and restart', async () => {
  const sessionId = await create()
  for (let i = 0; i < 4; i++) await send(sessionId, `PAGED_OLD_345_${i}`)
  const first = observe(sessionId)
  const second = observe(sessionId)
  let newcomer
  await Promise.all([first.ready, second.ready])
  const c0 = (await read(sessionId)).cursor
  const before = await pagesAt(sessionId, c0)
  assert.ok(before.pages.length > 2)
  const input = { sessionId, requestId: 'observed-clear', command: 2 }
  const result = await execute(input)
  const c1 = (await read(sessionId)).cursor
  const boundary = await pagesAt(sessionId, c1)
  const row = boundary.messages.find(m => m.messageId === `command:${result.commandId}`)
  assert.equal(row.commandStatus, 4)
  assert.equal(row.seq, result.completedSeq)
  assert.equal(boundary.messages.filter(m => m.kind === 3 && m.role === 3).length, 1)
  assert.equal(boundary.events.filter(e => e.type === 'user/message' && e.data.source.kind === 'ourfairy-context-reset').length, 1)
  for (const old of before.messages) assert.deepEqual(boundary.messages.find(m => m.messageId === old.messageId), old)
  try {
    for (const observation of [first, second]) await until(async () => observation.frames.at(-1), p => p?.messages.some(m => m.commandId === result.commandId && m.commandStatus === 4) && p.durableThroughSeq >= result.completedSeq)
    const pairs = commonVersions(first, second)
    assert.ok(pairs.some(([p]) => p.messages.some(m => m.commandStatus === 4)), 'both devices share a durable command publication')
    for (const pair of pairs) compareVersion(...pair)
    first.close()
    newcomer = observe(sessionId)
    await newcomer.ready
    await send(sessionId, 'PAGED_NEW_SURVIVES_345')
    assert.deepEqual((await call('/chat/commands/execute', alice.token, input)).command, result)
    await until(async () => commonVersions(newcomer, second), pairs => pairs.some(([p]) => p.replyStatus === 0 && p.messages.some(m => m.text === 'PAGED_NEW_SURVIVES_345')))
    for (const pair of commonVersions(newcomer, second)) compareVersion(...pair)
    for (const snapshot of [before, boundary]) {
      for (const { body, page } of snapshot.pages) {
        await losePage(body)
        assert.deepEqual((await call('/chat/page', alice.token, body)).page, page, 'lost-response replay keeps the original cut')
      }
    }
    assert.ok(!JSON.stringify(before.events).includes(result.commandId))
    assert.ok(!JSON.stringify(boundary.events).includes('PAGED_NEW_SURVIVES_345'))
  } finally { first.close(); second.close(); newcomer?.close() }
  await stop()
  await start()
  assert.deepEqual((await call('/chat/commands/status', alice.token, input)).command, result)
  for (const snapshot of [before, boundary]) for (const { body, page } of snapshot.pages) assert.deepEqual((await call('/chat/page', alice.token, body)).page, page)
  const recovered = await read(sessionId)
  assert.equal(recovered.messages.filter(m => m.commandId === result.commandId).length, 1)
  assert.deepEqual(recovered.messages.find(m => m.commandId === result.commandId), row)
  await send(sessionId, 'PAGED_COLD_PROBE_345')
  const wire = JSON.stringify(requests.at(-1).messages)
  assert.ok(wire.includes('PAGED_NEW_SURVIVES_345'))
  assert.ok(!wire.includes('PAGED_OLD_345_'))
})

test('an idle session with a real running job refuses commands without stopping it or executing them later', async () => {
  const sessionId = await create()
  const release = () => writeFileSync(join(home, 'dsh-home', 'spaces', 'private', String(alice.user.shortId), 'command-job-release'), 'ready')
  const directive = { name: 'bash', callId: `job-tool-${++serial}`, args: { command: 'printf JOB_READY_345; while [ ! -f command-job-release ]; do sleep .02; done; printf JOB_DONE_345', description: 'run a releasable session-owned job', run_in_background: true } }
  try {
    await send(sessionId, JSON.stringify(directive))
    const idle = await until(() => read(sessionId), p => p.replyStatus === 0 && p.tasks.some(t => t.status === 1))
    const task = idle.tasks.find(t => t.status === 1)
    assert.equal(task.availability, 1)
    const output = await until(async () => (await call('/chat/jobs/output', alice.token, { sessionId, taskId: task.taskId, from: 0 })).output, o => o.chunks.some(c => c.text.includes('JOB_READY_345')))
    assert.ok(output.next > 0)
    for (const command of [1, 2]) {
      const input = { sessionId, requestId: `job-refused-${command}`, command }
      const refused = await call('/chat/commands/execute', alice.token, input, false)
      assert.equal(refused.status, 409)
      assert.equal(refused.json.error.code, 'chat/session-busy')
      assert.equal((await call('/chat/commands/status', alice.token, input)).command, null)
      const active = await read(sessionId)
      assert.equal(active.replyStatus, 0, 'the job, independently of a reply, keeps commands busy')
      assert.equal(active.tasks.find(t => t.taskId === task.taskId).status, 1)
    }
    release()
    const finished = await until(() => read(sessionId), p => p.replyStatus === 0 && p.tasks.find(t => t.taskId === task.taskId)?.report.status === 3)
    assert.equal(finished.tasks.find(t => t.taskId === task.taskId).status, 3)
    const finalOutput = (await call('/chat/jobs/output', alice.token, { sessionId, taskId: task.taskId, from: 0 })).output
    assert.ok(finalOutput.chunks.map(c => c.text).join('').includes('JOB_DONE_345'))
    assert.equal(finished.events.filter(e => e.type === 'command/run').length, 0, 'refused commands never run after job completion')
    for (const command of [1, 2]) assert.equal((await call('/chat/commands/status', alice.token, { sessionId, requestId: `job-refused-${command}` })).command, null)
    assert.equal((await execute({ sessionId, requestId: 'job-finished-explicit-clear', command: 2 })).status, 4)
  } finally { release() }
})

test('queued input survives command refusal and no rejected reset executes when the held reply finishes', async () => {
  const sessionId = await create()
  await send(sessionId, 'QUEUED_OLD_CONTEXT_345')
  holdMain = true
  heldMain = undefined
  const pending = send(sessionId, 'HELD_INPUT_345')
  try {
    await until(async () => heldMain, Boolean)
    const receipt = (await call('/chat/send', alice.token, { sessionId, requestId: 'queued-after-held', text: 'QUEUED_ACCEPTED_345' })).receipt
    assert.ok(receipt.messageId)
    for (const command of [1, 2]) {
      const input = { sessionId, requestId: `queue-refused-${command}`, command }
      const refused = await call('/chat/commands/execute', alice.token, input, false)
      assert.equal(refused.status, 409)
      assert.equal(refused.json.error.code, 'chat/session-busy')
      assert.equal((await call('/chat/commands/status', alice.token, input)).command, null)
    }
    assert.equal((await read(sessionId)).replyStatus, 1)
    heldMain.release()
    await pending
    await until(() => read(sessionId), p => p.replyStatus === 0 && p.messages.some(m => m.messageId === receipt.messageId))
    await send(sessionId, 'QUEUED_FINAL_PROBE_345')
    const wire = JSON.stringify(requests.at(-1).messages)
    for (const marker of ['QUEUED_OLD_CONTEXT_345', 'HELD_INPUT_345', 'QUEUED_ACCEPTED_345']) assert.ok(wire.includes(marker), `${marker} remains after refusal`)
    const final = await read(sessionId)
    assert.equal(final.events.filter(e => e.type === 'command/run').length, 0)
    assert.equal(final.messages.filter(m => m.kind === 3 && m.role === 3).length, 0)
    for (const command of [1, 2]) assert.equal((await call('/chat/commands/status', alice.token, { sessionId, requestId: `queue-refused-${command}` })).command, null)
  } finally { heldMain?.release(); holdMain = false; await pending }
})

test('a refused summary reports a durable failure with its cause and preserves context and automatic settings', async () => {
  const sessionId = await create()
  const gatewayBefore = (await call('/gateway/read', admin.token)).gateway
  await send(sessionId, `REFUSED_SUMMARY_OLD_345 ${'x'.repeat(48000)}`)
  await send(sessionId, 'REFUSED_SUMMARY_RECENT_345')
  failSummary = 1
  try {
    const result = await execute({ sessionId, requestId: 'refused-summary', command: 1 })
    assert.equal(result.status, 5)
    assert.equal(result.error.code, 2)
    assert.equal(failSummary, 0, 'the real native summary request reached the HTTP 400 response')
    assert.match(result.error.message, /could not produce a smaller summary/)
    const projection = await read(sessionId)
    assert.ok(projection.durableThroughSeq >= result.completedSeq)
    const row = projection.messages.find(m => m.commandId === result.commandId)
    assert.equal(row.commandStatus, 5)
    assert.equal(row.status, 4)
    assert.deepEqual(row.commandError, result.error)
    assert.equal(projection.events.filter(e => e.type === 'compaction/summary').length, 0)
    assert.equal(projection.events.filter(e => e.type === 'turn/end').length, 2, 'failure does not create a chat turn')
    await send(sessionId, 'REFUSED_SUMMARY_PROBE_345')
    const wire = JSON.stringify(requests.at(-1).messages)
    assert.ok(wire.includes('REFUSED_SUMMARY_OLD_345'))
    assert.ok(wire.includes('REFUSED_SUMMARY_RECENT_345'))
    const gatewayAfter = (await call('/gateway/read', admin.token)).gateway
    assert.deepEqual(gatewayAfter.compaction, gatewayBefore.compaction)
    assert.equal(gatewayAfter.saved.compaction, gatewayBefore.saved.compaction)
  } finally { failSummary = 0 }
})

test('real cross-user delivery racing clear has one durable landing and follows the reset boundary without recipient inference', async () => {
  const target = (await call('/sessions/primary', bob.token)).session.id
  const sender = await create()
  for (let round = 0; round < 2; round++) {
    const old = `DELIVERY_OLD_345_${round}`
    const delivered = `DELIVERY_RACE_345_${round}`
    await send(target, old, bob.token)
    const count = requests.length
    holdDelivery = true
    heldDelivery = undefined
    const pending = send(sender, JSON.stringify({ name: 'deliver_message', callId: `delivery-call-${++serial}`,
      args: { recipientShortId: bob.user.shortId, text: delivered } }))
    try {
      await until(async () => heldDelivery, Boolean)
      // The first delivery must precede a reset, so cold replay always exercises
      // a span containing delivery/message; the second races the real writer.
      if (round === 0) { heldDelivery.release(); await pending }
      const input = { sessionId: target, requestId: `delivery-clear-${round}`, command: 2 }
      const clearing = call('/chat/commands/execute', bob.token, input, false)
      heldDelivery.release()
      const [outcome] = await Promise.all([clearing, pending])
      const projection = await read(target, bob.token)
      const deliveries = projection.events.filter(e => e.type === 'delivery/message'
        && e.data.message.content.some(b => b.type === 'text' && b.text === delivered))
      assert.equal(deliveries.length, 1)
      assert.equal(deliveries[0].data.origin.sessionId, sender)
      assert.equal(projection.messages.filter(m => m.text === delivered).length, 1)
      assert.equal(requests.length, count + 2, 'only the sender tool and result call the model; clear and delivery do not start recipient inference')
      let included
      if (outcome.status === 200) {
        const result = await until(async () => (await call('/chat/commands/status', bob.token, input)).command, c => c?.status !== 1)
        assert.equal(result.status, 4)
        const completed = await read(target, bob.token)
        const reset = completed.events.find(e => e.type === 'user/message' && e.data.source.kind === 'ourfairy-context-reset'
          && e.data.source.commandId === result.commandId)
        assert.ok(reset)
        assert.ok(completed.durableThroughSeq >= Math.max(result.completedSeq, deliveries[0].seq))
        assert.equal(completed.messages.filter(m => m.commandId === result.commandId).length, 1)
        included = deliveries[0].seq > reset.seq
        assert.deepEqual((await call('/chat/commands/execute', bob.token, input)).command, result)
      } else {
        assert.equal(outcome.status, 409)
        assert.equal(outcome.json.error.code, 'chat/session-busy')
        assert.equal((await call('/chat/commands/status', bob.token, input)).command, null)
        assert.ok(!projection.messages.some(m => m.requestId === input.requestId))
        included = true
      }
      await send(target, `DELIVERY_PROBE_345_${round}`, bob.token)
      const wire = JSON.stringify(requests.at(-1).messages)
      assert.equal(wire.includes(delivered), included, 'only a delivery after the reset may remain in the active context')
      assert.equal(wire.includes(old), outcome.status === 409, 'a busy refusal never silently resets the old context')
      if (outcome.status === 409) assert.equal((await execute({ sessionId: target, requestId: `delivery-explicit-retry-${round}`, command: 2 }, bob.token)).status, 4)
      else assert.equal((await call('/chat/commands/status', bob.token, input)).command.status, 4)
    } finally { heldDelivery?.release(); holdDelivery = false; await pending }
  }
  const before = (await read(target, bob.token)).messages
  await stop()
  await start()
  const cold = await read(target, bob.token).catch(error => { throw new Error('delivery cold read failed', { cause: error }) })
  assert.deepEqual(cold.messages, before)
  assert.equal(before.filter(m => /^DELIVERY_RACE_345_/.test(m.text)).length, 2)
})
