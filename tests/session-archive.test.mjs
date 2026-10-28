/**
 * Ticket #253 acceptance: "delete" is archiving a session.
 *
 * Every case drives the shipped launcher over real HTTP. The archive is a
 * product fact, so the checks are the product's own: the session leaves the
 * default list and survives a restart, its log and messages are untouched, the
 * primary session is refused by the backend (not only hidden in the UI), an
 * archived empty session is never entered again by `create`, conversation search
 * cannot see it, and another identity can neither archive nor read it.
 *
 * The model double answers title requests itself (the mounted title provider
 * asks the same route) and otherwise scripts one tool call per message whose
 * text is a `{"name": ...}` command. The search case needs that because the
 * product's search is a model tool, not an HTTP route.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import http from 'node:http'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { after, before, describe, test } from 'node:test'
import {
  describeRun, httpJson, makeHome, removeHome, runBackendAsync, startArgs, startedPort, toolResultBlocks,
} from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const PHAETHON_PASSWORD = 'archive-phaethon-password'
const home = makeHome('ourfairy-session-archive-')
const backend = { port: undefined }
const modelRequests = []
let admin
let model
let messageSerial = 0

/** Boot the real backend on an ephemeral port and remember the one it bound. */
async function startBackend() {
  const run = await runBackendAsync(startArgs(), {
    OURFAIRY_HOME: home,
    OURFAIRY_PORT: '0',
    OURFAIRY_PHAETHON_PASSWORD: PHAETHON_PASSWORD,
    MINIMAX_CN_API_KEY: 'mock-key',
    OURFAIRY_MINIMAX_BASE_URL: model.origin,
  })
  backend.port = startedPort(run)
}

/** Stop the running backend, asserting it left nothing behind. */
async function stopBackend() {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
  assert.match(run.stdout, /"leakedProcesses": \[\]|leaked processes: 0/u,
    `stopping the backend must not leave a process behind:\n${run.stdout}`)
}

/** Read one request body as one UTF-8 string, so a character split across chunks survives. */
async function readRequestBody(source) {
  const chunks = []
  for await (const chunk of source) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

before(async () => {
  const server = http.createServer(async (request, response) => {
    const raw = await readRequestBody(request)
    // The deployment route also answers session-title requests; a double that
    // scripts conversation turns must not treat one as a turn.
    if (answerIfTitle(raw, response)) return
    const body = JSON.parse(raw)
    modelRequests.push(body)
    const blocks = body.messages.flatMap(message => Array.isArray(message.content)
      ? message.content
      : [{ type: 'text', text: message.content }])
    const commandIndex = blocks.findLastIndex(block => block.type === 'text' && block.text.startsWith('{"name":'))
    const command = blocks[commandIndex]
    const result = blocks.slice(commandIndex + 1).findLast(block => block.type === 'tool_result')
    const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    emit({
      type: 'message_start',
      message: {
        id: 'archive-message', type: 'message', role: 'assistant', model: 'test',
        content: [], usage: { input_tokens: 3, output_tokens: 0 },
      },
    })
    const text = result === undefined
      ? (command === undefined ? 'OK' : undefined)
      : `RESULT:${JSON.stringify(toolResultBlocks(result))}`
    if (text !== undefined) {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
    } else {
      const call = JSON.parse(command.text)
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'archive-call', name: call.name, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.args) } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({
      type: 'message_delta',
      delta: { stop_reason: text === undefined ? 'tool_use' : 'end_turn', stop_sequence: null },
      usage: { output_tokens: 3 },
    })
    emit({ type: 'message_stop' })
    response.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  model = { server, origin: `http://127.0.0.1:${server.address().port}` }
  await startBackend()
  admin = await signIn('phaethon', PHAETHON_PASSWORD)
})

after(async () => {
  await stopBackend()
  removeHome(home)
  model.server.closeAllConnections?.()
  await new Promise(resolve => model.server.close(resolve))
})

/** One HTTP request against the running backend, with the raw response kept. */
function request(path, options = {}) {
  return httpJson(backend.port, path, { ...options, expect: false })
}

/** Sign one identity in and return its session credential and user. */
async function signIn(name, password) {
  const response = await request('/identity/sign-in', { body: { name, password } })
  assert.equal(response.status, 200, `sign-in for ${name} failed: ${response.text}`)
  return response.json
}

/** Register one freshly invited identity. */
async function register(name) {
  const invite = await request('/identity/invite', { token: admin.token })
  assert.equal(invite.status, 200, `invite creation failed: ${invite.text}`)
  const registered = await request('/identity/register', {
    body: { inviteCode: invite.json.invite.code, name, password: `${name}-password` },
  })
  assert.equal(registered.status, 200, `registering ${name} failed: ${registered.text}`)
  return registered.json
}

/** One identity with a primary session carrying content and one ordinary session. */
async function identityWithOrdinary(name) {
  const user = await register(name)
  const primary = await request('/sessions/create', { token: user.token })
  assert.equal(primary.status, 200, primary.text)
  await say(user.token, primary.json.session.id, 'primary session content')
  const ordinary = await request('/sessions/create', { token: user.token })
  assert.equal(ordinary.status, 200, ordinary.text)
  assert.notEqual(ordinary.json.session.id, primary.json.session.id,
    'a session whose log carries a message is not reused')
  return { user, primaryId: primary.json.session.id, ordinaryId: ordinary.json.session.id }
}

/**
 * Send one chat message and wait until its reply settles, so the session's log
 * is durably non-empty before the next `create` reads it.
 */
async function say(token, sessionId, text = 'owned-session content') {
  const sent = await request('/chat/send', {
    token, body: { sessionId, requestId: `archive-message-${++messageSerial}`, text },
  })
  assert.equal(sent.status, 200, `sending a message must succeed: ${sent.text}`)
  const until = Date.now() + 15000
  let projection
  do {
    const read = await request('/chat/read', { token, body: { sessionId } })
    assert.equal(read.status, 200, `reading the sent session must succeed: ${read.text}`)
    projection = read.json.projection
    if (projection.replyStatus === 0 && projection.messages.some(message => message.role === 2)) return
    await new Promise(resolve => setTimeout(resolve, 25))
  } while (Date.now() < until)
  assert.fail(`the sent message did not settle: ${JSON.stringify(projection)}`)
}

/**
 * Invoke one model tool in a session and return its answer text.
 *
 * The tool call is only observable through the model: the double emits one
 * `tool_use` for a command-shaped message and the product feeds the result back.
 */
async function tool(token, name, args, sessionId) {
  const seen = new Set((await request('/chat/read', { token, body: { sessionId } }))
    .json.projection.messages.map(message => message.messageId))
  const sent = await request('/chat/send', {
    token, body: { sessionId, requestId: `archive-tool-${++messageSerial}`, text: JSON.stringify({ name, args }) },
  })
  assert.equal(sent.status, 200, `sending the tool call must succeed: ${sent.text}`)
  const until = Date.now() + 15000
  while (Date.now() < until) {
    const read = await request('/chat/read', { token, body: { sessionId } })
    assert.equal(read.status, 200, read.text)
    const fresh = read.json.projection.messages
      .filter(message => message.role === 2 && message.text.startsWith('RESULT:'))
      .find(message => !seen.has(message.messageId))
    if (fresh !== undefined) return fresh.text.slice(7)
    if (read.json.projection.error) assert.fail(`chat failed before the tool result: ${read.json.projection.error}`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.fail(`tool ${name} returned no answer to session ${sessionId}`)
}

/** The canonical value one tool answered. */
function valueOf(text) {
  return JSON.parse(JSON.parse(text).map(block => block.text ?? '').join(''))
}

/** One session's durable log digest, so "archiving deleted nothing" is checkable. */
function logDigest(sessionId) {
  const root = join(home, 'dsh-home', 'sessions')
  const found = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.jsonl(\.zstd)?$/u.test(entry.name) && relative(root, path).split('/').includes(sessionId)) found.push(path)
    }
  }
  walk(root)
  assert.equal(found.length, 1, `session ${sessionId} must have exactly one durable log`)
  return createHash('sha256').update(readFileSync(found[0])).digest('hex')
}

/** The ids one list answered, in the order it answered them. */
function idsOf(response) {
  assert.equal(response.status, 200, response.text)
  assert.equal(response.json.ok, true, response.text)
  return response.json.sessions.map(session => session.id)
}

describe('OurFairy session archive over real HTTP', () => {
  test('archiving hides a session from the default list while its log and messages stay readable', async () => {
    const { user, primaryId, ordinaryId } = await identityWithOrdinary('archive-owner-one')
    const token = user.token
    await say(token, ordinaryId, '北京咖啡馆周末讨论')

    // No request has archived anything yet: the default view still holds both,
    // and the archived view holds neither. Lists and reads do not archive.
    assert.deepEqual(idsOf(await request('/sessions/list', { token })).sort(), [primaryId, ordinaryId].sort())
    assert.deepEqual(idsOf(await request('/sessions/list', { token, body: { archived: true } })), [])

    const digestBefore = logDigest(ordinaryId)
    const archived = await request('/sessions/archive', { token, body: { sessionId: ordinaryId } })
    assert.equal(archived.status, 200, archived.text)
    assert.equal(archived.json.session.id, ordinaryId)

    assert.deepEqual(idsOf(await request('/sessions/list', { token })), [primaryId],
      'an archived session leaves the default list')
    assert.deepEqual(idsOf(await request('/sessions/list', { token, body: { archived: true } })), [ordinaryId],
      'the archived view names exactly the archived session')

    // The header read still answers, and archiving rewrote no log.
    const read = await request('/sessions/read', { token, body: { sessionId: ordinaryId } })
    assert.equal(read.status, 200, read.text)
    assert.equal(read.json.session.id, ordinaryId)
    assert.equal(logDigest(ordinaryId), digestBefore, 'archiving must not rewrite the session log')

    // The restore path needs the messages, and they are still there.
    const transcript = await request('/chat/read', { token, body: { sessionId: ordinaryId } })
    assert.equal(transcript.status, 200, transcript.text)
    assert.ok(transcript.json.projection.messages.some(message => message.text.includes('北京咖啡馆周末讨论')),
      `an archived session keeps its messages: ${transcript.text}`)
  })

  test('the primary session is refused by the backend with its own code', async () => {
    const user = await register('archive-owner-primary')
    const primary = await request('/sessions/create', { token: user.token })
    assert.equal(primary.status, 200, primary.text)
    const primaryId = primary.json.session.id

    const refused = await request('/sessions/archive', { token: user.token, body: { sessionId: primaryId } })
    assert.equal(refused.status, 409, refused.text)
    assert.equal(refused.json.error.code, 'sessions/primary-not-archivable')
    assert.equal(refused.json.session, undefined, 'a refused archive must not name a session')
    assert.deepEqual(idsOf(await request('/sessions/list', { token: user.token })), [primaryId],
      'the refused archive left the primary in the default list')
    assert.deepEqual(idsOf(await request('/sessions/list', { token: user.token, body: { archived: true } })), [])
    const returned = await request('/sessions/primary', { token: user.token })
    assert.equal(returned.json.session.id, primaryId, 'the primary binding is untouched')
  })

  test('archiving is idempotent and leaves one archived entry', async () => {
    const { user, ordinaryId } = await identityWithOrdinary('archive-owner-twice')
    const token = user.token
    for (const attempt of [1, 2]) {
      const archived = await request('/sessions/archive', { token, body: { sessionId: ordinaryId } })
      assert.equal(archived.status, 200, `archive attempt ${attempt} must succeed: ${archived.text}`)
      assert.equal(archived.json.session.id, ordinaryId)
    }
    assert.deepEqual(idsOf(await request('/sessions/list', { token, body: { archived: true } })), [ordinaryId],
      'a repeated archive is one archived session, not two rows')
    assert.equal(idsOf(await request('/sessions/list', { token })).includes(ordinaryId), false)
    const read = await request('/sessions/read', { token, body: { sessionId: ordinaryId } })
    assert.equal(read.status, 200, read.text)
  })

  test('the archived view lists the most recently archived session first', async () => {
    const { user, ordinaryId } = await identityWithOrdinary('archive-owner-order')
    const token = user.token
    // A second session, so the two archives have distinct instants and distinct
    // creation instants: creation order would answer the reverse of what the
    // recorded archive instant says. The ordinary session is empty, so it has to
    // carry a message before create stops reusing it.
    await say(token, ordinaryId, 'the first session to archive')
    const second = await request('/sessions/create', { token })
    assert.equal(second.status, 200, second.text)
    const secondId = second.json.session.id
    assert.notEqual(secondId, ordinaryId, 'a session whose log carries a message is not reused')

    assert.equal((await request('/sessions/archive', { token, body: { sessionId: ordinaryId } })).status, 200)
    assert.equal((await request('/sessions/archive', { token, body: { sessionId: secondId } })).status, 200)

    const archived = idsOf(await request('/sessions/list', { token, body: { archived: true } }))
    assert.deepEqual(archived, [secondId, ordinaryId],
      `the archived view reads newest-archived first: ${JSON.stringify(archived)}`)
  })

  test('an archived empty session is never entered again by create', async () => {
    const { user, primaryId, ordinaryId } = await identityWithOrdinary('archive-owner-empty')
    const token = user.token

    // The ordinary session is still empty, which is exactly what create reuses.
    const reused = await request('/sessions/create', { token })
    assert.equal(reused.json.session.id, ordinaryId, 'the empty ordinary session is the reusable one before archiving')

    const archived = await request('/sessions/archive', { token, body: { sessionId: ordinaryId } })
    assert.equal(archived.status, 200, archived.text)

    const created = await request('/sessions/create', { token })
    assert.equal(created.status, 200, created.text)
    assert.notEqual(created.json.session.id, ordinaryId,
      'an archived empty session is not entered again')
    assert.notEqual(created.json.session.id, primaryId)
    assert.equal(created.json.session.primary, false)
    assert.deepEqual(idsOf(await request('/sessions/list', { token })).sort(), [primaryId, created.json.session.id].sort())
    assert.deepEqual(idsOf(await request('/sessions/list', { token, body: { archived: true } })), [ordinaryId])

    // The fresh empty session is now the reusable one; the archived row stays put.
    const again = await request('/sessions/create', { token })
    assert.equal(again.json.session.id, created.json.session.id)
    assert.deepEqual(idsOf(await request('/sessions/list', { token, body: { archived: true } })), [ordinaryId])
  })

  test('conversation search does not return an archived session', async () => {
    const { user, primaryId, ordinaryId } = await identityWithOrdinary('archive-owner-search')
    const token = user.token
    await say(token, ordinaryId, '春天的计划。'.repeat(5) + '北京咖啡馆周末讨论' + '等待确认时间。'.repeat(5))
    // Search only covers the caller's *other* sessions, so it runs in the primary.
    const before = valueOf(await tool(token, 'conversation_search', { query: '咖啡馆', limit: 1 }, primaryId))
    assert.equal(before.matches.length, 1)
    assert.equal(before.matches[0].sessionId, ordinaryId)

    const archived = await request('/sessions/archive', { token, body: { sessionId: ordinaryId } })
    assert.equal(archived.status, 200, archived.text)

    const after = valueOf(await tool(token, 'conversation_search', { query: '咖啡馆', limit: 1 }, primaryId))
    assert.deepEqual(after.matches, [], 'an archived session is not a search source')
  })

  test('another identity can neither archive nor read a session', async () => {
    const { user, ordinaryId } = await identityWithOrdinary('archive-owner-scope')
    const stranger = await register('archive-stranger')
    const ownerArchived = await request('/sessions/archive', { token: user.token, body: { sessionId: ordinaryId } })
    assert.equal(ownerArchived.status, 200, ownerArchived.text)

    const refusedArchive = await request('/sessions/archive', { token: stranger.token, body: { sessionId: ordinaryId } })
    assert.equal(refusedArchive.status, 404, refusedArchive.text)
    assert.equal(refusedArchive.json.error.code, 'sessions/unknown-session')
    assert.equal(refusedArchive.json.session, undefined, 'a refused archive discloses no session')

    const refusedRead = await request('/sessions/read', { token: stranger.token, body: { sessionId: ordinaryId } })
    assert.equal(refusedRead.status, 404, refusedRead.text)
    assert.equal(refusedRead.json.error.code, 'sessions/unknown-session')

    // The stranger's own view is unaffected by the owner's archive.
    assert.deepEqual(idsOf(await request('/sessions/list', { token: stranger.token })), [])
    assert.deepEqual(idsOf(await request('/sessions/list', { token: stranger.token, body: { archived: true } })), [])
    // The owner's archive is still exactly where it was.
    assert.deepEqual(idsOf(await request('/sessions/list', { token: user.token, body: { archived: true } })), [ordinaryId])
  })

  test('the archive route refuses a nameless, unknown or anonymous request', async () => {
    const user = await register('archive-owner-shape')
    const anonymous = await request('/sessions/archive', { body: { sessionId: 'anything' } })
    assert.equal(anonymous.status, 401, anonymous.text)
    assert.equal(anonymous.json.error.code, 'sessions/unauthorized')

    const nameless = await request('/sessions/archive', { token: user.token })
    assert.equal(nameless.status, 400, nameless.text)
    assert.equal(nameless.json.error.code, 'sessions/invalid-request')

    const unknown = await request('/sessions/archive', { token: user.token, body: { sessionId: 'not-a-session' } })
    assert.equal(unknown.status, 404, unknown.text)
    assert.equal(unknown.json.error.code, 'sessions/unknown-session')
  })

  test('an archive survives a restart and keeps the log and messages', async () => {
    const { user, primaryId, ordinaryId } = await identityWithOrdinary('archive-owner-restart')
    const token = user.token
    await say(token, ordinaryId, 'restart keeps this message')
    const archived = await request('/sessions/archive', { token, body: { sessionId: ordinaryId } })
    assert.equal(archived.status, 200, archived.text)
    const digestBefore = logDigest(ordinaryId)

    await stopBackend()
    await startBackend()

    assert.deepEqual(idsOf(await request('/sessions/list', { token })), [primaryId],
      'after a restart the archived session is still out of the default list')
    assert.deepEqual(idsOf(await request('/sessions/list', { token, body: { archived: true } })), [ordinaryId],
      'after a restart the archive still names the session')
    const read = await request('/sessions/read', { token, body: { sessionId: ordinaryId } })
    assert.equal(read.status, 200, read.text)
    assert.equal(logDigest(ordinaryId), digestBefore, 'the restart and the archive wrote no log')
    const transcript = await request('/chat/read', { token, body: { sessionId: ordinaryId } })
    assert.equal(transcript.status, 200, transcript.text)
    assert.ok(transcript.json.projection.messages.some(message => message.text.includes('restart keeps this message')),
      'the archived session still holds its messages after a restart')

    // An empty archived session is still not reusable after the restart.
    const empty = await identityWithOrdinary('archive-owner-restart-empty')
    assert.equal((await request('/sessions/archive', { token: empty.user.token, body: { sessionId: empty.ordinaryId } })).status, 200)
    await stopBackend()
    await startBackend()
    const created = await request('/sessions/create', { token: empty.user.token })
    assert.notEqual(created.json.session.id, empty.ordinaryId,
      'an archived empty session stays out of the create reuse set after a restart')
  })
})

describe('OurFairy session restore over real HTTP', () => {
  test('restoring returns a session to the default list and drops it from the archived view', async () => {
    const { user, primaryId, ordinaryId } = await identityWithOrdinary('restore-owner-one')
    const token = user.token
    await say(token, ordinaryId, '恢复后要保留的内容')
    const archived = await request('/sessions/archive', { token, body: { sessionId: ordinaryId } })
    assert.equal(archived.status, 200, archived.text)

    const [archivedRow] = (await request('/sessions/list', { token, body: { archived: true } })).json.sessions
    assert.equal(archivedRow.id, ordinaryId)
    assert.notEqual(archivedRow.title, '', 'the archived view names an archived session')
    assert.notEqual(archivedRow.title, ordinaryId, 'an archived row never shows its raw id')
    const digestBefore = logDigest(ordinaryId)

    const restored = await request('/sessions/restore', { token, body: { sessionId: ordinaryId } })
    assert.equal(restored.status, 200, restored.text)
    assert.equal(restored.json.ok, true, restored.text)
    assert.equal(restored.json.session.id, ordinaryId)
    assert.equal(restored.json.session.title, archivedRow.title, 'restoring answers the same row, with the same title')
    assert.equal(restored.json.session.titleSource, archivedRow.titleSource)
    assert.equal(logDigest(ordinaryId), digestBefore, 'restoring writes the archive row, never the session log')

    // There is no physical delete anywhere on this family: the product's word
    // for it is the archive, and its only exits are the archive and the restore.
    const physical = await request('/sessions/delete', { token, body: { sessionId: ordinaryId } })
    assert.equal(physical.status, 404, 'no physical delete route exists')
    assert.equal(logDigest(ordinaryId), digestBefore, 'no request deletes a log')

    assert.deepEqual(idsOf(await request('/sessions/list', { token })).sort(), [primaryId, ordinaryId].sort(),
      'a restored session is back in the default list')
    assert.deepEqual(idsOf(await request('/sessions/list', { token, body: { archived: true } })), [],
      'a restored session is no longer an archived one')
  })

  test('restoring a foreign, unknown or active session changes nothing and says why', async () => {
    const { user, primaryId, ordinaryId } = await identityWithOrdinary('restore-owner-scope')
    const token = user.token
    const stranger = await register('restore-stranger')
    const archived = await request('/sessions/archive', { token, body: { sessionId: ordinaryId } })
    assert.equal(archived.status, 200, archived.text)

    // Someone else's archived session: the same 404 as an unknown one, and the
    // owner's archive still holds it.
    const foreign = await request('/sessions/restore', { token: stranger.token, body: { sessionId: ordinaryId } })
    assert.equal(foreign.status, 404, foreign.text)
    assert.equal(foreign.json.error.code, 'sessions/unknown-session')
    assert.equal(foreign.json.session, undefined, 'a refused restore names no session')

    // A session that exists and is this caller's, but is not archived: its own
    // code, because the session does exist.
    const active = await request('/sessions/restore', { token, body: { sessionId: primaryId } })
    assert.equal(active.status, 409, active.text)
    assert.equal(active.json.error.code, 'sessions/not-archived')
    assert.equal(active.json.session, undefined, 'a refused restore names no session')

    // A session nobody has: the ownership check refuses it before the archive.
    const unknown = await request('/sessions/restore', { token, body: { sessionId: 'not-a-session' } })
    assert.equal(unknown.status, 404, unknown.text)
    assert.equal(unknown.json.error.code, 'sessions/unknown-session')

    // Restoring twice is the same refusal: the second answer changes nothing.
    const again = await request('/sessions/restore', { token, body: { sessionId: ordinaryId } })
    assert.equal(again.status, 200, again.text)
    const twice = await request('/sessions/restore', { token, body: { sessionId: ordinaryId } })
    assert.equal(twice.status, 409, twice.text)
    assert.equal(twice.json.error.code, 'sessions/not-archived')

    // Every refusal above left both views exactly as they were.
    assert.deepEqual(idsOf(await request('/sessions/list', { token })), [primaryId, ordinaryId],
      'a refused restore changed nothing in the default list')
    assert.deepEqual(idsOf(await request('/sessions/list', { token, body: { archived: true } })), [],
      'a refused restore changed nothing in the archived view')
    assert.deepEqual(idsOf(await request('/sessions/list', { token: stranger.token })), [])
    assert.deepEqual(idsOf(await request('/sessions/list', { token: stranger.token, body: { archived: true } })), [])
  })

  test('a restore survives a restart, and the restored session continues its history', async () => {
    const { user, primaryId, ordinaryId } = await identityWithOrdinary('restore-owner-restart')
    const token = user.token
    await say(token, ordinaryId, '恢复前的第一句话')
    assert.equal((await request('/sessions/archive', { token, body: { sessionId: ordinaryId } })).status, 200)
    const restored = await request('/sessions/restore', { token, body: { sessionId: ordinaryId } })
    assert.equal(restored.status, 200, restored.text)

    await stopBackend()
    await startBackend()

    assert.deepEqual(idsOf(await request('/sessions/list', { token })).sort(), [primaryId, ordinaryId].sort(),
      'the restore is durable: the session is in the default list after a restart')
    assert.deepEqual(idsOf(await request('/sessions/list', { token, body: { archived: true } })), [],
      'the restored session is not archived again by the restart')

    // The history is intact, and the conversation can go on from it.
    const transcript = await request('/chat/read', { token, body: { sessionId: ordinaryId } })
    assert.equal(transcript.status, 200, transcript.text)
    assert.ok(transcript.json.projection.messages.some(message => message.text.includes('恢复前的第一句话')),
      `the restored session still holds its messages: ${transcript.text}`)
    await say(token, ordinaryId, '恢复后的第二句话')
    const continued = await request('/chat/read', { token, body: { sessionId: ordinaryId } })
    assert.equal(continued.status, 200, continued.text)
    assert.ok(continued.json.projection.messages.some(message => message.text.includes('恢复前的第一句话')),
      'continuing after a restore does not lose the earlier message')
    assert.ok(continued.json.projection.messages.some(message => message.text.includes('恢复后的第二句话')),
      'the restored session answers and keeps the new message')

    // A restored row can be archived again, and that archive is a new fact.
    const again = await request('/sessions/archive', { token, body: { sessionId: ordinaryId } })
    assert.equal(again.status, 200, again.text)
    assert.deepEqual(idsOf(await request('/sessions/list', { token, body: { archived: true } })), [ordinaryId],
      'a restored session can be archived again')
    assert.equal((await request('/sessions/restore', { token, body: { sessionId: ordinaryId } })).status, 200,
      'the re-archived session restores again')
  })
})
