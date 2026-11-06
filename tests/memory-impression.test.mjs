/**
 * Per-user impressions through the login credential (ticket #245).
 *
 * The backend boots the real v1 profile and Loader against an external model
 * double. The read-only user endpoint and the Fairy's own `impression_*`
 * tools are driven exactly as the client and the model do; where the contract
 * is about the stored row rather than the interface, the memory SQLite file is
 * read directly.
 *
 * @covers backend/memory
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'
import {
  describeRun, httpJson, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort, toolResultBlocks,
} from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-impression-')
const password = 'impression-test-password'
/** The row's configured database, under the isolated deployment home. */
const databasePath = join(home, 'dsh-home', 'memory', 'memory.sqlite')
let port, model, modelPort, admin, alice, bob
let requestNo = 0
/** Every request body the model double received, in arrival order. */
const modelRequests = []

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * One authenticated product request. `/impression/*` bodies are tiny JSON
 * documents; errors answer the product envelope with their own status.
 */
async function request(path, token, body, expect = 200) {
  return httpJson(port, path, { token, body, expect })
}

function user(name) { return registerUser(port, admin.token, name, password) }

/** One fresh ordinary session of one identity. */
async function newSession(identity) {
  return (await request('/sessions/create', identity.token)).session.id
}

/** One plain turn; the model double acknowledges it, which assembles the prompt. */
async function note(identity, sessionId, text) {
  await request('/chat/send', identity.token, { sessionId, requestId: `impression-note-${++requestNo}`, text })
  // The acknowledgement names the note it answers. A bare shared marker would
  // let a previous turn's reply satisfy this wait, so a note could return while
  // its own turn was still assembling; matching the unique text removes that
  // stale-marker race.
  const marker = `NOTE_SAVED:${text}`
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const { projection } = await request('/chat/read', identity.token, { sessionId })
    if (projection.messages.some(message => message.text === marker)) return
    if (projection.error) assert.fail(`chat failed before the note finished: ${projection.error}`)
    await delay(25)
  }
  assert.fail(`the note ${text} never finished in session ${sessionId}`)
}

/**
 * Drive one tool call through chat and return its result blocks as the model
 * sees them: the JSON text of the blocks array.
 */
async function tool(identity, sessionId, name, args, callId = `impression-call-${requestNo + 1}`) {
  const seen = new Set((await request('/chat/read', identity.token, { sessionId })).projection.messages.map(message => message.messageId))
  await request('/chat/send', identity.token, {
    sessionId, requestId: `impression-request-${++requestNo}`, text: JSON.stringify({ name, args, callId }),
  })
  const until = Date.now() + 15000
  while (Date.now() < until) {
    const { projection } = await request('/chat/read', identity.token, { sessionId })
    const terminal = projection.messages.filter(message => message.role === 2 && message.text.startsWith('RESULT:'))
    const fresh = terminal.find(message => !seen.has(message.messageId))
    if (fresh) return fresh.text.slice(7)
    if (projection.error) assert.fail(`chat failed before the ${name} result: ${projection.error}`)
    await delay(25)
  }
  assert.fail(`the ${name} result never returned to session ${sessionId}`)
}

function blocksText(raw) {
  return JSON.parse(raw).map(block => block.text ?? '').join('')
}

/** The value one successful tool call returned. */
function valueOf(raw, label) {
  const text = blocksText(raw)
  assert.equal(text.startsWith('Error:'), false, `${label ?? 'tool'} must succeed; got ${text}`)
  return JSON.parse(text)
}

/** The failure text of one failed tool call. */
function errorOf(raw) { return blocksText(raw) }

/** The latest non-runtime user text in one request: a note turn sends its text verbatim. */
function latestUserText(body) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  const texts = messages.filter(message => message.role === 'user').map(message => {
    const content = message.content
    if (typeof content === 'string') return content
    if (!Array.isArray(content)) return ''
    return content.map(block => typeof block?.text === 'string' ? block.text : '').join('')
  })
  // dsh appends its own runtime-context user message and the native skill
  // catalog is a user message too; the note is the last real user text.
  return texts.filter(text => text !== '' && !text.startsWith('Current runtime context.')
    && !text.startsWith('<system-reminder>')).at(-1) ?? ''
}

/**
 * The system prompt a model request carried, as one string.
 *
 * The Messages wire form carries `system` as text blocks, while some routes
 * send the text as a bare string and others put it at the head of `messages`.
 * Reading every form keeps the assertion about content, not encoding.
 */
function systemOf(body) {
  const blocks = Array.isArray(body.system)
    ? body.system.map(block => block.text ?? '').join('')
    : typeof body.system === 'string' ? body.system : ''
  const history = body.messages.filter(message => message.role === 'system')
    .map(message => typeof message.content === 'string' ? message.content : '')
  return [blocks, ...history].join('\n')
}

/**
 * Every user-role text the model request carried, as one string.
 *
 * Runtime-context material arrives as a user-role snapshot, so this is where an
 * impression must be found once it stops being a system section (#311).
 * @param {object} body - one captured model request.
 * @returns {string} the joined user-role text.
 */
function userDataOf(body) {
  return body.messages
    .filter(message => message.role === 'user')
    .map(message => typeof message.content === 'string' ? message.content
      : (Array.isArray(message.content)
        ? message.content.map(block => typeof block?.text === 'string' ? block.text : '').join('')
        : ''))
    .join('\n')
}

/**
 * The newest runtime-context snapshot the request carried, as one string.
 *
 * dsh keeps superseded snapshots in history and states that the newest one
 * supersedes them, so an assertion about the *current* impression must read the
 * last snapshot rather than every user-role message.
 * @param {object} body - one captured model request.
 * @returns {string} the newest snapshot text, or '' when the request had none.
 */
function snapshotOf(body) {
  const snapshots = body.messages
    .filter(message => message.role === 'user')
    .map(message => typeof message.content === 'string' ? message.content
      : (Array.isArray(message.content)
        ? message.content.map(block => typeof block?.text === 'string' ? block.text : '').join('')
        : ''))
    .filter(text => text.startsWith('Current runtime context.'))
  return snapshots.at(-1) ?? ''
}

/** The last model request whose user text contains one marker. */
function requestWith(marker) {
  const found = modelRequests.filter(body => JSON.stringify(body.messages).includes(marker)).at(-1)
  assert.ok(found, `the model double never received a request containing ${marker}`)
  return found
}

/** The impression row of one user, read straight from the row's database file. */
function storedImpression(shortId) {
  const database = new DatabaseSync(databasePath)
  try {
    return database.prepare('SELECT short_id, content, created_at, updated_at, deleted_at FROM impressions WHERE short_id = ?').get(shortId)
  } finally {
    database.close()
  }
}

/** Set an impression through the only writer: the owner's Fairy tools. */
async function setImpression(identity, content) {
  const session = await newSession(identity)
  valueOf(await tool(identity, session, 'impression_read', {}))
  assert.deepEqual(valueOf(await tool(identity, session, 'impression_edit', { content })), { ok: true })
}

before(async () => {
  model = http.createServer(async (request, response) => {
    // Collect the bytes first: decoding each network chunk on its own splits a
    // multi-byte character that straddles two chunks into replacement marks.
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    // The deployment route also answers session-title requests; a double that
    // scripts conversation turns must not treat one as a turn.
    if (answerIfTitle(Buffer.concat(chunks).toString('utf8'), response)) return
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    modelRequests.push(body)
    const blocks = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }])
    const commandIndex = !latestUserText(body).startsWith('{"name":') ? -1 : blocks.findLastIndex(block => block.type === 'text' && typeof block.text === 'string' && block.text.startsWith('{"name":'))
    const command = blocks[commandIndex]
    const result = commandIndex < 0 ? undefined : blocks.slice(commandIndex + 1).findLast(block => block.type === 'tool_result')
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'impression-message', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (command === undefined) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `NOTE_SAVED:${latestUserText(body)}` } })
    } else if (result !== undefined) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `RESULT:${JSON.stringify(toolResultBlocks(result))}` } })
    } else {
      const call = JSON.parse(command.text)
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: call.callId, name: call.name, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.args) } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: command === undefined || result !== undefined ? 'end_turn' : 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } })
    emit({ type: 'message_stop' })
    response.end()
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')
  modelPort = model.address().port
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-impression-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${modelPort}` })
  port = startedPort(run)
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await user('impression-alice')
  bob = await user('impression-bob')
})

after(async () => {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
  await new Promise(resolve => model.close(resolve))
  removeHome(home)
})

test('the user route is read-only for every credential, including the administrator', async () => {
  assert.deepEqual((await request('/impression/read', alice.token)).impression,
    { content: '', updatedAt: null, maxCharacters: 8000 })
  await setImpression(alice, 'ALICE-IMPRESSION')
  await setImpression(bob, 'BOB-IMPRESSION')
  for (const identity of [alice, bob, admin]) {
    const response = await fetch(`http://127.0.0.1:${port}/impression/edit`, {
      method: 'POST', headers: { authorization: `Bearer ${identity.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'FORBIDDEN', shortId: alice.user.shortId }),
    })
    assert.equal(response.status, 404, 'there is no HTTP write route')
  }
  assert.equal((await request('/impression/read', bob.token, { shortId: alice.user.shortId })).impression.content, 'BOB-IMPRESSION')
  assert.equal((await request('/impression/read', admin.token, { shortId: alice.user.shortId })).impression.content, '')
  assert.equal((await request('/impression/read', alice.token)).impression.content, 'ALICE-IMPRESSION')
})

test('page reads and automatic prompt injection never authorize Fairy edits', async () => {
  const session = await newSession(alice)
  await request('/impression/read', alice.token)
  await note(alice, session, 'read-only-page-does-not-authorize')
  assert.match(errorOf(await tool(alice, session, 'impression_edit', { content: 'FORBIDDEN' })), /impression\/not-read/)
  assert.equal(storedImpression(alice.user.shortId).content, 'ALICE-IMPRESSION')
})

test('the Fairy refuses over-length impressions and counts Unicode code points', async () => {
  const carol = await user('impression-carol')
  const session = await newSession(carol)
  valueOf(await tool(carol, session, 'impression_read', {}))
  assert.match(errorOf(await tool(carol, session, 'impression_edit', { content: '海'.repeat(8001) })), /impression\/too-long/)
  assert.equal((await request('/impression/read', carol.token)).impression.content, '')
  const exact = '😀'.repeat(8000)
  valueOf(await tool(carol, session, 'impression_edit', { content: exact }))
  assert.equal((await request('/impression/read', carol.token)).impression.content, exact)
  assert.equal(storedImpression(carol.user.shortId).content, exact)
})

test('the impression travels only to its owner, as user-role data outside the stable prompt', async () => {
  const aliceSession = await newSession(alice)
  const bobSession = await newSession(bob)
  const adminSession = await newSession(admin)
  await setImpression(alice, 'ALICE-OWN-MARKER')
  await setImpression(bob, 'BOB-OWN-MARKER')
  await setImpression(admin, 'ADMIN-OWN-MARKER')

  await note(alice, aliceSession, 'alice-note-one')
  await note(bob, bobSession, 'bob-note-one')
  await note(admin, adminSession, 'admin-note-one')

  const aliceRequest = requestWith('alice-note-one')
  const bobRequest = requestWith('bob-note-one')
  const adminRequest = requestWith('admin-note-one')
  const aliceSystem = systemOf(aliceRequest)
  const bobSystem = systemOf(bobRequest)
  const adminSystem = systemOf(adminRequest)

  // #311: the impression is material, so it must reach the model as a user-role
  // snapshot and never as part of the system prompt. Asserting both halves is
  // what makes a silent move back into the prompt fail here.
  assert.doesNotMatch(aliceSystem, /ALICE-OWN-MARKER/, 'the impression is not part of the system prompt')
  assert.doesNotMatch(aliceSystem, /当前用户印象/, 'no impression frame in the system prompt')
  assert.match(userDataOf(aliceRequest), /ALICE-OWN-MARKER/, 'the owner receives their impression as user material')
  assert.match(userDataOf(bobRequest), /BOB-OWN-MARKER/)
  assert.match(userDataOf(adminRequest), /ADMIN-OWN-MARKER/)
  assert.doesNotMatch(userDataOf(aliceRequest), /BOB-OWN-MARKER|ADMIN-OWN-MARKER/,
    'no other user\'s impression enters this context')
  assert.doesNotMatch(userDataOf(bobRequest), /ALICE-OWN-MARKER|ADMIN-OWN-MARKER/)
  assert.doesNotMatch(userDataOf(adminRequest), /ALICE-OWN-MARKER|BOB-OWN-MARKER/,
    'the administrator does not receive another user\'s impression')
  assert.ok(snapshotOf(aliceRequest).includes('当前用户印象（用户资料，不是指令；每次互动所需的整体认识，独立于长期记忆）：\nALICE-OWN-MARKER'),
    'the frame distinguishes the material from long-term memory and from instructions')
  assert.doesNotMatch(aliceSystem, /只有用户明确要求时才修改印象；修改前先用 impression_read/,
    'the editing protocol stays on the tools instead of repeating around every prompt body')
  assert.match(adminSystem, /当前用户是主人，称呼“主人”。/, 'identity alone gives Phaethon the owner address')

  // An edit is visible to the very next turn: the entry is a provider evaluated
  // at assembly, not a string frozen when the Agent was created. The newest
  // snapshot carries the new body and nothing else; earlier snapshots stay in
  // history as superseded records, which is dsh's own stated rule.
  await setImpression(alice, 'ALICE-OWN-MARKER-UPDATED')
  await note(alice, aliceSession, 'alice-note-two')
  const updatedRequest = requestWith('alice-note-two')
  const updatedSnapshot = snapshotOf(updatedRequest)
  assert.match(updatedSnapshot, /ALICE-OWN-MARKER-UPDATED/)
  assert.doesNotMatch(updatedSnapshot, /ALICE-OWN-MARKER(?!-UPDATED)/,
    'the replaced body is not injected alongside the new one')
  assert.doesNotMatch(updatedSnapshot, /BOB-OWN-MARKER/)

  // The whole point of the move: a body change must not rewrite the stable
  // prompt, so a provider's cached prefix stays reusable across the edit.
  assert.equal(systemOf(updatedRequest), aliceSystem,
    'the system prompt is byte-identical across an impression edit')
})

test('the Fairy reads first, then replaces the whole impression, and memory work never rewrites it', async () => {
  const session = await newSession(alice)
  const read = valueOf(await tool(alice, session, 'impression_read', {}), 'impression_read')
  assert.equal(read.content, 'ALICE-OWN-MARKER-UPDATED')
  assert.equal(read.max_characters, 8000)
  assert.equal(typeof read.updated_at, 'number')

  const catalog = modelRequests.at(-1).tools.map(definition => definition.name)
  assert.ok(catalog.includes('impression_read'), `the owner must be offered impression_read; catalog ${JSON.stringify(catalog)}`)
  assert.ok(catalog.includes('impression_edit'), `the owner must be offered impression_edit; catalog ${JSON.stringify(catalog)}`)
  const editSchema = modelRequests.at(-1).tools.find(definition => definition.name === 'impression_edit')
  assert.deepEqual(Object.keys(editSchema.input_schema.properties), ['content'], 'the edit tool has no owner or number field')

  // A different session has not read: its edit is refused even though the same
  // user read in another session.
  const secondSession = await newSession(alice)
  assert.match(errorOf(await tool(alice, secondSession, 'impression_edit', { content: 'ALICE-FAIRY-EDITED' })), /impression\/not-read/,
    'a read in another session never authorizes this one')
  valueOf(await tool(alice, secondSession, 'impression_read', {}), 'impression_read')
  assert.deepEqual(valueOf(await tool(alice, secondSession, 'impression_edit', { content: 'ALICE-FAIRY-EDITED' }), 'impression_edit'), { ok: true })

  const replaced = valueOf(await tool(alice, secondSession, 'impression_read', {}), 'impression_read')
  assert.equal(replaced.content, 'ALICE-FAIRY-EDITED', 'the edit replaces the whole body')

  // Over-length content is refused by the tool as well, without truncating.
  assert.match(errorOf(await tool(alice, secondSession, 'impression_edit', { content: '海'.repeat(8001) })), /impression\/too-long/)
  assert.equal(valueOf(await tool(alice, secondSession, 'impression_read', {}), 'impression_read').content, 'ALICE-FAIRY-EDITED',
    'a refused over-length tool write changes nothing')

  // Memory work is a different authority: adding, searching and editing a
  // long-term memory leaves the impression untouched.
  const added = valueOf(await tool(alice, secondSession, 'memory_add', { content: '印象之外的长期记忆' }), 'memory_add')
  assert.deepEqual(added, { ok: true }, 'memory_add answers a simple confirmation')
  const search = valueOf(await tool(alice, secondSession, 'memory_search', { query: '印象之外' }), 'memory_search')
  const memoryId = search.memories.find(memory => memory.content === '印象之外的长期记忆')?.id
  assert.ok(Number.isSafeInteger(memoryId), `the added memory must be searchable; got ${JSON.stringify(search)}`)
  assert.deepEqual(valueOf(await tool(alice, secondSession, 'memory_edit', { id: memoryId, old_string: '长期记忆', new_string: '具体事实' }), 'memory_edit'), { ok: true })
  assert.equal(valueOf(await tool(alice, secondSession, 'impression_read', {}), 'impression_read').content, 'ALICE-FAIRY-EDITED',
    'memory maintenance-style work never rewrites the impression')

  // The administrator's tools act on the administrator's own row.
  const adminSession = await newSession(admin)
  assert.equal(valueOf(await tool(admin, adminSession, 'impression_read', {}), 'impression_read').content, 'ADMIN-OWN-MARKER')
  valueOf(await tool(admin, adminSession, 'impression_edit', { content: 'ADMIN-FAIRY-EDITED' }), 'impression_edit')
  assert.equal(valueOf(await tool(alice, secondSession, 'impression_read', {}), 'impression_read').content, 'ALICE-FAIRY-EDITED',
    'the administrator\'s tool call cannot write another user\'s impression')
})

test('the impression persists with its old timestamps and never expires', async () => {
  // Time-based expiry would be checked when the row is read. Move the only
  // timestamps the row has into the distant past and restart: the body must be
  // returned unchanged, because there is no expiry path at all.
  let run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop before backdating', run))
  const database = new DatabaseSync(databasePath)
  try {
    database.prepare('UPDATE impressions SET created_at = 1, updated_at = 1 WHERE short_id = ?').run(alice.user.shortId)
  } finally {
    database.close()
  }
  assert.equal(storedImpression(alice.user.shortId).updated_at, 1, 'the row now carries only ancient timestamps')
  run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-impression-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${modelPort}` })
  port = startedPort(run)
  const read = await request('/impression/read', alice.token)
  assert.equal(read.impression.content, 'ALICE-FAIRY-EDITED', 'an old impression is still the current impression')
  assert.equal(read.impression.updatedAt, 1)
})


test('session facts are real tool results and leave the cacheable system prefix stable', async () => {
  const session = await newSession(alice)
  const first = valueOf(await tool(alice, session, 'session_facts', {}, 'facts-first'))
  const firstSystem = systemOf(requestWith('facts-first'))
  assert.equal(first.sessionId, session)
  assert.deepEqual(first.reportedTokens, { uncachedInputTokens: 3, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.deepEqual(first.tasks, { total: 0, running: 0 })
  const second = valueOf(await tool(alice, session, 'session_facts', {}, 'facts-second'))
  assert.deepEqual(second.reportedTokens, { uncachedInputTokens: 9, outputTokens: 9, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.ok(second.throughSeq > first.throughSeq)
  assert.equal(systemOf(requestWith('facts-second')), firstSystem, 'usage changes do not rewrite the system prompt')
  assert.doesNotMatch(firstSystem, /reportedTokens/)
  assert.equal('cost' in second, false, 'reported tokens are not a monetary estimate')
})
