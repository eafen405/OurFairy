import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { existsSync, rmSync } from 'node:fs'
import { before, after, test } from 'node:test'
import { makeHome, removeHome, runBackendAsync, describeRun } from './helpers/backend.mjs'

const devFlags = process.env.OURFAIRY_DSH_DIR ? ['--allow-drift'] : []
const home = makeHome('ourfairy-search-')
const password = 'group-test-password'
let port, model, modelPort, admin, alice, bob
let aliceSession, bobSession
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
async function note(user, sessionId, text) {
  await request('/chat/send', user.token, { sessionId, requestId: `note-${++requestNo}`, text })
  for (let attempt = 0; attempt < 200; attempt++) {
    const { projection } = await request('/chat/read', user.token, { sessionId })
    if (projection.messages.some(m => m.text === 'NOTE_SAVED')) return
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail('ordinary note did not finish')
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
    if (!command) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'NOTE_SAVED' } })
    } else if (result) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `RESULT:${JSON.stringify(result.content)}` } })
    } else {
      const call = JSON.parse(command.text)
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'group-call', name: call.name, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.args) } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: result || !command ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } })
    emit({ type: 'message_stop' })
    res.end()
  })
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); modelPort = model.address().port
  const run = await runBackendAsync(['start', '--json', ...devFlags], { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    DEEPSEEK_API_KEY: 'mock-search-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${modelPort}/v1` })
  assert.equal(run.code, 0, describeRun('start', run)); port = JSON.parse(run.stdout).listeningPorts[0]
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await user('group-alice'); bob = await user('group-bob')
})
after(async () => {
  const run = await runBackendAsync(['stop', '--json', ...devFlags], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run)); await new Promise(resolve => model.close(resolve)); removeHome(home)
})
test('chat searches Chinese message excerpts then reads original event positions', async () => {
  aliceSession = (await request('/sessions/create', alice.token)).session.id
  bobSession = (await request('/sessions/create', bob.token)).session.id
  await note(alice, aliceSession, '春天的计划。'.repeat(15) + '北京咖啡馆周末讨论' + '等待确认时间。'.repeat(15))
  await note(bob, bobSession, '咖啡')
  const result = JSON.parse(await tool(alice, 'conversation_search', { query: '咖啡', limit: 1 }))
  const value = JSON.parse(result.map(c => c.text ?? '').join(''))
  assert.equal(value.matches.length, 1)
  assert.equal(value.matches[0].sessionId, aliceSession)
  assert.equal(value.matches[0].type, 'user/message')
  assert.match(value.matches[0].snippet, /北京咖啡馆/)
  assert.ok(Array.from(value.matches[0].snippet).length >= 50)
  assert.ok(Array.from(value.matches[0].snippet).length <= 100)
  const read = JSON.parse(await tool(alice, 'conversation_read', { sessionId: aliceSession, fromSeq: value.matches[0].seq, toSeq: value.matches[0].seq }))
  const range = JSON.parse(read.map(c => c.text ?? '').join(''))
  assert.equal(range.events[0].seq, value.matches[0].seq)
  assert.match(range.events[0].text, /北京咖啡馆/)
  assert.deepEqual(range.events.map(e => e.type), ['user/message'])
})

const valueOf = text => JSON.parse(JSON.parse(text).map(c => c.text ?? '').join(''))

test('known foreign IDs and administrator status cannot widen conversation tools', async () => {
  for (const caller of [alice, admin]) {
    const denied = await tool(caller, 'conversation_read', { sessionId: bobSession, fromSeq: 0, toSeq: 99 })
    assert.match(denied, /unknown-session|visible to you/)
    assert.doesNotMatch(denied, /NOTE_SAVED/)
  }
  const adminSearch = valueOf(await tool(admin, 'conversation_search', { query: '咖啡', limit: 1 }))
  assert.deepEqual(adminSearch.matches, [])
  const aliceSearch = valueOf(await tool(alice, 'conversation_search', { query: '咖啡', limit: 1 }))
  assert.notEqual(aliceSearch.matches[0].sessionId, bobSession)
  assert.match(aliceSearch.matches[0].sessionId, /^ourfairy-user-2-/)
  const schema = modelRequests.at(-1).tools.find(t => t.name === 'conversation_search')
  assert.deepEqual(Object.keys(schema.input_schema.properties).sort(), ['limit', 'query'])
})

test('read intervals have inclusive original positions, omit tool results, and bound message text', async () => {
  await tool(alice, 'groups', {}, aliceSession)
  const raw = (await request('/chat/read', alice.token, { sessionId: aliceSession, maxEvents: 256 })).projection.events
  assert.ok(raw.some(e => e.type === 'tool/result'))
  const range = valueOf(await tool(alice, 'conversation_read', { sessionId: aliceSession, fromSeq: 0, toSeq: 99 }))
  assert.ok(range.events.length >= 2)
  assert.ok(range.events.every(e => ['user/message', 'assistant/message', 'delivery/message'].includes(e.type)))
  assert.ok(range.events.every(e => Number.isInteger(e.seq)))
  assert.equal(range.truncated, false)
  const empty = valueOf(await tool(alice, 'conversation_read', { sessionId: aliceSession, fromSeq: 999, toSeq: 999 }))
  assert.deepEqual(empty.events, [])
  assert.match(await tool(alice, 'conversation_read', { sessionId: aliceSession, fromSeq: 10, toSeq: 9 }), /invalid-range/)
  assert.match(await tool(alice, 'conversation_read', { sessionId: aliceSession, fromSeq: 0, toSeq: 100 }), /invalid-range/)
  const longSession = (await request('/sessions/create', alice.token)).session.id
  await note(alice, longSession, '消息预算😀'.repeat(2000))
  const budget = valueOf(await tool(alice, 'conversation_read', { sessionId: longSession, fromSeq: 0, toSeq: 99 }))
  assert.equal(budget.truncated, true)
  assert.equal(budget.events.reduce((sum, e) => sum + Array.from(e.text).length, 0), 8000)
  const brief = (await request('/sessions/create', alice.token)).session.id
  await note(alice, brief, '单字珈')
  const shortHit = valueOf(await tool(alice, 'conversation_search', { query: '珈', limit: 1 }))
  assert.equal(shortHit.matches[0].snippet, '单字珈')
})

test('native index rebuild preserves Chinese search scope and independently authorized range reads', async () => {
  const index = join(home, 'dsh-home', 'query', 'sessions.sqlite')
  assert.ok(existsSync(index))
  let run = await runBackendAsync(['stop', '--json', ...devFlags], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop for index rebuild', run))
  for (const suffix of ['', '-wal', '-shm']) rmSync(index + suffix, { force: true })
  run = await runBackendAsync(['start', '--json', ...devFlags], { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    DEEPSEEK_API_KEY: 'mock-search-key', DEEPSEEK_BASE_URL: `http://127.0.0.1:${modelPort}/v1` })
  assert.equal(run.code, 0, describeRun('restart after index deletion', run))
  port = JSON.parse(run.stdout).listeningPorts[0]
  const result = valueOf(await tool(alice, 'conversation_search', { query: '咖啡馆', limit: 1 }))
  assert.equal(result.matches[0].sessionId, aliceSession)
  assert.match(result.matches[0].snippet, /北京咖啡馆/)
  assert.ok(existsSync(index))
  const range = valueOf(await tool(alice, 'conversation_read', { sessionId: aliceSession, fromSeq: result.matches[0].seq, toSeq: result.matches[0].seq }))
  assert.match(range.events[0].text, /北京咖啡馆/)
  assert.match(await tool(admin, 'conversation_read', { sessionId: aliceSession, fromSeq: 0, toSeq: 99 }), /unknown-session|visible to you/)
})


test('recipient searches a formal delivered body and reads its original event without sender access', async () => {
  const text = '共享邮笺：明天去星河书店读诗。'
  const delivered = valueOf(await tool(bob, 'deliver_message', { recipientShortId: alice.user.shortId, text }, bobSession))
  const recipientSearch = valueOf(await tool(alice, 'conversation_search', { query: '星河书店', limit: 1 }))
  const hit = recipientSearch.matches[0]
  assert.equal(hit.sessionId, delivered.sessionId)
  assert.equal(hit.type, 'delivery/message')
  assert.equal(hit.seq, delivered.acceptedSeq)
  assert.equal(hit.snippet, text)
  const range = valueOf(await tool(alice, 'conversation_read', { sessionId: hit.sessionId, fromSeq: hit.seq, toSeq: hit.seq }))
  assert.deepEqual(range.events, [{ seq: delivered.acceptedSeq, type: 'delivery/message', text }])
  assert.match(await tool(bob, 'conversation_read', { sessionId: hit.sessionId, fromSeq: hit.seq, toSeq: hit.seq }), /unknown-session|visible to you/)
  const source = modelRequests.at(-1)
  const systemText = JSON.stringify(source.system ?? source.messages.filter(m => m.role === 'system'))
  assert.ok(systemText.length > 2, 'actual model request must carry the deployment prompt')
  assert.doesNotMatch(systemText, /星河书店/)
})
