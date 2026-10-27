/**
 * The memory policy's mounting points (ticket #248).
 *
 * The real-model acceptance (`scripts/memory-acceptance.ts`) found that the
 * Fairy and its maintenance child wrote session summaries, user profiles and
 * inferred environment facts. The fix is guidance, not a semantic filter: one
 * policy section on an owned Agent's prompt, the same rules in the
 * `memory_add` description, and a maintenance-child policy that names the
 * no-summary/no-profile rule. This test uses the real profile and Loader with a
 * model double and reads the prompts the model actually receives, so a policy
 * that stops being mounted fails here even though the real semantic sample is
 * not part of CI.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import {
  describeRun, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort,
} from './helpers/backend.mjs'

const home = makeHome('ourfairy-memory-policy-')
const password = 'memory-policy-password'
const MEMORY_TOOLS = ['memory_add', 'memory_delete', 'memory_edit', 'memory_search', 'memory_switch']
const MAIN_POLICY_MARKER = '不要写会话摘要、用户画像'
const MAIN_ONLY_MARKER = '用户明确要求记住时立即用 memory_add 保存'
let port, model, modelPort, admin
/** Every request body the double received, in arrival order. */
const requests = []
let requestNo = 0

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

function isChild(body) {
  const names = Array.isArray(body.tools) ? body.tools.map(tool => tool.name) : []
  return names.length === MEMORY_TOOLS.length && MEMORY_TOOLS.every(name => names.includes(name))
}

/** The system prompt as one string; the wire carries text blocks. */
function systemOf(body) {
  if (typeof body.system === 'string') return body.system
  if (!Array.isArray(body.system)) return ''
  return body.system.map(block => typeof block?.text === 'string' ? block.text : '').join('\n')
}

/** The latest user text in one request, for a distinguishable acknowledgement. */
function latestUserText(body) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const last = messages.filter(message => message.role === 'user').at(-1)
  const content = last?.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(block => typeof block?.text === 'string' ? block.text : '').join('')
}

function emitText(response, text) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  emit({ type: 'message_start', message: { id: 'policy-message', type: 'message', role: 'assistant',
    model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
  emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  emit({ type: 'content_block_stop', index: 0 })
  emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
  emit({ type: 'message_stop' })
  response.end()
}

async function request(path, token, body = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(body) })
  const value = await response.json()
  assert.equal(response.status, 200, JSON.stringify(value))
  return value
}

/** One source turn; the double answers text, so the turn settles in one step. */
async function sendTurn(identity, sessionId, text) {
  const seen = new Set((await request('/chat/read', identity.token, { sessionId })).projection.messages.map(message => message.messageId))
  await request('/chat/send', identity.token, { sessionId, requestId: `policy-turn-${++requestNo}`, text })
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const { projection } = await request('/chat/read', identity.token, { sessionId })
    const reply = projection.messages.find(message => message.role === 2 && message.status === 2 && !seen.has(message.messageId))
    if (reply) return reply
    if (projection.error) assert.fail(`chat failed: ${projection.error}`)
    await delay(20)
  }
  assert.fail(`the turn never settled in ${sessionId}`)
}

async function waitFor(label, predicate, timeout = 20_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await delay(25)
  }
  assert.fail(`timed out waiting for ${label}`)
}

before(async () => {
  model = http.createServer(async (incoming, response) => {
    // Collect first: decoding per network chunk splits a multi-byte character.
    const chunks = []
    for await (const chunk of incoming) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push(body)
    emitText(response, isChild(body) ? 'MAINTENANCE-DONE' : `ACK:${latestUserText(body).slice(0, 60)}`)
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')
  modelPort = model.address().port
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-memory-policy-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${modelPort}`,
    OURFAIRY_MEMORY_MAINTENANCE_TURNS: '5', OURFAIRY_MEMORY_MAINTENANCE_DECAY_HOURS: '3' })
  port = startedPort(run)
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
})

after(async () => {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
  await new Promise(resolve => model.close(resolve))
  removeHome(home)
})

test('the owned prompt and the maintenance child carry the memory policy at their own seams', async () => {
  const user = await registerUser(port, admin.token, 'policy-user', password)
  const session = (await request('/sessions/create', user.token)).session.id
  for (let index = 0; index < 5; index += 1) await sendTurn(user, session, `POLICY-TURN-${index}`)

  const source = requests.find(body => !isChild(body))
  assert.ok(source !== undefined, 'the source session made a model request')
  const sourceSystem = systemOf(source)
  assert.match(sourceSystem, new RegExp(MAIN_POLICY_MARKER), 'the owned prompt carries the memory policy')
  assert.match(sourceSystem, /不要把你执行过的记忆增删改/, 'the owned prompt forbids meta-memories about memory operations')
  assert.match(sourceSystem, /不要记录带有「最近」「今天」「现在」「刚才」/, 'the owned prompt excludes time-bound observations')
  const addTool = Array.isArray(source.tools) ? source.tools.find(tool => tool.name === 'memory_add') : undefined
  assert.ok(addTool !== undefined, 'the source request declares memory_add')
  assert.match(addTool.description, /session summaries/, 'memory_add names the no-summary/no-profile rule')

  const child = await waitFor('the maintenance child request', () => requests.find(body => isChild(body)))
  const childSystem = systemOf(child)
  assert.match(childSystem, /不要写会话摘要/, 'the maintenance child carries the same no-summary/no-profile rule')
  assert.match(childSystem, /不要把你执行过的记忆增删改/, 'the child forbids meta-memories about memory operations')
  assert.match(childSystem, /不要记录带有「最近」「今天」「现在」「刚才」/, 'the child excludes time-bound observations')
  assert.equal(childSystem.includes(MAIN_ONLY_MARKER), false, 'the owned prompt policy is not inherited by the child')
  assert.deepEqual([...child.tools.map(tool => tool.name)].sort(), [...MEMORY_TOOLS].sort(),
    'the child still sees only the five memory tools')
})
