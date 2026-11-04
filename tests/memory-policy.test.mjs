/**
 * Where the memory write rule is allowed to live (tickets #248, #302).
 *
 * #248 put the rule in two places: the `memory_add` description and an
 * `ourfairy:memory-policy` prompt section. #302 removed the section — the
 * description already carried the rule, and a prohibition list in the
 * deployment prompt read back as assistant register.
 *
 * This test uses the real profile and Loader with a model double and reads the
 * prompts the model actually receives: the owned prompt must no longer carry
 * the section, the `memory_add` description must still carry the rule, and the
 * maintenance child keeps its own policy.
 *
 * @covers backend/memory
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { after, before, test } from 'node:test'
import {
  describeRun, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort,
} from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-memory-policy-')
const password = 'memory-policy-password'
const MEMORY_TOOLS = ['memory_add', 'memory_delete', 'memory_edit', 'memory_search', 'memory_switch']
/**
 * A phrase only the removed `ourfairy:memory-policy` section carried.
 *
 * The maintenance child has its own policy with overlapping wording, so this
 * marker must be a phrase unique to the owned section rather than a rule both
 * writers share.
 */
const MAIN_SECTION_MARKER = '用户明确要求记住时立即用 memory_add 保存'
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
    // The deployment route also answers session-title requests; a double that
    // scripts conversation turns must not treat one as a turn.
    if (answerIfTitle(Buffer.concat(chunks).toString('utf8'), response)) return
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

test('the write rule lives in the tool description, not in a prompt section', async () => {
  const user = await registerUser(port, admin.token, 'policy-user', password)
  const session = (await request('/sessions/create', user.token)).session.id
  for (let index = 0; index < 5; index += 1) await sendTurn(user, session, `POLICY-TURN-${index}`)

  const source = requests.find(body => !isChild(body))
  assert.ok(source !== undefined, 'the source session made a model request')
  const sourceSystem = systemOf(source)
  // #302 removed the `ourfairy:memory-policy` section. The `memory_add`
  // description already carried the same rule, so the deployment prompt no
  // longer holds a prohibition list of its own (#302).
  assert.equal(sourceSystem.includes(MAIN_SECTION_MARKER), false,
    'the owned prompt carries no memory-policy section any more')
  const addTool = Array.isArray(source.tools) ? source.tools.find(tool => tool.name === 'memory_add') : undefined
  assert.ok(addTool !== undefined, 'the source request declares memory_add')
  assert.match(addTool.description, /session summaries/, 'memory_add names the no-summary/no-profile rule')

  const child = await waitFor('the maintenance child request', () => requests.find(body => isChild(body)))
  const childSystem = systemOf(child)
  assert.match(childSystem, /不要写会话摘要/, 'the maintenance child carries the same no-summary/no-profile rule')
  assert.match(childSystem, /不要把你执行过的记忆增删改/, 'the child forbids meta-memories about memory operations')
  assert.match(childSystem, /不要记录带有「最近」「今天」「现在」「刚才」/, 'the child excludes time-bound observations')
  assert.match(childSystem, /可复用的工作流.*skill_manage.*记忆/u, 'the child carries the same workflow→skill boundary')

  assert.equal(childSystem.includes(MAIN_SECTION_MARKER), false, 'the removed owned prompt policy is not inherited by the child')
  assert.equal(childSystem.includes('Authorized file spaces'), false,
    'the spaces prompt context contributes nothing to the maintenance preset')
  assert.match(childSystem, /你是长期记忆维护子代理/, 'the child carries its own maintenance instruction')
  assert.deepEqual([...child.tools.map(tool => tool.name)].sort(), [...MEMORY_TOOLS].sort(),
    'the child still sees only the five memory tools')

  // #302 restates dsh's tool-usage sections in the deployment's voice, and a
  // section whose tool is not visible contributes nothing. The child has no
  // shell and no jobs, so it must not carry their instructions — upstream
  // registers `tool:bash` and `tool:jobs` unconditionally, which used to cost
  // this child 474 characters of discipline it could not act on.
  assert.equal(/exit code|后台任务|job_output/.test(childSystem), false,
    'the child carries no shell or background-job instructions, because it has neither tool')
})
