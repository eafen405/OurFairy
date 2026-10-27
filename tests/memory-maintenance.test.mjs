/**
 * Per-source-session memory maintenance through the authenticated product
 * session (ticket #246).
 *
 * The backend boots the real v1 profile and Loader against an external model
 * double. Source turns arrive through `/chat/send`; the maintenance child is a
 * real dsh Agent created by the memory row, so its model request crosses the
 * same loopback wire. Assertions read what the child model actually received
 * (the captured request body), the source session's events, and the memory
 * row's own `memory.sqlite` — never a hand-mounted plugin or a private class.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'
import {
  describeRun, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort, toolResultBlocks,
} from './helpers/backend.mjs'

const home = makeHome('ourfairy-memory-maintenance-')
const password = 'maintenance-test-password'
/** The memory row's configured database, under the isolated deployment home. */
const databasePath = join(home, 'dsh-home', 'memory', 'memory.sqlite')
/** The five tools a maintenance child may see, and no others. */
const MEMORY_TOOLS = ['memory_add', 'memory_delete', 'memory_edit', 'memory_search', 'memory_switch']
let port, model, modelPort, admin
let requestNo = 0
let childCallNo = 0
/** The last source tool command this double already turned into a tool_use. */
let executedCommand = null
/** Bodies the model double received for maintenance children, in arrival order. */
const childRequests = []
/** Bodies the model double received for ordinary source sessions, in arrival order. */
const mainRequests = []
/** Per-request scripted child behaviour; an empty queue means "write nothing". */
let childQueue = []
/** Number of upcoming child requests to refuse with a non-retryable HTTP 400. */
let failChildRequests = 0
/** While set, child responses wait until the test releases them. */
let heldChild = null
/** The next child request waits for the test to release it. */
let holdChildRequest = false
/** The next main reply waits for the test to release it. */
let holdMainRequest = false
let heldMain = null

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/** Clear everything one test taught the model double. */
function resetChildDouble() {
  childRequests.length = 0
  mainRequests.length = 0
  childQueue = []
  failChildRequests = 0
  holdChildRequest = false
  heldChild = null
  holdMainRequest = false
  heldMain = null
}

async function request(path, token, body = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(body) })
  const value = await response.json()
  assert.equal(response.status, 200, JSON.stringify(value))
  return value
}

/** One request whose refusal status the caller inspects itself. */
async function rawRequest(path, token, body = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(body) })
  return { status: response.status, json: await response.json() }
}

function user(name) { return registerUser(port, admin.token, name, password) }

async function newSession(identity) {
  return (await request('/sessions/create', identity.token)).session.id
}

/** Poll one predicate until it answers a truthy value or the deadline passes. */
async function waitFor(label, predicate, timeout = 20000) {
  const until = Date.now() + timeout
  let last
  while (Date.now() < until) {
    last = await predicate()
    if (last) return last
    await delay(25)
  }
  assert.fail(`timed out waiting for ${label}; last value ${JSON.stringify(last)}`)
}

/** One ordinary chat turn: send text and wait for its final Fairy reply. */
async function sendTurn(identity, sessionId, text, { uploadIds = [], expect = 'REPLY:' } = {}) {
  const seen = new Set((await request('/chat/read', identity.token, { sessionId })).projection.messages.map(message => message.messageId))
  await request('/chat/send', identity.token, {
    sessionId, requestId: `maintenance-turn-${++requestNo}`, text, ...(uploadIds.length > 0 ? { uploadIds } : {}),
  })
  const until = Date.now() + 20000
  while (Date.now() < until) {
    const { projection } = await request('/chat/read', identity.token, { sessionId })
    const reply = projection.messages.find(message => message.role === 2 && message.status === 2
      && !seen.has(message.messageId) && message.text.startsWith(expect))
    if (reply) return reply
    if (projection.error) assert.fail(`chat failed before the reply: ${projection.error}`)
    await delay(20)
  }
  assert.fail(`the ${expect} reply never returned to session ${sessionId}`)
}

/** One scripted tool call in a source session; returns the tool result text. */
async function toolTurn(identity, sessionId, name, args) {
  const seen = new Set((await request('/chat/read', identity.token, { sessionId })).projection.messages.map(message => message.messageId))
  await request('/chat/send', identity.token, {
    sessionId, requestId: `maintenance-tool-${++requestNo}`, text: JSON.stringify({ name, args, callId: `maintenance-call-${requestNo}` }),
  })
  const until = Date.now() + 20000
  while (Date.now() < until) {
    const { projection } = await request('/chat/read', identity.token, { sessionId })
    const reply = projection.messages.find(message => message.role === 2 && message.status === 2
      && !seen.has(message.messageId) && message.text.startsWith('RESULT:'))
    if (reply) return reply.text.slice(7)
    if (projection.error) assert.fail(`chat failed before the ${name} result: ${projection.error}`)
    await delay(20)
  }
  assert.fail(`the ${name} result never returned to session ${sessionId}`)
}

/** One raw binary request against the running backend. */
async function rawPost(path, token, bytes, headers) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST',
    headers: { authorization: `Bearer ${token}`, ...headers }, body: bytes })
  const text = await response.text()
  assert.equal(response.status, 200, text)
  return JSON.parse(text)
}

/** Upload one file into a source session and return its upload receipt. */
async function upload(identity, sessionId, bytes, name) {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const proposal = await request('/attachments/propose', identity.token, { sessionId, name, mime: 'text/plain', size: bytes.length, sha256 })
  await rawPost('/attachments/chunk', identity.token, bytes, {
    'content-type': 'application/octet-stream', 'x-upload-id': proposal.upload.uploadId, 'x-upload-offset': '0',
  })
  const completed = await request('/attachments/complete', identity.token, { uploadId: proposal.upload.uploadId })
  return completed.upload
}

/** The stored memory rows, read straight from the row's own database file. */
function storedMemories() {
  const database = new DatabaseSync(databasePath)
  try {
    return database.prepare('SELECT id, content, is_private, source_session FROM memories ORDER BY id').all()
  } finally {
    database.close()
  }
}

/** The maintenance state row for one source session, read from its own database. */
function maintenanceRow(sourceSession) {
  const database = new DatabaseSync(databasePath)
  try {
    return database.prepare('SELECT * FROM maintenance_state WHERE source_session = ?').get(sourceSession)
  } finally {
    database.close()
  }
}

/** Set one source's persisted newest-closed-turn time, as an operator time change would. */
function setLastClosedAt(sourceSession, time) {
  const database = new DatabaseSync(databasePath)
  try {
    database.exec('PRAGMA busy_timeout = 2000')
    database.prepare('UPDATE maintenance_state SET last_closed_at = ? WHERE source_session = ?').run(time, sourceSession)
  } finally {
    database.close()
  }
}

/** The raw source events the product routes expose, including turn boundaries. */
async function sourceEvents(identity, sessionId) {
  return (await request('/chat/read', identity.token, { sessionId, maxEvents: 256 })).projection.events
}

/** Emit one Messages-protocol text response. */
function emitText(response, text) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  emit({ type: 'message_start', message: { id: 'maintenance-message', type: 'message', role: 'assistant',
    model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
  emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
  emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
  emit({ type: 'content_block_stop', index: 0 })
  emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
  emit({ type: 'message_stop' })
  response.end()
}

/** Emit one Messages-protocol tool-use response. */
function emitToolUse(response, call) {
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  const callId = `child-call-${++childCallNo}`
  const input = call.arguments ?? call.args ?? {}
  emit({ type: 'message_start', message: { id: 'maintenance-message', type: 'message', role: 'assistant',
    model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
  emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: callId, name: call.name, input: {} } })
  emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } })
  emit({ type: 'content_block_stop', index: 0 })
  emit({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } })
  emit({ type: 'message_stop' })
  response.end()
}

/** One child request: its scripted action, or a zero-write completion. */
async function answerChild(response, body, tools) {
  const blocks = body.messages.flatMap(message => Array.isArray(message.content)
    ? message.content
    : [{ type: 'text', text: message.content }])
  if (failChildRequests > 0) {
    failChildRequests -= 1
    response.writeHead(400, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'the maintenance double refuses this turn' } }))
    return
  }
  if (holdChildRequest) {
    holdChildRequest = false
    await new Promise(resolve => { heldChild = { response, body, tools, release: resolve } })
  }
  const hasToolResult = blocks.some(block => block.type === 'tool_result')
  const action = childQueue.shift()
  if (action !== undefined) {
    const call = action()
    if (call?.toolCall) {
      emitToolUse(response, call.toolCall)
      return
    }
    if (call?.text !== undefined) {
      emitText(response, call.text)
      return
    }
  }
  emitText(response, 'MAINTENANCE-DONE')
}

before(async () => {
  model = http.createServer(async (request, response) => {
    // Collect the bytes first: decoding each network chunk on its own splits a
    // multi-byte character that straddles two chunks into replacement marks.
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    const tools = Array.isArray(body.tools) ? body.tools.map(tool => tool.name) : []
    const isChild = tools.length === MEMORY_TOOLS.length && MEMORY_TOOLS.every(name => tools.includes(name))
    if (isChild) {
      childRequests.push({ body, tools })
      await answerChild(response, body, tools)
      return
    }
    mainRequests.push(body)
    const blocks = body.messages.flatMap(message => Array.isArray(message.content)
      ? message.content
      : [{ type: 'text', text: message.content }])
    const lastBlock = blocks.at(-1)
    const hasToolResult = lastBlock?.type === 'tool_result'
    const directive = blocks.filter(block => block.type === 'text' && typeof block.text === 'string').at(-1)?.text ?? ''
    const scripted = directive.includes('请记住这个') ? { name: 'memory_add', arguments: { content: '主会话记住的材料内容' } }
      : directive.includes('请整理待办') ? { name: 'todo_write', arguments: { todos: [{ content: 'TODO-ARG-SECRET', status: 'pending' }] } }
        : directive.includes('请查一下') ? { name: 'memory_search', arguments: { query: 'SEARCH-ARG-SECRET' } }
          : undefined
    const commandIndex = blocks.findLastIndex(block => block.type === 'text' && typeof block.text === 'string' && block.text.startsWith('{"name":'))
    const command = blocks[commandIndex]
    if (hasToolResult) {
      const lastToolUse = blocks.findLast(block => block.type === 'tool_use')
      emitText(response, lastToolUse?.name === 'memory_search' || lastToolUse?.name === 'conversation_search'
        ? `RESULT:${JSON.stringify(toolResultBlocks(lastBlock))}`
        : 'RESULT:{"ok":true}')
      return
    }
    if (scripted !== undefined) {
      emitToolUse(response, scripted)
      return
    }
    if (command !== undefined && command.text !== executedCommand) {
      executedCommand = command.text
      emitToolUse(response, JSON.parse(command.text))
      return
    }
    const turnText = blocks.filter(block => block.type === 'text' && typeof block.text === 'string'
      && block.text.includes('TURN:')).at(-1)?.text ?? 'no turn'
    const replyText = `REPLY:${turnText.slice(0, 120)}`
    if (holdMainRequest) {
      holdMainRequest = false
      await new Promise(resolve => { heldMain = { response, text: replyText, release: resolve } })
      emitText(response, replyText)
      return
    }
    emitText(response, replyText)
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')
  modelPort = model.address().port
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-maintenance-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${modelPort}` })
  port = startedPort(run)
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
})

after(async () => {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
  await new Promise(resolve => model.close(resolve))
  removeHome(home)
})

test('the default threshold is 15 closed user turns, and a zero-write child advances the watermark', async () => {
  const alice = await user('maintenance-threshold')
  const session = await newSession(alice)
  for (let index = 0; index < 14; index += 1) {
    await sendTurn(alice, session, `TURN:${index}:普通对话第${index}轮`)
  }
  await waitFor('the source observation row', () => maintenanceRow(session))
  const observed = maintenanceRow(session)
  assert.equal(observed.child_session, null, 'below the threshold no maintenance child exists')
  assert.ok(childRequests.length === 0, `no child may start below 15 closed turns; got ${childRequests.length}`)

  await sendTurn(alice, session, 'TURN:14:普通对话第14轮')
  const completed = await waitFor('the zero-write maintenance completion', () => {
    const row = maintenanceRow(session)
    return row?.status === 0 && row?.child_session !== null && row?.watermark_seq >= 0 ? row : undefined
  })
  assert.equal(childRequests.length, 1, 'exactly one maintenance child runs for this interval')
  const [child] = childRequests
  assert.deepEqual([...child.tools].sort(), MEMORY_TOOLS, 'the child sees only the five long-term memory tools')
  assert.equal(child.body.model, 'MiniMax-M3.1-Flash', 'the child uses the deployment light model route')

  const endings = (await sourceEvents(alice, session)).filter(event => event.type === 'turn/end')
  assert.equal(endings.length, 15)
  assert.equal(completed.watermark_seq, endings.at(-1).seq, 'the completed watermark covers the frozen interval')
  assert.equal(completed.cut_seq, endings.at(-1).seq, 'the frozen cut is the last closed turn of the interval')
})

test('the child reads only interval messages, attachment names and memory changes, and attributes writes to the source', async () => {
  resetChildDouble()
  const alice = await user('maintenance-material')
  const session = await newSession(alice)
  for (let index = 0; index < 11; index += 1) {
    await sendTurn(alice, session, `TURN:${index}:材料区间第${index}轮`)
  }
  const attachment = await upload(alice, session, Buffer.from('ATTACHMENT-BODY-SECRET'), 'maintenance-note.txt')
  await sendTurn(alice, session, 'TURN:11:请看附件', { uploadIds: [attachment.uploadId] })
  await sendTurn(alice, session, 'TURN:12:请记住这个', { expect: 'RESULT:' })
  await sendTurn(alice, session, 'TURN:13:请整理待办', { expect: 'RESULT:' })
  // Script the child's decision before the fifteenth turn closes the interval.
  childQueue = [() => ({ toolCall: { name: 'memory_add', arguments: { content: '维护子会话新增的归属测试记忆' } } })]
  await sendTurn(alice, session, 'TURN:14:请查一下', { expect: 'RESULT:' })

  const [child] = await waitFor('the child request', () => childRequests.length > 0 ? childRequests : undefined)
  const material = child.body.messages.find(message => typeof message.content === 'string' && message.content.startsWith('维护材料：'))?.content
  assert.ok(typeof material === 'string', `the child must receive one material message; got ${JSON.stringify(child.body.messages)}`)
  assert.match(material, /TURN:0:材料区间第0轮/, 'the interval user messages are present')
  assert.match(material, /\[Fairy\] REPLY:TURN:0:材料区间第0轮/, 'the interval Fairy replies are present')
  assert.match(material, /TURN:11:请看附件/)
  assert.match(material, /\[附件\] maintenance-note\.txt/, 'only the attachment name is carried')
  assert.match(material, /\[记忆变更\] memory_add \{"content":"主会话记住的材料内容"\}/, 'the source memory change call is carried')
  assert.equal(material.includes('ATTACHMENT-BODY-SECRET'), false, 'attachment bodies never enter the material')
  assert.equal(material.includes('TODO-ARG-SECRET'), false, 'other tools inputs never enter the material')
  assert.equal(material.includes('SEARCH-ARG-SECRET'), false, 'a memory search call is not a memory change call')
  assert.equal(material.includes('你是Fairy'), false, 'the source persona is not part of the material')
  assert.equal(material.includes('当前已认证用户短号'), false, 'the source identity prompt is not part of the material')

  const system = JSON.stringify(child.body.system ?? '')
  assert.equal(system.includes('你是Fairy'), false, 'the child does not inherit the Fairy persona')
  assert.equal(system.includes('当前已认证用户短号'), false, 'the child does not inherit the source identity prompt')
  assert.equal(JSON.stringify(child.body).includes('Authorized file spaces'), false, 'the deployment file-space prompt is skipped for the maintenance preset')
  const sourceUserMessages = child.body.messages.filter(message => message.role === 'user'
    && JSON.stringify(message.content).includes('TURN:'))
  assert.equal(sourceUserMessages.length, 1, 'source turns exist only inside the material, not as separate child messages')
  assert.deepEqual([...child.tools].sort(), MEMORY_TOOLS)

  // The scripted child add must attribute its source to the source session,
  // never to the child itself.
  const completed = await waitFor('the child write completion', () => {
    const row = maintenanceRow(session)
    return row?.status === 0 && row?.watermark_seq >= 0 ? row : undefined
  })
  assert.ok(completed.watermark_seq > 0)
  const stored = storedMemories().find(row => row.content === '维护子会话新增的归属测试记忆')
  assert.ok(stored !== undefined, 'the child write reached the memory store')
  assert.equal(stored.source_session, session, 'the memory source is the parentSession source, not the child')
  const searched = valueOf(await toolTurn(alice, session, 'memory_search', { query: '维护子会话新增的归属测试记忆' }))
  assert.equal(searched.memories[0].owner_short_id, alice.user.shortId, 'the owner is derived from the source session header')
})

/** The value one successful tool result carries. */
function valueOf(raw) {
  const text = JSON.parse(raw).map(block => block.text ?? '').join('')
  assert.equal(text.startsWith('Error:'), false, text)
  return JSON.parse(text)
}

test('maintenance waits for silence, runs beside the source, freezes its interval and never doubles a child', async () => {
  resetChildDouble()
  const alice = await user('maintenance-parallel')
  const session = await newSession(alice)
  for (let index = 0; index < 14; index += 1) {
    await sendTurn(alice, session, `TURN:${index}:并行前置第${index}轮`)
  }
  await waitFor('the prerequisite observation row', () => maintenanceRow(session))

  // The fifteenth reply stays open, so the source is running when the
  // threshold is reached. A running source must not get a child.
  holdMainRequest = true
  const pendingTurn = sendTurn(alice, session, 'TURN:14:静默等待测试')
  await waitFor('the held fifteenth reply', () => heldMain)
  await delay(2500)
  assert.equal(childRequests.length, 0, 'a running source never starts maintenance')
  assert.equal(maintenanceRow(session).child_session, null)

  holdChildRequest = true
  heldMain.release()
  await pendingTurn
  await waitFor('the maintenance child request', () => childRequests.length > 0)
  assert.equal(childRequests.length, 1)
  assert.ok(heldChild !== null, 'the child request is held open')
  const heldRequest = childRequests[0]

  // The source continues while its child is held: the extra turn succeeds,
  // belongs to the next interval, and never creates a second child.
  const reply = await sendTurn(alice, session, 'TURN:15:冻结之后的新消息')
  assert.match(reply.text, /TURN:15/)
  await delay(2500)
  assert.equal(childRequests.length, 1, 'one source session has at most one maintenance child at a time')
  const running = maintenanceRow(session)
  assert.equal(running.status, 1, 'the child is still the running interval')
  assert.equal(childRequests[0], heldRequest, 'the only child request is the one already running')

  heldChild.release()
  const completed = await waitFor('the frozen interval completion', () => {
    const row = maintenanceRow(session)
    return row?.status === 0 && row?.watermark_seq >= 0 ? row : undefined
  })
  assert.equal(completed.child_session, running.child_session, 'the completion is recorded for the same child')
  assert.equal(JSON.stringify(heldRequest.body).includes('冻结之后的新消息'), false, 'the extra turn is not part of the frozen material')

  const endings = (await sourceEvents(alice, session)).filter(event => event.type === 'turn/end')
  assert.equal(endings.length, 16)
  assert.equal(completed.watermark_seq, endings.at(-2).seq, 'the frozen cut is the fifteenth turn')
  assert.ok(endings.at(-1).seq > completed.watermark_seq, 'the later turn starts the next interval')
})

test('a failed maintenance run keeps the watermark and resumes the same child', async () => {
  resetChildDouble()
  const alice = await user('maintenance-retry')
  const session = await newSession(alice)
  for (let index = 0; index < 14; index += 1) {
    await sendTurn(alice, session, `TURN:${index}:失败恢复前置第${index}轮`)
  }
  failChildRequests = 1
  await sendTurn(alice, session, 'TURN:14:失败恢复测试')

  const failed = await waitFor('the failed maintenance run', () => {
    const row = maintenanceRow(session)
    return row?.status === 2 ? row : undefined
  })
  assert.equal(failed.watermark_seq, -1, 'a failed run does not advance the watermark')
  assert.ok(typeof failed.child_session === 'string' && failed.child_session.length > 0)
  const childSession = failed.child_session
  const endings = (await sourceEvents(alice, session)).filter(event => event.type === 'turn/end')
  assert.equal(failed.cut_seq, endings.at(-1).seq, 'the frozen cut survives the failure')
  assert.equal(childRequests.length, 1, 'only the refused turn reached the model')

  const recovered = await waitFor('the resumed completion', () => {
    const row = maintenanceRow(session)
    return row?.status === 0 && row?.watermark_seq >= 0 ? row : undefined
  }, 30000)
  assert.equal(recovered.child_session, childSession, 'the retry resumes the same child session')
  assert.equal(recovered.watermark_seq, failed.cut_seq, 'the recovered run advances to the same frozen cut')
  await waitFor('the resumed child request', () => childRequests.length >= 2 ? true : undefined)
  const resumed = childRequests[1].body.messages.flatMap(message => Array.isArray(message.content)
    ? message.content.map(block => block.text ?? '')
    : [message.content]).join('\n')
  assert.match(resumed, /维护材料：/, 'the resumed child keeps its original material')
  assert.match(resumed, /上一轮维护没有完成/, 'the resumed child receives the retry instruction')
})

test('the maintenance child must run its own search before it can change a memory', async () => {
  resetChildDouble()
  const alice = await user('maintenance-gate')
  const session = await newSession(alice)
  await toolTurn(alice, session, 'memory_add', { content: '门禁记忆：雨天的旧伞' })
  const [stored] = storedMemories().filter(row => row.content === '门禁记忆：雨天的旧伞')
  assert.ok(stored !== undefined)
  await toolTurn(alice, session, 'memory_search', { query: '门禁记忆' })
  for (let index = 0; index < 13; index += 1) {
    await sendTurn(alice, session, `TURN:${index}:门禁前置第${index}轮`)
  }
  // The source queried the memory above; that must not authorize the child.
  // The child has to search for itself, so its first edit is refused and only
  // the edit after its own search succeeds.
  childQueue = [
    () => ({ toolCall: { name: 'memory_edit', arguments: { id: stored.id, old_string: '旧伞', new_string: '新伞' } } }),
    () => ({ toolCall: { name: 'memory_search', arguments: { query: '门禁记忆' } } }),
    () => ({ toolCall: { name: 'memory_edit', arguments: { id: stored.id, old_string: '旧伞', new_string: '新伞' } } }),
  ]
  await sendTurn(alice, session, 'TURN:12:门禁触发')

  const completed = await waitFor('the gated maintenance completion', () => {
    const row = maintenanceRow(session)
    return row?.status === 0 && row?.watermark_seq >= 0 ? row : undefined
  })
  assert.ok(completed.watermark_seq > 0)
  await waitFor('three child tool calls', () => childRequests.length >= 4 ? true : undefined, 30000)

  const toolResultText = index => childRequests[index].body.messages
    .flatMap(message => Array.isArray(message.content) ? message.content : [])
    .filter(block => block.type === 'tool_result')
    .map(block => block.content ?? '')
    .join('\n')
  assert.match(toolResultText(1), /memory\/not-queried/, 'a source-session query never authorizes the child')
  assert.match(toolResultText(2), /门禁记忆/, 'the child can find the memory with its own search')
  assert.match(toolResultText(3), /"ok":true/, 'the edit after the child\'s own search succeeds')
  const edited = storedMemories().find(row => row.id === stored.id)
  assert.equal(edited?.content, '门禁记忆：雨天的新伞')
  assert.equal(edited?.source_session, session, 'a child edit stays attributed to its source session')
})

test('the maintenance child stays out of the user session list and search, and leaves the main model alone', async () => {
  resetChildDouble()
  const alice = await user('maintenance-invisible')
  const session = await newSession(alice)
  for (let index = 0; index < 15; index += 1) {
    await sendTurn(alice, session, `TURN:${index}:不可见性第${index}轮`)
  }
  const completed = await waitFor('the child completion', () => {
    const row = maintenanceRow(session)
    return row?.status === 0 && row?.child_session !== null ? row : undefined
  })
  const childSession = completed.child_session

  const list = await request('/sessions/list', alice.token)
  assert.equal(list.sessions.some(entry => entry.id === childSession), false, 'the child never enters the user session list')
  const read = await rawRequest('/sessions/read', alice.token, { sessionId: childSession })
  assert.equal(read.status, 403)
  assert.equal(read.json.error.code, 'sessions/unowned-session', 'the child has no owner and is not readable as a user session')

  const searched = valueOf(await toolTurn(alice, session, 'conversation_search', { query: 'MAINTENANCE-DONE' }))
  assert.deepEqual(searched.matches, [], 'conversation search never reaches the ownerless child')

  assert.ok(mainRequests.length >= 1)
  assert.ok(mainRequests.every(body => body.model === 'MiniMax-M3.1-Flash'), 'the source keeps the deployment model')
  assert.ok(childRequests.every(request => request.body.model === 'MiniMax-M3.1-Flash'), 'the child uses the configured light model route')
})

test('a parked interval is re-evaluated on time: one full decay interval lowers the threshold by one', async () => {
  resetChildDouble()
  const alice = await user('maintenance-decay')
  const session = await newSession(alice)
  for (let index = 0; index < 14; index += 1) {
    await sendTurn(alice, session, `TURN:${index}:衰减前置第${index}轮`)
  }
  const latestEnd = (await sourceEvents(alice, session)).filter(event => event.type === 'turn/end').at(-1).seq
  const observed = await waitFor('the observed interval', () => {
    const row = maintenanceRow(session)
    return row?.cut_seq === latestEnd ? row : undefined
  })
  assert.equal(observed.child_session, null, 'fourteen turns stay below the default threshold of fifteen')
  // The source is cold enough after one full six-hour interval: the threshold
  // is fourteen, so the same untouched interval must now start maintenance.
  setLastClosedAt(session, Date.now() - 7 * 60 * 60 * 1000)
  const completed = await waitFor('the decayed interval completion', () => {
    const row = maintenanceRow(session)
    return row?.status === 0 && row?.watermark_seq >= 0 ? row : undefined
  })
  assert.equal(completed.cut_seq, observed.cut_seq, 'the interval content is unchanged')
  const endings = (await sourceEvents(alice, session)).filter(event => event.type === 'turn/end')
  assert.equal(completed.watermark_seq, endings.at(-1).seq)
  assert.equal(childRequests.length, 1, 'the decayed threshold starts exactly one child')
})
