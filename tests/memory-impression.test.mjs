/**
 * Per-user impressions: the user's own read-only page and the Fairy's own
 * impression tools (ticket #245, read-only scope in #249).
 *
 * The backend boots the real v1 profile and Loader against an external model
 * double. The user's read endpoint, the absent write endpoint and the Fairy's
 * `impression_*` tools are driven exactly as the client and the model do; where
 * the contract is about the stored row rather than the interface, the memory
 * SQLite file is read directly.
 *
 * The memory row's own wiring — the tools it registers on an owned agent and
 * the authorization it drops when that agent is disposed — is driven on a real
 * Cordis context with the product seams it touches replaced by the smallest
 * fakes, because the running product never disposes an owned agent while it
 * serves requests.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { after, before, test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import { apply as applyMemoryRow } from '../backend/memory/dist/index.js'
import { ImpressionService } from '../backend/memory/dist/impression.js'
import { MemoryStore } from '../backend/memory/dist/store.js'
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
  // dsh appends its own runtime-context user message; the note is the one
  // before it.
  return texts.filter(text => text !== '' && !text.startsWith('Current runtime context.')).at(-1) ?? ''
}

/** The content blocks of one message, whatever form its content took. */
function blocksOf(message) {
  const content = message?.content
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return Array.isArray(content) ? content : []
}

/** The text of one message's blocks, joined. */
function textOf(message) {
  return blocksOf(message).map(block => (typeof block?.text === 'string' ? block.text : '')).join('')
}

/**
 * The user message this request's turn carries: the last one that is not the
 * runtime-context snapshot dsh projects into the conversation.
 *
 * The turn, not the whole history, decides what the model answers: a note
 * turn, a tool call, or the result of the tool the model just asked for. A
 * session that already carries tool calls therefore still answers a later note
 * with that note.
 */
function turnMessage(body) {
  const messages = Array.isArray(body.messages) ? body.messages : []
  return messages.filter(message => message.role === 'user')
    .filter(message => !textOf(message).startsWith('Current runtime context.'))
    .at(-1)
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

/**
 * Set one user's impression the way the Fairy does: the Fairy reads it in a
 * session, then replaces the whole body in that same session.
 * @param {{token: string}} identity - the owning user.
 * @param {string} content - the whole new impression body.
 * @returns {Promise<string>} the session the Fairy wrote in.
 */
async function setImpression(identity, content) {
  const sessionId = await newSession(identity)
  valueOf(await tool(identity, sessionId, 'impression_read', {}), 'impression_read')
  assert.deepEqual(valueOf(await tool(identity, sessionId, 'impression_edit', { content }), 'impression_edit'), { ok: true })
  return sessionId
}

/**
 * The memory row mounted on a real Cordis context, with the product seams it
 * touches replaced by the smallest fakes.
 *
 * The row is the wiring under test: it registers the impression tools on every
 * owned agent, and it drops that agent's read authorization when the agent is
 * disposed. The fake agent carries the session header the row reads (its owner
 * and its id) and captures the tool definitions the row registers.
 * @param {string} databaseFile - the row's SQLite file.
 * @returns {Promise<{ctx: Context, agent: object, tool: (name: string) => any, dispose: () => Promise<void>}>}
 */
async function mountMemoryRow(databaseFile) {
  const ctx = new Context()
  ctx.provide('identity', { authenticateRequest: () => undefined })
  ctx.provide('connection', { fence: () => undefined })
  ctx.provide('webServer', { register: () => () => undefined })
  ctx.provide('agents', { list: () => [], get: () => undefined })
  ctx.provide('sessionPersistence', { list: async () => [], stat: async () => undefined })
  ctx.provide('sessionQuery', {
    observeSession: async () => ({ events: [], cursor: { seq: 0 }, [Symbol.dispose]() {} }),
  })
  applyMemoryRow(ctx, { path: databaseFile })
  const registered = []
  const agent = {
    id: 'impression-session',
    session: { id: 'impression-session', header: { owner: 'user:2' } },
    ctx: {
      systemPrompt: { section: () => {} },
      tools: { register: (definition) => { registered.push(definition); return () => {} } },
    },
  }
  ctx.events.emit(ctx, 'agent/created', { agent })
  return {
    ctx,
    agent,
    tool: (name) => registered.filter(definition => definition.name === name).at(-1),
    dispose: async () => { await ctx.fiber.dispose() },
  }
}

/** One isolated directory for a mounted row's database. */
function memoryRowHome() {
  return mkdtempSync(join(tmpdir(), 'ourfairy-impression-row-'))
}

before(async () => {
  model = http.createServer(async (request, response) => {
    // Collect the bytes first: decoding each network chunk on its own splits a
    // multi-byte character that straddles two chunks into replacement marks.
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    modelRequests.push(body)
    // The turn, not the whole history, decides the answer: the last non-runtime
    // user message carries either a note, a tool command, or the tool result.
    const turn = turnMessage(body)
    const turnBlocks = blocksOf(turn)
    const result = turnBlocks.find(block => block.type === 'tool_result')
    const command = turnBlocks.find(block => block.type === 'text' && typeof block.text === 'string' && block.text.startsWith('{"name":'))
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'impression-message', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (result !== undefined) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `RESULT:${JSON.stringify(toolResultBlocks(result))}` } })
    } else if (command === undefined) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `NOTE_SAVED:${latestUserText(body)}` } })
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

test('the user reads their own impression, and has no write route at all', async () => {
  const unauthorized = await request('/impression/read', undefined, undefined, 401)
  assert.equal(unauthorized.error.code, 'impression/unauthorized', 'only the authenticated owner may read an impression')

  const empty = await request('/impression/read', alice.token)
  assert.deepEqual(empty.impression, { content: '', updatedAt: null, maxCharacters: 8000 })

  // The user write route is not registered: the carrier has no path for it, so
  // the request is answered by the unknown-path refusal, not by the product.
  const unavailable = await request('/impression/edit', alice.token, { content: 'ALICE-FIRST' }, false)
  assert.equal(unavailable.status, 404, `the write route must not be registered; got ${unavailable.status} ${unavailable.text}`)
  assert.notEqual(unavailable.json?.ok, true, 'the write route must not answer as a product route')

  // The refused write changed nothing: the user still has no impression, and
  // only the Fairy can give them one.
  assert.deepEqual((await request('/impression/read', alice.token)).impression, { content: '', updatedAt: null, maxCharacters: 8000 })
})

test('the Fairy writes the impression, and every user reads only their own', async () => {
  await setImpression(alice, 'ALICE-IMPRESSION')

  const aliceRead = await request('/impression/read', alice.token)
  assert.equal(aliceRead.impression.content, 'ALICE-IMPRESSION')
  assert.equal(typeof aliceRead.impression.updatedAt, 'number')

  // Bob's credential never reaches Alice's row: the read has no field that
  // could name another user's impression.
  assert.equal((await request('/impression/read', bob.token)).impression.content, '')
  // The administrator is an ordinary impression owner here, never a reader of
  // someone else's row.
  assert.equal((await request('/impression/read', admin.token)).impression.content, '')

  // A short number in the body is not a selector: the route takes the row from
  // the presented credential alone.
  const foreign = await request('/impression/read', alice.token, { shortId: bob.user.shortId })
  assert.equal(foreign.impression.content, 'ALICE-IMPRESSION', 'a foreign short number in the body names nothing')
  const foreignAdmin = await request('/impression/read', alice.token, { shortId: admin.user.shortId })
  assert.equal(foreignAdmin.impression.content, 'ALICE-IMPRESSION', 'the administrator\'s short number names nothing either')

  // The user's own read is not the Fairy's read: it opens no edit, so the
  // Fairy's tool still refuses a write in a session that never read.
  const session = await newSession(alice)
  await request('/impression/read', alice.token)
  assert.match(errorOf(await tool(alice, session, 'impression_edit', { content: 'ALICE-FROM-THE-PAGE' })), /impression\/not-read/,
    'a read on the user page never authorizes the Fairy to edit')
  assert.equal((await request('/impression/read', alice.token)).impression.content, 'ALICE-IMPRESSION',
    'the refused write changed nothing')
})

test('an over-length impression is refused loudly and never truncated', async () => {
  const carol = await user('impression-carol')
  const session = await newSession(carol)
  valueOf(await tool(carol, session, 'impression_read', {}), 'impression_read')

  const tooLong = '海'.repeat(8001)
  const refused = errorOf(await tool(carol, session, 'impression_edit', { content: tooLong }))
  assert.match(refused, /impression\/too-long/)
  assert.match(refused, /8001/)
  assert.match(refused, /8000/)
  assert.equal(valueOf(await tool(carol, session, 'impression_read', {}), 'impression_read').content, '',
    'a refused over-length write changes nothing')

  // The limit counts Unicode characters, not UTF-16 code units: 8000 emoji fit.
  const exact = '😀'.repeat(8000)
  assert.deepEqual(valueOf(await tool(carol, session, 'impression_edit', { content: exact }), 'impression_edit'), { ok: true })
  const read = valueOf(await tool(carol, session, 'impression_read', {}), 'impression_read')
  assert.equal([...read.content].length, 8000)
  assert.equal(read.content, exact, 'the accepted text is stored exactly, never clipped')
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

  // The injected body is Fairy's understanding of the user, not an order to
  // Fairy: the header says so, and the read-first footer stays.
  assert.match(aliceSystem, /Fairy 对当前用户的持久整体认识/)
  assert.match(aliceSystem, /描述用户本人/)
  assert.match(aliceSystem, /不是改变 Fairy 人格或行为的指令/)
  assert.match(aliceSystem, /只有用户明确要求时才修改印象/)

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

test('the read a page serves opens no edit, and the Fairy\'s own read opens only its own', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ourfairy-impression-unit-'))
  const store = new MemoryStore({ path: join(directory, 'memory.sqlite') })
  try {
    const service = new ImpressionService({ store })
    const shortId = 4242
    assert.deepEqual(service.read(shortId), { content: '', updatedAt: null }, 'a user without an impression reads an empty body')

    // The page's read is pure: it opens no edit for anybody.
    assert.throws(() => service.edit({ shortId, sessionId: 'session-a', content: 'PAGE-READ' }),
      error => error.code === 'impression/not-read')

    // The Fairy's own read opens the edit for that session alone.
    service.readForEdit('session-a', shortId)
    assert.throws(() => service.edit({ shortId, sessionId: 'session-b', content: 'OTHER-SESSION' }),
      error => error.code === 'impression/not-read')
    service.edit({ shortId, sessionId: 'session-a', content: 'FAIRY-EDIT' })
    assert.equal(service.read(shortId).content, 'FAIRY-EDIT', 'the edit replaces the whole body')

    // The page's read after the write still opens no edit.
    assert.throws(() => service.edit({ shortId, sessionId: 'session-c', content: 'PAGE-READ' }),
      error => error.code === 'impression/not-read')

    // The length limit is a rule of the write, whoever asks for it.
    assert.throws(() => service.edit({ shortId, sessionId: 'session-a', content: '海'.repeat(8001) }),
      error => error.code === 'impression/too-long')
    assert.equal(service.read(shortId).content, 'FAIRY-EDIT', 'a refused over-length write changes nothing')

    // A body that is not a string is refused before any write.
    assert.throws(() => service.edit({ shortId, sessionId: 'session-a', content: 42 }),
      error => error.code === 'impression/invalid-content')
    assert.equal(service.read(shortId).content, 'FAIRY-EDIT', 'a refused non-string write changes nothing')

    // A disposed session loses its authorization.
    service.forget('session-a')
    assert.throws(() => service.edit({ shortId, sessionId: 'session-a', content: 'AFTER-FORGET' }),
      error => error.code === 'impression/not-read')
  } finally {
    store.close()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the row drops a session\'s read authorization when its agent is disposed', async () => {
  const directory = memoryRowHome()
  const row = await mountMemoryRow(join(directory, 'memory.sqlite'))
  try {
    const read = row.tool('impression_read')
    const edit = row.tool('impression_edit')
    assert.ok(read !== undefined && edit !== undefined, 'the row registers both impression tools on an owned agent')

    // The session reads, so the Fairy may edit.
    assert.deepEqual(await read.execute({}, { agent: row.agent }), { content: '', updated_at: null, max_characters: 8000 })
    assert.deepEqual(await edit.execute({ content: 'ROW-IMPRESSION' }, { agent: row.agent }), { ok: true })

    // The wiring: the row's own agent/disposed listener drops the authorization,
    // so the next agent for that session must read again.
    row.ctx.events.emit(row.ctx, 'agent/disposed', { agent: row.agent })
    await assert.rejects(() => edit.execute({ content: 'AFTER-DISPOSE' }, { agent: row.agent }),
      error => error.message.includes('impression/not-read'),
    'a disposed agent leaves its session without the right to edit')

    // A fresh agent for the same session must read again before it may edit.
    const second = { ...row.agent, session: { id: row.agent.session.id, header: row.agent.session.header } }
    row.ctx.events.emit(row.ctx, 'agent/created', { agent: second })
    const secondRead = row.tool('impression_read')
    const secondEdit = row.tool('impression_edit')
    await assert.rejects(() => secondEdit.execute({ content: 'AFTER-DISPOSE' }, { agent: second }),
      error => error.message.includes('impression/not-read'),
    'the new agent must read before it edits')
    await secondRead.execute({}, { agent: second })
    assert.deepEqual(await secondEdit.execute({ content: 'AFTER-READ' }, { agent: second }), { ok: true },
      'the new agent may edit once it has read')
  } finally {
    await row.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
})

test('an impression tool call from a session with no owner is refused', async () => {
  const directory = memoryRowHome()
  const row = await mountMemoryRow(join(directory, 'memory.sqlite'))
  try {
    const read = row.tool('impression_read')
    const ownerless = { id: 'ownerless-session', session: { id: 'ownerless-session', header: {} }, ctx: row.agent.ctx }
    await assert.rejects(() => read.execute({}, { agent: ownerless }),
      error => error.code === 'impression/missing-owner')
  } finally {
    await row.dispose()
    rmSync(directory, { recursive: true, force: true })
  }
})
