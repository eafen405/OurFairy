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

test('lost chunk ACK retries exact bytes, expired upload cannot be new input, and admitted retry survives expiry', async () => {
  const sessionId = await session(alice), bytes = Buffer.from('two chunk upload')
  const receipt = await propose(alice, sessionId, bytes)
  const first = bytes.subarray(0, 5)
  assert.equal((await chunk(alice, receipt, first)).body.upload.offset, 5)
  assert.equal((await chunk(alice, receipt, first)).body.upload.offset, 5)
  assert.equal((await chunk(alice, receipt, Buffer.from('wrong'))).status, 409)
  assert.equal((await chunk(alice, receipt, bytes.subarray(5), 5)).body.upload.offset, bytes.length)
  assert.equal((await request('/attachments/complete', alice.token, { uploadId: receipt.uploadId })).status, 200)
  const input = { sessionId, requestId: 'expired-admitted', text: '', uploadIds: [receipt.uploadId] }
  const sent = await request('/chat/send', alice.token, input)
  assert.equal(sent.status, 200)
  // Clock-boundary fault setup in the actual business DB; observable results
  // below still go through authenticated public routes, not database reads.
  const { DatabaseSync } = await import('node:sqlite')
  const db = new DatabaseSync(join(home, 'dsh-home', 'identity', 'identity.sqlite'))
  try { db.prepare('UPDATE uploads SET expires_at = ? WHERE upload_id = ?').run(Date.now() - 1, receipt.uploadId) }
  finally { db.close() }
  assert.equal((await request('/attachments/complete', alice.token, { uploadId: receipt.uploadId })).status, 410)
  assert.equal((await request('/chat/send', alice.token, { ...input, requestId: 'expired-new' })).status, 410)
  await stop(); await start()
  assert.deepEqual((await request('/chat/send', alice.token, input)).body.receipt, sent.body.receipt)
  assert.deepEqual((await request('/attachments/download', alice.token, { sessionId, messageId: sent.body.receipt.messageId, index: 0 })).bytes, bytes)
})

test('images keep original downloads while official Messages serialization uses normalized native image content', async () => {
  const sessionId = await session(alice)
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWNgZGIGAAAOAAeCcsnOAAAAAElFTkSuQmCC', 'base64')
  const receipt = await upload(alice, sessionId, bytes, 'pixel.png', 'image/png')
  const sent = await request('/chat/send', alice.token, { sessionId, requestId: 'image-input', text: 'see T9_PIXEL', uploadIds: [receipt.uploadId] })
  assert.equal(sent.status, 200, JSON.stringify(sent))
  const until = Date.now() + 10000
  let captured
  do {
    captured = model.requests.find(item => JSON.stringify(item.body).includes('T9_PIXEL'))
    if (captured) break
    await new Promise(resolve => setTimeout(resolve, 25))
  } while (Date.now() < until)
  assert.ok(captured, 'official provider must actually dispatch image request')
  const images = captured.body.messages.flatMap(m => m.content).filter(c => c.type === 'image')
  assert.equal(images.length, 1)
  assert.equal(images[0].source.type, 'base64')
  assert.ok(Buffer.from(images[0].source.data, 'base64').length > 0)
  const read = await request('/chat/read', alice.token, { sessionId })
  assert.deepEqual(read.body.projection.messages.find(m => m.requestId === 'image-input').attachments,
    [{ index: 0, type: 2, name: 'pixel.png', mime: 'image/png', bytes: bytes.length }])
  const download = await request('/attachments/download', alice.token, { sessionId, messageId: sent.body.receipt.messageId, index: 0 })
  assert.deepEqual(download.bytes, bytes)
  const malformed = await propose(alice, sessionId, Buffer.from('not a png'), 'broken.png', 'image/png')
  await chunk(alice, malformed, Buffer.from('not a png'))
  assert.equal((await request('/attachments/complete', alice.token, { uploadId: malformed.uploadId })).status, 400)
  assert.equal((await request('/chat/send', alice.token, { sessionId, requestId: 'broken-image', text: '', uploadIds: [malformed.uploadId] })).status, 404)
})
