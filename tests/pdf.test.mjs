import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { makeHome, removeHome, runBackendAsync, describeRun, repoRoot } from './helpers/backend.mjs'
const combo = JSON.parse(readFileSync(join(repoRoot, 'combo.json')))
const { startMockLlmServer } = await import(join(combo.repos.dsh.localPath, 'packages/test-support/llm-mock-server/lib/index.js'))
const home = makeHome('ourfairy-pdf-'), password = 'attachment-password'
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
async function startToolModel() {
  const { createServer } = await import('node:http'), { once } = await import('node:events')
  const requests = []
  const server = createServer(async (req, res) => {
    let bytes = ''; for await (const chunk of req) bytes += chunk
    const body = JSON.parse(bytes); requests.push({ body })
    const blocks = body.messages.flatMap(m => Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }])
    const commandIndex = blocks.findLastIndex(c => c.type === 'text' && c.text.startsWith('{"tool":'))
    const call = JSON.parse(blocks[commandIndex].text)
    const result = blocks.slice(commandIndex + 1).findLast(c => c.type === 'tool_result')
    const handle = blocks.filter(c => c.type === 'text').map(c => c.text.match(/read-only copy saved at ("(?:[^"\\]|\\.)*")/)).findLast(Boolean)
    const args = JSON.parse(JSON.stringify(call.args).replaceAll('$INPUT', handle ? JSON.parse(handle[1]) : 'NO_QUALIFIED_INPUT_HANDLE'))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'attachment-tool-model', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (result) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `RESULT:${JSON.stringify(result.content)}` } })
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
    if (messages.length > previous && read.body.projection.replyStatus === 0) return JSON.parse(messages.at(-1).text.slice(7)).map(block => block.text ?? '').join('\n')
    await new Promise(resolve => setTimeout(resolve, 25))
  } while (Date.now() < until)
  assert.fail(`tool result not returned: ${JSON.stringify(read.body)}`)
}

const pdf = name => readFileSync(new URL(`./fixtures/pdf/${name}.pdf`, import.meta.url))
test('PDF upload, selected page text with citation, and immutable original use actual authorized tools', async () => {
  await stop(); await model.close(); model = await startToolModel(); await start()
  const id = await session(alice)
  const receipt = await upload(alice, id, pdf('text'), 'book.pdf', 'application/pdf')
  const info = await tool(alice, id, 'pdf_info', { file_path: '$INPUT' }, [receipt.uploadId])
  assert.match(info, /"pageCount":2/)
  assert.match(info, /PAGE_ONE_ALPHA/)
  assert.doesNotMatch(info, /PAGE_TWO_BETA/)
  const text = await tool(alice, id, 'pdf_read_pages', { file_path: '$INPUT', pages: [2] })
  assert.match(text, /"page":2/)
  assert.match(text, /PAGE_TWO_BETA/)
  assert.doesNotMatch(text, /PAGE_ONE_ALPHA/)
  const projection = (await request('/chat/read', alice.token, { sessionId: id })).body.projection
  const message = projection.messages.find(m => m.attachments?.length)
  assert.deepEqual((await request('/attachments/download', alice.token, { sessionId: id, messageId: message.messageId, index: 0 })).bytes, pdf('text'))
  const native = model.requests.flatMap(r => r.body.messages).flatMap(m => m.content).filter(c => c.type === 'text').map(c => c.text).join('\n')
  const path = JSON.parse(native.match(/read-only copy saved at ("(?:[^"\\]|\\.)*")/)[1])
  for (const [who, other] of [[bob, await session(bob)], [alice, await session(alice)]]) {
    const denied = await tool(who, other, 'pdf_read_pages', { file_path: path, pages: [2] })
    assert.doesNotMatch(denied, /PAGE_TWO_BETA/)
    assert.match(denied, /unavailable|denied|qualified/i)
  }
})

test('PDF tools report encrypted, damaged, empty, partial and over-limit documents without reading other pages', async () => {
  for (const [name, expected] of [['encrypted', 'encrypted'], ['damaged', 'damaged'], ['many-pages', 'page-limit']]) {
    const id = await session(alice), receipt = await upload(alice, id, pdf(name), `${name}.pdf`, 'application/pdf')
    const result = JSON.parse(await tool(alice, id, 'pdf_info', { file_path: '$INPUT' }, [receipt.uploadId]))
    assert.equal(result.status, 3, name); assert.equal(result.error, expected, name)
  }
  const blankId = await session(alice), blank = await upload(alice, blankId, pdf('empty'), 'scan.pdf', 'application/pdf')
  const empty = JSON.parse(await tool(alice, blankId, 'pdf_read_pages', { file_path: '$INPUT', pages: [1] }, [blank.uploadId]))
  assert.equal(empty.pages[0].text, ''); assert.equal(empty.pages[0].needsImage, true)
  const partialId = await session(alice), broken = await upload(alice, partialId, pdf('partial'), 'partial.pdf', 'application/pdf')
  const partial = JSON.parse(await tool(alice, partialId, 'pdf_read_pages', { file_path: '$INPUT', pages: [1, 2] }, [broken.uploadId]))
  assert.equal(partial.status, 2)
  assert.equal(partial.pages[0].text, 'PAGE_ONE_ALPHA')
  assert.equal(partial.pages[1].error, 'page-unreadable')
  for (const pages of [[0], [3], [1, 1], [1, 2, 3, 4, 5, 6]]) {
    const invalid = JSON.parse(await tool(alice, partialId, 'pdf_read_pages', { file_path: '$INPUT', pages }))
    assert.equal(invalid.error, 'invalid-pages')
  }
})

// Independent literal PDF fixture: a known one-page content stream, not parser output.
function streamPdf(content) {
  const stream = deflateSync(Buffer.from(content)), chunks = [Buffer.from('%PDF-1.7\n')], offsets = [0]
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from('\nendstream')]),
  ]
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.concat(chunks).length)
    chunks.push(Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(objects[index]), Buffer.from('\nendobj\n'))
  }
  const xref = Buffer.concat(chunks).length
  chunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`))
  return Buffer.concat(chunks)
}

test('PDF text is explicitly truncated and a compressed costly page hits an actual process resource budget', async () => {
  const id = await session(alice), text = streamPdf(`BT /F1 12 Tf (${'X'.repeat(4500)}) Tj ET`)
  const receipt = await upload(alice, id, text, 'long.pdf', 'application/pdf')
  const result = JSON.parse(await tool(alice, id, 'pdf_read_pages', { file_path: '$INPUT', pages: [1] }, [receipt.uploadId]))
  assert.equal(result.pages[0].truncated, true)
  assert.equal(result.pages[0].text.length, 4000)
  const costlyId = await session(alice), costly = streamPdf('BT /F1 12 Tf (BUDGET) Tj ET\n'.repeat(1000000))
  const uploaded = await upload(alice, costlyId, costly, 'costly.pdf', 'application/pdf')
  const bounded = JSON.parse(await tool(alice, costlyId, 'pdf_read_pages', { file_path: '$INPUT', pages: [1] }, [uploaded.uploadId]))
  assert.equal(bounded.error, 'resource-limit', JSON.stringify(bounded))
  assert.equal(bounded.status, 3)
})
