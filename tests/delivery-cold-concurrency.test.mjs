/**
 * Cold-write delivery under a concurrent resume (ticket #278).
 *
 * `delivery.settle` has two write paths for its target session: a session chat
 * already holds takes `runtime.events` + `runtime.barrier` over the live
 * session; a session with no Agent takes its own exclusive
 * `sessionPersistence.open(id, 'write')`, `sessions.prepare`, append and flush.
 * Both run inside the target's `runSession` queue, and chat's open/resume takes
 * the same queue, so the two should serialize. #275 will fold the cold path
 * into `ourfairyChatRuntime.appendOnce`; this suite pins the caller-visible
 * outcome of that concurrency first, against the current composition.
 *
 * Every case asserts only observable facts: the number of `delivery/message`
 * rows in the projection, the one `deliveries` row and its `status`/`message_id`,
 * HTTP status (the request helper requires 200), and the sender's own tool
 * result. No case asserts which write path ran, nor the queue implementation.
 *
 * The last case makes the target session's log file read-only: a filesystem
 * condition at the cold write's durability boundary, not a product seam. The
 * cold path emits no `session/event`, so the existing outlet fault fixture
 * cannot reach it.
 *
 * @covers backend/delivery — this suite drives the row through the product's
 * chat and HTTP routes rather than importing it.
 * @covers backend/chat — `/chat/read` and `/chat/observe` are the resume side
 * of the race: each opens (resumes) the cold target session.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { join } from 'node:path'
import { chmodSync, readFileSync, readdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { before, after, test } from 'node:test'
import { describeRun, makeHome, registerUser, removeHome, runBackendAsync, startArgs, startedPort, toolResultBlocks } from './helpers/backend.mjs'
import { answerIfTitle } from './helpers/title-aware.mjs'

const home = makeHome('ourfairy-delivery-cold-')
const password = 'delivery-cold-password'
/** Rounds of "cold settle vs /chat/read"; the ticket requires at least five. */
const OPEN_ROUNDS = 6
/** Rounds of "cold settle vs /chat/observe". */
const OBSERVE_ROUNDS = 5
/** Rounds of two senders racing into one already-materialized cold primary. */
const MULTI_ROUNDS = 3
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
let port, model, modelPort, admin, alice, db
let senderSession, adminSenderSession
let requestNo = 0

async function request(path, token, body = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
  }, body: JSON.stringify(body) })
  const value = await response.json()
  assert.equal(response.status, 200, JSON.stringify(value))
  return value
}

function user(name) { return registerUser(port, admin.token, name, password) }

/** The content blocks of one wire message; a plain string is a text block. */
const blocksOf = message => Array.isArray(message.content) ? message.content : [{ type: 'text', text: message.content }]

/**
 * Drive one real tool execution through the sender's chat turn.
 *
 * The model double turns a command-shaped user message into the tool call, the
 * product executes it, and the result comes back as the assistant's next step.
 * The returned value is the tool result content as the product rendered it.
 */
async function tool(sender, name, args, sessionId, callId) {
  const seen = new Set((await request('/chat/read', sender.token, { sessionId })).projection.messages.map(message => message.messageId))
  await request('/chat/send', sender.token, { sessionId, requestId: `cold-tool-${++requestNo}`, text: JSON.stringify({ name, args, callId }) })
  const until = Date.now() + 20000
  while (Date.now() < until) {
    const { projection } = await request('/chat/read', sender.token, { sessionId })
    const fresh = projection.messages.filter(message => message.role === 2 && message.text.startsWith('RESULT:'))
      .find(message => !seen.has(message.messageId))
    if (fresh) return fresh.text.slice(7)
    if (projection.error) assert.fail(`chat failed before the tool result: ${projection.error}`)
    await delay(25)
  }
  assert.fail(`tool ${name} reply was not returned to its sender session ${sessionId}`)
}

/** The receipt object one successful `deliver_message` answered with. */
function receiptOf(result) {
  const text = JSON.parse(result).filter(block => block.type === 'text').map(block => block.text).join('')
  return JSON.parse(text)
}

/** The one text of a delivered-message event. */
const deliveryText = event => event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')

/** The delivery events the projection carries for one delivered text. */
const deliveryEvents = (projection, text) => projection.events.filter(event => event.type === 'delivery/message' && deliveryText(event) === text)

/** Wait for one condition, polling the projection the phone reads. */
async function eventually(work, check, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let value
  do { value = await work(); if (check(value)) return value; await delay(25) } while (Date.now() < deadline)
  assert.fail(`condition not reached; last value was ${JSON.stringify(value)?.slice(0, 500)}`)
}

/** One `/chat/read` projection of the recipient's target session. */
async function projectionOf(recipient, target) {
  return (await request('/chat/read', recipient.token, { sessionId: target })).projection
}

/**
 * Wait until the delivery's coordination row exists.
 *
 * The row is written immediately before the settle that appends to the target
 * session, so firing the competing open at that instant puts the two on the
 * target's queue together; this only times the request, no assertion depends
 * on it.
 */
async function deliveryRowAppeared(text, timeoutMs = 15000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      const row = db.prepare('SELECT status FROM deliveries WHERE text = ?').get(text)
      if (row !== undefined) return row
    } catch { /* a concurrent write may hold the read for one attempt */ }
    await delay(1)
  }
  assert.fail(`the delivery row for ${JSON.stringify(text)} never appeared`)
}

/**
 * Open `/chat/observe` and collect frames until it is closed.
 *
 * Resolves once the route has answered 200 and registered its observer; the
 * reader keeps appending to `frames` in the background.
 */
async function observe(token, sessionId) {
  const controller = new AbortController(), frames = []
  const response = await fetch(`http://127.0.0.1:${port}/chat/observe`, { method: 'POST', signal: controller.signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ sessionId }) })
  assert.equal(response.status, 200)
  const reader = response.body.getReader(), decoder = new TextDecoder()
  const settled = (async () => {
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let end
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const event = buffer.slice(0, end); buffer = buffer.slice(end + 2)
        const line = event.split('\n').find(candidate => candidate.startsWith('data: '))
        if (line) frames.push(JSON.parse(line.slice(6)))
      }
    }
  })().catch(error => { if (!controller.signal.aborted) throw error })
  return { frames, async close() { controller.abort(); await settled } }
}

/**
 * One delivery's caller-visible settlement: exactly one event, one message row
 * and one delivered coordination row, and the row names the projected message.
 */
async function oneDelivery(recipient, target, text, result, label) {
  const projection = await projectionOf(recipient, target)
  const events = deliveryEvents(projection, text)
  assert.equal(events.length, 1, `${label}: exactly one delivery/message in the projection`)
  assert.equal(projection.messages.filter(message => message.text === text).length, 1, `${label}: exactly one transcript row`)
  const rows = db.prepare('SELECT delivery_id, status, message_id FROM deliveries WHERE text = ?').all(text)
  assert.equal(rows.length, 1, `${label}: exactly one delivery row`)
  assert.equal(rows[0].status, 1, `${label}: the row is durably delivered`)
  assert.equal(rows[0].message_id, events[0].data.message.id, `${label}: the row names the one projected message`)
  assert.equal(receiptOf(result).deliveryId, rows[0].delivery_id, `${label}: the sender was answered with that delivery identity`)
  return { projection, event: events[0], row: rows[0] }
}

/** A later chat turn on the reopened session still works and appends no delivery. */
async function chatStillWorks(recipient, target, text, label) {
  const { receipt } = await request('/chat/send', recipient.token, { sessionId: target, requestId: `cold-after-${++requestNo}`, text })
  assert.ok(receipt.messageId, `${label}: the session accepts a chat turn after the race`)
  const projection = await eventually(() => projectionOf(recipient, target), value => value.replyStatus === 0
    && value.messages.some(message => message.role === 2 && message.text === `CHAT:${text}`))
  return projection
}

/** The durable session log of one cold session, found by its directory segment. */
function sessionLogOf(sessionId) {
  const found = []
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (path.split('/').includes(sessionId) && /\.jsonl(\.zstd)?$/.test(entry.name)) found.push(path)
    }
  }
  walk(join(home, 'dsh-home'))
  assert.equal(found.length, 1, `one durable log names ${sessionId}: ${JSON.stringify(found)}`)
  return found[0]
}

async function startBackend() {
  // This suite drives many tool turns through one source session; keep them
  // below the maintenance threshold so it tests delivery, not maintenance.
  const run = await runBackendAsync(startArgs(), { OURFAIRY_HOME: home, OURFAIRY_PHAETHON_PASSWORD: password,
    MINIMAX_CN_API_KEY: 'mock-cold-delivery-key', OURFAIRY_MINIMAX_BASE_URL: `http://127.0.0.1:${modelPort}`,
    OURFAIRY_MEMORY_MAINTENANCE_TURNS: '50' })
  port = startedPort(run)
}

async function stopBackend() {
  const run = await runBackendAsync(['stop', '--json'], { OURFAIRY_HOME: home })
  assert.equal(run.code, 0, describeRun('stop', run))
}

before(async () => {
  model = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk
    // The deployment route also answers session-title requests; a double that
    // scripts conversation turns must not treat one as a turn.
    if (answerIfTitle(data, res)) return
    const body = JSON.parse(data)
    // The harness injects its own runtime context as a separate user message,
    // so the turn's input is the user blocks after the last assistant message;
    // the injected context is not part of the caller's text.
    const lastAssistant = body.messages.findLastIndex(message => message.role === 'assistant')
    const turnBlocks = body.messages.slice(lastAssistant + 1).filter(message => message.role === 'user').flatMap(blocksOf)
    // A tool continuation arrives as the result the product already executed;
    // hand it back as assistant text so the sender's chat can observe it.
    const toolResult = turnBlocks.findLast(block => block.type === 'tool_result')
    // A command-shaped user message asks the real product to run one tool.
    const command = toolResult === undefined
      ? turnBlocks.findLast(block => block.type === 'text' && block.text.startsWith('{"name":'))
      : undefined
    const userText = turnBlocks.findLast(block => block.type === 'text' && !block.text.startsWith('{"name":')
      && !block.text.startsWith('Current runtime context.'))?.text ?? ''
    const reply = `CHAT:${userText}`
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const emit = event => res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    emit({ type: 'message_start', message: { id: 'cold-message', type: 'message', role: 'assistant', model: 'test', content: [], usage: { input_tokens: 3, output_tokens: 0 } } })
    if (command !== undefined) {
      const call = JSON.parse(command.text)
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: call.callId, name: call.name, input: {} } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(call.args) } })
    } else {
      const text = toolResult !== undefined ? `RESULT:${JSON.stringify(toolResultBlocks(toolResult))}` : reply
      emit({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })
      emit({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })
    }
    emit({ type: 'content_block_stop', index: 0 })
    emit({ type: 'message_delta', delta: { stop_reason: command !== undefined ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } })
    emit({ type: 'message_stop' })
    res.end()
  })
  model.listen(0, '127.0.0.1'); await once(model, 'listening'); modelPort = model.address().port
  await startBackend()
  admin = await request('/identity/sign-in', undefined, { name: 'phaethon', password })
  alice = await user('cold-alice')
  senderSession = (await request('/sessions/create', alice.token)).session.id
  adminSenderSession = (await request('/sessions/create', admin.token)).session.id
  db = new DatabaseSync(join(home, 'dsh-home', 'identity', 'identity.sqlite'))
})

after(async () => {
  db?.close()
  await stopBackend()
  await new Promise(resolve => model.close(resolve))
  removeHome(home)
})

test('a cold settle racing /chat/read leaves one delivery and an openable session, round after round', async () => {
  for (let round = 1; round <= OPEN_ROUNDS; round++) {
    const recipient = await user(`cold-open-${round}`)
    const target = (await request('/sessions/primary', recipient.token)).session.id
    const text = `Cold open round ${round}`
    const callId = `cold-open-call-${round}`
    // Start the delivery turn, then open the same cold session exactly when the
    // delivery's durable row says its settle is next: the two requests meet on
    // the target session's queue.
    const pending = tool(alice, 'deliver_message', { recipientShortId: recipient.user.shortId, text }, senderSession, callId)
    await deliveryRowAppeared(text)
    const [result, opened] = await Promise.all([pending, request('/chat/read', recipient.token, { sessionId: target })])
    assert.match(result, /deliveryId/, `round ${round}: the delivery was confirmed to its sender`)
    assert.equal(opened.projection.sessionId, target, `round ${round}: the concurrent read answered for the target session`)
    const settled = await oneDelivery(recipient, target, text, result, `round ${round}`)
    const afterChat = await chatStillWorks(recipient, target, `cold-open-after-${round}`, `round ${round}`)
    const again = deliveryEvents(afterChat, text)
    assert.equal(again.length, 1, `round ${round}: the later chat turn appends no second delivery`)
    assert.equal(again[0].seq, settled.event.seq, `round ${round}: it is the same projected event`)
  }
})

test('a cold settle racing /chat/observe publishes the one delivery to the observer', async () => {
  for (let round = 1; round <= OBSERVE_ROUNDS; round++) {
    const recipient = await user(`cold-observe-${round}`)
    const target = (await request('/sessions/primary', recipient.token)).session.id
    const text = `Cold observe round ${round}`
    const callId = `cold-observe-call-${round}`
    const pending = tool(alice, 'deliver_message', { recipientShortId: recipient.user.shortId, text }, senderSession, callId)
    await deliveryRowAppeared(text)
    const [result, observation] = await Promise.all([pending, observe(recipient.token, target)])
    try {
      assert.match(result, /deliveryId/, `round ${round}: the delivery was confirmed to its sender`)
      await oneDelivery(recipient, target, text, result, `round ${round}`)
      const frame = await eventually(() => observation.frames.at(-1), value => value !== undefined
        && value.messages.filter(message => message.text === text).length === 1, 20000)
      assert.equal(frame.sessionId, target, `round ${round}: the observer stayed on the target session`)
      assert.equal(deliveryEvents(frame, text).length, 1, `round ${round}: the observer's projection carries exactly one delivery/message`)
      assert.ok(observation.frames.every(candidate => candidate.messages.filter(message => message.text === text).length <= 1),
        `round ${round}: no published frame ever showed the delivery twice`)
      const afterChat = await chatStillWorks(recipient, target, `cold-observe-after-${round}`, `round ${round}`)
      assert.equal(deliveryEvents(afterChat, text).length, 1, `round ${round}: the later chat turn appends no second delivery`)
    } finally {
      await observation.close()
    }
  }
})

test('two senders delivering repeatedly into one already-cold primary keep one message per delivery', async () => {
  // `text-delivery`'s simultaneous-senders case races `/sessions/primary` too;
  // here the primary is already materialized and only the two settles meet on
  // its queue, repeated, with the target never opened until the end.
  const recipient = await user('cold-multi-recipient')
  const target = (await request('/sessions/primary', recipient.token)).session.id
  const texts = []
  for (let round = 1; round <= MULTI_ROUNDS; round++) {
    const fromAlice = `Alice cold multi ${round}`
    const fromPhaethon = `Phaethon cold multi ${round}`
    texts.push(fromAlice, fromPhaethon)
    const [aliceResult, phaethonResult] = await Promise.all([
      tool(alice, 'deliver_message', { recipientShortId: recipient.user.shortId, text: fromAlice }, senderSession, `cold-multi-alice-${round}`),
      tool(admin, 'deliver_message', { recipientShortId: recipient.user.shortId, text: fromPhaethon }, adminSenderSession, `cold-multi-phaethon-${round}`),
    ])
    assert.match(aliceResult, /deliveryId/, `round ${round}: Alice's delivery was confirmed`)
    assert.match(phaethonResult, /deliveryId/, `round ${round}: Phaethon's delivery was confirmed`)
    for (const text of [fromAlice, fromPhaethon]) {
      const rows = db.prepare('SELECT delivery_id, status, message_id FROM deliveries WHERE text = ?').all(text)
      assert.equal(rows.length, 1, `round ${round}: one row for ${JSON.stringify(text)}`)
      assert.equal(rows[0].status, 1, `round ${round}: ${JSON.stringify(text)} is durably delivered`)
    }
  }
  const projection = await projectionOf(recipient, target)
  assert.equal(projection.events.filter(event => event.type === 'delivery/message').length, 2 * MULTI_ROUNDS,
    'every concurrent delivery is exactly one delivery/message')
  assert.deepEqual(projection.messages.map(message => message.text).sort(), [...texts].sort(),
    'the cold writes compose in order without duplicates or losses')
  assert.ok(projection.messages.every(message => message.role === 2), 'each delivery is one assistant row')
  await chatStillWorks(recipient, target, 'cold-multi-after', 'after all rounds')
  assert.equal(deliveryEvents(await projectionOf(recipient, target), texts[0]).length, 1, 'the later chat turn appends no second delivery')
})

test('a failed cold durability write confirms nothing and its exact retry settles one delivery', async () => {
  const recipient = await user('cold-write-failure')
  const target = (await request('/sessions/primary', recipient.token)).session.id
  // The cold path writes through its own persistence handle and emits no
  // `session/event`, so the outlet fault fixture cannot reach it. A read-only
  // log file is a filesystem condition at exactly that durability boundary.
  const log = sessionLogOf(target)
  const durable = readFileSync(log)
  const text = 'Cold write fails at the durable append'
  const args = { recipientShortId: recipient.user.shortId, text }
  chmodSync(log, 0o400)
  try {
    const failed = await tool(alice, 'deliver_message', args, senderSession, 'cold-write-failure-call')
    assert.doesNotMatch(failed, /deliveryId/, 'a failed cold write never confirms the delivery')
  } finally {
    chmodSync(log, 0o600)
  }
  const pending = db.prepare('SELECT status FROM deliveries WHERE text = ?').all(text)
  assert.equal(pending.length, 1, 'the failed attempt leaves one coordination row')
  assert.equal(pending[0].status, 0, 'the coordination row stays ready for its exact retry')
  assert.deepEqual(readFileSync(log), durable, 'the failed write leaves the durable log byte-for-byte unchanged')
  const retried = await tool(alice, 'deliver_message', args, senderSession, 'cold-write-failure-call')
  const settled = await oneDelivery(recipient, target, text, retried, 'after the permission is restored')
  assert.equal(settled.row.status, 1, 'the exact retry settles the same identity')
  await chatStillWorks(recipient, target, 'cold-write-after', 'after the retry')
})
