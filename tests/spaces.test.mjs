import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { before, after, test } from 'node:test'
import { makeHome, removeHome, runBackendAsync, describeRun } from './helpers/backend.mjs'

const home = makeHome('ourfairy-spaces-')
const password = 'space-test-password'
let port, model, modelPort, admin, alice, bob
const modelRequests = []
async function request(path, token, body = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(body) })
  const value = await response.json()
  assert.equal(response.status, 200, JSON.stringify(value))
  return value
}
async function user(name) {
  const invite = await request('/identity/invite', admin.token)
  return request('/identity/register', undefined, { name, password, inviteCode: invite.invite.code })
}
async function tool(user, name, args) {
  const { session } = await request('/sessions/create', user.token)
  await request('/chat/send', user.token, { sessionId: session.id, requestId: 'tool-request', text: JSON.stringify({ name, args }) })
  const until = Date.now() + 15000
  while (Date.now() < until) {
    const { projection } = await request('/chat/read', user.token, { sessionId: session.id })
    const terminal = projection.messages.find(m => m.role === 2 && m.text.startsWith('RESULT:'))
    if (terminal) return terminal.text.slice(7)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(`tool reply was not returned to original chat; last model request ${JSON.stringify(modelRequests.at(-1))}`)
}
before(async () => {
  model = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk
    const body = JSON.parse(data); modelRequests.push(body)
    const blocks = body.messages.flatMap(m => Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }])
    const command = blocks.findLast(c => c.type === 'text' && c.text.startsWith('{"name":'))
    const result = blocks.findLast(c => c.type === 'tool_result')
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'space-message', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (result) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `RESULT:${JSON.stringify(result.content)}` } })
    } else {
      const call = JSON.parse(command.text)
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'space-call', name: call.name, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.args) } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: result ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } })
    emit({ type: 'message_stop' })
    res.end()
  })
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); modelPort = model.address().port
  const run = await runBackendAsync(['start', '--json'], { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    DEEPSEEK_API_KEY: 'mock-space-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${modelPort}/v1` })
  assert.equal(run.code, 0, describeRun('start', run)); port = JSON.parse(run.stdout).listeningPorts[0]
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await user('space-alice'); bob = await user('space-bob')
})
after(async () => {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run)); await new Promise(resolve => model.close(resolve)); removeHome(home)
})
test('chat tools write own private files, share public files, and deny another user including administrator', async () => {
  const root = join(home, 'dsh-home', 'spaces')
  const privateFile = join(root, 'private', String(alice.user.shortId), 'hello.txt')
  assert.match(await tool(alice, 'write', { file_path: privateFile, content: 'private-alice' }), /create|wrote|write|success/i)
  assert.equal(readFileSync(privateFile, 'utf8'), 'private-alice')
  assert.match(await tool(alice, 'read', { file_path: privateFile }), /private-alice/)
  for (const other of [bob, admin]) assert.match(await tool(other, 'read', { file_path: privateFile }), /denied|outside|permission/i)
  const publicFile = join(root, 'public', 'shared.txt')
  await tool(alice, 'write', { file_path: publicFile, content: 'shared-value' })
  assert.match(await tool(bob, 'read', { file_path: publicFile }), /shared-value/)
})
