/**
 * Per-user impressions through the login credential (ticket #245).
 *
 * The backend boots the real v1 profile and Loader against an external model
 * double. The two user-facing endpoints and the Fairy's own `impression_*`
 * tools are driven exactly as the client and the model do; where the contract
 * is about the stored row rather than the interface, the memory SQLite file is
 * read directly.
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
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const { projection } = await request('/chat/read', identity.token, { sessionId })
    if (projection.messages.some(message => message.text === 'NOTE_SAVED')) return
    if (projection.error) assert.fail(`chat failed before the note finished: ${projection.error}`)
    await delay(25)
  }
  assert.fail(`the note never finished in session ${sessionId}`)
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

/** Set one user's impression through the user endpoint after a successful read. */
async function setImpression(identity, content) {
  await request('/impression/read', identity.token)
  const saved = await request('/impression/edit', identity.token, { content })
  assert.deepEqual(saved, { ok: true })
}

before(async () => {
  model = http.createServer(async (request, response) => {
    // Collect the bytes first: decoding each network chunk on its own splits a
    // multi-byte character that straddles two chunks into replacement marks.
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    modelRequests.push(body)
    const blocks = body.messages.flatMap(message => Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }])
    const commandIndex = blocks.findLastIndex(block => block.type === 'text' && typeof block.text === 'string' && block.text.startsWith('{"name":'))
    const command = blocks[commandIndex]
    const result = commandIndex < 0 ? undefined : blocks.slice(commandIndex + 1).findLast(block => block.type === 'tool_result')
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'impression-message', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (command === undefined) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'NOTE_SAVED' } })
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

test('each user reads and edits only their own impression, and must read before editing', async () => {
  const blocked = await request('/impression/edit', alice.token, { content: 'ALICE-FIRST' }, 409)
  assert.equal(blocked.error.code, 'impression/not-read', 'a write without a successful read is refused')

  const empty = await request('/impression/read', alice.token)
  assert.deepEqual(empty.impression, { content: '', updatedAt: null, maxCharacters: 8000 })
  assert.deepEqual(await request('/impression/edit', alice.token, { content: 'ALICE-IMPRESSION' }), { ok: true })
  const read = await request('/impression/read', alice.token)
  assert.equal(read.impression.content, 'ALICE-IMPRESSION')
  assert.equal(typeof read.impression.updatedAt, 'number')

  // Bob's credential never reaches Alice's row, even when the body names her.
  assert.equal((await request('/impression/read', bob.token)).impression.content, '')
  await request('/impression/read', bob.token)
  await request('/impression/edit', bob.token, { content: 'BOB-IMPRESSION', shortId: alice.user.shortId })
  assert.equal((await request('/impression/read', alice.token)).impression.content, 'ALICE-IMPRESSION',
    'another user cannot overwrite this impression')
  assert.equal((await request('/impression/read', bob.token)).impression.content, 'BOB-IMPRESSION',
    'the short number in the body is not a selector')

  // The administrator is an ordinary impression owner here, never a reader of
  // someone else's row, with or without a foreign short number in the body.
  const adminRead = await request('/impression/read', admin.token, { shortId: alice.user.shortId })
  assert.equal(adminRead.impression.content, '', 'the administrator reads only their own impression')
  await request('/impression/edit', admin.token, { content: 'ADMIN-IMPRESSION', shortId: alice.user.shortId })
  assert.equal((await request('/impression/read', alice.token)).impression.content, 'ALICE-IMPRESSION',
    'the administrator cannot write another user\'s impression')

  // The gate follows the login credential: a second live credential of the same
  // user must read for itself before it may write.
  const second = await request('/identity/sign-in', undefined, { name: 'impression-alice', password })
  const refused = await request('/impression/edit', second.token, { content: 'ALICE-FROM-SECOND' }, 409)
  assert.equal(refused.error.code, 'impression/not-read')
  await request('/impression/read', second.token)
  await request('/impression/edit', second.token, { content: 'ALICE-FROM-SECOND' })
  assert.equal((await request('/impression/read', alice.token)).impression.content, 'ALICE-FROM-SECOND')
})

test('an over-length impression is refused loudly and never truncated', async () => {
  const carol = await user('impression-carol')
  await request('/impression/read', carol.token)
  const tooLong = '海'.repeat(8001)
  const refused = await request('/impression/edit', carol.token, { content: tooLong }, 400)
  assert.equal(refused.error.code, 'impression/too-long')
  assert.match(refused.error.message, /8001/)
  assert.match(refused.error.message, /8000/)
  assert.equal((await request('/impression/read', carol.token)).impression.content, '',
    'a refused over-length write changes nothing')

  // The limit counts Unicode characters, not UTF-16 code units: 8000 emoji fit.
  const exact = '😀'.repeat(8000)
  await request('/impression/edit', carol.token, { content: exact })
  const read = await request('/impression/read', carol.token)
  assert.equal([...read.impression.content].length, 8000)
  assert.equal(read.impression.content, exact, 'the accepted text is stored exactly, never clipped')
  assert.equal(storedImpression(carol.user.shortId).content, exact)
})

test('the impression is injected only into its owner\'s system prompt, fresh on every assembly', async () => {
  const aliceSession = await newSession(alice)
  const bobSession = await newSession(bob)
  const adminSession = await newSession(admin)
  await setImpression(alice, 'ALICE-OWN-MARKER')
  await setImpression(bob, 'BOB-OWN-MARKER')
  await setImpression(admin, 'ADMIN-OWN-MARKER')

  await note(alice, aliceSession, 'alice-note-one')
  await note(bob, bobSession, 'bob-note-one')
  await note(admin, adminSession, 'admin-note-one')

  const aliceSystem = systemOf(requestWith('alice-note-one'))
  const bobSystem = systemOf(requestWith('bob-note-one'))
  const adminSystem = systemOf(requestWith('admin-note-one'))
  assert.match(aliceSystem, /ALICE-OWN-MARKER/, 'the owner receives their impression without a search')
  assert.match(bobSystem, /BOB-OWN-MARKER/)
  assert.match(adminSystem, /ADMIN-OWN-MARKER/)
  assert.doesNotMatch(aliceSystem, /BOB-OWN-MARKER|ADMIN-OWN-MARKER/, 'no other user\'s impression enters this prompt')
  assert.doesNotMatch(bobSystem, /ALICE-OWN-MARKER|ADMIN-OWN-MARKER/)
  assert.doesNotMatch(adminSystem, /ALICE-OWN-MARKER|BOB-OWN-MARKER/,
    'the administrator does not receive another user\'s impression')

  // An edit is visible to the very next turn: the section is a provider
  // evaluated at assembly, not a string frozen when the Agent was created.
  await setImpression(alice, 'ALICE-OWN-MARKER-UPDATED')
  await note(alice, aliceSession, 'alice-note-two')
  const updated = systemOf(requestWith('alice-note-two'))
  assert.match(updated, /ALICE-OWN-MARKER-UPDATED/)
  assert.doesNotMatch(updated, /ALICE-OWN-MARKER(?!-UPDATED)/, 'the replaced body is not injected alongside the new one')
  assert.doesNotMatch(updated, /BOB-OWN-MARKER/)
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
  const memory = valueOf(await tool(alice, secondSession, 'memory_add', { content: '印象之外的长期记忆' }), 'memory_add')
  valueOf(await tool(alice, secondSession, 'memory_search', { query: '印象之外' }), 'memory_search')
  valueOf(await tool(alice, secondSession, 'memory_edit', { id: memory.id, old_string: '长期记忆', new_string: '具体事实' }), 'memory_edit')
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
