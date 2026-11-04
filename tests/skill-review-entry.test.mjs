/**
 * Ticket #295 review E1: the pending-entry click starts a real review turn.
 *
 * Every case drives the shipped launcher, the real API server, the real SQLite
 * store and the real verification runner. A model double speaks the Messages
 * protocol and turns `[[tool:<name>:<json>]]` into a real tool call, so the
 * candidate is created through the same `skill_manage` seam the model uses.
 *
 * The reference under test is delivered by `POST /skills/review-open`: the
 * model must receive it in a turn nobody typed a chat message for, the chat
 * projection must not show it as a user bubble, and a repeated or concurrent
 * open must neither stack references nor start another turn.
 *
 * @covers backend/skill-creator — the pending-entry review turn and its system-context reference.
 */
import assert from 'node:assert/strict'
import { once } from 'node:events'
import http from 'node:http'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { describeRun, httpJson, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-skill-review-entry-')
const password = 'skill-review-entry-password'
const skillRoot = join(home, 'dsh-home', 'skill')
const databasePath = join(skillRoot, 'skill.sqlite')

let model
let port
let admin
let alice
let bob
let sessionAlice
let run
let requestNo = 0
let callNo = 0
const requests = []
const ids = {}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

/** One product POST, asserting the HTTP status through the shared helper. */
function request(path, token, body = {}) {
  return httpJson(port, path, { token, body })
}

/** One version row by id. */
function versionOf(versionId) {
  const database = new DatabaseSync(databasePath)
  try {
    return database.prepare('SELECT * FROM skill_version WHERE id = ?').get(versionId)
  } finally {
    database.close()
  }
}

/** All text blocks of one model request, joined, for reference assertions. */
function requestText(body) {
  return (body?.messages ?? []).flatMap(message => {
    const content = message.content
    if (typeof content === 'string') return [content]
    return Array.isArray(content) ? content.filter(block => block.type === 'text').map(block => block.text) : []
  }).join('\n')
}

/** Poll until a predicate answers something, failing the case after the budget. */
async function waitFor(what, predicate, timeout = 30_000) {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = await predicate()
    if (value !== undefined && value !== false) return value
    await delay(20)
  }
  assert.fail(`timed out waiting for ${what}`)
}

/** Wait until one session has no running reply, so the next case starts quiet. */
async function waitIdle(identity, sessionId) {
  await waitFor(`session ${sessionId} to settle`, async () => {
    const { projection } = await request('/chat/read', identity.token, { sessionId })
    return projection.replyStatus === 0 ? projection : undefined
  })
  return (await request('/chat/read', identity.token, { sessionId })).projection
}

/** The whole committed log of one session, paged from its current cut. */
async function readEvents(identity, sessionId) {
  const read = await request('/chat/read', identity.token, { sessionId })
  const cut = read.projection.cursor
  const events = []
  let beforeSeq = cut + 1
  while (beforeSeq > 0) {
    const { page } = await request('/chat/page', identity.token, { sessionId, throughSeq: cut, beforeSeq, maxEvents: 128 })
    events.unshift(...page.events)
    beforeSeq = page.beforeSeq ?? 0
  }
  return events
}

/** The review references of one session's durable log. */
function references(events, versionId) {
  return events.filter(event => event.type === 'user/message'
    && event.data.source?.kind === 'skill-review'
    && (versionId === undefined || event.data.source.versionId === versionId))
}

/** One turn's final reply; tool-only steps pass through with empty text. */
async function send(identity, sessionId, text) {
  const seen = new Set((await request('/chat/read', identity.token, { sessionId })).projection.messages.map(message => message.messageId))
  await request('/chat/send', identity.token, { sessionId, requestId: `review-entry-request-${++requestNo}`, text })
  const until = Date.now() + 30_000
  while (Date.now() < until) {
    const { projection } = await request('/chat/read', identity.token, { sessionId })
    const reply = projection.messages.find(message => message.role === 2 && message.status === 2
      && !seen.has(message.messageId) && message.text.startsWith('REPLY:'))
    if (reply) return projection
    if (projection.error) assert.fail(`the chat failed before the reply: ${projection.error}`)
    await delay(20)
  }
  assert.fail(`the reply never returned to ${sessionId}`)
}

/** One real model-issued `skill_manage` call, returning its JSON value. */
async function callTool(identity, sessionId, name, args = {}) {
  const before = new Set((await readEvents(identity, sessionId)).filter(event => event.type === 'tool/call').map(event => event.data.callId))
  await send(identity, sessionId, `[[tool:${name}:${JSON.stringify(args)}]]`)
  const events = await readEvents(identity, sessionId)
  const call = events.filter(event => event.type === 'tool/call' && event.data.name === name && !before.has(event.data.callId)).at(-1)
  assert.ok(call, `the log must contain the new ${name} call`)
  const result = events.find(event => event.type === 'tool/result' && event.data.message.toolCallId === call.data.callId)
  assert.ok(result, `the log must contain the result for ${call.data.callId}`)
  const text = (result.data.message.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('')
  let value
  try {
    value = JSON.parse(text)
  } catch {
    value = undefined
  }
  return { call, result, isError: result.data.message.isError === true, text, value }
}

/** A complete package as the model would submit it. */
function packageFiles(name, { description = 'Use when reviewing the reusable workflow.', body = '# Workflow\n\nRun the checked steps.' } = {}) {
  return [{ path: 'SKILL.md', content: `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n` }]
}

/** Boot the real backend against the shared model double. */
async function start() {
  run = await runBackendAsync(startArgs(), {
    OURFAIRY_HOME: home,
    OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-skill-review-entry-key',
    OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${model.address().port}`,
    // Background children reach the double too; keep both engines above this
    // suite's turn count so the recorded requests are the conversation's.
    OURFAIRY_MEMORY_MAINTENANCE_TURNS: '50',
  })
  port = startedPort(run)
}

/** Stop the backend and assert a clean exit. */
async function stop() {
  const stopped = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(stopped.code, 0, describeRun('stop', stopped))
}

before(async () => {
  model = http.createServer(async (incoming, response) => {
    const chunks = []
    for await (const chunk of incoming) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8')
    if (answerIfTitle(raw, response)) return
    const body = JSON.parse(raw)
    requests.push(body)
    const flat = (body.messages ?? []).flatMap(message => {
      const content = message.content
      if (typeof content === 'string') return [{ type: 'text', text: content }]
      return Array.isArray(content) ? content : []
    })
    const commandIndex = flat.findLastIndex(block => block.type === 'text' && typeof block.text === 'string'
      && block.text.startsWith('[[tool:'))
    const answered = commandIndex >= 0 && flat.slice(commandIndex + 1).some(block => block.type === 'tool_result')
    const toolCall = commandIndex >= 0 && !answered ? /^\[\[tool:([a-z_]+):([\s\S]*)\]\]$/u.exec(flat[commandIndex].text) : null
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    const emit = event => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'skill-review-entry-double', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (toolCall !== null) {
      const callId = `mock-call-${++callNo}`
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: callId, name: toolCall[1], input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: toolCall[2] } })
      emit({ type: 'content_block_stop', index: 0 })
      emit({ type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 3 } })
    } else {
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: `REPLY:${requests.length}` } })
      emit({ type: 'content_block_stop', index: 0 })
      emit({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
    }
    emit({ type: 'message_stop' })
    response.end()
  })
  model.listen(0, '127.0.0.1')
  await once(model, 'listening')

  await start()
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await registerUser(port, admin.token, 'review-entry-author', password)
  bob = await registerUser(port, admin.token, 'review-entry-outsider', password)
  sessionAlice = (await request('/sessions/create', alice.token)).session.id

  // Two real turns so `focus` has a closed turn and a current one to name.
  await send(alice, sessionAlice, 'PROBE: first real turn')
  await send(alice, sessionAlice, 'PROBE: second real turn')

  const created = await callTool(alice, sessionAlice, 'skill_manage', {
    action: 'create', scope: 1, focus: { kind: 'turn' },
    files: packageFiles('review-entry-check'), scenarios: [{ name: 'ok', command: 'true' }],
  })
  assert.equal(created.isError, false, `the candidate must create: ${created.text.slice(0, 400)}`)
  ids.candidate = created.value.versionId
})

after(async () => {
  try {
    await stop()
  } catch {
    // A failing assertion may have stopped the backend already.
  }
  if (model !== undefined) await new Promise(resolve => model.close(resolve))
  removeHome(home)
})

describe('review entry starts the review turn', () => {
  const primary = () => `ourfairy-user-${alice.user.shortId}-primary`

  test('the pending entry delivers one reference and the model turns without a typed message', async () => {
    const userMessagesBefore = (await readEvents(alice, primary()))
      .filter(event => event.type === 'user/message' && event.data.source?.kind === 'user').length
    const before = requests.length
    const opened = await request('/skills/review-open', alice.token, { versionId: ids.candidate })
    assert.equal(opened.sessionId, primary(), 'the entry always opens the caller\'s fixed primary session')

    const triggered = await waitFor('the review turn to reach the model', () => {
      const fresh = requests.slice(before).filter(body => requestText(body).includes('技能候选'))
      return fresh.length > 0 ? fresh : undefined
    })
    assert.equal(triggered.length, 1, 'one click starts exactly one review turn')
    const prompt = requestText(triggered[0])
    assert.match(prompt, /技能候选「review-entry-check」/u)
    assert.match(prompt, /skill_manage/u, 'the reference names the one next tool call')

    const projection = await waitIdle(alice, primary())
    assert.ok(projection.messages.some(message => message.role === 2 && message.text.startsWith('REPLY:')),
      'a real assistant reply was produced for the entry click')
    assert.ok(!projection.messages.some(message => message.role === 1 && message.text.includes('技能候选')),
      'the reference is not projected as a user bubble')

    const events = await readEvents(alice, primary())
    const found = references(events, ids.candidate)
    assert.equal(found.length, 1, 'exactly one durable reference exists')
    assert.equal(found[0].data.source.form, 'instructions')
    assert.equal(found[0].data.source.manifestHash, versionOf(ids.candidate).manifest_hash)
    assert.match((found[0].data.content ?? []).filter(block => block.type === 'text').map(block => block.text).join(''), /技能候选/u)
    const userMessages = events.filter(event => event.type === 'user/message' && event.data.source?.kind === 'user')
    assert.equal(userMessages.length, userMessagesBefore, 'the trigger does not fabricate a user message')
    assert.ok(!userMessages.some(event => (event.data.content ?? []).some(block => block.type === 'text'
      && block.text.includes('技能候选'))), 'no user message carries the reference text')
  })

  test('repeated and concurrent opens neither stack references nor start another turn', async () => {
    const second = await callTool(alice, sessionAlice, 'skill_manage', {
      action: 'create', scope: 1, focus: { kind: 'turn' },
      files: packageFiles('review-entry-check', { body: '# Workflow\n\nA second pending draft.' }),
      scenarios: [{ name: 'ok', command: 'true' }],
    })
    assert.equal(second.isError, false, second.text.slice(0, 400))

    const before = requests.length
    const [first, other] = await Promise.all([
      request('/skills/review-open', alice.token, { versionId: second.value.versionId }),
      request('/skills/review-open', alice.token, { versionId: second.value.versionId }),
    ])
    assert.equal(first.sessionId, primary())
    assert.equal(other.sessionId, primary())
    // A third, sequential open of the same candidate must be a no-op too.
    await request('/skills/review-open', alice.token, { versionId: second.value.versionId })

    const triggered = await waitFor('the second draft review turn', () => {
      const fresh = requests.slice(before).filter(body => requestText(body).includes('技能候选「review-entry-check」等待审核（版本 '
        + `${second.value.versionId}，`))
      return fresh.length > 0 ? fresh : undefined
    })
    assert.equal(triggered.length, 1, 'a candidate is reviewed once, however many times it is opened')

    const projection = await waitIdle(alice, primary())
    assert.ok(projection.messages.some(message => message.role === 2 && message.text.startsWith('REPLY:')))
    // Give a duplicate trigger time to surface before asserting its absence.
    await delay(1_000)
    assert.equal(requests.length, before + 1, 'no extra review turn was started')
    const events = await readEvents(alice, primary())
    assert.equal(references(events, second.value.versionId).length, 1)
    assert.equal(references(events).length, 2, 'one reference per candidate, not per click')
  })

  test('a refused or failed open writes no reference and starts no turn', async () => {
    const before = requests.length
    const aliceReferences = references(await readEvents(alice, primary()))
    const bobOpen = await httpJson(port, '/skills/review-open', {
      token: bob.token, body: { versionId: ids.candidate }, expect: false,
    })
    assert.equal(bobOpen.status, 404, 'another user cannot open the review entry')
    const missing = await httpJson(port, '/skills/review-open', {
      token: alice.token, body: { versionId: 999_999 }, expect: false,
    })
    assert.equal(missing.status, 404)

    await delay(1_000)
    assert.equal(requests.length, before, 'a refused open starts no model turn')
    assert.equal(references(await readEvents(alice, primary())).length, aliceReferences.length, 'nothing was appended')
    const bobSessions = await request('/sessions/list', bob.token, {})
    assert.equal(bobSessions.primarySessionId, null, 'the refusal did not even create a primary session to write into')
  })
})
