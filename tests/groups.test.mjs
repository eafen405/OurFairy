import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { before, after, test } from 'node:test'
import { describeRun, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort } from './helpers/backend.mjs'

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
function user(name) { return registerUser(port, admin.token, name, password) }
let requestNo = 0
async function tool(user, name, args, sessionId) {
  sessionId ??= (await request('/sessions/create', user.token)).session.id
  const seen = new Set((await request('/chat/read', user.token, { sessionId })).projection.messages.map(m => m.messageId))
  await request('/chat/send', user.token, { sessionId, requestId: `tool-request-${++requestNo}`, text: JSON.stringify({ name, args }) })
  const until = Date.now() + 15000
  while (Date.now() < until) {
    const { projection } = await request('/chat/read', user.token, { sessionId })
    const terminal = projection.messages.filter(m => m.role === 2 && m.text.startsWith('RESULT:'))
    const fresh = terminal.find(m => !seen.has(m.messageId))
    if (fresh) return fresh.text.slice(7)
    if (projection.error) assert.fail(`chat failed before tool result: ${projection.error}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(`tool ${name} reply was not returned to original chat ${sessionId}`)
}
before(async () => {
  model = http.createServer(async (req, res) => {
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
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    DEEPSEEK_API_KEY: 'mock-group-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${modelPort}/v1` })
  port = startedPort(run)
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await user('group-alice'); bob = await user('group-bob')
})
after(async () => {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run)); await new Promise(resolve => model.close(resolve)); removeHome(home)
})
test('chat creates group for designated owner and updates live owner tools', async () => {
  aliceSession = (await request('/sessions/create', alice.token)).session.id
  await tool(alice, 'groups', {}, aliceSession)
  const initial = modelRequests.at(-1)
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

test('only the target group owner changes membership; members share real files and confined scripts', async () => {
  assert.match(await tool(alice, 'group_members', { groupId: group.id, userShortId: bob.user.shortId, action: 1 }, aliceSession), /group-bob|memberShortIds/)
  const path = join(group.root, 'collaboration.txt')
  assert.match(await tool(bob, 'write', { file_path: path, content: 'group-shared-value' }), /create|wrote|write|success/i)
  assert.match(await tool(alice, 'read', { file_path: path }, aliceSession), /group-shared-value/)
  const processResult = await tool(bob, 'bash', { description: 'Read and write group file from actual confined process',
    workdir: group.root, command: "cat collaboration.txt; printf 'group-process-value' > process.txt" })
  assert.match(processResult, /group-shared-value/)
  assert.match(await tool(alice, 'read', { file_path: join(group.root, 'process.txt') }), /group-process-value/)
  for (const outsider of [admin]) {
    assert.match(await tool(outsider, 'read', { file_path: path }), /outside|denied/i)
    assert.match(await tool(outsider, 'bash', { description: 'Try unjoined group file', command: `cat '${path}'` }), /No such file|denied|not found/i)
  }
  assert.match(await tool(bob, 'group_members', { groupId: group.id, userShortId: admin.user.shortId, action: 1 }), /unknown tool/i)
  assert.match(await tool(alice, 'group_create', { name: 'Forbidden lab', ownerShortId: alice.user.shortId }), /unknown tool/i)
  const otherCreated = await tool(admin, 'group_create', { name: 'Other lab', ownerShortId: bob.user.shortId })
  const other = JSON.parse(JSON.parse(otherCreated).map(c => c.text ?? '').join(''))
  assert.match(await tool(bob, 'group_members', { groupId: group.id, userShortId: admin.user.shortId, action: 1 }), /current owner of this group/i)
  assert.match(await tool(alice, 'group_members', { groupId: other.id, userShortId: admin.user.shortId, action: 1 }), /current owner of this group/i)
  assert.match(await tool(admin, 'group_members', { groupId: group.id, userShortId: admin.user.shortId, action: 1 }), /unknown tool|current owner/i)
  assert.match(await tool(alice, 'group_members', { groupId: group.id, userShortId: alice.user.shortId, action: 2 }), /must remain a member/i)
  assert.match(await tool(admin, 'read', { file_path: path }), /outside|denied/i)
})

test('removing a member invalidates the same live session cwd and later file/script access', async () => {
  const sessionId = (await request('/sessions/create', bob.token)).session.id
  await tool(bob, 'working_directory', { cd: group.root }, sessionId)
  assert.match(await tool(bob, 'read', { file_path: 'collaboration.txt' }, sessionId), /group-shared-value/)
  await tool(alice, 'group_members', { groupId: group.id, userShortId: bob.user.shortId, action: 2 })
  assert.match(await tool(bob, 'read', { file_path: 'collaboration.txt' }, sessionId), /outside|denied|not found/i)
  assert.match(await tool(bob, 'write', { file_path: join(group.root, 'forbidden.txt'), content: 'NO' }, sessionId), /outside|denied/i)
  assert.match(await tool(bob, 'bash', { description: 'Try removed group file from same live session', command: `cat '${group.root}/collaboration.txt'` }, sessionId), /outside|denied|not found|No such file/i)
  assert.match(await tool(bob, 'working_directory', { cd: group.root }, sessionId), /outside|denied/i)
  assert.equal(existsSync(join(group.root, 'forbidden.txt')), false)
  assert.match(await tool(bob, 'working_directory', {}, sessionId), /spaces\/private\/3/)
  assert.match(await tool(bob, 'group_members', { groupId: group.id, userShortId: admin.user.shortId, action: 1 }, sessionId), /current owner of this group/i)
  const list = await tool(bob, 'groups', {}, sessionId)
  assert.doesNotMatch(list, /Shared lab/)
  await tool(alice, 'group_members', { groupId: group.id, userShortId: bob.user.shortId, action: 1 })
  assert.match(await tool(bob, 'read', { file_path: join(group.root, 'collaboration.txt') }, sessionId), /group-shared-value/)
})

test('concurrent duplicate membership updates stay singular and restart preserves group access', async () => {
  await Promise.all([tool(alice, 'group_members', { groupId: group.id, userShortId: bob.user.shortId, action: 1 }),
    tool(alice, 'group_members', { groupId: group.id, userShortId: bob.user.shortId, action: 1 })])
  const listing = await tool(bob, 'groups', {})
  const groups = JSON.parse(JSON.parse(listing).map(c => c.text ?? '').join('')).groups
  assert.deepEqual(groups.find(g => g.id === group.id).memberShortIds, [alice.user.shortId, bob.user.shortId])
  const stopped = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(stopped.code, 0, describeRun('restart stop', stopped))
  const started = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    DEEPSEEK_API_KEY: 'mock-group-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${modelPort}/v1` })
  port = startedPort(started)
  assert.match(await tool(bob, 'read', { file_path: join(group.root, 'collaboration.txt') }), /group-shared-value/)
  assert.match(await tool(alice, 'groups', {}, aliceSession), /Shared lab/)
  assert.match(await tool(admin, 'read', { file_path: join(group.root, 'collaboration.txt') }), /outside|denied/i)
  await tool(alice, 'group_members', { groupId: group.id, userShortId: bob.user.shortId, action: 2 }, aliceSession)
  assert.match(await tool(bob, 'read', { file_path: join(group.root, 'collaboration.txt') }), /outside|denied/i)
})
