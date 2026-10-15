import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { before, after, test } from 'node:test'
import { makeHome, removeHome, runBackendAsync, describeRun } from './helpers/backend.mjs'

const home = makeHome('ourfairy-groups-')
const password = 'group-test-password'
let port, model, modelPort, admin, alice, bob
let aliceSession, group
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
let requestNo = 0
async function tool(user, name, args, sessionId) {
  sessionId ??= (await request('/sessions/create', user.token)).session.id
  const old = (await request('/chat/read', user.token, { sessionId })).projection.messages.filter(m => m.role === 2 && m.text.startsWith('RESULT:')).length
  await request('/chat/send', user.token, { sessionId, requestId: `tool-request-${++requestNo}`, text: JSON.stringify({ name, args }) })
  const until = Date.now() + 15000
  while (Date.now() < until) {
    const { projection } = await request('/chat/read', user.token, { sessionId })
    const terminal = projection.messages.filter(m => m.role === 2 && m.text.startsWith('RESULT:'))
    if (terminal.length > old) return terminal.at(-1).text.slice(7)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(`tool reply was not returned to original chat; last model request ${JSON.stringify(modelRequests.at(-1))}`)
}
before(async () => {
  const packageDir = join(home, 'fixture', 'package')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: 'ourfairy-fixture-dep', version: '1.0.0', main: 'index.js' }))
  writeFileSync(join(packageDir, 'index.js'), "module.exports = 'shared-dependency-ok'\n")
  execFileSync('tar', ['-czf', join(home, 'fixture.tgz'), '-C', join(home, 'fixture'), 'package'])
  model = http.createServer(async (req, res) => {
    if (req.url === '/fixture.tgz') { res.setHeader('content-type', 'application/gzip'); res.end(readFileSync(join(home, 'fixture.tgz'))); return }
    if (req.url === '/network-probe') { res.end('network-ok'); return }
    let data = ''; for await (const chunk of req) data += chunk
    const body = JSON.parse(data); modelRequests.push(body)
    const blocks = body.messages.flatMap(m => Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }])
    const commandIndex = blocks.findLastIndex(c => c.type === 'text' && c.text.startsWith('{"name":'))
    const command = blocks[commandIndex]
    const result = blocks.slice(commandIndex + 1).findLast(c => c.type === 'tool_result')
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'group-message', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (result) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `RESULT:${JSON.stringify(result.content)}` } })
    } else {
      const call = JSON.parse(command.text)
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'group-call', name: call.name, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.args) } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: result ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } })
    emit({ type: 'message_stop' })
    res.end()
  })
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); modelPort = model.address().port
  const run = await runBackendAsync(['start', '--json'], { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    DEEPSEEK_API_KEY: 'mock-group-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${modelPort}/v1` })
  assert.equal(run.code, 0, describeRun('start', run)); port = JSON.parse(run.stdout).listeningPorts[0]
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await user('group-alice'); bob = await user('group-bob')
})
after(async () => {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run)); await new Promise(resolve => model.close(resolve)); removeHome(home)
})
test('chat creates group for designated owner, updates live owner tools and persists membership', async () => {
  aliceSession = (await request('/sessions/create', alice.token)).session.id
  await tool(alice, 'groups', {}, aliceSession)
  const initial = modelRequests.findLast(r => r.messages.some(m => JSON.stringify(m).includes('"name":"groups"')))
  assert.equal(initial.tools.some(t => t.name === 'group_create'), false)
  assert.equal(initial.tools.some(t => t.name === 'group_members'), false)
  const result = await tool(admin, 'group_create', { name: 'Shared lab', ownerShortId: alice.user.shortId })
  assert.match(result, /Shared lab/)
  const listing = await tool(alice, 'groups', {}, aliceSession)
  assert.match(listing, /Shared lab/)
  const text = JSON.parse(listing).map(c => c.text ?? '').join('')
  group = JSON.parse(text).groups[0]
  assert.equal(group.ownerShortId, alice.user.shortId)
  assert.deepEqual(group.memberShortIds, [alice.user.shortId])
  assert.equal(modelRequests.at(-1).tools.some(t => t.name === 'group_members'), true)
  assert.equal(modelRequests.at(-1).tools.some(t => t.name === 'group_create'), false)
  assert.match(await tool(admin, 'read', { file_path: join(group.root, 'missing.txt') }), /outside|denied/i)
})
