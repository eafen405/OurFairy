import assert from 'node:assert/strict'
import http from 'node:http'
import { join } from 'node:path'
import { readFileSync, readdirSync, statSync, chmodSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { before, after, test } from 'node:test'
import { describeRun, makeHome, registerUser, removeHome, runBackendAsync, repoRoot, startArgs, startedPort } from './helpers/backend.mjs'

const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const { startMockLlmServer } = await import(join(combo.repos.dsh.localPath, 'packages/test-support/llm-mock-server/lib/index.js'))
const home = makeHome('ourfairy-reconnect-')
const password = 'test-chat-password'
const answer = '# Fairy\n\n你好，**世界**。\n```js\n1 + 1\n```\n最后。'
let model, port, admin, alice, bob
async function start() {
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-key', OURFAIRY_MINIMAX_BASE_URL: `${model.baseURL}` })
  port = startedPort(run)
}
async function stop() {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}
function request(path, token, body = {}) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const call = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: {
      'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    } }, response => {
      let text = ''
      response.setEncoding('utf8').on('data', chunk => { text += chunk }).on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(text) }) }
        catch { reject(new Error(`${response.statusCode}: ${text}`)) }
      })
    })
    call.on('error', reject).end(payload)
  })
}
function user(name) { return registerUser(port, admin.token, name, password) }
async function session(token) {
  const result = await request('/sessions/create', token)
  assert.equal(result.status, 200, JSON.stringify(result))
  return result.body.session.id
}
async function eventually(work, check, timeout = 15000) {
  const until = Date.now() + timeout
  let value
  do {
    value = await work()
    if (check(value)) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  } while (Date.now() < until)
  assert.fail(`condition not reached: ${JSON.stringify(value)}`)
}
before(async () => {
  model = await startMockLlmServer({ apiKey: 'mock-key', sequence: ['success'], repeatLast: true,
    successText: answer })
  await start()
  admin = (await request('/identity/sign-in', undefined, { name: 'phaethon', password })).body
  alice = await user('chat-alice')
  bob = await user('chat-bob')
})
after(async () => { await stop(); await model?.close(); removeHome(home) })


async function sendAndWait(token, sessionId, requestId, text = requestId) {
  const sent = await request('/chat/send', token, { sessionId, requestId, text })
  assert.equal(sent.status, 200, JSON.stringify(sent))
  return eventually(() => request('/chat/read', token, { sessionId }), r => r.body.projection?.replyStatus === 0 && r.body.projection.messages.some(m => m.role === 2))
}

test('bounded history pages keep the opening cut while new formal events arrive', async () => {
  const sessionId = await session(alice.token)
  for (let index = 0; index < 8; index++) await sendAndWait(alice.token, sessionId, `offline-${index}`)
  const read = await request('/chat/read', alice.token, { sessionId, maxEvents: 5 })
  assert.equal(read.status, 200, JSON.stringify(read))
  const initial = read.body.projection
  assert.equal(initial.events.length, 5)
  const defaultRead = await request('/chat/read', alice.token, { sessionId })
  assert.equal(defaultRead.body.projection.events.length, 64, 'the default wire baseline is bounded too')
  assert.equal(initial.throughSeq, initial.cursor)
  assert.equal(initial.fromSeq, initial.cursor - 4)
  assert.equal(initial.hasMore, true)
  const cut = initial.throughSeq
  const firstRequest = { sessionId, throughSeq: cut, beforeSeq: initial.beforeSeq, maxEvents: 5 }
  const first = await request('/chat/page', alice.token, firstRequest)
  assert.equal(first.status, 200, JSON.stringify(first))
  await sendAndWait(alice.token, sessionId, 'live-after-fixed-cut')
  const repeated = await request('/chat/page', alice.token, firstRequest)
  assert.deepEqual(repeated.body.page, first.body.page)
  const events = [...initial.events]
  let beforeSeq = initial.beforeSeq
  let pages = 0
  while (beforeSeq !== null) {
    const response = await request('/chat/page', alice.token, { sessionId, throughSeq: cut, beforeSeq, maxEvents: 5 })
    assert.equal(response.status, 200, JSON.stringify(response))
    const page = response.body.page
    assert.equal(page.throughSeq, cut)
    assert.ok(page.events.length <= 5)
    assert.ok(page.events.every(event => event.seq < beforeSeq && event.seq <= cut))
    events.unshift(...page.events)
    beforeSeq = page.beforeSeq
    pages++
  }
  assert.ok(pages > 3)
  assert.deepEqual(events.map(event => event.seq), Array.from({ length: cut + 1 }, (_, index) => index))
  assert.equal(events.filter(event => event.type === 'user/message' && event.data.source?.kind === 'user').length, 8)
  assert.ok(!JSON.stringify(events).includes('live-after-fixed-cut'))
  const checkpoint = await request('/chat/checkpoint', alice.token, { sessionId })
  assert.equal(checkpoint.status, 200, JSON.stringify(checkpoint))
  assert.ok(checkpoint.body.durableThroughSeq > cut)
})

function observe(token, sessionId, maxEvents = 5) {
  const frames = []
  let response, call, failure
  const ready = new Promise((resolve, reject) => {
    const payload = JSON.stringify({ sessionId, maxEvents })
    call = http.request({ host: '127.0.0.1', port, path: '/chat/observe', method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
    } }, incoming => {
      response = incoming
      if (incoming.statusCode !== 200) { reject(new Error(`observe ${incoming.statusCode}`)); incoming.resume(); return }
      let buffer = ''
      incoming.setEncoding('utf8').on('data', chunk => {
        buffer += chunk
        let boundary
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const item = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          const data = item.split('\n').find(line => line.startsWith('data: '))
          if (data) frames.push(JSON.parse(data.slice(6)))
          resolve()
        }
      }).on('error', error => { failure = error })
    })
    call.on('error', reject).end(payload)
  })
  return { ready, frames, close: () => { response?.destroy(); call?.destroy() }, failure: () => failure }
}


test('a reconnect restores the active cumulative attempt while bounded backfill and live tail proceed independently', async () => {
  await stop()
  await model.close()
  model = await startMockLlmServer({ apiKey: 'mock-key', sequence: ['slow_success'], repeatLast: true,
    successText: answer.repeat(12), chunkSize: 2, chunkDelayMs: 5 })
  await start()
  const sessionId = await session(alice.token)
  // Create enough native history while this phone has no observation connection.
  const queued = []
  for (let index = 0; index < 6; index++) queued.push(request('/chat/send', alice.token, { sessionId, requestId: `long-offline-${index}`, text: `离线${index}` }))
  await Promise.all(queued)
  await eventually(() => request('/chat/read', alice.token, { sessionId, maxEvents: 1 }), r => r.body.projection?.attempt?.text.length > 20)
  const stream = observe(alice.token, sessionId, 3)
  await stream.ready
  try {
    const opening = stream.frames[0]
    assert.equal(opening.events.length, 3)
    assert.ok(opening.attempt.text.length > 20, 'the prefix produced without any phone remains in the opening attempt baseline')
    assert.equal(opening.throughSeq, opening.cursor)
    const cut = opening.throughSeq
    const range = [...opening.events]
    const pages = []
    let beforeSeq = opening.beforeSeq
    while (beforeSeq !== null) {
      const response = await request('/chat/page', alice.token, { sessionId, throughSeq: cut, beforeSeq, maxEvents: 3 })
      assert.equal(response.status, 200, JSON.stringify(response))
      pages.push(response.body.page)
      range.unshift(...response.body.page.events)
      beforeSeq = response.body.page.beforeSeq
    }
    assert.ok(pages.length > 2)
    assert.deepEqual(range.map(event => event.seq), Array.from({ length: cut + 1 }, (_, index) => index))
    const finishedFirst = await eventually(async () => stream.frames.at(-1), frame => frame.cursor > cut && frame.messages.some(message => message.role === 2 && message.status === 2), 30000)
    assert.equal(finishedFirst.throughSeq, cut)
    assert.equal(finishedFirst.fromSeq, opening.fromSeq)
    assert.deepEqual(finishedFirst.events.map(event => event.seq), Array.from({ length: finishedFirst.cursor - opening.fromSeq + 1 }, (_, index) => opening.fromSeq + index))
    const settled = finishedFirst.messages.find(message => message.role === 2 && message.status === 2)
    assert.equal(settled.text, answer.repeat(12))
    assert.ok(settled.text.startsWith(opening.attempt.text))
    // All historical pages remain at C; they contain no stale attempt/status fields to overwrite the live state.
    assert.ok(pages.every(page => page.throughSeq === cut && page.attempt === undefined && page.replyStatus === undefined))
    const baselineAttempt = opening.attempt.attemptId
    const partials = stream.frames.filter(frame => frame.attempt?.attemptId === baselineAttempt).map(frame => frame.attempt.text)
    for (let index = 1; index < partials.length; index++) assert.ok(partials[index].startsWith(partials[index - 1]))
  } finally {
    stream.close()
    await request('/chat/stop', alice.token, { sessionId })
  }
})

function lostPage(token, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const call = http.request({ host: '127.0.0.1', port, path: '/chat/page', method: 'POST', headers: {
      authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload),
    } }, response => {
      assert.equal(response.statusCode, 200)
      // Lose the response on the actual socket after server acceptance, before consuming its body.
      response.destroy()
      call.destroy()
      resolve()
    })
    call.on('error', reject).end(payload)
  })
}

test('a lost page response can be retried at its unchanged frozen cut', async () => {
  const sessionId = await session(bob.token)
  await request('/chat/send', bob.token, { sessionId, requestId: 'page-retry', text: 'retry page' })
  const read = await request('/chat/read', bob.token, { sessionId, maxEvents: 1 })
  const initial = read.body.projection
  const pageRequest = { sessionId, throughSeq: initial.throughSeq, beforeSeq: initial.beforeSeq, maxEvents: 2 }
  const expected = await request('/chat/page', bob.token, pageRequest)
  await lostPage(bob.token, pageRequest)
  const retried = await request('/chat/page', bob.token, pageRequest)
  assert.deepEqual(retried.body.page, expected.body.page)
  await request('/chat/stop', bob.token, { sessionId })
})

function artifactOf(sessionId) {
  const root = join(home, 'dsh-home', 'sessions')
  const relative = readdirSync(root, { recursive: true }).find(name => name.includes(`${sessionId}/`) && /\.jsonl(\.zstd)?$/.test(name))
  assert.ok(relative, `no real artifact for ${sessionId}`)
  return join(root, relative)
}

test('a real writer permission failure cannot advance durable ACK, then retry and cold recovery use the same acceptance', async () => {
  const sessionId = await session(alice.token)
  const stream = observe(alice.token, sessionId, 256)
  await stream.ready
  const acknowledged = stream.frames.at(-1).durableThroughSeq
  const artifact = artifactOf(sessionId)
  const savedHash = createHash('sha256').update(readFileSync(artifact)).digest('hex')
  const body = { sessionId, requestId: 'writer-failure-request', text: 'flush must fail before this text is acknowledged' }
  chmodSync(artifact, 0o400)
  try {
    const sent = await request('/chat/send', alice.token, body)
    assert.equal(sent.status, 500, JSON.stringify(sent))
    const observed = await eventually(async () => stream.frames.at(-1), frame => frame.events.some(event => event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.source?.rpcId === body.requestId)))
    assert.ok(observed.cursor > acknowledged)
    assert.equal(observed.durableThroughSeq, acknowledged)
    const checkpoint = await request('/chat/checkpoint', alice.token, { sessionId })
    assert.equal(checkpoint.status, 500, JSON.stringify(checkpoint))
    assert.equal(stream.frames.at(-1).durableThroughSeq, acknowledged)
    assert.equal(createHash('sha256').update(readFileSync(artifact)).digest('hex'), savedHash, 'real JSONL bytes did not save during EACCES')
  } finally {
    chmodSync(artifact, 0o600)
    stream.close()
  }
  const checkpoint = await request('/chat/checkpoint', alice.token, { sessionId })
  assert.equal(checkpoint.status, 200, JSON.stringify(checkpoint))
  assert.ok(checkpoint.body.durableThroughSeq > acknowledged)
  const receipt = await request('/chat/receipt', alice.token, { sessionId, requestId: body.requestId })
  assert.ok(receipt.body.receipt)
  const retried = await request('/chat/send', alice.token, body)
  assert.deepEqual(retried.body.receipt, receipt.body.receipt)
  const beforeRestart = await request('/chat/read', alice.token, { sessionId, maxEvents: 256 })
  await stop()
  await start()
  const recovered = await request('/chat/read', alice.token, { sessionId, maxEvents: 256 })
  assert.equal(recovered.status, 200, JSON.stringify(recovered))
  assert.deepEqual(recovered.body.projection.events.slice(0, beforeRestart.body.projection.cursor + 1), beforeRestart.body.projection.events)
  const coldReceipt = await request('/chat/receipt', alice.token, { sessionId, requestId: body.requestId })
  assert.deepEqual(coldReceipt.body.receipt, receipt.body.receipt)
})

test('new history and checkpoint routes keep the cold/live ownership fence and validate exact ranges', async () => {
  const sessionId = await session(bob.token)
  for (const [path, body] of [
    ['/chat/page', { sessionId, throughSeq: -1, beforeSeq: 0, maxEvents: 1 }],
    ['/chat/checkpoint', { sessionId }],
  ]) {
    assert.equal((await request(path, undefined, body)).status, 401)
    for (const token of [alice.token, admin.token]) assert.equal((await request(path, token, body)).status, 404)
  }
  const empty = await request('/chat/read', bob.token, { sessionId, maxEvents: 1 })
  const cut = empty.body.projection.throughSeq
  for (const body of [
    { sessionId, throughSeq: cut + 1, beforeSeq: 0 },
    { sessionId, throughSeq: cut, beforeSeq: cut + 2 },
    { sessionId, throughSeq: cut, beforeSeq: 0, maxEvents: 0 },
    { sessionId, throughSeq: cut, beforeSeq: 0, maxEvents: 257 },
    { sessionId, throughSeq: cut, beforeSeq: -1 },
  ]) assert.equal((await request('/chat/page', bob.token, body)).status, 400, JSON.stringify(body))
  const terminal = await request('/chat/page', bob.token, { sessionId, throughSeq: cut, beforeSeq: 0 })
  assert.deepEqual(terminal.body.page, { sessionId, throughSeq: cut, fromSeq: 0, beforeSeq: null, hasMore: false, events: [], messages: [] })
  for (const path of ['/chat/page', '/chat/checkpoint']) {
    assert.equal((await request(path, alice.token, { sessionId, throughSeq: cut, beforeSeq: 0 })).status, 404)
  }
})

test('a crash-orphaned turn is resumed and writer-saved before its recovery closer is acknowledged', async () => {
  await stop()
  await model.close()
  model = await startMockLlmServer({ apiKey: 'mock-key', sequence: ['stall'], repeatLast: true })
  await start()
  const sessionId = await session(bob.token)
  await request('/chat/send', bob.token, { sessionId, requestId: 'crash-open-turn', text: 'survive process crash' })
  await eventually(async () => model.requests, requests => requests.length === 1)
  const checkpoint = await request('/chat/checkpoint', bob.token, { sessionId })
  assert.equal(checkpoint.status, 200)
  const before = await request('/chat/read', bob.token, { sessionId, maxEvents: 256 })
  assert.ok(!before.body.projection.events.some(event => event.type === 'turn/end'))
  const previousAck = checkpoint.body.durableThroughSeq
  const { pid } = JSON.parse(readFileSync(join(home, 'run/backend.json'), 'utf8'))
  process.kill(-pid, 'SIGKILL')
  // SIGKILL delivery precedes exit; /proc/<pid>/fd can become unreadable meanwhile.
  // Finish the crash fixture before asking the launcher to inspect its process.
  await eventually(async () => {
    try { process.kill(pid, 0); return false }
    catch (error) { if (error.code === 'ESRCH') return true; throw error }
  }, gone => gone)
  await eventually(async () => {
    const status = await runBackendAsync(['status', '--json'], { OURFAIRY_HOME: home })
    assert.equal(status.code, 0, describeRun('status after crash', status))
    return JSON.parse(status.stdout)
  }, state => state.running === false)
  await start()
  const stream = observe(bob.token, sessionId, 256)
  await stream.ready
  const resumed = stream.frames[0]
  stream.close()
  const closer = resumed.events.find(event => event.type === 'turn/end' && event.data.reason.kind === 'interrupted')
  assert.ok(closer, JSON.stringify(resumed))
  assert.ok(closer.seq > previousAck)
  assert.ok(resumed.durableThroughSeq >= closer.seq, 'the native resumed writer actually saves the closer before follow ACK')
  await stop()
  await start()
  const recovered = await request('/chat/read', bob.token, { sessionId, maxEvents: 256 })
  assert.deepEqual(recovered.body.projection.events.find(event => event.seq === closer.seq), closer)
})
