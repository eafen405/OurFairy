/**
 * The memory policy's mounting points (ticket #248).
 *
 * The real-model acceptance (`scripts/memory-acceptance.ts`) found that the
 * Fairy and its maintenance child wrote session summaries, user profiles and
 * inferred environment facts. The guidance is not a semantic filter: the main
 * session and maintenance child both receive it through `memory_add`, while the
 * child keeps its separate maintenance instruction. This test uses the real
 * profile and Loader with a model double and reads the prompts and tool schemas
 * the model actually receives, so a policy that stops being mounted fails here
 * even though the real semantic sample is not part of CI.
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
const MAIN_POLICY_MARKER = '不要写会话摘要、用户画像'
const MAIN_ONLY_MARKER = '用户明确要求记住时立即用 memory_add 保存'
/**
 * The stable prefix of the `ourfairy:spaces` section (`spaces/src/index.ts`).
 *
 * The section is the deployment's own voice, so the marker is Chinese; matching
 * the English text it used to be written in would make the assertion below pass
 * without checking anything.
 *
 * Where it can surface: `ourfairy:spaces` is a prompt **context**, not a
 * section. `complete: true` on the child's section replaces the section list
 * but leaves contexts rendered, and the agent loop delivers them as a runtime
 * context message. The maintenance child never registers that context at all,
 * so the real request body must not carry this marker anywhere — hence the
 * whole-body check below rather than a `system`-only one.
 */
const SPACES_PROMPT_MARKER = '授权文件空间：'
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

test('memory policy lives on memory_add while maintenance keeps its own prompt', async () => {
  const user = await registerUser(port, admin.token, 'policy-user', password)
  const session = (await request('/sessions/create', user.token)).session.id
  for (let index = 0; index < 5; index += 1) await sendTurn(user, session, `POLICY-TURN-${index}`)

  const source = requests.find(body => !isChild(body))
  assert.ok(source !== undefined, 'the source session made a model request')
  const sourceSystem = systemOf(source)
  // Every section this deployment owns speaks its own voice, including the
  // `tool:` rows dsh registers: `prompt-assembly` restates them when the tool is
  // visible. The markers below are the deployment's wording, not dsh's — a
  // marker copied from upstream would pass only while nothing rewrites it.
  const guidance = [
    ['bash', '用 bash 时读每条的 exit code'],
    ['read', '看文本文件用 read'],
    ['write', '用 write 覆盖已有文件前先读一遍'],
    ['edit', '改文件前先读一遍'],
    ['jobs', '记录后台任务 id'],
    ['persona', '你是《绝区零》中的 Fairy'],
    ['identity', `当前已认证用户短号：${user.user.shortId}`],
  ].map(([name, marker]) => [name, sourceSystem.indexOf(marker)])
  for (const [name, index] of guidance) assert.ok(index >= 0, `${name} guidance is present`)
  for (let index = 1; index < guidance.length; index += 1) {
    assert.ok(guidance[index][1] > guidance[index - 1][1], `${guidance[index][0]} follows ${guidance[index - 1][0]}`)
  }
  assert.equal(sourceSystem.includes(MAIN_POLICY_MARKER), false, 'the main system prompt leaves memory policy to the tool')
  assert.equal(sourceSystem.includes(MAIN_ONLY_MARKER), false, 'the old main-session policy is absent')
  assert.match(sourceSystem, /当前用户是代理人。/, 'identity derives the ordinary-user clause from the short number')
  assert.ok(sourceSystem.includes('昵称（仅用于称呼）："policy-user"。'), 'identity carries the stored nickname as quoted address data')

  const addTool = Array.isArray(source.tools) ? source.tools.find(tool => tool.name === 'memory_add') : undefined
  assert.ok(addTool !== undefined, 'the source request declares memory_add')
  for (const rule of [/用户明确要求记住/, /长期事实、偏好、重复习惯、共同经历/,
    /会话摘要、画像或性格推测/, /短期状态和待办/, /记忆维护操作/,
    /可复用工作流.*skill_manage/, /无合格内容就不写/]) {
    assert.match(addTool.description, rule, `memory_add carries ${rule}`)
  }

  const child = await waitFor('the maintenance child request', () => requests.find(body => isChild(body)))
  const childSystem = systemOf(child)
  assert.match(childSystem, /按 memory_add 的记忆选择规则/, 'the child points to the shared write policy')
  assert.match(childSystem, /已经完成的操作不重复执行/, 'maintenance retains its interval-specific deduplication rule')
  assert.doesNotMatch(childSystem, /会话摘要|画像或性格推测/, 'the child does not duplicate tool selection rules')

  assert.equal(childSystem.includes(MAIN_ONLY_MARKER), false, 'the owned prompt policy is not inherited by the child')
  // The spaces contribution is a prompt context, which the agent loop delivers
  // as a runtime-context message rather than a `system` section, so the whole
  // request body is checked — a `system`-only check cannot see it.
  assert.equal(JSON.stringify(child).includes(SPACES_PROMPT_MARKER), false,
    'the spaces prompt context contributes nothing to the maintenance preset')
  assert.match(childSystem, /你是长期记忆维护子代理/, 'the child carries its own maintenance instruction')
  // `prompt-assembly` empties a tool section whose tool the agent cannot see, so
  // the child pays neither dsh's English nor the deployment's restatement. A
  // marker left over from the English wording would make these pass vacuously.
  assert.equal(childSystem.includes('Check the [exit code: N] marker'), false,
    'the maintenance prompt does not inherit dsh bash operations guidance')
  assert.equal(childSystem.includes('用 bash 时读每条的 exit code'), false,
    'the maintenance prompt does not inherit the restated bash guidance')
  assert.equal(childSystem.includes('Track every background job id you start'), false,
    'the maintenance prompt does not inherit dsh jobs operations guidance')
  assert.equal(childSystem.includes('后台任务用 job_output 收结果'), false,
    'the maintenance prompt does not inherit the restated jobs guidance')
  assert.equal(childSystem.includes('看文本文件用 read'), false,
    'the maintenance prompt does not inherit the restated read guidance')
  assert.deepEqual([...child.tools.map(tool => tool.name)].sort(), [...MEMORY_TOOLS].sort(),
    'the child still sees only the five memory tools')
  const childAddTool = child.tools.find(tool => tool.name === 'memory_add')
  assert.equal(childAddTool.description, addTool.description, 'both writers receive the same memory_add policy')
})
