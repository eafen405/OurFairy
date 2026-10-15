import assert from 'node:assert/strict'
import http from 'node:http'
import { join } from 'node:path'
import { readFileSync, readdirSync, statSync, chmodSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { before, after, test } from 'node:test'
import { makeHome, removeHome, runBackendAsync, describeRun, repoRoot } from './helpers/backend.mjs'

const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const { startMockLlmServer } = await import(join(combo.repos.dsh.localPath, 'packages/test-support/llm-mock-server/lib/index.js'))
const home = makeHome('ourfairy-reconnect-')
const password = 'test-chat-password'
const answer = '# Fairy\n\n你好，**世界**。\n```js\n1 + 1\n```\n最后。'
let model, port, admin, alice, bob
async function start() {
  const run = await runBackendAsync(['start', '--json'], { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    DEEPSEEK_API_KEY: 'mock-key', DEEPSEEK_BASE_URL: `${model.baseURL}/v1` })
  assert.equal(run.code, 0, describeRun('start', run))
  port = JSON.parse(run.stdout).listeningPorts[0]
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
async function user(name) {
  const invite = await request('/identity/invite', admin.token)
  const result = await request('/identity/register', undefined, { name, password, inviteCode: invite.body.invite.code })
  assert.equal(result.status, 200, JSON.stringify(result))
  return result.body
}
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
