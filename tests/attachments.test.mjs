import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { makeHome, removeHome, runBackendAsync, describeRun, repoRoot } from './helpers/backend.mjs'
const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json')))
const { startMockLlmServer } = await import(join(combo.repos.dsh.localPath, 'packages/test-support/llm-mock-server/lib/index.js'))
const home = makeHome('ourfairy-attachments-'), password = 'attachment-password'
let model, port, admin, alice, bob
async function start() {
  const run = await runBackendAsync(['start', '--json'], { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    DEEPSEEK_API_KEY: 'mock-key', DEEPSEEK_BASE_URL: `${model.baseURL}/v1` })
  assert.equal(run.code, 0, describeRun('start', run)); port = JSON.parse(run.stdout).listeningPorts[0]
}
async function stop() { const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home }); assert.equal(run.code, 0, describeRun('stop', run)) }
async function request(path, token, body = {}, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers,
  }, body: Buffer.isBuffer(body) ? body : JSON.stringify(body) })
  const bytes = Buffer.from(await response.arrayBuffer())
  return { status: response.status, headers: response.headers, bytes, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes) : null }
}
async function user(name) { const invite = await request('/identity/invite', admin.token); return (await request('/identity/register', null, { name, password, inviteCode: invite.body.invite.code })).body }
async function session(user) { return (await request('/sessions/create', user.token)).body.session.id }
async function propose(user, sessionId, bytes, name = 'notes.txt', mime = 'text/plain') {
  const result = await request('/attachments/propose', user.token, { sessionId, name, mime, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
  assert.equal(result.status, 200, JSON.stringify(result)); return result.body.upload
}
async function chunk(user, upload, bytes, offset = 0) { return request('/attachments/chunk', user.token, bytes, { 'content-type': 'application/octet-stream', 'x-upload-id': upload.uploadId, 'x-upload-offset': String(offset) }) }
async function upload(user, sessionId, bytes, name, mime) {
  const receipt = await propose(user, sessionId, bytes, name, mime)
  assert.equal((await chunk(user, receipt, bytes)).status, 200)
  const complete = await request('/attachments/complete', user.token, { uploadId: receipt.uploadId })
  assert.equal(complete.status, 200, JSON.stringify(complete)); return complete.body.upload
}
before(async () => {
  model = await startMockLlmServer({ apiKey: 'mock-key', sequence: ['success'], repeatLast: true, successText: 'attachment received' })
  await start(); admin = (await request('/identity/sign-in', null, { name: 'phaethon', password })).body
  alice = await user('attachment-alice'); bob = await user('attachment-bob')
})
after(async () => { await stop(); await model?.close(); removeHome(home) })
test('upload completes before sending and original downloads by qualified message identity across restart', async () => {
  const sessionId = await session(alice), bytes = Buffer.from('original UTF-8 附件\n')
  const receipt = await upload(alice, sessionId, bytes)
  const repeat = await request('/attachments/complete', alice.token, { uploadId: receipt.uploadId })
  assert.deepEqual(repeat.body.upload, receipt)
  const input = { sessionId, requestId: 'attachment-request', text: '', uploadIds: [receipt.uploadId] }
  const sends = await Promise.all([request('/chat/send', alice.token, input), request('/chat/send', alice.token, input)])
  assert.equal(sends[0].status, 200, JSON.stringify(sends[0])); assert.deepEqual(sends[1].body.receipt, sends[0].body.receipt)
  const messageId = sends[0].body.receipt.messageId
  const download = await request('/attachments/download', alice.token, { sessionId, messageId, index: 0 })
  assert.equal(download.status, 200); assert.deepEqual(download.bytes, bytes)
  const read = await request('/chat/read', alice.token, { sessionId })
  assert.deepEqual(read.body.projection.messages.find(m => m.messageId === messageId).attachments,
    [{ index: 0, type: 1, name: 'notes.txt', mime: 'text/plain', bytes: bytes.length }])
  await stop(); await start()
  const retry = await request('/chat/send', alice.token, input)
  assert.deepEqual(retry.body.receipt, sends[0].body.receipt)
  assert.deepEqual((await request('/attachments/download', alice.token, { sessionId, messageId, index: 0 })).bytes, bytes)
})

test('unfinished and foreign receipts never grant message or download access, including identical stored bytes', async () => {
  const aliceId = await session(alice), aliceOther = await session(alice), bobId = await session(bob)
  const bytes = Buffer.from('same hash gives no authority')
  const pending = await propose(alice, aliceId, bytes)
  assert.equal((await request('/attachments/complete', alice.token, { uploadId: pending.uploadId })).status, 409)
  assert.equal((await request('/chat/send', alice.token, { sessionId: aliceId, requestId: 'unfinished', text: '', uploadIds: [pending.uploadId] })).status, 404)
  const accepted = await upload(alice, aliceId, bytes), bobUpload = await upload(bob, bobId, bytes)
  for (const [who, sessionId] of [[bob, bobId], [alice, aliceOther]]) {
    assert.equal((await request('/chat/send', who.token, { sessionId, requestId: 'foreign-input', text: '', uploadIds: [accepted.uploadId] })).status, 404)
  }
  const sent = await request('/chat/send', alice.token, { sessionId: aliceId, requestId: 'own-input', text: '', uploadIds: [accepted.uploadId] })
  const messageId = sent.body.receipt.messageId
  for (const who of [bob, admin]) {
    assert.equal((await request('/attachments/propose', who.token, { sessionId: aliceId, name: 'bad', mime: 'text/plain', size: bytes.length, sha256: accepted.sha256 })).status, 404)
    assert.equal((await request('/attachments/download', who.token, { sessionId: aliceId, messageId, index: 0 })).status, 404)
    assert.equal((await request('/attachments/complete', who.token, { uploadId: accepted.uploadId })).status, 404)
  }
  assert.equal((await request('/attachments/download', bob.token, { sessionId: bobId, messageId, index: 0 })).status, 404)
  assert.equal((await request('/attachments/download', alice.token, { sessionId: aliceId, uploadId: bobUpload.uploadId, index: 0 })).status, 404)
  assert.equal((await request('/chat/send', alice.token, { sessionId: aliceId, requestId: 'own-input', text: '', uploadIds: [pending.uploadId] })).status, 409)
})
