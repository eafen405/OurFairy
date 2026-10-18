import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { describeRun, leadingJsonObject, makeHome, messageBlocks, registerUser, removeHome, repoRoot, runBackendAsync, startArgs, startedPort, toolResultBlocks } from './helpers/backend.mjs'
const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json')))
const { startMockLlmServer } = await import(join(combo.repos.dsh.localPath, 'packages/test-support/llm-mock-server/lib/index.js'))
const home = makeHome('ourfairy-attachments-'), password = 'attachment-password'
let model, port, admin, alice, bob
async function start() {
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-key', OURFAIRY_MINIMAX_BASE_URL: `${model.baseURL}` })
  port = startedPort(run)
}
async function stop() { const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home }); assert.equal(run.code, 0, describeRun('stop', run)) }
async function request(path, token, body = {}, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers,
  }, body: Buffer.isBuffer(body) ? body : JSON.stringify(body) })
  const bytes = Buffer.from(await response.arrayBuffer())
  return { status: response.status, headers: response.headers, bytes, body: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(bytes) : null }
}
function user(name) { return registerUser(port, admin.token, name, password) }
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

test('a malformed upload ID list is refused as a bad request before any session is opened', async () => {
  const sessionId = await session(alice)
  const uploadId = 'a'.repeat(32)
  for (const [label, uploadIds] of [
    ['not a list', uploadId],
    ['a non-string member', [1]],
    ['a member of the wrong length', ['abc']],
    ['a member with non-hex characters', ['z'.repeat(32)]],
    ['a duplicated member', [uploadId, uploadId]],
    ['more than eight members', Array.from({ length: 9 }, (_, index) => index.toString(16).padStart(32, '0'))],
  ]) {
    const refused = await request('/chat/send', alice.token, { sessionId, requestId: `malformed-${label}`, text: '', uploadIds })
    assert.equal(refused.status, 400, `${label} must be refused as a bad request: ${JSON.stringify(refused)}`)
    assert.equal(refused.body.error.code, 'attachments/invalid-request',
      `${label} must name the attachment rule it broke: ${JSON.stringify(refused)}`)
  }
  // A well-formed list that names no real upload is a different answer: the
  // rule above rejects the shape, not the absence.
  const unknown = await request('/chat/send', alice.token, { sessionId, requestId: 'unknown-but-well-formed', text: '', uploadIds: [uploadId] })
  assert.equal(unknown.status, 404, JSON.stringify(unknown))
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
  const images = captured.body.messages.flatMap(messageBlocks).filter(c => c.type === 'image')
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

async function startToolModel() {
  const { createServer } = await import('node:http'), { once } = await import('node:events')
  const requests = []
  const server = createServer(async (req, res) => {
    let bytes = ''; for await (const chunk of req) bytes += chunk
    const body = JSON.parse(bytes); requests.push({ body })
    const blocks = body.messages.flatMap(m => Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }])
    const commandIndex = blocks.findLastIndex(c => c.type === 'text' && c.text.startsWith('{"tool":'))
    const call = leadingJsonObject(blocks[commandIndex].text)
    const result = blocks.slice(commandIndex + 1).findLast(c => c.type === 'tool_result')
    const handle = blocks.filter(c => c.type === 'text').map(c => c.text.match(/read-only copy saved at ("(?:[^"\\]|\\.)*")/)).findLast(Boolean)
    const args = JSON.parse(JSON.stringify(call.args).replaceAll('$INPUT', handle ? JSON.parse(handle[1]) : 'NO_QUALIFIED_INPUT_HANDLE'))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'attachment-tool-model', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (result) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `RESULT:${JSON.stringify(toolResultBlocks(result))}` } })
    } else {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'attachment-tool-call', name: call.tool, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(args) } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: result ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } })
    emit({ type: 'message_stop' }); res.end()
  })
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  return { baseURL: `http://127.0.0.1:${server.address().port}`, requests, close: () => new Promise(resolve => server.close(resolve)) }
}
let toolRequest = 0
async function tool(who, sessionId, name, args, uploadIds = []) {
  const previous = (await request('/chat/read', who.token, { sessionId })).body.projection.messages.filter(m => m.role === 2).length
  const sent = await request('/chat/send', who.token, { sessionId, requestId: `attachment-tool-${++toolRequest}`, text: JSON.stringify({ tool: name, args }), uploadIds })
  assert.equal(sent.status, 200, JSON.stringify(sent))
  const until = Date.now() + 15000
  let read
  do {
    read = await request('/chat/read', who.token, { sessionId })
    const messages = read.body.projection.messages.filter(m => m.role === 2)
    if (messages.length > previous && read.body.projection.replyStatus === 0) return messages.at(-1).text
    await new Promise(resolve => setTimeout(resolve, 25))
  } while (Date.now() < until)
  assert.fail(`tool result not returned: ${JSON.stringify(read.body)}`)
}
test('native model file handles permit real read and sandboxed scripts only in the admitted session and stay readonly', async () => {
  await stop(); await model.close(); model = await startToolModel(); await start()
  const aliceId = await session(alice), bobId = await session(bob), otherId = await session(alice)
  const bytes = Buffer.from('REAL_ATTACHMENT_CONTENT_私密\n')
  const receipt = await upload(alice, aliceId, bytes, 'private.txt', 'text/plain')
  assert.match(await tool(alice, aliceId, 'read', { file_path: '$INPUT' }, [receipt.uploadId]), /REAL_ATTACHMENT_CONTENT_私密/)
  const bodyText = model.requests.flatMap(item => item.body.messages).flatMap(messageBlocks).filter(c => c.type === 'text').map(c => c.text).join('\n')
  const handle = bodyText.match(/read-only copy saved at ("(?:[^"\\]|\\.)*")/)
  assert.ok(handle, 'actual provider text must contain a usable file handle')
  const path = JSON.parse(handle[1])
  const child = await tool(alice, aliceId, 'bash', { description: 'Read immutable input in actual sandbox', command: `cat '${path}'; printf bad > '${path}'` })
  assert.match(child, /REAL_ATTACHMENT_CONTENT_私密/)
  assert.match(child, /Read-only file system|Permission denied/i)
  assert.match(await tool(alice, aliceId, 'write', { file_path: path, content: 'bad' }), /denied|outside|permission/i)
  for (const [who, id] of [[bob, bobId], [alice, otherId]]) {
    assert.match(await tool(who, id, 'read', { file_path: path }), /denied|outside|permission/i)
    const denied = await tool(who, id, 'bash', { description: 'Try guessed attachment path', command: `cat '${path}'` })
    assert.doesNotMatch(denied, /REAL_ATTACHMENT_CONTENT_私密/)
    assert.match(denied, /No such file|denied|not found/i)
  }
  const read = await request('/chat/read', alice.token, { sessionId: aliceId })
  const inputMessage = read.body.projection.messages.find(message => message.attachments?.length)
  assert.deepEqual((await request('/attachments/download', alice.token, { sessionId: aliceId, messageId: inputMessage.messageId, index: 0 })).bytes, bytes, 'failed script/tool mutations must preserve the downloadable original')
  await stop(); await start()
  assert.match(await tool(alice, aliceId, 'read', { file_path: '$INPUT' }), /REAL_ATTACHMENT_CONTENT_私密/)
})
