import assert from 'node:assert/strict'
import http from 'node:http'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { before, after, test } from 'node:test'
import { makeHome, removeHome, runBackendAsync, describeRun, repoRoot } from './helpers/backend.mjs'

const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json'), 'utf8'))
const { startMockLlmServer } = await import(join(combo.repos.dsh.localPath, 'packages/test-support/llm-mock-server/lib/index.js'))
const home = makeHome('ourfairy-chat-')
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
  model = await startMockLlmServer({ apiKey: 'mock-key', sequence: ['slow_success'], repeatLast: true,
    successText: answer, chunkSize: 2, chunkDelayMs: 15 })
  await start()
  admin = (await request('/identity/sign-in', undefined, { name: 'phaethon', password })).body
  alice = await user('chat-alice')
  bob = await user('chat-bob')
})
after(async () => { await stop(); await model?.close(); removeHome(home) })

test('a stable send is durably accepted once across concurrent retries and backend restart', async () => {
  const sessionId = await session(alice.token)
  const body = { sessionId, requestId: 'alice-stable-1', text: 'Alice私有文本' }
  const results = await Promise.all(Array.from({ length: 5 }, () => request('/chat/send', alice.token, body)))
  for (const result of results) {
    assert.equal(result.status, 200, JSON.stringify(result))
    assert.deepEqual(result.body.receipt, results[0].body.receipt)
  }
  const receipt = results[0].body.receipt
  assert.equal(receipt.requestId, body.requestId)
  assert.ok(receipt.messageId)
  const conflict = await request('/chat/send', alice.token, { ...body, text: 'changed' })
  assert.equal(conflict.status, 409)
  await eventually(() => request('/chat/read', alice.token, { sessionId }), r => r.body.projection?.replyStatus === 0
    && r.body.projection.messages.some(m => m.role === 2))
  const fetched = await request('/chat/receipt', alice.token, { sessionId, requestId: body.requestId })
  assert.deepEqual(fetched.body.receipt, receipt)
  assert.equal(model.requests.length, 1)
  await stop()
  await start()
  const retried = await request('/chat/send', alice.token, body)
  assert.deepEqual(retried.body.receipt, receipt)
  const read = await request('/chat/read', alice.token, { sessionId })
  assert.deepEqual(read.body.projection.messages.map(m => m.text), [body.text, answer])
  assert.equal(model.requests.length, 1)
})
